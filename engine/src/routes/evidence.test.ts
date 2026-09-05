// Real end-to-end tests for POST /v1/evidence with real API-key auth
// (build-order step 5 replacing step 1's x-notary-organization-id stub).
// Spins up the actual express router against a real Postgres and drives it over
// real HTTP. Skip cleanly when no test database is configured.
//
// Proves the auth swap end to end: a valid key succeeds, a revoked key is
// rejected, garbage is rejected, the old header stub no longer works, and the
// route's EXISTING business logic (cross-org scoping, append-only inserts) is
// unchanged by the identity-mechanism change.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { issueApiKey, revokeApiKey } from "../auth/apiKey.ts";
import { evidenceRouter } from "./evidence.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

const VALID_REVIEW_BODY = {
  review_id: "", // set per test
  origin: "answer_citation",
  submitted_url: "https://example.com/report.pdf",
  submitted_by: "claude",
  snapshot_reuse_policy: "reuse",
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

async function postEvidence(
  server: TestServer,
  opts: { bearer?: string; reviewId: string; extraHeaders?: Record<string, string>; body?: Record<string, unknown> },
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", ...opts.extraHeaders };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  return fetch(`${server.baseUrl}/v1/evidence`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...VALID_REVIEW_BODY, review_id: opts.reviewId, ...opts.body }),
  });
}

test(
  "POST /v1/evidence: a valid API key registers evidence exactly as before",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const reviewId = await createReview(server.pool, orgId);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const res = await postEvidence(server, { bearer: plaintextKey, reviewId });
      assert.equal(res.status, 201);
      const json = (await res.json()) as { evidence: { id: string; review_id: string; payload_hash: string | null; retrieval_status: string } };
      assert.equal(json.evidence.review_id, reviewId);
      assert.equal(json.evidence.retrieval_status, "pending");

      // Append-only still holds: resubmitting the same URL creates a NEW row.
      const again = await postEvidence(server, { bearer: plaintextKey, reviewId });
      assert.equal(again.status, 201);
      const againJson = (await again.json()) as { evidence: { id: string } };
      assert.notEqual(againJson.evidence.id, json.evidence.id);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/evidence: the old x-notary-organization-id header stub no longer authenticates anyone",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const reviewId = await createReview(server.pool, orgId);

      // The pre-auth header, even with the seeded demo org id, is rejected —
      // the stub is gone, not quietly still accepted.
      const res = await postEvidence(server, {
        reviewId,
        extraHeaders: { "x-notary-organization-id": orgId },
      });
      assert.equal(res.status, 401);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/evidence: missing, garbage, and revoked keys are all rejected with 401",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const reviewId = await createReview(server.pool, orgId);
      const { plaintextKey, keyId } = await issueApiKey(orgId, server.pool);

      const missing = await postEvidence(server, { reviewId });
      assert.equal(missing.status, 401);

      const garbage = await postEvidence(server, { reviewId, bearer: "not-a-real-key" });
      assert.equal(garbage.status, 401);

      const forged = await postEvidence(server, { reviewId, bearer: "Bearer sk-evil" });
      assert.equal(forged.status, 401);

      // Revocation is immediate: the same key that just worked now fails.
      const before = await postEvidence(server, { reviewId, bearer: plaintextKey });
      assert.equal(before.status, 201);
      await revokeApiKey(keyId, server.pool);
      const after = await postEvidence(server, { reviewId, bearer: plaintextKey });
      assert.equal(after.status, 401);
    } finally {
      await server.close();
    }
  },
);

test(
  "POST /v1/evidence: org scoping still holds — a key for org A cannot register into org B's review",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgA = await createOrganization(server.pool);
      const orgB = await createOrganization(server.pool);
      const reviewInB = await createReview(server.pool, orgB);
      const { plaintextKey } = await issueApiKey(orgA, server.pool);

      const res = await postEvidence(server, { bearer: plaintextKey, reviewId: reviewInB });
      assert.equal(res.status, 404, "the review does not belong to the key's organization");
      const json = (await res.json()) as { error: string };
      assert.equal(json.error, "review not found for this organization");
    } finally {
      await server.close();
    }
  },
);

test(
  "E-EVIDENCE: payload + submitted_url registers 'pending' with the excerpt retained as caller_excerpt (page will be fetched at review time)",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const reviewId = await createReview(server.pool, orgId);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);

      const excerpt = "The Pacific Ocean contains approximately 714 million cubic kilometers of water.";
      const res = await postEvidence(server, {
        bearer: plaintextKey,
        reviewId,
        body: { payload: excerpt, submitted_url: "https://example.com/pacific" },
      });
      assert.equal(res.status, 201);
      const json = (await res.json()) as { evidence: { id: string; retrieval_status: string } };
      assert.equal(json.evidence.retrieval_status, "pending", "a row with both excerpt and URL must be resolved against the page");

      const row = (
        await server.pool.query("SELECT caller_excerpt, resolved_text, text_provenance FROM evidence WHERE id = $1", [json.evidence.id])
      ).rows[0] as { caller_excerpt: string; resolved_text: string; text_provenance: string };
      assert.equal(row.caller_excerpt, excerpt, "the excerpt must be retained as the fallback");
      assert.equal(row.text_provenance, "caller_supplied", "the retained excerpt must never claim to be fetched");
    } finally {
      await server.close();
    }
  },
);

test(
  "excerpt with NO url stays 'retrieved' as before (nothing to fetch)",
  { ...skip },
  async () => {
    const server = await startServer();
    try {
      const orgId = await createOrganization(server.pool);
      const reviewId = await createReview(server.pool, orgId);
      const { plaintextKey } = await issueApiKey(orgId, server.pool);
      const res = await postEvidence(server, {
        bearer: plaintextKey,
        reviewId,
        // Override the shared base body's submitted_url so the row has NO url.
        body: { payload: "a caller excerpt with no url", submitted_url: undefined },
      });
      assert.equal(res.status, 201);
      const json = (await res.json()) as { evidence: { retrieval_status: string } };
      assert.equal(json.evidence.retrieval_status, "retrieved");
    } finally {
      await server.close();
    }
  },
);
