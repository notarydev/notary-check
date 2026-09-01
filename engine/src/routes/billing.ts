// POST /v1/billing/checkout — billing scaffolding (Stripe test account).
//
// Auth is exactly the evidence.ts pattern: `Authorization: Bearer <api-key>`
// resolves the organization from the organization_api_key table; the
// organization is DERIVED from the key, never from a client-supplied header.
// The body's organization_id must match the authenticated org (org scoping,
// same discipline as evidence.ts's cross-org rejection).
//
// Flow: validate the tier (only non-custom tiers in plans.ts; "enterprise" and
// unknown tiers are rejected with no Stripe call) → look up or create the org's
// Stripe Customer (persisting the customer id on the organization row) → ensure
// the tier's Stripe Product + Price exists (idempotent, so checkout works even
// if bootstrapProducts hasn't been run) → create a Checkout Session → return
// `{ checkout_url }`.

import { Router } from "express";
import type pg from "pg";
import Stripe from "stripe";
import { z } from "zod";
import { verifyApiKey } from "../auth/apiKey.ts";
import { ensureTierProductAndPrice } from "../billing/bootstrapProducts.ts";
import { getPlan } from "../billing/plans.ts";
import { logEvent } from "../observability/log.ts";

const BEARER_PREFIX = "Bearer ";

const checkoutSchema = z.object({
  organization_id: z.string().uuid(),
  tier: z.string(),
});

function billingSuccessUrl(): string {
  return process.env.NOTARY_BILLING_SUCCESS_URL ?? "http://localhost:3000/billing/success";
}

function billingCancelUrl(): string {
  return process.env.NOTARY_BILLING_CANCEL_URL ?? "http://localhost:3000/billing/cancel";
}

export function billingRouter(database: pg.Pool, stripe: Stripe): Router {
  const router = Router();

  router.post("/v1/billing/checkout", async (req, res) => {
    const authHeader = req.header("authorization");
    if (!authHeader?.startsWith(BEARER_PREFIX)) {
      return res.status(401).json({ error: "missing Authorization: Bearer <api-key> header" });
    }
    const presentedKey = authHeader.slice(BEARER_PREFIX.length).trim();
    const auth = await verifyApiKey(presentedKey, database);
    if (!auth.ok) {
      logEvent({ event: "auth_failed", error_cause: `api_key_${auth.reason}`, path: "deterministic-only" });
      return res.status(401).json({ error: "invalid or revoked API key" });
    }
    const orgId = auth.organizationId;

    const parsed = checkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }
    const { organization_id: bodyOrganizationId, tier } = parsed.data;

    // Organization scoping: never trust a client-supplied organization id alone.
    if (bodyOrganizationId !== orgId) {
      return res.status(403).json({ error: "organization_id does not match the authenticated organization" });
    }

    const plan = getPlan(tier);
    if (plan === undefined) {
      return res.status(400).json({ error: `unknown tier: '${tier}'` });
    }
    // No Stripe call for non-self-serve tiers: "enterprise" is negotiated
    // sales-assisted and has no Stripe object.
    if (plan.custom) {
      return res.status(400).json({ error: `tier '${tier}' is not self-serve; contact sales` });
    }

    const orgRow = await database.query("SELECT id, stripe_customer_id FROM organization WHERE id = $1", [orgId]);
    if (orgRow.rowCount === 0) {
      return res.status(404).json({ error: "organization not found" });
    }

    let customerId = orgRow.rows[0].stripe_customer_id as string | null;
    if (customerId === null) {
      const customer = await stripe.customers.create({ metadata: { organization_id: orgId } });
      customerId = customer.id;
      await database.query("UPDATE organization SET stripe_customer_id = $1 WHERE id = $2", [customerId, orgId]);
    }

    const { priceId } = await ensureTierProductAndPrice(stripe, plan);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: billingSuccessUrl(),
      cancel_url: billingCancelUrl(),
      // The webhook needs to know which org + tier a session belongs to.
      metadata: { organization_id: orgId, tier: plan.id },
      subscription_data: { metadata: { organization_id: orgId, tier: plan.id } },
    });

    logEvent({ event: "billing_checkout_created", organization_id: orgId, tier: plan.id });
    return res.status(200).json({ checkout_url: session.url });
  });

  return router;
}
