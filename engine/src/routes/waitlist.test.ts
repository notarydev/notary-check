// Real end-to-end tests for POST /v1/waitlist — same pattern as
// internal.test.ts: a real express router against a real Postgres, driven
// over real HTTP, skipping cleanly when no test database is configured.
//
// Covers: valid email -> 201; repeat submission of the same email -> still
// 201, no distinguishable "already exists" response (must not leak list
// membership); invalid email -> 400; missing body -> 400; the in-process
// per-IP rate limit kicks in after the configured max within the window.

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import type pg from "pg";
import { waitlistRouter } from "./waitlist.ts";
import { freshPool, HAS_DB } from "../test/db.ts";

const skip = { skip: !HAS_DB ? "no test database configured (set TEST_DATABASE_URL or DATABASE_URL)" : false };

interface TestServer {
  baseUrl: string;
  pool: pg.Pool;
  close: () => Promise<void>;
}

async function startServer(): Promise<TestServer> {
  const pool: pg.Pool = await freshPool();
  const app = express();
  app.use(express.json());
  app.use(waitlistRouter(pool));
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

async function joinRequest(server: TestServer, body: unknown) {
  const res = await fetch(`${server.baseUrl}/v1/waitlist`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test("POST /v1/waitlist: a valid email is accepted (201)", skip, async () => {
  const server = await startServer();
  try {
    const { status, body } = await joinRequest(server, { email: `first-${Date.now()}@example.com` });
    assert.equal(status, 201);
    assert.deepEqual(body, { ok: true });
  } finally {
    await server.close();
  }
});

test("POST /v1/waitlist: a repeat submission of the same email is still 201, not a distinguishable error", skip, async () => {
  const server = await startServer();
  try {
    const email = `repeat-${Date.now()}@example.com`;
    const first = await joinRequest(server, { email });
    const second = await joinRequest(server, { email });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.deepEqual(second.body, { ok: true });

    const row = await server.pool.query("SELECT count(*) FROM waitlist_signup WHERE email = $1", [email]);
    assert.equal(row.rows[0].count, "1");
  } finally {
    await server.close();
  }
});

test("POST /v1/waitlist: an invalid email is rejected with 400", skip, async () => {
  const server = await startServer();
  try {
    const { status, body } = await joinRequest(server, { email: "not-an-email" });
    assert.equal(status, 400);
    assert.equal(body.error, "invalid request body");
  } finally {
    await server.close();
  }
});

test("POST /v1/waitlist: a missing body is rejected with 400", skip, async () => {
  const server = await startServer();
  try {
    const { status } = await joinRequest(server, {});
    assert.equal(status, 400);
  } finally {
    await server.close();
  }
});

test("POST /v1/waitlist: the per-IP rate limit rejects requests past the configured max within the window", skip, async () => {
  const server = await startServer();
  try {
    const results: number[] = [];
    for (let i = 0; i < 8; i++) {
      const { status } = await joinRequest(server, { email: `rl-${Date.now()}-${i}@example.com` });
      results.push(status);
    }
    // All requests share one client IP (loopback) in this test, so the
    // in-process limiter should start rejecting once the window's cap is
    // exceeded, regardless of each request's own validity.
    assert.ok(results.some((s) => s === 429), `expected at least one 429 among: ${results.join(",")}`);
  } finally {
    await server.close();
  }
});
