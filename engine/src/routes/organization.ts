// GET /v1/organization — dashboard's plan/account summary for the
// authenticated organization. Read-only, derived from the organization row
// plus billing/plans.ts's single source of truth for tier pricing/allowances.
//
// has_payment_method is a boolean derived from stripe_customer_id IS NOT
// NULL — the raw Stripe customer id itself is never exposed to a client,
// same discipline as key_hash/plaintext keys never leaving auth/apiKey.ts.
//
// created_at: the organization table has never had a created_at column (0001
// defined it as just id + name; 0005/0007 added plan/Stripe/Clerk columns,
// none added a timestamp). Migration 0008 is scoped to claim/evidence/review
// only, so this route does not invent one — it returns null rather than
// querying a column that does not exist.
//
// Same auth pattern as evidence.ts/reviews.ts: identity comes from
// `Authorization: Bearer <api-key>`, organization is DERIVED from the key.

import { Router } from "express";
import type pg from "pg";
import { verifyApiKey } from "../auth/apiKey.ts";
import { getPlan } from "../billing/plans.ts";
import { logEvent } from "../observability/log.ts";

const BEARER_PREFIX = "Bearer ";

export function organizationRouter(database: pg.Pool): Router {
  const router = Router();

  router.get("/v1/organization", async (req, res) => {
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

    const orgRow = await database.query("SELECT plan, stripe_customer_id FROM organization WHERE id = $1", [orgId]);
    if (!orgRow.rowCount) {
      return res.status(404).json({ error: "organization not found" });
    }
    const row = orgRow.rows[0] as { plan: string; stripe_customer_id: string | null };
    const plan = getPlan(row.plan);

    return res.status(200).json({
      plan_id: row.plan,
      plan_name: plan?.name ?? row.plan,
      checks_per_month: plan?.checksPerMonth ?? null,
      price_cents: plan?.monthlyPriceCents ?? null,
      has_payment_method: row.stripe_customer_id !== null,
      // organization has no created_at column (see header comment) — null,
      // not a fabricated value.
      created_at: null,
    });
  });

  return router;
}
