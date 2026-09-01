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
// WIRING-POINT STATUS, stated honestly: as of build-order step 5 there is NO
// caller in this codebase that persists judge usage to the database yet — the
// judge runs only through extractField(), which returns a JudgeFieldAnswer
// carrying the full JudgeCallRecord, and nothing downstream writes it. So the
// mapping below is real and tested, but the end-to-end "judge call → usage row"
// path is DEFERRED until the orchestrator that owns reviews and organizations
// actually calls the judge and persists usage. No fake integration is invented
// here to paper over that gap.

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
