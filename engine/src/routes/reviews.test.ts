// Real end-to-end tests for POST /v1/reviews and POST
// /v1/reviews/:reviewId/claims — same pattern as evidence.test.ts (real express
// router against a real Postgres, driven over real HTTP, skipping cleanly when
// no test database is configured).
//
// Covers: create review, sequential idempotency, CONCURRENT idempotency (two
// requests fired together must not both create a row), missing/wrong auth,
// claim creation end-to-end reusing the evidence route's inline-payload
// registration, and a cross-org claim POST (404).

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { issueApiKey } from "../auth/apiKey.ts";
import { evidenceRouter } from "./evidence.ts";
import { reviewsRouter } from "./reviews.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const SUPPORT_TEXT = "Acme's revenue growth was 17% in FY25, compared to the prior year, actual company-wide figures.";

const CLAIM_FIELDS = {
  entity: "Acme",
  period: "FY25",
  measure: "revenue growth",
  valueUnit: { value: "17", unit: "%" },
  comparatorBaseline: "prior year",
  modality: "actual",
  scope: "company-wide",
};

interface TestServer {
  baseUrl: string;
  pool: pg.Pool;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const app = express();
  app.use(express.json());
  app.use(evidenceRouter(pool));
  app.use(reviewsRouter(pool));
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

async function createReviewRequest(server: TestServer, opts: { bearer?: string; idempotencyKey: string }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  return fetch(`${server.baseUrl}/v1/reviews`, {
    method: "POST",
    headers,
    body: JSON.stringify({ idempotency_key: opts.idempotencyKey }),
  });
}

test(
  "POST /v1/reviews: creates a review with 201 and the expected row shape",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await createReviewRequest(server, { bearer: plaintextKey, idempotencyKey: "review-key-1" });
      assert.equal(res.status, 201);
      const json = (await res.json()) as { review: { id: string; organization_id: string; idempotency_key: string; status: string; created_at: string } };
      assert.equal(json.review.organization_id, orgId);
      assert.equal(json.review.idempotency_key, "review-key-1");
      assert.equal(json.review.status, "processing");
      assert.ok(json.review.id);
      assert.ok(json.review.created_at);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/reviews: a duplicate idempotency key returns the SAME review (sequential)",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const first = await createReviewRequest(server, { bearer: plaintextKey, idempotencyKey: "same-key" });
      assert.equal(first.status, 201);
      const firstJson = (await first.json()) as { review: { id: string } };

      const second = await createReviewRequest(server, { bearer: plaintextKey, idempotencyKey: "same-key" });
      assert.equal(second.status, 200);
      const secondJson = (await second.json()) as { review: { id: string } };
      assert.equal(secondJson.review.id, firstJson.review.id, "the duplicate must return the EXISTING review id");

      const count = await server.pool.query(
        "SELECT count(*)::int AS n FROM review WHERE organization_id = $1 AND idempotency_key = $2",
        [orgId, "same-key"],
      );
      assert.equal(count.rows[0].n, 1, "exactly one review row must exist for this (org, key)");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/reviews: a duplicate idempotency key returns the SAME review under two CONCURRENT requests (race-safe)",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      // Fire both requests at the same time — a sequential-only test would not
      // catch a race that lets both succeed at creating a row.
      const [a, b] = await Promise.all([
        createReviewRequest(server, { bearer: plaintextKey, idempotencyKey: "concurrent-key" }),
        createReviewRequest(server, { bearer: plaintextKey, idempotencyKey: "concurrent-key" }),
      ]);
      const aJson = (await a.json()) as { review: { id: string } };
      const bJson = (await b.json()) as { review: { id: string } };
      assert.ok(a.status === 201 || a.status === 200, `first request status ${a.status}`);
      assert.ok(b.status === 201 || b.status === 200, `second request status ${b.status}`);
      assert.equal(aJson.review.id, bJson.review.id, "both concurrent requests must resolve to the SAME review id");

      const count = await server.pool.query(
        "SELECT count(*)::int AS n FROM review WHERE organization_id = $1 AND idempotency_key = $2",
        [orgId, "concurrent-key"],
      );
      assert.equal(count.rows[0].n, 1, "the race must not create two review rows");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/reviews: missing, garbage, and forged keys are rejected with 401",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);

      const missing = await createReviewRequest(server, { idempotencyKey: "k" });
      assert.equal(missing.status, 401);

      const garbage = await createReviewRequest(server, { bearer: "not-a-real-key", idempotencyKey: "k" });
      assert.equal(garbage.status, 401);

      const forged = await createReviewRequest(server, { bearer: "sk-evil", idempotencyKey: "k" });
      assert.equal(forged.status, 401);

      // The old x-notary-organization-id stub header is still dead.
      const stub = await fetch(`${server.baseUrl}/v1/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-notary-organization-id": orgId },
        body: JSON.stringify({ idempotency_key: "k" }),
      });
      assert.equal(stub.status, 401);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/reviews/:reviewId/claims: end-to-end against a review with real bound evidence (registered via the evidence route)",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const reviewId = await createReview(server.pool, orgId);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      // Register an inline-payload evidence row through the real evidence
      // router — it lands as 'retrieved' with resolved_text populated, so the
      // review flow can read it without a network fetch.
      const evRes = await fetch(`${server.baseUrl}/v1/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${plaintextKey}` },
        body: JSON.stringify({
          review_id: reviewId,
          origin: "answer_citation",
          payload: SUPPORT_TEXT,
        }),
      });
      assert.equal(evRes.status, 201);
      const evJson = (await evRes.json()) as { evidence: { id: string; retrieval_status: string; resolved_text: string | null } };
      assert.equal(evJson.evidence.retrieval_status, "retrieved");
      assert.equal(evJson.evidence.resolved_text, SUPPORT_TEXT);

      const claimRes = await fetch(`${server.baseUrl}/v1/reviews/${reviewId}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${plaintextKey}` },
        body: JSON.stringify({
          text: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          materiality: true,
          claim_fields: CLAIM_FIELDS,
          evidence_ids: [evJson.evidence.id],
        }),
      });
      assert.equal(claimRes.status, 201);
      const claimJson = (await claimRes.json()) as {
        claim: { id: string; review_id: string; state: string; state_reason: string; no_source: boolean };
        matches: Array<{ evidenceId: string; relation: string; method: string }>;
      };
      assert.equal(claimJson.claim.review_id, reviewId);
      assert.equal(claimJson.claim.state, "SUPPORTED");
      assert.equal(claimJson.claim.no_source, false);
      assert.deepEqual(claimJson.matches, [
        { evidenceId: evJson.evidence.id, relation: "supports", method: "quoted_or_computed" },
      ]);

      // Persisted for real: a claim row and an evidence_match row exist.
      const claimRow = await server.pool.query("SELECT 1 FROM claim WHERE id = $1", [claimJson.claim.id]);
      assert.equal(claimRow.rowCount, 1);
      const matchRow = await server.pool.query("SELECT 1 FROM evidence_match WHERE claim_id = $1", [claimJson.claim.id]);
      assert.equal(matchRow.rowCount, 1);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/reviews/:reviewId/claims: a malformed reviewId returns 400, not a 500",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await fetch(`${server.baseUrl}/v1/reviews/not-a-uuid/claims`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${plaintextKey}` },
        body: JSON.stringify({ text: "x", ordinal: 1, claim_fields: CLAIM_FIELDS, evidence_ids: [] }),
      });
      assert.equal(res.status, 400, "a malformed reviewId must never reach Postgres as a raw string and 500");
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/reviews/:reviewId/claims: a review belonging to a DIFFERENT org returns 404",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgA = await createOrganization(server.pool);
      const orgB = await createOrganization(server.pool);
      const reviewInB = await createReview(server.pool, orgB);
      const { plaintextKey } = await issueApiKey(orgA, server.pool);

      const res = await fetch(`${server.baseUrl}/v1/reviews/${reviewInB}/claims`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${plaintextKey}` },
        body: JSON.stringify({
          text: "Acme's revenue grew 17% in FY25.",
          ordinal: 1,
          claim_fields: CLAIM_FIELDS,
          evidence_ids: [],
        }),
      });
      assert.equal(res.status, 404);
      const json = (await res.json()) as { error: string };
      assert.equal(json.error, "review not found for this organization");
    } finally {
      await server.close();
    }
  },
);
