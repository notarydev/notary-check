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
import { rateLimit } from "../middleware/rateLimit.ts";

const waitlistSchema = z.object({
  email: z.string().email(),
  source: z.string().optional(),
});

// This route has no API-key gate to lean on for abuse resistance (it's the
// one deliberately public, unauthenticated route — see header comment
// above), so it keeps its own tight per-IP limit rather than relying on the
// generous global default applied in server.ts. Same numbers as before the
// refactor to the shared middleware factory.
const waitlistRateLimit = rateLimit({ windowMs: 60_000, max: 5, message: "too many requests, try again shortly" });

export function waitlistRouter(database: pg.Pool): Router {
  const router = Router();

  router.post("/v1/waitlist", waitlistRateLimit, async (req, res) => {
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
