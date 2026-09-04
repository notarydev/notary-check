// Move — persistence, into act_invocation / act_move only
// (migration 0013_advance.sql). This is the ONE place a caller writes what
// generateMoves() (liveGenerate.ts) returned; that module itself
// stays DB-free, same discipline as ../judge/challengeGeneration.ts being
// separate from ../review/reviewFlow.ts's persistence of challenge_item.
//
// Writes to act_invocation and act_move and to nothing else —
// in particular, never claim, never evidence_match. Same authority boundary
// challenge_item's own persistence in reviewFlow.ts already holds: a
// move register cannot reach either table from here because this
// module has no reference to either.

import type pg from "pg";
import { estimateDeepSeekCostMillicents } from "../quotas/usage.ts";
import { POLICY_VERSION } from "./policy.ts";
import type { GenerateMoveResult } from "./liveGenerate.ts";
import type { MoveKind, Move } from "./types.ts";

export interface PersistMoveInput {
  organizationId: string;
  reviewId?: string;
  claimId?: string;
  invocationContextId: string;
  taskMode?: string;
  hasEvidenceConstraint: boolean;
  allowedMoves: readonly MoveKind[];
  result: GenerateMoveResult;
}

export interface PersistedMove {
  invocationId: string;
  moves: readonly Move[];
}

/**
 * Persists one Move call's outcome: exactly one act_invocation row,
 * plus one act_move row per returned move (0-2, ordinal 0/1 —
 * the UNIQUE (invocation_id, ordinal) index is the DB-visible half of the
 * cardinality cap validator.ts already enforced app-side).
 *
 * `status` is derived from the SAME distinction GenerateMoveResult's
 * own doc comment draws: `moves` set (even empty) means the call
 * resolved and validated -> 'ok'; `record` set with no `moves` means a
 * call was attempted and failed (transport, validation, quota, kill switch)
 * -> 'error'; neither set (the allowedMoves===0 / no_user_request
 * short-circuits) -> 'skipped', no network, still a real, queryable row.
 */
export async function persistMoveInvocation(db: pg.Pool, input: PersistMoveInput): Promise<PersistedMove> {
  const { result } = input;
  const status: "ok" | "error" | "skipped" = result.moves !== undefined ? "ok" : result.record !== undefined ? "error" : "skipped";
  const model = result.record?.model ?? "none";
  const promptVersion = result.record?.promptVersion ?? "none";
  const error = result.error ?? null;
  const inputTokens = result.record?.inputTokens ?? null;
  const outputTokens = result.record?.outputTokens ?? null;
  // Millicents only. estimated_cost_cents is GENERATED ALWAYS from this
  // (migration 0015) and cannot be written directly.
  const estimatedCostMillicents =
    inputTokens !== null && outputTokens !== null ? estimateDeepSeekCostMillicents(inputTokens, outputTokens) : null;

  const inserted = await db.query(
    `INSERT INTO act_invocation
       (organization_id, review_id, claim_id, invocation_context_id, task_mode,
        has_evidence_constraint, allowed_moves, policy_version, model, prompt_version,
        status, error, input_tokens, output_tokens, estimated_cost_millicents)
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
      estimatedCostMillicents,
    ],
  );
  const invocationId = inserted.rows[0].id as string;

  // The RETURNED move carries the DATABASE id, not the model's own.
  //
  // The model names its moves "s1"/"s2" — unique within one response and
  // meaningless outside it. Handing that id to the card meant an interaction
  // could not be tied back to a row: act_move_event.move_id is a foreign key,
  // and "s1" matches every invocation ever made. The model's id is still
  // stored as model_move_id for provenance; only what leaves this function
  // changes, and `Move.id` is opaque to every consumer of it.
  const persisted: Move[] = [];
  for (const [ordinal, s] of (result.moves ?? []).entries()) {
    const row = await db.query(
      `INSERT INTO act_move (invocation_id, model_move_id, ordinal, move, short_label, prompt)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [invocationId, s.id, ordinal, s.move, s.short_label, s.prompt],
    );
    persisted.push({ ...s, id: row.rows[0].id as string });
  }

  return { invocationId, moves: persisted };
}
