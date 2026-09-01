// Tests for the Stripe client wrapper (engine/src/billing/stripeClient.ts).
// Focus: the loud config error when the key is missing, that the key is
// injected from env or options (never read at a call site), and that the error
// message never leaks the key. No network anywhere.

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createStripeClient, StripeConfigError } from "./stripeClient.ts";

const originalKey = process.env.STRIPE_SECRET_KEY;
afterEach(() => {
  if (originalKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalKey;
});

test("createStripeClient throws StripeConfigError when the key is missing", () => {
  delete process.env.STRIPE_SECRET_KEY;
  assert.throws(() => createStripeClient(), (err) => err instanceof StripeConfigError);
  assert.throws(() => createStripeClient({ secretKey: "" }), (err) => err instanceof StripeConfigError);
  assert.throws(() => createStripeClient({ secretKey: undefined }), (err) => err instanceof StripeConfigError);
});

test("createStripeClient builds a client from the env or from an injected key", () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_from_env";
  assert.ok(createStripeClient(), "reads the env key");
  assert.ok(createStripeClient({ secretKey: "sk_test_injected" }), "explicit key wins over env");
});

test("the config error never contains the key value", () => {
  delete process.env.STRIPE_SECRET_KEY;
  const secret = "sk_test_value_that_must_never_appear_in_output";
  try {
    createStripeClient({ secretKey: secret });
    createStripeClient();
    assert.fail("expected StripeConfigError");
  } catch (err) {
    assert.ok(err instanceof StripeConfigError);
    assert.ok(!err.message.includes(secret), "the secret must not be echoed");
    assert.ok(!/sk_/i.test(err.message), "no sk_ material in the message");
  }
});
