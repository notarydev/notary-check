// The pricing tiers — the SINGLE source of truth for billing. Every other
// module (bootstrapProducts, the checkout route, the webhook's plan mapping)
// reads from here; tier numbers must never be hardcoded anywhere else.
//
// Tiers were decided by the product owner (not derived here):
//   Starter    $0/mo      25 checks/month
//   Pro        $49/mo     500 checks/month
//   Team       $199/mo    2,500 checks/month
//   Enterprise custom     negotiated (sales-assisted, no Stripe object)
//
// Enterprise is deliberately NOT representable as a Stripe price: it has no
// monthly price and no fixed allowance. It is marked `custom: true` and is
// excluded from Stripe Product/Price creation (see STRIPE_TIERS below).

export type PlanId = "starter" | "pro" | "team" | "enterprise";

export interface Plan {
  /** Stable id, used as the organization.plan value and the Stripe metadata tag. */
  id: PlanId;
  /** Human-readable tier name. */
  name: string;
  /** Monthly price in US cents. null only for Enterprise (custom, negotiated). */
  monthlyPriceCents: number | null;
  /** Monthly checks-per-month allowance. null only for Enterprise (negotiated). */
  checksPerMonth: number | null;
  /** True for tiers that are sold by hand and never have a Stripe Product/Price. */
  custom: boolean;
}

export const PLANS: Plan[] = [
  { id: "starter", name: "Starter", monthlyPriceCents: 0, checksPerMonth: 25, custom: false },
  { id: "pro", name: "Pro", monthlyPriceCents: 4_900, checksPerMonth: 500, custom: false },
  { id: "team", name: "Team", monthlyPriceCents: 19_900, checksPerMonth: 2_500, custom: false },
  { id: "enterprise", name: "Enterprise", monthlyPriceCents: null, checksPerMonth: null, custom: true },
];

export const PLAN_BY_ID: Readonly<Record<PlanId, Plan>> = Object.fromEntries(
  PLANS.map((plan) => [plan.id, plan]),
) as Readonly<Record<PlanId, Plan>>;

/** Looks a tier up by id; returns undefined for anything not in PLANS. */
export function getPlan(id: string): Plan | undefined {
  return PLAN_BY_ID[id as PlanId];
}

/**
 * The tiers that get real Stripe Product + Price objects. Enterprise is
 * excluded: it is negotiated/sales-assisted and must never be pushed to Stripe.
 */
export function stripeTiers(): Plan[] {
  return PLANS.filter((plan) => !plan.custom);
}

/** The metadata tag used to make product bootstrapping idempotent. */
export function notaryTierMetadataTag(planId: PlanId): Record<string, string> {
  return { notary_tier: planId };
}
