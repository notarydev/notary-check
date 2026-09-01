// The engine's thin Stripe client wrapper (billing scaffolding).
//
// This is deliberately a THIN wrapper: it exists so that (a) the secret key is
// read from the environment in exactly one place, (b) a missing key fails LOUD
// at construction time instead of at first use, and (c) tests can inject a
// client without touching the environment. It adds no billing logic — plan
// tiers live in plans.ts, Stripe product bootstrapping in bootstrapProducts.ts,
// and the HTTP surface in routes/billing.ts + routes/webhook.ts.
//
// Config-error convention mirrors judgeClient.ts's JudgeConfigError: a missing
// key throws a clearly-named error and never logs the key (which must never be
// printed or logged anywhere).
//
// Injectable-for-tests seam, same pattern as safeFetch's resolve/createConnection
// and judgeClient's httpCall: the underlying Stripe HTTP transport is a
// constructor option, so unit tests can drive requests without any network.

import Stripe from "stripe";

/** Thrown when the client cannot be configured (missing Stripe secret key). */
export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeConfigError";
  }
}

export interface StripeClientOptions {
  /** Overrides process.env.STRIPE_SECRET_KEY (test injection). */
  secretKey?: string;
  /** Overrides the SDK's default HTTP transport (test injection, no network). */
  httpClient?: Stripe.HttpClient;
}

/**
 * Creates a Stripe client from the configured secret key. Throws
 * StripeConfigError (loud, at startup, never at first request) when the key is
 * missing. Never prints or logs the key.
 */
export function createStripeClient(options: StripeClientOptions = {}): Stripe {
  const secretKey = options.secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (secretKey === undefined || secretKey.length === 0) {
    throw new StripeConfigError("STRIPE_SECRET_KEY is not set; the billing client cannot be configured");
  }
  if (options.httpClient !== undefined) {
    return new Stripe(secretKey, { httpClient: options.httpClient });
  }
  return new Stripe(secretKey);
}
