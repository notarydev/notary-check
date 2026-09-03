// Advance — persistence, into advance_invocation / advance_suggestion only
// (migration 0013_advance.sql). This is the ONE place a caller writes what
// generateAdvanceSuggestions() (liveGenerate.ts) returned; that module itself
// stays DB-free, same discipline as ../judge/challengeGeneration.ts being
// separate from ../review/reviewFlow.ts's persistence of challenge_item.
//
// Writes to advance_invocation and advance_suggestion and to nothing else —
// in particular, never claim, never evidence_match. Same authority boundary
// challenge_item's own persistence in reviewFlow.ts already holds: a
// suggestion register cannot reach either table from here because this
// module has no reference to either.

import type pg from "pg";
import { estimateDeepSeekCostCents } from "../quotas/usage.ts";
import { POLICY_VERSION } from "./policy.ts";
import type { GenerateAdvanceMoveResult } from "./liveGenerate.ts";
import type { AdvanceMove, AdvanceSuggestion } from "./types.ts";

export interface PersistAdvanceInput {
  organizationId: string;
  reviewId?: string;
  claimId?: string;
  invocationContextId: string;
  taskMode?: string;
  hasEvidenceConstraint: boolean;
  allowedMoves: readonly AdvanceMove[];
  result: GenerateAdvanceMoveResult;
}

export interface PersistedAdvance {
  invocationId: string;
  suggestions: readonly AdvanceSuggestion[];
}

/**
 * Persists one Advance call's outcome: exactly one advance_invocation row,
 * plus one advance_suggestion row per returned suggestion (0-2, ordinal 0/1 —
 * the UNIQUE (invocation_id, ordinal) index is the DB-visible half of the
 * cardinality cap validator.ts already enforced app-side).
 *
 * `status` is derived from the SAME distinction GenerateAdvanceMoveResult's
 * own doc comment draws: `suggestions` set (even empty) means the call
 * resolved and validated -> 'ok'; `record` set with no `suggestions` means a
 * call was attempted and failed (transport, validation, quota, kill switch)
 * -> 'error'; neither set (the allowedMoves===0 / no_user_request
 * short-circuits) -> 'skipped', no network, still a real, queryable row.
 */
export async function persistAdvanceInvocation(db: pg.Pool, input: PersistAdvanceInput): Promise<PersistedAdvance> {
  const { result } = input;
  const status: "ok" | "error" | "skipped" = result.suggestions !== undefined ? "ok" : result.record !== undefined ? "error" : "skipped";
  const model = result.record?.model ?? "none";
  const promptVersion = result.record?.promptVersion ?? "none";
  const error = result.error ?? null;
  const inputTokens = result.record?.inputTokens ?? null;
  const outputTokens = result.record?.outputTokens ?? null;
  const estimatedCostCents =
    inputTokens !== null && outputTokens !== null ? estimateDeepSeekCostCents(inputTokens, outputTokens) : null;

  const inserted = await db.query(
    `INSERT INTO advance_invocation
       (organization_id, review_id, claim_id, invocation_context_id, task_mode,
        has_evidence_constraint, allowed_moves, policy_version, model, prompt_version,
        status, error, input_tokens, output_tokens, estimated_cost_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      input.organizationId,
      input.reviewId ?? null,
      input.claimId ?? null,
      input.invocationContextId,
      input.taskMode ?? null,
      input.hasEvidenceConstraint,
      JSON.stringify(input.allowedMoves),
      POLICY_VERSION,
      model,
      promptVersion,
      status,
      error,
      inputTokens,
      outputTokens,
      estimatedCostCents,
    ],
  );
  const invocationId = inserted.rows[0].id as string;

  const suggestions = result.suggestions ?? [];
  for (const [ordinal, s] of suggestions.entries()) {
    await db.query(
      `INSERT INTO advance_suggestion (invocation_id, model_suggestion_id, ordinal, move, short_label, prompt)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [invocationId, s.id, ordinal, s.move, s.short_label, s.prompt],
    );
  }

  return { invocationId, suggestions };
}
