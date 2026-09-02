import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentOrg } from "@/lib/currentOrg";
import { getUsage, listReviews } from "@/lib/engine";

export const dynamic = "force-dynamic";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "complete":
      return "default";
    case "failed":
      return "destructive";
    case "processing":
      return "secondary";
    default:
      return "outline";
  }
}

export default async function DashboardOverviewPage() {
  const org = await getCurrentOrg();
  const [usage, { reviews }] = await Promise.all([getUsage(org.apiKey), listReviews(org.apiKey, { limit: 5 })]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Usage this month</CardTitle>
          <CardDescription>Plan: {usage.plan_id}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <p className="text-sm">
            {usage.checks_used_this_month.toLocaleString()}
            {usage.checks_limit !== null ? ` / ${usage.checks_limit.toLocaleString()}` : ""} checks used
          </p>
          <p className="text-sm text-muted-foreground">
            {(usage.cost_cents_this_month / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}{" "}
            spent of{" "}
            {(usage.org_monthly_limit_cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD" })}{" "}
            limit
          </p>
          <Link href="/dashboard/usage" className="mt-2 text-sm underline text-muted-foreground">
            View usage details
          </Link>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Recent reviews</CardTitle>
          <CardDescription>Your organization&apos;s latest reviews.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            reviews.map((review) => (
              <Link
                key={review.id}
                href={`/dashboard/reviews/${review.id}`}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="text-muted-foreground">{new Date(review.created_at).toLocaleString()}</span>
                <Badge variant={statusVariant(review.status)}>{review.status}</Badge>
              </Link>
            ))
          )}
          <Link href="/dashboard/reviews" className="mt-2 text-sm underline text-muted-foreground">
            View all reviews
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
