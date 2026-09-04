// POST /v1/move-events — the interaction record.
//
// WHY THESE TESTS EXIST AT ALL. act_move_event has been in the schema since
// migration 0013 and held zero rows in production: 33 moves had been shown to
// real users and nothing recorded whether one was ever useful. A table nothing
// writes is indistinguishable from a table nothing needs, and the only way to
// keep the first from quietly becoming the second is a test that fails when
// the write stops happening.
//
// The ownership test is the load-bearing one. `move_id` is a client-supplied
// uuid, so without the organization check any authenticated caller could write
// events against another org's moves and corrupt the single metric this table
// exists to produce.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { issueApiKey } from "../auth/apiKey.ts";
import { reviewsRouter } from "./reviews.ts";
import { createOrganization, createReview, freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

interface Harness {
  baseUrl: string;
  pool: pg.Pool;
  close: () => Promise<void>;
}

async function start(): Promise<Harness> {
  const pool: pg.Pool = await freshPool();
  const app = express();
  app.use(express.json());
  app.use(reviewsRouter(pool));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    pool,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      await pool.end();
    },
  };
}

/** One org with an API key, and one persisted move belonging to it. */
async function seedMove(pool: pg.Pool): Promise<{ orgId: string; bearer: string; moveId: string }> {
  const orgId = await createOrganization(pool);
  const { plaintextKey } = await issueApiKey(orgId, pool);
  const reviewId = await createReview(pool, orgId);
  const inv = await pool.query(
    `INSERT INTO act_invocation
       (organization_id, review_id, invocation_context_id, has_evidence_constraint,
        allowed_moves, policy_version, model, prompt_version, status)
     VALUES ($1, $2, $3, false, '[]'::jsonb, 'v', 'm', 'p', 'ok') RETURNING id`,
    [orgId, reviewId, reviewId],
  );
  const move = await pool.query(
    `INSERT INTO act_move (invocation_id, model_move_id, ordinal, move, short_label, prompt)
     VALUES ($1, 's1', 0, 'clarify', 'Clarify read patterns', 'What are the read patterns?') RETURNING id`,
    [inv.rows[0].id],
  );
  return { orgId, bearer: plaintextKey, moveId: move.rows[0].id as string };
}

async function post(h: Harness, bearer: string, body: unknown): Promise<Response> {
  return fetch(`${h.baseUrl}/v1/move-events`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
}

test("records an interaction — the row this table never had", { ...skip }, async () => {
  const h = await start();
  try {
    const { moveId, bearer } = await seedMove(h.pool);
    const res = await post(h, bearer, { move_id: moveId, event_type: "committed" });
    assert.equal(res.status, 201);

    const rows = await h.pool.query("SELECT event_type FROM act_move_event WHERE move_id = $1", [moveId]);
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].event_type, "committed");
  } finally {
    await h.close();
  }
});

test("all four event types are accepted, and they accumulate", { ...skip }, async () => {
  const h = await start();
  try {
    const { moveId, bearer } = await seedMove(h.pool);
    for (const t of ["shown", "revealed", "committed", "dismissed"]) {
      assert.equal((await post(h, bearer, { move_id: moveId, event_type: t })).status, 201, t);
    }
    const rows = await h.pool.query("SELECT count(*)::int AS n FROM act_move_event WHERE move_id = $1", [moveId]);
    // Deliberately additive, not upsert: a move shown twice IS two displays,
    // and collapsing them would understate the denominator.
    assert.equal(rows.rows[0].n, 4);
  } finally {
    await h.close();
  }
});

test("an invented event type is refused — the vocabulary is closed", { ...skip }, async () => {
  const h = await start();
  try {
    const { moveId, bearer } = await seedMove(h.pool);
    const res = await post(h, bearer, { move_id: moveId, event_type: "loved_it" });
    assert.equal(res.status, 400);
    const rows = await h.pool.query("SELECT count(*)::int AS n FROM act_move_event WHERE move_id = $1", [moveId]);
    assert.equal(rows.rows[0].n, 0, "a rejected request must write nothing");
  } finally {
    await h.close();
  }
});

test("another organization's move cannot be written to", { ...skip }, async () => {
  const h = await start();
  try {
    const mine = await seedMove(h.pool);
    const theirs = await seedMove(h.pool);
    // Authenticated as `mine`, naming `theirs`'s move id.
    const res = await post(h, mine.bearer, { move_id: theirs.moveId, event_type: "committed" });
    assert.equal(res.status, 404, "404 rather than 403 — whether that id exists elsewhere is not this caller's business");
    const rows = await h.pool.query("SELECT count(*)::int AS n FROM act_move_event WHERE move_id = $1", [theirs.moveId]);
    assert.equal(rows.rows[0].n, 0, "cross-org writes would corrupt the one metric this table produces");
  } finally {
    await h.close();
  }
});

test("an unknown move id is a 404, not a dangling row", { ...skip }, async () => {
  const h = await start();
  try {
    const { bearer } = await seedMove(h.pool);
    const res = await post(h, bearer, {
      move_id: "00000000-0000-4000-8000-000000000000",
      event_type: "shown",
    });
    assert.equal(res.status, 404);
  } finally {
    await h.close();
  }
});

test("no API key is a 401", { ...skip }, async () => {
  const h = await start();
  try {
    const { moveId } = await seedMove(h.pool);
    const res = await fetch(`${h.baseUrl}/v1/move-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ move_id: moveId, event_type: "shown" }),
    });
    assert.equal(res.status, 401);
  } finally {
    await h.close();
  }
});
