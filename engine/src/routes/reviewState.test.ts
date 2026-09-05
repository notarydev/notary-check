// GET /v1/reviews/:id/state and POST /v1/reviews/:id/complete — the read side
// of an updating card.
//
// These exist so verification can stop blocking the connector. The card renders
// immediately and polls; the poll must therefore be cheap, org-scoped, and
// honest about whether it is finished.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { issueApiKey } from "../auth/apiKey.ts";
import { reviewsRouter } from "./reviews.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

async function start(): Promise<{ base: string; pool: pg.Pool; close: () => Promise<void> }> {
  const pool: pg.Pool = await freshPool();
  const app = express();
  app.use(express.json());
  app.use(reviewsRouter(pool));
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    pool,
    close: async () => {
      await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
      await pool.end();
    },
  };
}

test("state starts incomplete, and completing it flips the flag", { ...skip }, async () => {
  const h = await start();
  try {
    const orgId = await createOrganization(h.pool);
    const { plaintextKey } = await issueApiKey(orgId, h.pool);
    const reviewId = await createReview(h.pool, orgId);
    const auth = { authorization: `Bearer ${plaintextKey}` };

    const before = await (await fetch(`${h.base}/v1/reviews/${reviewId}/state`, { headers: auth })).json();
    assert.equal(before.complete, false, "a review nothing has finished must not claim to be complete");
    assert.deepEqual(before.claims, []);

    const done = await fetch(`${h.base}/v1/reviews/${reviewId}/complete`, { method: "POST", headers: auth });
    assert.equal(done.status, 200);

    const after = await (await fetch(`${h.base}/v1/reviews/${reviewId}/state`, { headers: auth })).json();
    assert.equal(after.complete, true);
  } finally {
    await h.close();
  }
});

test("completing twice is not an error — a retried call must not fail", { ...skip }, async () => {
  const h = await start();
  try {
    const orgId = await createOrganization(h.pool);
    const { plaintextKey } = await issueApiKey(orgId, h.pool);
    const reviewId = await createReview(h.pool, orgId);
    const auth = { authorization: `Bearer ${plaintextKey}` };
    assert.equal((await fetch(`${h.base}/v1/reviews/${reviewId}/complete`, { method: "POST", headers: auth })).status, 200);
    assert.equal((await fetch(`${h.base}/v1/reviews/${reviewId}/complete`, { method: "POST", headers: auth })).status, 200);
  } finally {
    await h.close();
  }
});

test("another organization's review is a 404, not a 403", { ...skip }, async () => {
  // Whether a review exists elsewhere is not this caller's business — the same
  // don't-leak-existence rule every other route here follows.
  const h = await start();
  try {
    const mineOrg = await createOrganization(h.pool);
    const { plaintextKey } = await issueApiKey(mineOrg, h.pool);
    const theirsReview = await createReview(h.pool, await createOrganization(h.pool));
    const auth = { authorization: `Bearer ${plaintextKey}` };

    assert.equal((await fetch(`${h.base}/v1/reviews/${theirsReview}/state`, { headers: auth })).status, 404);
    const stolen = await fetch(`${h.base}/v1/reviews/${theirsReview}/complete`, { method: "POST", headers: auth });
    assert.equal(stolen.status, 404, "and it must not be completable either");

    const still = await h.pool.query("SELECT status FROM review WHERE id = $1", [theirsReview]);
    assert.equal(still.rows[0].status, "processing", "a cross-org write must change nothing");
  } finally {
    await h.close();
  }
});

test("no key is a 401, and a malformed id is a 400", { ...skip }, async () => {
  const h = await start();
  try {
    assert.equal((await fetch(`${h.base}/v1/reviews/00000000-0000-4000-8000-000000000000/state`)).status, 401);
    const orgId = await createOrganization(h.pool);
    const { plaintextKey } = await issueApiKey(orgId, h.pool);
    const res = await fetch(`${h.base}/v1/reviews/not-a-uuid/state`, {
      headers: { authorization: `Bearer ${plaintextKey}` },
    });
    assert.equal(res.status, 400, "a malformed id must be a 400, never a 500 from the query layer");
  } finally {
    await h.close();
  }
});
