// Idempotent Stripe Product + Price bootstrapping for the non-custom tiers
// (Starter, Pro, Team — Enterprise is sales-assisted and deliberately excluded,
// see plans.ts).
//
// Run once (`tsx src/billing/bootstrapProducts.ts` against the configured
// STRIPE_SECRET_KEY) and re-run freely: before creating anything it searches
// Stripe for an existing product carrying the `notary_tier: "<plan id>"`
// metadata tag and reuses it, and reuses an existing monthly recurring price at
// the exact plan amount. Running it twice must never create duplicates.
//
// Exported so it can be imported and unit-tested with an injected Stripe
// client, mirroring the injectable seams used throughout this codebase.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { createStripeClient } from "./stripeClient.ts";
import { notaryTierMetadataTag, stripeTiers, type Plan, type PlanId } from "./plans.ts";

export interface BootstrapResult {
  plan: PlanId;
  productId: string;
  priceId: string;
  /** True only when THIS run created the product (false = already existed). */
  created: boolean;
}

export interface TierProductAndPrice {
  productId: string;
  priceId: string;
  /** True only when THIS call created the product (false = already existed). */
  created: boolean;
}

export interface BootstrapOptions {
  /** Optional sink for progress messages (defaults to no-op). */
  logger?: (message: string) => void;
}

const LIST_LIMIT = 100;

/** Finds the active product tagged with this tier, paginating past the 100-item page. */
async function findProductByTier(stripe: Stripe, planId: PlanId): Promise<Stripe.Product | null> {
  let startingAfter: string | undefined;
  for (;;) {
    const list = await stripe.products.list({
      active: true,
      limit: LIST_LIMIT,
      ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
    });
    const match = list.data.find((p) => p.metadata?.notary_tier === planId);
    if (match) return match;
    if (!list.has_more) return null;
    startingAfter = list.data[list.data.length - 1]?.id;
  }
}

/** Finds an active monthly USD price for the product at exactly `unitAmount` cents. */
async function findMonthlyPrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
): Promise<Stripe.Price | null> {
  let startingAfter: string | undefined;
  for (;;) {
    const list = await stripe.prices.list({
      product: productId,
      active: true,
      limit: LIST_LIMIT,
      ...(startingAfter !== undefined ? { starting_after: startingAfter } : {}),
    });
    const match = list.data.find(
      (p) => p.unit_amount === unitAmount && p.currency === "usd" && p.recurring?.interval === "month",
    );
    if (match) return match;
    if (!list.has_more) return null;
    startingAfter = list.data[list.data.length - 1]?.id;
  }
}

/**
 * Ensures a Stripe Product + monthly recurring Price exists for a SINGLE tier.
 * Idempotent: the product is looked up by its `notary_tier` metadata tag and the
 * price by exact unit amount before any create. Used by bootstrapProducts (all
 * tiers) and by the checkout route (one tier, so checkout works even if the
 * bootstrap script was never run).
 */
export async function ensureTierProductAndPrice(
  stripe: Stripe,
  plan: Plan,
  logger: (message: string) => void = () => {},
): Promise<TierProductAndPrice> {
  // unit_amount is guaranteed non-null for non-custom tiers (plans.ts).
  const unitAmount = plan.monthlyPriceCents as number;

  let product = await findProductByTier(stripe, plan.id);
  let created = false;
  if (product !== null) {
    logger(`bootstrap ${plan.id}: reusing existing product ${product.id}`);
  } else {
    product = await stripe.products.create({
      name: plan.name,
      metadata: notaryTierMetadataTag(plan.id),
    });
    created = true;
    logger(`bootstrap ${plan.id}: created product ${product.id}`);
  }

  let price = await findMonthlyPrice(stripe, product.id, unitAmount);
  if (price === null) {
    price = await stripe.prices.create({
      product: product.id,
      unit_amount: unitAmount,
      currency: "usd",
      recurring: { interval: "month" },
    });
    logger(`bootstrap ${plan.id}: created price ${price.id}`);
  } else {
    logger(`bootstrap ${plan.id}: reusing existing price ${price.id}`);
  }

  return { productId: product.id, priceId: price.id, created };
}

/**
 * Ensures a Stripe Product + monthly recurring Price exists for every
 * non-custom tier. Idempotent: products are looked up by their
 * `notary_tier` metadata tag and prices by exact unit amount before any create.
 * Returns one result per tier, so callers (and tests) can assert idempotency.
 */
export async function bootstrapProducts(
  stripe: Stripe,
  options: BootstrapOptions = {},
): Promise<BootstrapResult[]> {
  const log = options.logger ?? (() => {});
  const results: BootstrapResult[] = [];

  for (const plan of stripeTiers()) {
    const { productId, priceId, created } = await ensureTierProductAndPrice(stripe, plan, log);
    results.push({ plan: plan.id, productId, priceId, created });
  }

  return results;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const { config } = await import("dotenv");
  config();
  const stripe = createStripeClient();
  const results = await bootstrapProducts(stripe, { logger: console.log });
  console.log(
    results
      .map((r) => `${r.created ? "created" : "found"} ${r.plan}: product=${r.productId} price=${r.priceId}`)
      .join("\n"),
  );
}
