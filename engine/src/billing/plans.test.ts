// Pure unit tests for the pricing tiers (engine/src/billing/plans.ts) — the
// single source of truth for billing. No network, no DB. Every tier number
// asserted here is the product-owner-decided value and must never be hardcoded
// anywhere else in the codebase.

import assert from "node:assert/strict";
import { test } from "node:test";
import { getPlan, PLANS, PLAN_BY_ID, stripeTiers } from "./plans.ts";

test("all four tiers are defined with the product-owner-decided numbers", () => {
  assert.deepEqual(
    PLANS.map((p) => ({ id: p.id, priceCents: p.monthlyPriceCents, checksPerMonth: p.checksPerMonth })),
    [
      { id: "starter", priceCents: 0, checksPerMonth: 25 },
      { id: "pro", priceCents: 4_900, checksPerMonth: 500 },
      { id: "team", priceCents: 19_900, checksPerMonth: 2_500 },
      { id: "enterprise", priceCents: null, checksPerMonth: null },
    ],
  );
});

test("enterprise is custom (sales-assisted) and has no Stripe price or fixed allowance", () => {
  const enterprise = PLAN_BY_ID.enterprise;
  assert.equal(enterprise.custom, true);
  assert.equal(enterprise.monthlyPriceCents, null);
  assert.equal(enterprise.checksPerMonth, null);
});

test("stripeTiers() excludes enterprise — only tiers that get Stripe objects", () => {
  const tiers = stripeTiers();
  assert.deepEqual(
    tiers.map((t) => t.id),
    ["starter", "pro", "team"],
  );
  assert.ok(tiers.every((t) => !t.custom));
  assert.ok(tiers.every((t) => typeof t.monthlyPriceCents === "number"));
});

test("the non-custom tier prices match $0 / $49 / $199 monthly exactly", () => {
  assert.equal(PLAN_BY_ID.starter.monthlyPriceCents, 0);
  assert.equal(PLAN_BY_ID.pro.monthlyPriceCents, 4_900);
  assert.equal(PLAN_BY_ID.team.monthlyPriceCents, 19_900);
});

test("getPlan resolves known ids and returns undefined for anything else", () => {
  assert.equal(getPlan("starter")?.name, "Starter");
  assert.equal(getPlan("pro")?.name, "Pro");
  assert.equal(getPlan("team")?.name, "Team");
  assert.equal(getPlan("enterprise")?.custom, true);
  assert.equal(getPlan("platinum"), undefined);
  assert.equal(getPlan(""), undefined);
});

test("PLAN_BY_ID and PLANS describe the same set", () => {
  assert.equal(Object.keys(PLAN_BY_ID).length, PLANS.length);
  for (const plan of PLANS) {
    assert.equal(PLAN_BY_ID[plan.id], plan);
  }
});
