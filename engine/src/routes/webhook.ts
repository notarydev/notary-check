// POST /v1/billing/webhook — Stripe webhook endpoint (billing scaffolding).
//
// Signature verification uses the official SDK's `stripe.webhooks.constructEvent`
// (NOT hand-rolled crypto) against `process.env.STRIPE_WEBHOOK_SECRET`. Events
// handled:
//   checkout.session.completed        — plan + stripe_subscription_id set from
//                                        session metadata; entitlement_status
//                                        set to 'active' (first successful
//                                        payment).
//   customer.subscription.updated     — plan follows subscription metadata;
//                                        entitlement_status follows Stripe's
//                                        own subscription.status (active/
//                                        trialing → 'active', past_due/unpaid
//                                        → 'past_due', canceled → downgrade +
//                                        'canceled').
//   customer.subscription.deleted     — downgrade to 'starter',
//                                        entitlement_status → 'canceled'.
//   invoice.payment_failed            — entitlement_status → 'past_due' only;
//                                        plan is left alone (Stripe's own
//                                        dunning may still recover the
//                                        subscription without a plan change).
//   charge.refunded                   — logged distinctly for the billing
//                                        audit trail. Deliberately does NOT
//                                        change plan/entitlement_status: a
//                                        refund (full or partial) is not the
//                                        same event as a cancellation — Stripe
//                                        sends customer.subscription.deleted
//                                        separately if the subscription itself
//                                        is actually being canceled.
//
// Every event that reaches handleEvent is logged with its outcome (applied /
// skipped-unlinked / ignored-type), and a handler that throws is logged loud
// via billing_webhook_error before the 500 — so a missed or failed event is
// never a silent desync of organization.plan / entitlement_status.
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
import type { EntitlementStatus } from "../auth/entitlement.ts";
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

    let outcome: WebhookOutcome;
    try {
      outcome = await handleEvent(database, event);
    } catch (err) {
      // Loud on purpose: a webhook handler that throws must never be a silent
      // desync of organization.plan / entitlement_status. Stripe will retry
      // anything we 500, but only if this line makes the failure visible.
      logEvent({
        event: "billing_webhook_error",
        type: event.type,
        stripe_event_id: event.id,
        error_cause: err instanceof Error ? err.message : "unknown",
      });
      return res.status(500).json({ error: "failed to process webhook" });
    }

    logEvent({ event: "billing_webhook_received", type: event.type, stripe_event_id: event.id, outcome });
    return res.status(200).json({ received: true });
  });

  return router;
}

/**
 * Outcome of processing one webhook event, for the log line the route emits
 * on every request (success path) — separate from billing_webhook_error,
 * which covers the throw path.
 *   applied           — organization row(s) updated.
 *   customer_not_found — a recognized, linkable event whose customer id has no
 *                        matching organization row (0 rows updated) — worth
 *                        distinguishing from "applied" since it means this
 *                        event landed on nothing.
 *   skipped_unlinked  — the event lacks the metadata needed to apply it (e.g.
 *                        no tier in session/subscription metadata).
 *   ignored_type      — an event type this webhook does not act on.
 */
type WebhookOutcome = "applied" | "customer_not_found" | "skipped_unlinked" | "ignored_type";

/**
 * Applies the plan/subscription/entitlement changes the webhook events
 * describe. Unknown event types and events without a usable customer/plan
 * linkage are acknowledged (returned 200) but not applied — Stripe retries
 * anything we 500. Returns the outcome so the route can log it.
 */
async function handleEvent(database: pg.Pool, event: Stripe.Event): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const customerId = typeof session.customer === "string" ? session.customer : undefined;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
      const tier = session.metadata?.tier;
      if (customerId === undefined || tier === undefined || getPlan(tier) === undefined) return "skipped_unlinked";
      // First successful payment: entitlement is unconditionally 'active'.
      return applyOrgByCustomer(database, customerId, {
        plan: tier as PlanId,
        subscriptionId,
        entitlementStatus: "active",
      });
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = typeof subscription.customer === "string" ? subscription.customer : undefined;
      if (customerId === undefined) return "skipped_unlinked";
      const canceled = event.type === "customer.subscription.deleted" || subscription.status === "canceled";
      if (canceled) {
        // Canceled/deleted subscription: downgrade the org to the free tier
        // and mark entitlement canceled.
        return applyOrgByCustomer(database, customerId, {
          plan: "starter",
          subscriptionId: subscription.id,
          entitlementStatus: "canceled",
        });
      }
      const tier = subscription.metadata?.tier;
      if (tier === undefined || getPlan(tier) === undefined) return "skipped_unlinked";
      // Follow Stripe's own subscription.status for entitlement: an active
      // subscription that is behind on an invoice (past_due/unpaid) should
      // not read as fully entitled even though it hasn't been canceled yet.
      const entitlementStatus: EntitlementStatus =
        subscription.status === "past_due" || subscription.status === "unpaid" ? "past_due" : "active";
      return applyOrgByCustomer(database, customerId, {
        plan: tier as PlanId,
        subscriptionId: subscription.id,
        entitlementStatus,
      });
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : undefined;
      if (customerId === undefined) return "skipped_unlinked";
      // Plan is deliberately left alone: Stripe's own dunning may still
      // recover the subscription without any plan change. Only entitlement
      // is gated.
      const result = await database.query(
        `UPDATE organization SET entitlement_status = 'past_due' WHERE stripe_customer_id = $1`,
        [customerId],
      );
      return (result.rowCount ?? 0) > 0 ? "applied" : "customer_not_found";
    }
    case "charge.refunded": {
      // Logged for the billing audit trail only — see the module header for
      // why this deliberately does not touch plan/entitlement_status.
      const charge = event.data.object as Stripe.Charge;
      logEvent({
        event: "billing_refund_processed",
        stripe_event_id: event.id,
        stripe_customer_id: typeof charge.customer === "string" ? charge.customer : undefined,
        stripe_charge_id: charge.id,
        amount_refunded_cents: charge.amount_refunded,
      });
      return "applied";
    }
    default:
      return "ignored_type";
  }
}

async function applyOrgByCustomer(
  database: pg.Pool,
  customerId: string,
  change: { plan: PlanId; subscriptionId: string | null; entitlementStatus: EntitlementStatus },
): Promise<WebhookOutcome> {
  const result = await database.query(
    `UPDATE organization
     SET plan = $1, stripe_subscription_id = $2, entitlement_status = $3
     WHERE stripe_customer_id = $4`,
    [change.plan, change.subscriptionId, change.entitlementStatus, customerId],
  );
  return (result.rowCount ?? 0) > 0 ? "applied" : "customer_not_found";
}
