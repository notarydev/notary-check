// Webhook signature tests — the ONE place a real cryptographic check matters.
//
// This file computes a REAL Stripe webhook signature by hand — Stripe's scheme
// is public: the `Stripe-Signature` header is `t=<timestamp>,v1=<hex>`, where
// `<hex>` is the lowercase hex HMAC-SHA256 digest of `<timestamp>.<payload>`
// keyed by the webhook secret. It then drives the actual route (mounted behind
// express.raw() exactly as server.ts does) with a REAL Stripe SDK instance, so
// `stripe.webhooks.constructEvent` performs the verification — this proves the
// verification works cryptographically, not just that a function was called.
//
// A tampered payload and a wrong-secret signature must both be REJECTED.

import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import Stripe from "stripe";
import { webhookRouter } from "./webhook.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const WEBHOOK_SECRET = "whsec_test_secret";
// A fake test-mode key for constructing a REAL Stripe SDK instance — no network
// is ever hit (constructEvent is pure crypto).
const FAKE_STRIPE_KEY = "sk_test_fake_key_for_local_crypto_only";

/** A customer id unique to this run — the org table has a unique-when-present constraint. */
function uniqueCustomerId(): string {
  return `cus_${randomUUID().replace(/-/g, "")}`;
}

/** Builds a real Stripe webhook signature over the exact payload bytes. */
function stripeSignature(payload: string, secret: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

interface TestServer {
  baseUrl: string;
  pool: pg.Pool;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const stripe = new Stripe(FAKE_STRIPE_KEY);
  const app = express();
  // Exactly the server.ts wiring for this path: raw body BEFORE the JSON parser.
  app.use("/v1/billing/webhook", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use(webhookRouter(pool, stripe));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pool,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await pool.end();
    },
  };
}

async function postWebhook(
  server: TestServer,
  opts: { payload: string; signature?: string; secret?: string; overrideHeader?: string },
): Promise<Response> {
  const secret = opts.secret ?? WEBHOOK_SECRET;
  const signature = opts.signature ?? stripeSignature(opts.payload, secret);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.overrideHeader !== undefined) headers["stripe-signature"] = opts.overrideHeader;
  else headers["stripe-signature"] = signature;
  return fetch(`${server.baseUrl}/v1/billing/webhook`, {
    method: "POST",
    headers,
    body: opts.payload,
  });
}

async function orgState(
  pool: pg.Pool,
  orgId: string,
): Promise<{ plan: string; subscriptionId: string | null; entitlementStatus: string }> {
  const row = await pool.query(
    "SELECT plan, stripe_subscription_id, entitlement_status FROM organization WHERE id = $1",
    [orgId],
  );
  return {
    plan: row.rows[0].plan,
    subscriptionId: row.rows[0].stripe_subscription_id,
    entitlementStatus: row.rows[0].entitlement_status,
  };
}

function invoicePaymentFailedEvent(customerId: string): string {
  return JSON.stringify({
    id: "evt_test_invoice_payment_failed",
    object: "event",
    type: "invoice.payment_failed",
    data: {
      object: {
        id: "in_test_1",
        object: "invoice",
        customer: customerId,
      },
    },
  });
}

function chargeRefundedEvent(customerId: string): string {
  return JSON.stringify({
    id: "evt_test_charge_refunded",
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_1",
        object: "charge",
        customer: customerId,
        amount_refunded: 4_900,
      },
    },
  });
}

function subscriptionUpdatedEvent(customerId: string, subscriptionId: string, tier: string, status: string): string {
  return JSON.stringify({
    id: "evt_test_sub_updated",
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: customerId,
        status,
        metadata: { tier },
      },
    },
  });
}

function completedSessionEvent(customerId: string, subscriptionId: string, tier: string): string {
  return JSON.stringify({
    id: "evt_test_checkout_completed",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        customer: customerId,
        subscription: subscriptionId,
        metadata: { tier },
      },
    },
  });
}

test(
  "POST /v1/billing/webhook: a REAL Stripe signature over the raw body is accepted and updates the org",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query("UPDATE organization SET stripe_customer_id = $1, plan = 'starter' WHERE id = $2", [
        customerId,
        orgId,
      ]);

      const payload = completedSessionEvent(customerId, "sub_test_1", "pro");
      const res = await postWebhook(server, { payload });

      assert.equal(res.status, 200, "a correctly signed webhook is accepted");
      const json = (await res.json()) as { received: boolean };
      assert.equal(json.received, true);
      const state = await orgState(server.pool, orgId);
      assert.equal(state.plan, "pro", "plan upgraded from the checkout.session.completed metadata");
      assert.equal(state.subscriptionId, "sub_test_1");
      assert.equal(state.entitlementStatus, "active", "successful payment activates entitlement");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: a tampered payload with the SAME signature is rejected (400)",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query("UPDATE organization SET stripe_customer_id = $1, plan = 'starter' WHERE id = $2", [
        customerId,
        orgId,
      ]);

      const payload = completedSessionEvent(customerId, "sub_test_1", "pro");
      const signature = stripeSignature(payload, WEBHOOK_SECRET);
      // Tamper: change a byte of the payload AFTER the signature was computed.
      const tampered = payload.replace('"tier":"pro"', '"tier":"team"');

      const res = await postWebhook(server, { payload: tampered, signature });
      assert.equal(res.status, 400, "a tampered payload must be rejected");
      const state = await orgState(server.pool, orgId);
      assert.equal(state.plan, "starter", "no plan change from a rejected webhook");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: a signature made with the WRONG secret is rejected (400)",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query("UPDATE organization SET stripe_customer_id = $1, plan = 'starter' WHERE id = $2", [
        customerId,
        orgId,
      ]);

      const payload = completedSessionEvent(customerId, "sub_test_1", "pro");
      // Signed with a DIFFERENT secret than the route is configured with.
      const wrongSignature = stripeSignature(payload, "whsec_wrong_secret");

      const res = await postWebhook(server, { payload, signature: wrongSignature });
      assert.equal(res.status, 400, "a wrong-secret signature must be rejected");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: customer.subscription.deleted downgrades the org to starter",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query(
        "UPDATE organization SET stripe_customer_id = $1, plan = 'team', stripe_subscription_id = 'sub_old' WHERE id = $2",
        [customerId, orgId],
      );

      const payload = JSON.stringify({
        id: "evt_test_sub_deleted",
        object: "event",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_old",
            object: "subscription",
            customer: customerId,
            status: "canceled",
            metadata: { tier: "team" },
          },
        },
      });

      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 200);
      const state = await orgState(server.pool, orgId);
      assert.equal(state.plan, "starter", "a canceled subscription downgrades to the free tier");
      assert.equal(state.subscriptionId, "sub_old");
      assert.equal(state.entitlementStatus, "canceled", "a deleted subscription cancels entitlement");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: invoice.payment_failed sets entitlement to past_due without touching plan",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query(
        "UPDATE organization SET stripe_customer_id = $1, plan = 'pro', entitlement_status = 'active' WHERE id = $2",
        [customerId, orgId],
      );

      const payload = invoicePaymentFailedEvent(customerId);
      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 200);
      const state = await orgState(server.pool, orgId);
      assert.equal(state.plan, "pro", "plan is left alone on a payment failure");
      assert.equal(state.entitlementStatus, "past_due");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: customer.subscription.updated with status=past_due sets entitlement to past_due",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query(
        "UPDATE organization SET stripe_customer_id = $1, plan = 'starter', entitlement_status = 'active' WHERE id = $2",
        [customerId, orgId],
      );

      const payload = subscriptionUpdatedEvent(customerId, "sub_pd_1", "pro", "past_due");
      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 200);
      const state = await orgState(server.pool, orgId);
      assert.equal(state.plan, "pro", "plan still follows subscription metadata");
      assert.equal(state.entitlementStatus, "past_due");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: customer.subscription.updated with status=active re-activates entitlement",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query(
        "UPDATE organization SET stripe_customer_id = $1, plan = 'pro', entitlement_status = 'past_due' WHERE id = $2",
        [customerId, orgId],
      );

      const payload = subscriptionUpdatedEvent(customerId, "sub_recovered_1", "pro", "active");
      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 200);
      const state = await orgState(server.pool, orgId);
      assert.equal(state.entitlementStatus, "active", "a recovered subscription re-activates entitlement");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: charge.refunded is accepted and does not change plan or entitlement",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const orgId = await createOrganization(server.pool);
      const customerId = uniqueCustomerId();
      await server.pool.query(
        "UPDATE organization SET stripe_customer_id = $1, plan = 'pro', entitlement_status = 'active' WHERE id = $2",
        [customerId, orgId],
      );

      const payload = chargeRefundedEvent(customerId);
      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 200);
      const state = await orgState(server.pool, orgId);
      assert.equal(state.plan, "pro", "a refund alone does not change plan");
      assert.equal(state.entitlementStatus, "active", "a refund alone does not change entitlement");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: an unlinked customer (no matching organization) is still a 200, no throw",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const payload = invoicePaymentFailedEvent("cus_does_not_exist_anywhere");
      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 200, "an event that matches no organization is acknowledged, not retried");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: missing Stripe-Signature header is a 400",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const payload = completedSessionEvent("cus_test_1", "sub_test_1", "pro");
      const res = await postWebhook(server, { payload, overrideHeader: "" });
      assert.equal(res.status, 400);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: missing STRIPE_WEBHOOK_SECRET is a config 500, never a silent pass",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      const payload = completedSessionEvent("cus_test_1", "sub_test_1", "pro");
      const res = await postWebhook(server, { payload });
      assert.equal(res.status, 500);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/webhook: a JSON-parsed body (not mounted behind express.raw) is rejected, not silently mis-verified",
  { ...dbSkip },
  async () => {
    const pool: pg.Pool = await freshPool();
    const stripe = new Stripe(FAKE_STRIPE_KEY);
    const app = express();
    // WRONG wiring, on purpose: JSON parser runs FIRST, so req.body is a parsed
    // object and the route's raw-body guard must reject it explicitly.
    app.use(express.json());
    app.use(webhookRouter(pool, stripe));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
      const payload = completedSessionEvent("cus_test_1", "sub_test_1", "pro");
      const signature = stripeSignature(payload, WEBHOOK_SECRET);
      const res = await fetch(`${baseUrl}/v1/billing/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "stripe-signature": signature },
        body: payload,
      });
      assert.equal(res.status, 400, "the raw-body guard fires instead of failing the crypto check");
      const json = (await res.json()) as { error: string };
      assert.match(json.error, /raw request body/i);
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await pool.end();
    }
  },
);
