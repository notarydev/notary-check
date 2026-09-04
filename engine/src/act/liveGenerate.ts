// Act / Move — the one bounded live model call, per round
// (§ Act / Move build order step 5: "Only now introduce the live
// model call... producing 0-2 items in that ONE call." Part 11 § Move
// cardinality: "two ROUNDS, not two calls" — one initial round, one revision
// round if a material Verify update arrives, each round at most one call
// producing 0-2 items.).
//
// This is deliberately the ONLY file in engine/src/act/ that imports the
// judge client / does network I/O — types.ts, policy.ts, and validator.ts
// stay exactly as isolated and zero-I/O as they were verified to be. This
// module is a thin orchestrator: check the policy short-circuit, build the
// prompt (prompt.ts), call the model (judgeClient.ts, same transport Verify
// and Act/Challenge already use), validate the raw output (validator.ts)
// before anything is trusted. Never throws — every path returns a
// discriminated result with real token/cost provenance, same discipline as
// generateChallenges in ../judge/challengeGeneration.ts.
//
// NOT YET WIRED INTO ANY PRODUCT PATH. No persistence, no reviewFlow.ts
// integration, no route. This exists to let a small, explicitly-authorized
// number of real calls be made and assessed by hand before any of that is
// built.

import type pg from "pg";
import {
  createJudgeClient,
  DEFAULT_JUDGE_MODEL,
  type JudgeCallInput,
  type JudgeCallRecord,
  type JudgeClient,
} from "../judge/judgeClient.ts";
import { isJudgeDisabled } from "../judge/killSwitch.ts";
import { logEvent } from "../observability/log.ts";
import { checkQuota } from "../quotas/quotaCheck.ts";
import { buildMovePrompt, MOVE_PROMPT_VERSION } from "./prompt.ts";
import { validateMoveOutput, type MoveValidationResult } from "./validator.ts";
import type { MoveKind, Move, InvocationContext, ActEvidenceConstraint } from "./types.ts";

export interface GenerateMoveOptions {
  /** Injected judge client. Defaults to a real DeepSeek client over the network. */
  client?: JudgeClient;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /**
   * Org for the quota gate and observability. When provided together with
   * `db`, `checkQuota` is consulted before any client is constructed — the
   * same gate ../judge/challengeGeneration.ts and ../review/reviewFlow.ts
   * already apply to every other DeepSeek call site. Absent either one, the
   * quota gate is skipped (never silently enforced against a caller that
   * cannot supply it) — see the module comment on why this must not be the
   * case for any real-traffic call site: reviewFlow.ts's Move wiring
   * always supplies both.
   */
  organizationId?: string;
  db?: pg.Pool;
}

export interface GenerateMoveResult {
  /** Set only when validation passed. 0-2 items — an empty array is a valid, non-error result ("no useful intervention"), distinct from `error` being set. */
  moves?: readonly Move[];
  /** Real provenance for this call — persisted regardless of whether the output validated. Absent entirely when the policy short-circuit fired (no call was made). */
  record?: JudgeCallRecord;
  /** Set when no usable result was produced — transport failure, parse failure, or policy/content rejection. Never set alongside `moves`. */
  error?: string;
}

/**
 * Makes at most ONE bounded call and returns a validated (possibly empty)
 * move set, or a reason there isn't one. Never throws.
 *
 * Policy short-circuit (Part 11 § Move cardinality, layer 2): if
 * `allowedMoves` is empty, no legal move exists for this invocation state —
 * skip the model call entirely, zero cost, zero network. Mirrors
 * challengeGeneration.ts's `cap === 0` short-circuit exactly.
 */
export async function generateMoves(
  context: InvocationContext,
  allowedMoves: readonly MoveKind[],
  constraint: ActEvidenceConstraint | undefined,
  options: GenerateMoveOptions = {},
): Promise<GenerateMoveResult> {
  if (allowedMoves.length === 0) {
    return { moves: [], error: "no_legal_move_for_this_state" };
  }

  // POLICY-BOUNDARY SHORT-CIRCUIT: no user_request, no call. types.ts marks
  // `user_request` required because "Move has nothing to recommend a next
  // move ABOUT without knowing what was being asked" — a caller that has no
  // real user_request (the MCP tool's `user_request` field is optional; the
  // server only has it "when available") must not fabricate one just to
  // satisfy the type. Same shape as the allowedMoves short-circuit above:
  // zero cost, zero network, a real (non-guessed) result rather than a
  // special case the caller has to remember to apply itself.
  if (context.user_request.trim().length === 0) {
    return { moves: [], error: "no_user_request" };
  }

  const { system, user, question } = buildMovePrompt({ context, allowedMoves, constraint });
  const recordBase: JudgeCallRecord = {
    model: options.model ?? DEFAULT_JUDGE_MODEL,
    promptVersion: MOVE_PROMPT_VERSION,
    question,
  };

  // The judge kill switch governs every DeepSeek call in this system —
  // Move is one, and this was a known gap (it was not checked here at
  // all) before this change. When active, no client is constructed and no
  // network call is made, exactly like ../judge/challengeGeneration.ts.
  if (isJudgeDisabled()) {
    logEvent({
      event: "move_generation",
      path: "judge-involved",
      error_cause: "judge_kill_switch_active",
      organization_id: options.organizationId,
    });
    return { record: { ...recordBase, error: "judge_kill_switch_active" }, error: "judge_kill_switch_active" };
  }

  // The same quota gate every other DeepSeek call site in this codebase uses
  // (../judge/challengeGeneration.ts, ../review/reviewFlow.ts's field-judge
  // path) — checked, like the kill switch above, BEFORE any client is
  // constructed. This was the other known gap: Move's live call had no
  // quota consultation at all. organizationId/db are both required to run
  // the check (a caller with neither cannot be gated, but reviewFlow.ts's
  // real wiring always supplies both, so this is not a real-traffic gap).
  if (options.organizationId !== undefined && options.db !== undefined) {
    const quota = await checkQuota(options.organizationId, options.db);
    if (!quota.allowed) {
      logEvent({
        event: "move_generation",
        path: "judge-involved",
        error_cause: `quota_${quota.reason}`,
        organization_id: options.organizationId,
      });
      return { record: { ...recordBase, error: `quota_${quota.reason}` }, error: `quota_${quota.reason}` };
    }
  }

  let client: JudgeClient;
  try {
    client = options.client ?? createJudgeClient({ model: options.model, timeoutMs: options.timeoutMs });
  } catch (err) {
    return { record: { ...recordBase, error: (err as Error).message }, error: (err as Error).message };
  }

  const input: JudgeCallInput = {
    model: options.model,
    promptVersion: MOVE_PROMPT_VERSION,
    question,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: options.maxTokens,
  };

  let result;
  try {
    result = await client.call(input);
  } catch (err) {
    return { record: { ...recordBase, error: (err as Error).message }, error: (err as Error).message };
  }

  if (result.status === "error") {
    return { record: result.record, error: result.record.error };
  }

  const validated: MoveValidationResult = validateMoveOutput(result.record.answer ?? "", { allowedMoves });
  if (!validated.ok) {
    // The record is returned intact (token counts included) even on a
    // rejected parse: the call happened and its cost is real, whether or not
    // its output survived validation. Whole-response rejection (§ validator.ts) —
    // there is no partial-credit path here either.
    return { record: result.record, error: validated.error };
  }

  return { moves: validated.moves, record: result.record };
}
