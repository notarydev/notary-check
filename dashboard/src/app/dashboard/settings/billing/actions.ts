"use server";

import { redirect } from "next/navigation";
import { createCheckoutSession } from "@/lib/engine";
import { getCurrentOrg } from "@/lib/currentOrg";

// Only the self-serve tiers from engine/src/billing/plans.ts. "enterprise" is
// sales-assisted and has no Stripe object, so it's deliberately not a valid
// input here — see plans.ts / billing.ts, which reject it with a 400 anyway.
const SELF_SERVE_TIERS = new Set(["pro", "team"]);

/**
 * Starts a Stripe checkout session for the signed-in user's organization and
 * redirects the browser to it. Invoked from a <form action> on the Upgrade
 * buttons in page.tsx, so the tier is bound server-side per button rather
 * than trusted from client input.
 */
export async function startCheckout(tier: string): Promise<void> {
  if (!SELF_SERVE_TIERS.has(tier)) {
    throw new Error(`'${tier}' is not a self-serve tier`);
  }

  // getCurrentOrg() redirects to "/" on its own if there's no session —
  // deliberately not wrapped in try/catch here: Next's redirect() throws by
  // design and must be allowed to propagate uncaught.
  const { organizationId, apiKey } = await getCurrentOrg();
  const checkoutUrl = await createCheckoutSession(apiKey, organizationId, tier);

  // redirect() throws internally; must not be inside a try/catch.
  redirect(checkoutUrl);
}
