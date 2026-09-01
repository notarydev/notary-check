// Idempotency tests for Stripe Product/Price bootstrapping
// (engine/src/billing/bootstrapProducts.ts). The Stripe client is the in-memory
// FakeStripe — no network. The core assertion is the required one: when a
// product with the matching `notary_tier` metadata already exists, create is NOT
// called. (Live verification against the real test-mode Stripe account is done
// by the operator by running `tsx src/billing/bootstrapProducts.ts`.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { bootstrapProducts } from "./bootstrapProducts.ts";
import { FakeStripe } from "../test/fakeStripe.ts";

test("bootstraps every non-custom tier, creating a product + monthly price each", async () => {
  const fake = new FakeStripe();
  const results = await bootstrapProducts(fake.asStripe());

  assert.deepEqual(
    results.map((r) => r.plan),
    ["starter", "pro", "team"],
  );
  assert.ok(results.every((r) => r.created), "first run creates everything");
  assert.equal(fake.productCreateCalls, 3);
  assert.equal(fake.priceCreateCalls, 3);

  // Every product carries the idempotency metadata tag.
  for (const plan of ["starter", "pro", "team"]) {
    const product = fake.products.find((p) => p.metadata.notary_tier === plan);
    assert.ok(product, `product tagged notary_tier=${plan} exists`);
    const price = fake.prices.find((p) => p.product === product!.id);
    assert.ok(price, `price exists for ${plan}`);
  }
});

test("is idempotent: running twice creates nothing the second time", async () => {
  const fake = new FakeStripe();
  await bootstrapProducts(fake.asStripe());

  const results = await bootstrapProducts(fake.asStripe());
  assert.ok(results.every((r) => !r.created), "second run reuses everything");
  // The money assertions: create is NOT called again for either products or prices.
  assert.equal(fake.productCreateCalls, 3, "products.create must not be called again");
  assert.equal(fake.priceCreateCalls, 3, "prices.create must not be called again");
});

test("does NOT call products.create for a tier whose product (matching metadata) already exists", async () => {
  const fake = new FakeStripe();
  // Pre-seed ALL three tiers as if a prior run already happened.
  fake.seedProduct("starter", 0);
  fake.seedProduct("pro", 4_900);
  fake.seedProduct("team", 19_900);

  const results = await bootstrapProducts(fake.asStripe());

  assert.ok(results.every((r) => !r.created));
  assert.equal(fake.productCreateCalls, 0, "no products.create when every tier already has its product");
  assert.equal(fake.priceCreateCalls, 0, "no prices.create when the exact amount's price already exists");
});

test("reuses an existing product but still creates its missing price", async () => {
  const fake = new FakeStripe();
  // Product exists for "pro" with the right metadata, but NO price yet.
  fake.products.push({ id: "prod_existing_pro", name: "Pro", active: true, metadata: { notary_tier: "pro" } });

  const results = await bootstrapProducts(fake.asStripe());
  const pro = results.find((r) => r.plan === "pro")!;
  assert.equal(pro.created, false, "the product was reused");
  assert.equal(fake.productCreateCalls, 2, "only starter + team got new products");
  assert.equal(fake.priceCreateCalls, 3, "all three tiers needed a price");
  const price = fake.prices.find((p) => p.product === "prod_existing_pro");
  assert.ok(price && price.unit_amount === 4_900);
});

test("reuses the exact-amount monthly price and does not create a duplicate price", async () => {
  const fake = new FakeStripe();
  const { priceId } = fake.seedProduct("pro", 4_900);

  const results = await bootstrapProducts(fake.asStripe());
  const pro = results.find((r) => r.plan === "pro")!;
  assert.equal(pro.priceId, priceId, "the exact amount's existing price is reused");
  assert.equal(fake.priceCreateCalls, 2, "starter + team get new prices, pro's is reused");
});
