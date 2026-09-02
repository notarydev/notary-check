// Real end-to-end tests for POST /v1/internal/resolve-organization — same
// pattern as reviews.test.ts: a real express router against a real Postgres,
// driven over real HTTP, skipping cleanly when no test database is
// configured.
//
// Covers: missing/wrong X-Internal-Secret -> 401; first call for a new
// clerk_user_id -> 200/created:true with a real organization row; second call
// for the SAME clerk_user_id -> 200/created:false, same organization_id, a
// DIFFERENT api_key that independently verifies; malformed body -> 400.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { verifyApiKey } from "../auth/apiKey.ts";
import { internalRouter } from "./internal.ts";
import { freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const TEST_SECRET = "test-secret-value-for-internal-route-tests";

interface TestServer {
  baseUrl: string;
  pool: pg.Pool;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const app = express();
  app.use(express.json());
  app.use(internalRouter(pool));
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

async function resolveOrgRequest(server: TestServer, opts: { secret?: string; body: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secret !== undefined) headers["x-internal-secret"] = opts.secret;
  return fetch(`${server.baseUrl}/v1/internal/resolve-organization`, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body),
  });
}

async function withInternalSecret<T>(fn: () => Promise<T>): Promise<T> {
  const original = process.env.INTERNAL_SERVICE_SECRET;
  process.env.INTERNAL_SERVICE_SECRET = TEST_SECRET;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.INTERNAL_SERVICE_SECRET;
    else process.env.INTERNAL_SERVICE_SECRET = original;
  }
}

test(
  "POST /v1/internal/resolve-organization: missing or wrong X-Internal-Secret is rejected with 401",
  { ...skip },
  async () => {
    await withInternalSecret(async () => {
      const server = await startServer();
      try {
        const missing = await resolveOrgRequest(server, { body: { clerk_user_id: "user_missing_secret" } });
        assert.equal(missing.status, 401);

        const wrong = await resolveOrgRequest(server, { secret: "not-the-right-secret", body: { clerk_user_id: "user_wrong_secret" } });
        assert.equal(wrong.status, 401);

        // A secret of a different length must also fail cleanly (exercises
        // the length-check-before-timingSafeEqual path, not a thrown error).
        const shorter = await resolveOrgRequest(server, { secret: "short", body: { clerk_user_id: "user_short_secret" } });
        assert.equal(shorter.status, 401);
      } finally {
        await server.close();
      }
    });
  },
);

test(
  "POST /v1/internal/resolve-organization: first call for a new clerk_user_id creates an organization (created:true)",
  { ...skip },
  async () => {
    await withInternalSecret(async () => {
      const server = await startServer();
      try {
        const clerkUserId = `user_new_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const res = await resolveOrgRequest(server, {
          secret: TEST_SECRET,
          body: { clerk_user_id: clerkUserId, email: "founder@example.com" },
        });
        assert.equal(res.status, 200);
        const json = (await res.json()) as { organization_id: string; api_key: string; created: boolean };
        assert.equal(json.created, true);
        assert.ok(json.organization_id);
        assert.match(json.api_key, /^nk_live_[0-9a-f]{64}$/);

        const row = await server.pool.query(
          "SELECT id, clerk_user_id, name FROM organization WHERE clerk_user_id = $1",
          [clerkUserId],
        );
        assert.equal(row.rowCount, 1);
        assert.equal(row.rows[0].id, json.organization_id);
        assert.equal(row.rows[0].name, "founder");

        const verified = await verifyApiKey(json.api_key, server.pool);
        assert.ok(verified.ok);
        if (verified.ok) assert.equal(verified.organizationId, json.organization_id);
      } finally {
        await server.close();
      }
    });
  },
);

test(
  "POST /v1/internal/resolve-organization: a second call for the SAME clerk_user_id reuses the org (created:false) with a different api_key",
  { ...skip },
  async () => {
    await withInternalSecret(async () => {
      const server = await startServer();
      try {
        const clerkUserId = `user_repeat_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        const first = await resolveOrgRequest(server, { secret: TEST_SECRET, body: { clerk_user_id: clerkUserId } });
        assert.equal(first.status, 200);
        const firstJson = (await first.json()) as { organization_id: string; api_key: string; created: boolean };
        assert.equal(firstJson.created, true);

        const second = await resolveOrgRequest(server, { secret: TEST_SECRET, body: { clerk_user_id: clerkUserId } });
        assert.equal(second.status, 200);
        const secondJson = (await second.json()) as { organization_id: string; api_key: string; created: boolean };
        assert.equal(secondJson.created, false);

        assert.equal(secondJson.organization_id, firstJson.organization_id, "same clerk_user_id must resolve to the SAME organization");
        assert.notEqual(secondJson.api_key, firstJson.api_key, "each call must mint a FRESH api key");

        // Exactly one organization row for this clerk_user_id.
        const count = await server.pool.query("SELECT count(*)::int AS n FROM organization WHERE clerk_user_id = $1", [clerkUserId]);
        assert.equal(count.rows[0].n, 1);

        // Both keys independently verify against the same organization.
        const verifiedFirst = await verifyApiKey(firstJson.api_key, server.pool);
        const verifiedSecond = await verifyApiKey(secondJson.api_key, server.pool);
        assert.ok(verifiedFirst.ok);
        assert.ok(verifiedSecond.ok);
        if (verifiedFirst.ok && verifiedSecond.ok) {
          assert.equal(verifiedFirst.organizationId, firstJson.organization_id);
          assert.equal(verifiedSecond.organizationId, firstJson.organization_id);
        }
      } finally {
        await server.close();
      }
    });
  },
);

test(
  "POST /v1/internal/resolve-organization: a malformed body is rejected with 400",
  { ...skip },
  async () => {
    await withInternalSecret(async () => {
      const server = await startServer();
      try {
        const missingField = await resolveOrgRequest(server, { secret: TEST_SECRET, body: {} });
        assert.equal(missingField.status, 400);

        const emptyId = await resolveOrgRequest(server, { secret: TEST_SECRET, body: { clerk_user_id: "" } });
        assert.equal(emptyId.status, 400);

        const badEmail = await resolveOrgRequest(server, {
          secret: TEST_SECRET,
          body: { clerk_user_id: "user_bad_email", email: "not-an-email" },
        });
        assert.equal(badEmail.status, 400);
      } finally {
        await server.close();
      }
    });
  },
);
