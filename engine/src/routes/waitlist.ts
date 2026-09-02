// POST /v1/waitlist — public, UNAUTHENTICATED email capture for the signup
// gate (see NOTARY_SIGNUP_MODE in dashboard/, and migration 0009's header
// comment). This is the one route in the engine deliberately open to the
// public internet with zero credential — there's no organization yet to
// scope a request to. A basic per-IP token-bucket rate limit is applied
// in-process (no new infra dependency) since this route has no API-key gate
// to lean on for abuse resistance.

import { Router } from "express";
import type pg from "pg";
import { z } from "zod";
import { logEvent } from "../observability/log.ts";

const waitlistSchema = z.object({
  email: z.string().email(),
  source: z.string().optional(),
});

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 5;

/** ip -> request timestamps within the current window. Process-lifetime, in-memory — matches this codebase's existing apiKeyCache-style tradeoff (server/src/orgResolver.ts): simple and sufficient for a single-instance deployment, resets on restart. */
const requestLog = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_PER_WINDOW;
}

export function waitlistRouter(database: pg.Pool): Router {
  const router = Router();

  router.post("/v1/waitlist", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (isRateLimited(ip)) {
      logEvent({ event: "waitlist_rate_limited", path: "deterministic-only" });
      return res.status(429).json({ error: "too many requests, try again shortly" });
    }

    const parsed = waitlistSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid request body", details: parsed.error.flatten() });
    }
    const { email, source } = parsed.data;

    // Upsert-by-email semantics: a repeat submission from the same address is
    // a no-op success, not an error — it must never leak whether an email is
    // already on the list via a distinguishable error response.
    await database.query(
      "INSERT INTO waitlist_signup (email, source) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      [email, source ?? null],
    );

    logEvent({ event: "waitlist_joined", path: "deterministic-only" });
    return res.status(201).json({ ok: true });
  });

  return router;
}
