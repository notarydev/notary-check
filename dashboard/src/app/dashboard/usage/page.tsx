import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { getCurrentOrg } from "@/lib/currentOrg";
import { getUsage } from "@/lib/engine";

export const dynamic = "force-dynamic";

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export default async function UsagePage() {
  const org = await getCurrentOrg();
  const usage = await getUsage(org.apiKey);

  const checksPct =
    usage.checks_limit && usage.checks_limit > 0
      ? Math.min(100, Math.round((usage.checks_used_this_month / usage.checks_limit) * 100))
      : null;
  const costPct =
    usage.org_monthly_limit_cents > 0
      ? Math.min(100, Math.round((usage.cost_cents_this_month / usage.org_monthly_limit_cents) * 100))
      : null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Checks this month</CardTitle>
          <CardDescription>Plan: {usage.plan_id}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-2xl font-semibold">
            {usage.checks_used_this_month.toLocaleString()}
            {usage.checks_limit !== null ? ` / ${usage.checks_limit.toLocaleString()}` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            {usage.checks_limit !== null
              ? `${usage.checks_used_this_month.toLocaleString()} of ${usage.checks_limit.toLocaleString()} checks used this month${
                  checksPct !== null ? ` (${checksPct}%)` : ""
                }`
              : "No fixed monthly allowance on this plan."}
          </p>
          {checksPct !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${checksPct}%` }} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost this month</CardTitle>
          <CardDescription>Against your organization&apos;s monthly limit.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-2xl font-semibold">
            {formatCents(usage.cost_cents_this_month)} / {formatCents(usage.org_monthly_limit_cents)}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCents(usage.cost_cents_this_month)} of {formatCents(usage.org_monthly_limit_cents)} spent this
            month{costPct !== null ? ` (${costPct}%)` : ""}
          </p>
          {costPct !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${costPct}%` }} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
