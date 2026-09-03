// Generic in-process token-bucket rate-limit middleware, generalized from the
// bespoke per-IP limiter that used to live inline in routes/waitlist.ts (see
// that file's history / notary-check/CLAUDE.md for the paid-alpha context
// this exists for). Same tradeoff as the code it replaces and as
// server/src/orgResolver.ts's apiKeyCache: simple, process-lifetime,
// in-memory, resets on restart — sufficient for a single-instance deployment
// and not a substitute for real infra (Redis, a gateway) if this ever scales
// past one instance or one paid-alpha's worth of traffic.

import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  /** Sliding window size, in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key within the window. */
  max: number;
  /**
   * Derives the bucket key for a request. Defaults to the client IP
   * (req.ip). Override for authenticated routes to key by API key / org
   * instead, so one IP can't exhaust another tenant's budget (and one
   * tenant behind a shared/proxy IP doesn't get punished for a neighbor).
   */
  keyFn?: (req: Request) => string;
  /** Response body sent on a 429. Defaults to a generic message. */
  message?: string;
}

/**
 * Express middleware factory implementing a sliding-window token bucket per
 * key. Each call to the returned middleware trims timestamps older than the
 * window, records the current request, and rejects with 429 once the count
 * exceeds `max` — same algorithm as the original waitlist.ts limiter.
 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyFn = (req: Request) => req.ip ?? "unknown", message = "too many requests, try again shortly" } = options;

  /** key -> request timestamps within the current window. */
  const requestLog = new Map<string, number[]>();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const key = keyFn(req);
    const now = Date.now();
    const timestamps = (requestLog.get(key) ?? []).filter((t) => now - t < windowMs);
    timestamps.push(now);
    requestLog.set(key, timestamps);

    if (timestamps.length > max) {
      res.status(429).json({ error: message });
      return;
    }

    next();
  };
}
