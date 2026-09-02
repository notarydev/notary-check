// GET /v1/usage — dashboard usage/quota summary for the authenticated
// organization. Read-only: reuses the existing quota and plan machinery
// (organizationMonthCostCents, orgMonthlyLimitCents, getPlan) rather than
// re-deriving any of it, plus a new checks-this-month aggregation over
// claim.created_at (migration 0008).
//
// Same auth pattern as evidence.ts/reviews.ts: identity comes from
// `Authorization: Bearer <api-key>`, organization is DERIVED from the key.

import { Router } from "express";
import type pg from "pg";
import { verifyApiKey } from "../auth/apiKey.ts";
import { getPlan } from "../billing/plans.ts";
import { logEvent } from "../observability/log.ts";
import { organizationMonthCostCents, orgMonthlyLimitCents } from "../quotas/quotaCheck.ts";

const BEARER_PREFIX = "Bearer ";

export function usageRouter(database: pg.Pool): Router {
  const router = Router();

  router.get("/v1/usage", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      logEvent({ event: "auth_failed", error_cause: "missing_bearer", path: "deterministic-only" });
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    const orgRow = await database.query("SELECT plan FROM organization WHERE id = $1", [orgId]);
    if (!orgRow.rowCount) {
      return res.status(404).json({ error: "organization not found" });
    }
    const planId = orgRow.rows[0].plan as string;
    const plan = getPlan(planId);

    // Count of claims created this calendar month, org-scoped through the
    // owning review. Mirrors organizationMonthCostCents's own
    // date_trunc('month', now()) boundary so the two figures describe the
    // same window.
    const checksResult = await database.query(
      `SELECT count(*)::int AS n
       FROM claim
       JOIN review ON claim.review_id = review.id
       WHERE review.organization_id = $1
         AND claim.created_at >= date_trunc('month', now())`,
      [orgId],
    );
    const checksUsedThisMonth = checksResult.rows[0].n as number;

    const costCentsThisMonth = await organizationMonthCostCents(orgId, database);

    return res.status(200).json({
      plan_id: planId,
      checks_used_this_month: checksUsedThisMonth,
      // null for a plan with no fixed allowance (Enterprise) or an unrecognized
      // plan id on the org row — never silently coerced to 0.
      checks_limit: plan?.checksPerMonth ?? null,
      cost_cents_this_month: costCentsThisMonth,
      org_monthly_limit_cents: orgMonthlyLimitCents(),
    });
  });

  return router;
}
