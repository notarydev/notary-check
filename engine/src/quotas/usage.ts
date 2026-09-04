// UsageEvent shaping for § Core data model's UsageEvent table.
//
// This module has two jobs:
//   1. Map the data judgeClient.ts already returns on its call record
//      (inputTokens / outputTokens — it already tracks them) into a
//      UsageEvent-shaped record a caller can persist, with the
//      estimated_cost_cents derived from DeepSeek's published prices.
//   2. Insert a usage_event row into Postgres — the persistence half, which
//      belongs to the CALLER of a judge call, not to judgeClient.ts. That
//      module is deliberately DB-free (it has no DB dependency and must not
//      gain one); it returns token/cost data, and THIS module is the contract
//      a caller uses to store it.
//
// WIRING-POINT STATUS. Both DeepSeek call sites now persist usage:
//   - evidence-field judging — ../review/reviewFlow.ts, via
//     usageEventFromJudgeCall, written for every call that actually reached the
//     network (a token count on the record is the test);
//   - claim extraction — ../extraction/extractClaims.ts, via
//     usageEventFromExtractionCall. This one was MISSING until the audit found
//     it: extraction called DeepSeek, imported the cost estimator for a log
//     line, and wrote no ledger row and ran no quota check. Since checkQuota
//     sums exactly these rows, an unrecorded call is invisible to every later
//     check — the gap was not just a reporting hole, it was a hole in the
//     enforcement itself.

import type pg from "pg";
/**
 * The only thing this module needs from a model call: what it cost and which
 * model/prompt produced it. Declared HERE, structurally, rather than imported
 * from judge/judgeClient.ts's JudgeCallRecord.
 *
 * WHY. quotas/ is a lower layer than judge/ — judge/, extraction/ and act/ all
 * import this module to write their spend to the ledger. Importing a judge type
 * back made the two directories mutually dependent, which meant neither could
 * be read, tested, or replaced without the other, for the sake of four field
 * names. JudgeCallRecord still satisfies this shape structurally, so every
 * existing caller compiles unchanged and no cast is needed.
 *
 * scripts/check-boundaries.ts fails the build if the import comes back.
 */
export interface ModelCallRecord {
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * DeepSeek pricing, § Operating cost (off-peak cache-miss, the conservative
 * case). $0.22 / million input tokens, $0.66 / million output tokens. The
 * estimate here uses these constants so a usage row can be written at call
 * time without a pricing lookup.
 */
export const DEEPSEEK_INPUT_PRICE_USD_PER_MTOK = 0.22;
export const DEEPSEEK_OUTPUT_PRICE_USD_PER_MTOK = 0.66;

/** The shape of a UsageEvent row, as insertable. */
export interface UsageEventShape {
  organizationId: string;
  /** Nullable: no user model is wired in yet (see 0004's user stub). */
  userId?: string;
  /** Nullable: no review ownership exists on judge calls today. */
  reviewId?: string;
  eventType: string;
  inputTokens: number;
  outputTokens: number;
  fetchBytes: number;
  estimatedCostCents: number;
  /**
   * The same cost at 1000x resolution. This is the field the quota gates
   * actually sum — `estimatedCostCents` rounds a typical ~0.134-cent call to
   * 0, which made both spend caps sum zeros and never bite (migration 0015).
   * Keep both: cents stays the human-readable figure, millicents is the one
   * that enforces.
   */
  estimatedCostMillicents: number;
}

/** US dollars from a DeepSeek token count, via the constants above. Unrounded. */
function deepSeekCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * DEEPSEEK_INPUT_PRICE_USD_PER_MTOK +
    (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_PRICE_USD_PER_MTOK
  );
}

/**
 * Cents, rounded. FOR DISPLAY ONLY — do not sum these to enforce a cap.
 *
 * A typical call in this system costs about $0.00134 = 0.134 cents, which
 * rounds to 0 here. That is not a precision nit: both spend gates used to sum
 * this value, so they summed zeros and never fired. Use
 * `estimateDeepSeekCostMillicents` for anything that enforces (migration 0015).
 */
export function estimateDeepSeekCostCents(inputTokens: number, outputTokens: number): number {
  return Math.round(deepSeekCostUsd(inputTokens, outputTokens) * 100);
}

/**
 * Millicents (1/1000 of a cent) — the enforcing unit. A typical call lands
 * around 134 rather than 0, so a month of real traffic actually accumulates
 * toward the per-org limit and the global provider cap.
 */
export function estimateDeepSeekCostMillicents(inputTokens: number, outputTokens: number): number {
  return Math.round(deepSeekCostUsd(inputTokens, outputTokens) * 100_000);
}

export interface JudgeUsageMeta {
  organizationId: string;
  userId?: string;
  reviewId?: string;
}

/**
 * Maps a judge call's persisted record to a UsageEvent-shaped row. The caller
 * supplies the org/review context the judge client itself does not know about.
 */
export function usageEventFromJudgeCall(record: ModelCallRecord, meta: JudgeUsageMeta): UsageEventShape {
  const inputTokens = record.inputTokens ?? 0;
  const outputTokens = record.outputTokens ?? 0;
  return {
    organizationId: meta.organizationId,
    userId: meta.userId,
    reviewId: meta.reviewId,
    eventType: "judge_call",
    inputTokens,
    outputTokens,
    fetchBytes: 0,
    estimatedCostCents: estimateDeepSeekCostCents(inputTokens, outputTokens),
    estimatedCostMillicents: estimateDeepSeekCostMillicents(inputTokens, outputTokens),
  };
}

/**
 * Maps a CLAIM-EXTRACTION call's record to a UsageEvent-shaped row.
 *
 * Identical arithmetic to usageEventFromJudgeCall — same provider, same prices
 * — but a DIFFERENT event_type, and that difference is the point. Claim
 * extraction and evidence-field judging are two distinct DeepSeek call sites
 * with different volumes and different cost profiles; rolling them into one
 * "judge_call" bucket would make the per-org cost breakdown unable to answer
 * "what is actually driving this bill". Extraction was previously not recorded
 * at ALL (see extractClaims.ts's header), so every quota sum in the system was
 * computed against an incomplete ledger.
 */
export function usageEventFromExtractionCall(record: ModelCallRecord, meta: JudgeUsageMeta): UsageEventShape {
  const inputTokens = record.inputTokens ?? 0;
  const outputTokens = record.outputTokens ?? 0;
  return {
    organizationId: meta.organizationId,
    userId: meta.userId,
    reviewId: meta.reviewId,
    eventType: "claim_extraction",
    inputTokens,
    outputTokens,
    fetchBytes: 0,
    estimatedCostCents: estimateDeepSeekCostCents(inputTokens, outputTokens),
    estimatedCostMillicents: estimateDeepSeekCostMillicents(inputTokens, outputTokens),
  };
}

/**
 * Maps a ACT / CHALLENGE-GENERATION call's record to a UsageEvent row.
 *
 * Same arithmetic again, third distinct event_type, for the same reason
 * extraction got its own: Act is an ADDITIONAL DeepSeek call per material
 * claim on top of the field-judging calls, so folding it into "judge_call"
 * would hide exactly the cost question the feature flag exists to answer —
 * "what did enabling Act for this org actually add to the bill". It goes
 * through insertUsageEvent like every other call site, which is what makes it
 * visible to checkQuota's sums rather than a fourth unmetered path.
 */
export function usageEventFromChallengeCall(record: ModelCallRecord, meta: JudgeUsageMeta): UsageEventShape {
  const inputTokens = record.inputTokens ?? 0;
  const outputTokens = record.outputTokens ?? 0;
  return {
    organizationId: meta.organizationId,
    userId: meta.userId,
    reviewId: meta.reviewId,
    eventType: "challenge_generation",
    inputTokens,
    outputTokens,
    fetchBytes: 0,
    estimatedCostCents: estimateDeepSeekCostCents(inputTokens, outputTokens),
    estimatedCostMillicents: estimateDeepSeekCostMillicents(inputTokens, outputTokens),
  };
}

/**
 * Maps an MOVE-GENERATION call's record to a UsageEvent row. Same
 * arithmetic, own event_type — same rationale as challenge_generation's own
 * split: Move is an additional DeepSeek call per invocation on top of the
 * field-judging (and, where enabled, Challenge) calls, and folding it into
 * "judge_call" would hide exactly the cost question the quota gate exists to
 * answer. This is what makes a Move call visible to checkQuota's sums —
 * see engine/src/act/liveGenerate.ts's quota gate, which is only
 * meaningful if every call that passes it is also recorded here.
 */
export function usageEventFromMoveCall(record: ModelCallRecord, meta: JudgeUsageMeta): UsageEventShape {
  const inputTokens = record.inputTokens ?? 0;
  const outputTokens = record.outputTokens ?? 0;
  return {
    organizationId: meta.organizationId,
    userId: meta.userId,
    reviewId: meta.reviewId,
    eventType: "move_generation",
    inputTokens,
    outputTokens,
    fetchBytes: 0,
    estimatedCostCents: estimateDeepSeekCostCents(inputTokens, outputTokens),
    estimatedCostMillicents: estimateDeepSeekCostMillicents(inputTokens, outputTokens),
  };
}

/** Inserts a usage_event row. Returns the created row's id. */
export async function insertUsageEvent(db: pg.Pool, event: UsageEventShape): Promise<string> {
  const result = await db.query(
    `INSERT INTO usage_event (
       organization_id, user_id, review_id, event_type,
       input_tokens, output_tokens, fetch_bytes, estimated_cost_millicents
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      event.organizationId,
      event.userId ?? null,
      event.reviewId ?? null,
      event.eventType,
      event.inputTokens,
      event.outputTokens,
      event.fetchBytes,
      // estimated_cost_cents is GENERATED ALWAYS from this (migration 0015)
      // and cannot be written directly — that is what stops a caller from
      // silently under-metering by setting only the rounded cent value.
      event.estimatedCostMillicents,
    ],
  );
  return result.rows[0].id as string;
}
