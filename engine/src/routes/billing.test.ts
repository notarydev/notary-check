// End-to-end tests for POST /v1/billing/checkout with real API-key auth (same
// pattern as evidence.test.ts) and a real Postgres, with the Stripe client
// injected as the in-memory FakeStripe (no network). Proves: auth, tier
// validation (enterprise/unknown tiers rejected with NO Stripe call), customer
// lookup-or-create with the customer id persisted on the organization row, and
// Checkout Session creation returning { checkout_url }.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { issueApiKey } from "../auth/apiKey.ts";
import { billingRouter } from "./billing.ts";
import { createOrganization, freshPool, HAS_DB } from "../test/db.ts";
import { FakeStripe } from "../test/fakeStripe.ts";

const dbSkip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

interface TestServer {
  baseUrl: string;
  pool: pg.Pool;
  stripe: FakeStripe;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const stripe = new FakeStripe();
  const app = express();
  app.use(express.json());
  app.use(billingRouter(pool, stripe.asStripe()));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    pool,
    stripe,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await pool.end();
    },
  };
}

async function postCheckout(
  server: TestServer,
  opts: { bearer?: string; tier?: string; organizationId?: string },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  const body: Record<string, unknown> = { tier: opts.tier ?? "pro" };
  if (opts.organizationId !== undefined) body.organization_id = opts.organizationId;
  return fetch(`${server.baseUrl}/v1/billing/checkout`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function stripeCustomerIdOf(pool: pg.Pool, orgId: string): Promise<string | null> {
  const row = await pool.query("SELECT stripe_customer_id FROM organization WHERE id = $1", [orgId]);
  return (row.rows[0]?.stripe_customer_id as string | null) ?? null;
}

async function postCancel(
  server: TestServer,
  opts: { bearer?: string; organizationId?: string },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  const body: Record<string, unknown> = {};
  if (opts.organizationId !== undefined) body.organization_id = opts.organizationId;
  return fetch(`${server.baseUrl}/v1/billing/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function orgBillingState(
  pool: pg.Pool,
  orgId: string,
): Promise<{ plan: string; entitlementStatus: string }> {
  const row = await pool.query("SELECT plan, entitlement_status FROM organization WHERE id = $1", [orgId]);
  return { plan: row.rows[0].plan, entitlementStatus: row.rows[0].entitlement_status };
}

test(
  "POST /v1/billing/checkout: creates a Stripe customer, persists its id, and returns a checkout URL",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postCheckout(server, { bearer: plaintextKey, tier: "pro", organizationId: orgId });
      assert.equal(res.status, 200);
      const json = (await res.json()) as { checkout_url: string };
      assert.ok(json.checkout_url.startsWith("https://checkout.stripe.com/"), "returns a real-looking checkout URL");

      // The customer id was persisted on the organization row.
      const customerId = await stripeCustomerIdOf(server.pool, orgId);
      assert.ok(customerId, "stripe_customer_id persisted");
      assert.equal(server.stripe.customerCreateCalls, 1);
      assert.equal(server.stripe.customersCreated[0].metadata.organization_id, orgId);

      // The session was created in subscription mode against the tier's price.
      assert.equal(server.stripe.sessionCreateCalls, 1);
      const session = server.stripe.sessionsCreated[0] as { mode: string; customer: string; line_items: Array<{ price: string }>; metadata: Record<string, string> };
      assert.equal(session.mode, "subscription");
      assert.equal(session.customer, customerId);
      assert.equal(session.metadata.tier, "pro");
      const proPrice = server.stripe.prices.find((p) => p.unit_amount === 4_900);
      assert.equal(session.line_items[0].price, proPrice?.id, "session uses the Pro tier's price");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/checkout: a second checkout for the same org reuses the Stripe customer",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const first = await postCheckout(server, { bearer: plaintextKey, tier: "pro", organizationId: orgId });
      assert.equal(first.status, 200);
      const customerAfterFirst = await stripeCustomerIdOf(server.pool, orgId);

      const second = await postCheckout(server, { bearer: plaintextKey, tier: "team", organizationId: orgId });
      assert.equal(second.status, 200);
      assert.equal(server.stripe.customerCreateCalls, 1, "no second customer is created");
      assert.equal(await stripeCustomerIdOf(server.pool, orgId), customerAfterFirst, "customer id is stable");
      assert.equal(server.stripe.sessionCreateCalls, 2);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/checkout: 'enterprise' is rejected with a clear error and NO Stripe call",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postCheckout(server, { bearer: plaintextKey, tier: "enterprise", organizationId: orgId });
      assert.equal(res.status, 400);
      const json = (await res.json()) as { error: string };
      assert.match(json.error, /enterprise/i);
      assert.equal(server.stripe.customerCreateCalls, 0, "no customer created for a non-self-serve tier");
      assert.equal(server.stripe.sessionCreateCalls, 0, "no checkout session created");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/checkout: an unknown tier is rejected with no Stripe call",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postCheckout(server, { bearer: plaintextKey, tier: "platinum", organizationId: orgId });
      assert.equal(res.status, 400);
      const json = (await res.json()) as { error: string };
      assert.match(json.error, /platinum/);
      assert.equal(server.stripe.customerCreateCalls, 0);
      assert.equal(server.stripe.sessionCreateCalls, 0);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/checkout: missing and garbage auth are rejected with 401",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);

      const missing = await postCheckout(server, { tier: "pro", organizationId: orgId });
      assert.equal(missing.status, 401);

      const garbage = await postCheckout(server, { bearer: "not-a-real-key", tier: "pro", organizationId: orgId });
      assert.equal(garbage.status, 401);

      assert.equal(server.stripe.customerCreateCalls, 0);
      assert.equal(server.stripe.sessionCreateCalls, 0);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/checkout: a body organization_id that is not the authenticated org is rejected",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgA = await createOrganization(server.pool);
      const orgB = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgA, server.pool);

      const res = await postCheckout(server, { bearer: plaintextKey, tier: "pro", organizationId: orgB });
      assert.equal(res.status, 403);
      assert.equal(server.stripe.customerCreateCalls, 0, "no Stripe call on a cross-org attempt");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/checkout: a missing organization_id in the body is a 400",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postCheckout(server, { bearer: plaintextKey, tier: "pro" });
      assert.equal(res.status, 400);
      assert.equal(server.stripe.customerCreateCalls, 0);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/cancel: cancels the Stripe subscription and downgrades plan + entitlement synchronously",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);
      await server.pool.query(
        "UPDATE organization SET plan = 'pro', stripe_subscription_id = 'sub_active_1', entitlement_status = 'active' WHERE id = $1",
        [orgId],
      );

      const res = await postCancel(server, { bearer: plaintextKey, organizationId: orgId });
      assert.equal(res.status, 200);
      const json = (await res.json()) as { canceled: boolean };
      assert.equal(json.canceled, true);

      assert.equal(server.stripe.subscriptionCancelCalls, 1);
      assert.equal(server.stripe.subscriptionsCanceled[0], "sub_active_1");

      const state = await orgBillingState(server.pool, orgId);
      assert.equal(state.plan, "starter", "canceling downgrades the org to the free tier");
      assert.equal(state.entitlementStatus, "canceled");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/cancel: an org with no Stripe subscription is a 400, no Stripe call",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postCancel(server, { bearer: plaintextKey, organizationId: orgId });
      assert.equal(res.status, 400);
      assert.equal(server.stripe.subscriptionCancelCalls, 0);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/cancel: missing auth is rejected with 401, no Stripe call",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);

      const res = await postCancel(server, { organizationId: orgId });
      assert.equal(res.status, 401);
      assert.equal(server.stripe.subscriptionCancelCalls, 0);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/billing/cancel: a body organization_id that is not the authenticated org is rejected (403), no Stripe call",
  { ...dbSkip },
  async () => {
    const server = await startServer();
    try {
      const orgA = await createOrganization(server.pool);
      const orgB = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgA, server.pool);
      await server.pool.query(
        "UPDATE organization SET stripe_subscription_id = 'sub_b_1' WHERE id = $1",
        [orgB],
      );

      const res = await postCancel(server, { bearer: plaintextKey, organizationId: orgB });
      assert.equal(res.status, 403);
      assert.equal(server.stripe.subscriptionCancelCalls, 0, "no Stripe call on a cross-org attempt");
    } finally {
      await server.close();
    }
  },
);
