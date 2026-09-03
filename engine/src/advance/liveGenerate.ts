// Track 2 / Advance — the one bounded live model call, per round
// (§ Track 2 / Advance build order step 5: "Only now introduce the live
// model call... producing 0-2 items in that ONE call." Part 11 § Suggestion
// cardinality: "two ROUNDS, not two calls" — one initial round, one revision
// round if a material Track 1 update arrives, each round at most one call
// producing 0-2 items.).
//
// This is deliberately the ONLY file in engine/src/advance/ that imports the
// judge client / does network I/O — types.ts, policy.ts, and validator.ts
// stay exactly as isolated and zero-I/O as they were verified to be. This
// module is a thin orchestrator: check the policy short-circuit, build the
// prompt (prompt.ts), call the model (judgeClient.ts, same transport Track 1
// and Track 2/Challenge already use), validate the raw output (validator.ts)
// before anything is trusted. Never throws — every path returns a
// discriminated result with real token/cost provenance, same discipline as
// generateChallenges in ../judge/challengeGeneration.ts.
//
// NOT YET WIRED INTO ANY PRODUCT PATH. No persistence, no reviewFlow.ts
// integration, no route. This exists to let a small, explicitly-authorized
// number of real calls be made and assessed by hand before any of that is
// built.

import {
  createJudgeClient,
  DEFAULT_JUDGE_MODEL,
  type JudgeCallInput,
  type JudgeCallRecord,
  type JudgeClient,
} from "../judge/judgeClient.ts";
import { buildAdvancePrompt, ADVANCE_PROMPT_VERSION } from "./prompt.ts";
import { validateAdvanceOutput, type AdvanceValidationResult } from "./validator.ts";
import type { AdvanceMove, AdvanceSuggestion, InvocationContext, Track2EvidenceConstraint } from "./types.ts";

export interface GenerateAdvanceMoveOptions {
  /** Injected judge client. Defaults to a real DeepSeek client over the network. */
  client?: JudgeClient;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface GenerateAdvanceMoveResult {
  /** Set only when validation passed. 0-2 items — an empty array is a valid, non-error result ("no useful intervention"), distinct from `error` being set. */
  suggestions?: readonly AdvanceSuggestion[];
  /** Real provenance for this call — persisted regardless of whether the output validated. Absent entirely when the policy short-circuit fired (no call was made). */
  record?: JudgeCallRecord;
  /** Set when no usable result was produced — transport failure, parse failure, or policy/content rejection. Never set alongside `suggestions`. */
  error?: string;
}

/**
 * Makes at most ONE bounded call and returns a validated (possibly empty)
 * suggestion set, or a reason there isn't one. Never throws.
 *
 * Policy short-circuit (Part 11 § Suggestion cardinality, layer 2): if
 * `allowedMoves` is empty, no legal move exists for this invocation state —
 * skip the model call entirely, zero cost, zero network. Mirrors
 * challengeGeneration.ts's `cap === 0` short-circuit exactly.
 */
export async function generateAdvanceSuggestions(
  context: InvocationContext,
  allowedMoves: readonly AdvanceMove[],
  constraint: Track2EvidenceConstraint | undefined,
  options: GenerateAdvanceMoveOptions = {},
): Promise<GenerateAdvanceMoveResult> {
  if (allowedMoves.length === 0) {
    return { suggestions: [], error: "no_legal_move_for_this_state" };
  }

  const { system, user, question } = buildAdvancePrompt({ context, allowedMoves, constraint });
  const recordBase: JudgeCallRecord = {
    model: options.model ?? DEFAULT_JUDGE_MODEL,
    promptVersion: ADVANCE_PROMPT_VERSION,
    question,
  };

  let client: JudgeClient;
  try {
    client = options.client ?? createJudgeClient({ model: options.model, timeoutMs: options.timeoutMs });
  } catch (err) {
    return { record: { ...recordBase, error: (err as Error).message }, error: (err as Error).message };
  }

  const input: JudgeCallInput = {
    model: options.model,
    promptVersion: ADVANCE_PROMPT_VERSION,
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

  const validated: AdvanceValidationResult = validateAdvanceOutput(result.record.answer ?? "", { allowedMoves });
  if (!validated.ok) {
    // The record is returned intact (token counts included) even on a
    // rejected parse: the call happened and its cost is real, whether or not
    // its output survived validation. Whole-response rejection (§ validator.ts) —
    // there is no partial-credit path here either.
    return { record: result.record, error: validated.error };
  }

  return { suggestions: validated.suggestions, record: result.record };
}
