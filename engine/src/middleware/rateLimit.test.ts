// Unit tests for the generic rateLimit() middleware factory — no database
// needed, these exercise the middleware directly against a real express app
// over real HTTP (same "real thing, not a mock" spirit as this codebase's
// route tests, just without the DB dependency this piece doesn't need).

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import { rateLimit } from "./rateLimit.ts";

async function startServer(limiterOptions: Parameters<typeof rateLimit>[0]) {
  const app = express();
  app.use(rateLimit(limiterOptions));
  app.get("/ping", (_req, res) => res.status(200).json({ ok: true }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test("rateLimit: requests within the configured max all succeed", async () => {
  const server = await startServer({ windowMs: 60_000, max: 5 });
  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${server.baseUrl}/ping`);
      assert.equal(res.status, 200, `request ${i} should succeed`);
    }
  } finally {
    await server.close();
  }
});

test("rateLimit: requests past the configured max within the window are rejected with 429", async () => {
  const server = await startServer({ windowMs: 60_000, max: 3 });
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await fetch(`${server.baseUrl}/ping`);
      statuses.push(res.status);
    }
    // All requests share one client IP (loopback) in this test, so the
    // limiter should start rejecting once the window's cap is exceeded.
    assert.ok(statuses.slice(0, 3).every((s) => s === 200), `expected first 3 to succeed: ${statuses.join(",")}`);
    assert.ok(statuses.slice(3).every((s) => s === 429), `expected the rest to be rate-limited: ${statuses.join(",")}`);
  } finally {
    await server.close();
  }
});

test("rateLimit: the 429 body carries the configured message", async () => {
  const server = await startServer({ windowMs: 60_000, max: 1, message: "custom limit message" });
  try {
    await fetch(`${server.baseUrl}/ping`);
    const res = await fetch(`${server.baseUrl}/ping`);
    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.error, "custom limit message");
  } finally {
    await server.close();
  }
});

test("rateLimit: a custom keyFn buckets requests independently per key", async () => {
  const app = express();
  let nextKey = "a";
  app.use(rateLimit({ windowMs: 60_000, max: 1, keyFn: () => nextKey }));
  app.get("/ping", (_req, res) => res.status(200).json({ ok: true }));
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    nextKey = "a";
    const first = await fetch(`${baseUrl}/ping`);
    assert.equal(first.status, 200);
    const second = await fetch(`${baseUrl}/ping`);
    assert.equal(second.status, 429, "same key should now be limited");

    nextKey = "b";
    const third = await fetch(`${baseUrl}/ping`);
    assert.equal(third.status, 200, "different key should have its own bucket");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
