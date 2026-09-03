// Quota enforcement (§ Cost-control rules rule 6; § Monitoring spend caps).
//
// checkQuota() is the single gate a caller uses before doing expensive work for
// an organization. It enforces TWO independent ceilings:
//
//   1. Per-organization monthly limit — the sum of the current calendar month's
//      usage_event.estimated_cost_cents for that org, compared against
//      NOTARY_ORG_MONTHLY_LIMIT_CENTS. A single org cannot run unbounded.
//
//   2. A hard, GLOBAL DeepSeek spend cap — NOTARY_GLOBAL_SPEND_CAP_CENTS across
//      ALL organizations for the current calendar month. This is a separate
//      ceiling because the per-org limit does not protect against many orgs
//      together exceeding total provider spend: one misbehaving org is stopped
//      by rule 1, but a fleet of orgs each under their own limit can still blow
//      the aggregate provider bill. Rule 2 is the provider-spend backstop.
//
// Both limits are read from the environment at CALL time (not module load), so
// tests and operators can change them without a restart. Values are in US
// cents, consistent with usage_event.estimated_cost_cents. Defaults are
// documented in engine/.env.example.

import type pg from "pg";

export const DEFAULT_ORG_MONTHLY_LIMIT_CENTS = 100_000; // $1,000/month/org
export const DEFAULT_GLOBAL_SPEND_CAP_CENTS = 500_000; // $5,000/month total

export function orgMonthlyLimitCents(): number {
  return readCentsEnv("NOTARY_ORG_MONTHLY_LIMIT_CENTS", DEFAULT_ORG_MONTHLY_LIMIT_CENTS);
}

export function globalSpendCapCents(): number {
  return readCentsEnv("NOTARY_GLOBAL_SPEND_CAP_CENTS", DEFAULT_GLOBAL_SPEND_CAP_CENTS);
}

function readCentsEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export type QuotaResult = { allowed: true } | { allowed: false; reason: string };

/** Sums the current calendar month's usage_event cost for one org, in cents. */
export async function organizationMonthCostCents(organizationId: string, db: pg.Pool): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(SUM(estimated_cost_cents), 0) AS total
     FROM usage_event
     WHERE organization_id = $1
       AND created_at >= date_trunc('month', now())
       AND created_at < date_trunc('month', now()) + interval '1 month'`,
    [organizationId],
  );
  return Number(result.rows[0].total);
}

/** Sums ALL orgs' usage_event cost for the current calendar month, in cents. */
export async function globalMonthCostCents(db: pg.Pool): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(SUM(estimated_cost_cents), 0) AS total
     FROM usage_event
     WHERE created_at >= date_trunc('month', now())
       AND created_at < date_trunc('month', now()) + interval '1 month'`,
  );
  return Number(result.rows[0].total);
}

/** The hard, global provider-spend-cap check on its own. */
export async function checkGlobalSpendCap(db: pg.Pool): Promise<QuotaResult> {
  const total = await globalMonthCostCents(db);
  if (total >= globalSpendCapCents()) {
    return { allowed: false, reason: "global_spend_cap_exceeded" };
  }
  return { allowed: true };
}

/**
 * The single quota gate: per-org monthly limit first, then the global spend
 * cap. Returns the FIRST reason that fires. Callers are expected to treat a
 * `{ allowed: false }` as "do not do the expensive work for this org now".
 *
 * KNOWN LIMITATION, not yet fixed: this is read-then-decide (sum historical
 * usage_event rows, compare, return), not an atomic reservation. Two
 * concurrent calls for the same org can each read "under the cap" and both
 * proceed, each later writing its own usage_event — the cap is a best-effort
 * preflight check under concurrency, not a hard, race-free ceiling. Low real
 * risk at alpha's traffic volume (docs/build/tier-1-build-and-operating-plan.md
 * § Release gates, "Cost" row), but a true hard cap under higher concurrency
 * needs an atomic reservation (e.g. an increment-and-check inside one
 * transaction), not an aggregate historical-usage read.
 */
export async function checkQuota(organizationId: string, db: pg.Pool): Promise<QuotaResult> {
  const orgCost = await organizationMonthCostCents(organizationId, db);
  if (orgCost >= orgMonthlyLimitCents()) {
    return { allowed: false, reason: "organization_monthly_limit_exceeded" };
  }
  const global = await globalMonthCostCents(db);
  if (global >= globalSpendCapCents()) {
    return { allowed: false, reason: "global_spend_cap_exceeded" };
  }
  return { allowed: true };
}
