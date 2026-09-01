// POST /v1/billing/webhook — Stripe webhook endpoint (billing scaffolding).
//
// Signature verification uses the official SDK's `stripe.webhooks.constructEvent`
// (NOT hand-rolled crypto) against `process.env.STRIPE_WEBHOOK_SECRET`. On
// `checkout.session.completed` and `customer.subscription.updated`/`deleted` the
// organization's `plan` and `stripe_subscription_id` are updated accordingly.
//
// RAW BODY REQUIREMENT (the classic integration bug): Stripe signs the exact
// bytes of the request body, so signature verification MUST run against the
// unmodified raw payload — never a re-serialized JSON object. This route is
// therefore mounted in engine/src/server.ts behind
// `express.raw({ type: "application/json" })` BEFORE the global
// `express.json()` parser, so `req.body` is a Buffer here (body-parser marks the
// body as already parsed and the JSON parser skips it). If `req.body` is a
// parsed object, constructEvent can NEVER pass — we reject explicitly with a
// clear 400 rather than fail silently.

import { Router } from "express";
import type pg from "pg";
import Stripe from "stripe";
import { getPlan, type PlanId } from "../billing/plans.ts";
import { logEvent } from "../observability/log.ts";

export function webhookRouter(database: pg.Pool, stripe: Stripe): Router {
  const router = Router();

  router.post("/v1/billing/webhook", async (req, res) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (webhookSecret === undefined || webhookSecret.length === 0) {
      logEvent({ event: "billing_webhook_config_error", error_cause: "missing_webhook_secret" });
      return res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET is not configured" });
    }

    const signature = req.header("stripe-signature");
    if (!signature) {
      return res.status(400).json({ error: "missing Stripe-Signature header" });
    }

    // The raw bytes required by constructEvent — see the module header.
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string") {
      return res.status(400).json({
        error: "raw request body required for webhook signature verification (mount behind express.raw)",
      });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch {
      return res.status(400).json({ error: "invalid webhook signature" });
    }

    try {
      await handleEvent(database, event);
    } catch (err) {
      logEvent({
        event: "billing_webhook_error",
        error_cause: err instanceof Error ? err.message : "unknown",
      });
      return res.status(500).json({ error: "failed to process webhook" });
    }

    logEvent({ event: "billing_webhook_received", type: event.type });
    return res.status(200).json({ received: true });
  });

  return router;
}

/**
 * Applies the plan/subscription changes the webhook events describe. Unknown
 * event types and events without a usable customer/plan linkage are
 * acknowledged (returned 200) but not applied — Stripe retries anything we 500.
 */
async function handleEvent(database: pg.Pool, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = typeof session.customer === "string" ? session.customer : undefined;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
      const tier = session.metadata?.tier;
      if (customerId === undefined || tier === undefined || getPlan(tier) === undefined) return;
      await applyPlanByCustomer(database, customerId, { plan: tier as PlanId, subscriptionId });
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : undefined;
      if (customerId === undefined) return;
      const canceled = event.type === "customer.subscription.deleted" || subscription.status === "canceled";
      if (canceled) {
        // Canceled/deleted subscription: downgrade the org to the free tier.
        await applyPlanByCustomer(database, customerId, { plan: "starter", subscriptionId: subscription.id });
      } else {
        const tier = subscription.metadata?.tier;
        if (tier === undefined || getPlan(tier) === undefined) return;
        await applyPlanByCustomer(database, customerId, { plan: tier as PlanId, subscriptionId: subscription.id });
      }
      return;
    }
    default:
      return;
  }
}

async function applyPlanByCustomer(
  database: pg.Pool,
  customerId: string,
  change: { plan: PlanId; subscriptionId: string | null },
): Promise<void> {
  await database.query(
    `UPDATE organization
     SET plan = $1, stripe_subscription_id = $2
     WHERE stripe_customer_id = $3`,
    [change.plan, change.subscriptionId, customerId],
  );
}
