// UsageEvent shaping for § Core data model's UsageEvent table.
//
// This module has two jobs:
//   1. Map the data judgeClient.ts already returns on JudgeCallRecord
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
import type { JudgeCallRecord } from "../judge/judgeClient.ts";

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
}

/** Cents from a DeepSeek token count, via the constants above. */
export function estimateDeepSeekCostCents(inputTokens: number, outputTokens: number): number {
  const usd =
    (inputTokens / 1_000_000) * DEEPSEEK_INPUT_PRICE_USD_PER_MTOK +
    (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_PRICE_USD_PER_MTOK;
  return Math.round(usd * 100);
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
export function usageEventFromJudgeCall(record: JudgeCallRecord, meta: JudgeUsageMeta): UsageEventShape {
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
export function usageEventFromExtractionCall(record: JudgeCallRecord, meta: JudgeUsageMeta): UsageEventShape {
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
  };
}

/**
 * Maps a TRACK 2 / CHALLENGE-GENERATION call's record to a UsageEvent row.
 *
 * Same arithmetic again, third distinct event_type, for the same reason
 * extraction got its own: Track 2 is an ADDITIONAL DeepSeek call per material
 * claim on top of the field-judging calls, so folding it into "judge_call"
 * would hide exactly the cost question the feature flag exists to answer —
 * "what did enabling Track 2 for this org actually add to the bill". It goes
 * through insertUsageEvent like every other call site, which is what makes it
 * visible to checkQuota's sums rather than a fourth unmetered path.
 */
export function usageEventFromChallengeCall(record: JudgeCallRecord, meta: JudgeUsageMeta): UsageEventShape {
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
  };
}

/**
 * Maps an ADVANCE-GENERATION call's record to a UsageEvent row. Same
 * arithmetic, own event_type — same rationale as challenge_generation's own
 * split: Advance is an additional DeepSeek call per invocation on top of the
 * field-judging (and, where enabled, Challenge) calls, and folding it into
 * "judge_call" would hide exactly the cost question the quota gate exists to
 * answer. This is what makes an Advance call visible to checkQuota's sums —
 * see engine/src/advance/liveGenerate.ts's quota gate, which is only
 * meaningful if every call that passes it is also recorded here.
 */
export function usageEventFromAdvanceCall(record: JudgeCallRecord, meta: JudgeUsageMeta): UsageEventShape {
  const inputTokens = record.inputTokens ?? 0;
  const outputTokens = record.outputTokens ?? 0;
  return {
    organizationId: meta.organizationId,
    userId: meta.userId,
    reviewId: meta.reviewId,
    eventType: "advance_generation",
    inputTokens,
    outputTokens,
    fetchBytes: 0,
    estimatedCostCents: estimateDeepSeekCostCents(inputTokens, outputTokens),
  };
}

/** Inserts a usage_event row. Returns the created row's id. */
export async function insertUsageEvent(db: pg.Pool, event: UsageEventShape): Promise<string> {
  const result = await db.query(
    `INSERT INTO usage_event (
       organization_id, user_id, review_id, event_type,
       input_tokens, output_tokens, fetch_bytes, estimated_cost_cents
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
      event.estimatedCostCents,
    ],
  );
  return result.rows[0].id as string;
}
