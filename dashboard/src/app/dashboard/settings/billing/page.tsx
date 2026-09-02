import { getCurrentOrg } from "@/lib/currentOrg";
import { getOrganization } from "@/lib/settings";
import { startCheckout } from "./actions";

// Mirrors engine/src/billing/plans.ts (the single source of truth on the
// engine side). Starter is the implicit default for a freshly-provisioned
// org and isn't a Stripe checkout target, so it's just shown as the current
// baseline, not an upgrade button.
const PAID_TIERS = [
  { id: "pro", name: "Pro", priceLabel: "$49/mo", checks: "500 checks/month" },
  { id: "team", name: "Team", priceLabel: "$199/mo", checks: "2,500 checks/month" },
] as const;

export default async function BillingPage() {
  // getCurrentOrg() redirects on its own if there's no session.
  const { organizationId, apiKey } = await getCurrentOrg();

  // Best-effort: /v1/organization may not be deployed yet in every
  // environment. Failure here shouldn't take down the whole page — the
  // upgrade buttons will surface a real error if clicked while it's down.
  let plan: Awaited<ReturnType<typeof getOrganization>> | null = null;
  let planError: string | null = null;
  try {
    plan = await getOrganization(apiKey);
  } catch (err) {
    planError = err instanceof Error ? err.message : "unknown error";
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Plan, usage allowance, and upgrades.</p>
      </div>

      <section className="rounded-xl border p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Current plan</h2>
        {plan ? (
          <>
            <p className="mt-2 text-lg font-semibold">
              {plan.planName}
              {plan.checksPerMonth != null ? ` — ${plan.checksPerMonth.toLocaleString()} checks/month` : ""}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {plan.hasPaymentMethod
                ? "A payment method is on file for this organization."
                : "Every new Notary organization starts on the free tier. Upgrade below for a higher monthly allowance."}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-500">
            Couldn&apos;t load your current plan right now{planError ? ` (${planError})` : ""}. You can still start
            an upgrade below.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">Organization: {organizationId}</p>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PAID_TIERS.map((tier) => (
          <div key={tier.id} className="flex flex-col rounded-xl border p-6">
            <h3 className="text-lg font-semibold">{tier.name}</h3>
            <p className="mt-1 text-2xl font-semibold">{tier.priceLabel}</p>
            <p className="mt-1 text-sm text-muted-foreground">{tier.checks}</p>
            <form action={startCheckout.bind(null, tier.id)} className="mt-6">
              <button
                type="submit"
                className="w-full rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                Upgrade to {tier.name}
              </button>
            </form>
          </div>
        ))}

        <div className="flex flex-col rounded-xl border p-6">
          <h3 className="text-lg font-semibold">Enterprise</h3>
          <p className="mt-1 text-2xl font-semibold">Custom</p>
          <p className="mt-1 text-sm text-muted-foreground">Negotiated pricing &amp; allowance</p>
          <a
            href="mailto:sales@notarycheck.ai?subject=Enterprise%20plan"
            className="mt-6 w-full rounded-full border px-4 py-2 text-center text-sm font-medium transition-colors hover:bg-muted"
          >
            Contact us
          </a>
        </div>
      </section>
    </div>
  );
}
