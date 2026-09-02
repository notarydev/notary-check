import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Settings index: links out to the three sub-pages. Kept as a simple card
// grid rather than Tabs since each destination is its own route (Tabs would
// imply same-page switching).
export default function SettingsPage() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Link href="/dashboard/settings/billing">
        <Card className="h-full transition-colors hover:bg-muted/50">
          <CardHeader>
            <CardTitle>Billing</CardTitle>
            <CardDescription>Plan, usage allowance, and upgrades.</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/dashboard/settings/api-keys">
        <Card className="h-full transition-colors hover:bg-muted/50">
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>Issue and revoke API keys for this organization.</CardDescription>
          </CardHeader>
        </Card>
      </Link>
      <Link href="/dashboard/settings/connect">
        <Card className="h-full transition-colors hover:bg-muted/50">
          <CardHeader>
            <CardTitle>Connect Claude</CardTitle>
            <CardDescription>Add Notary as a connector in Claude.</CardDescription>
          </CardHeader>
        </Card>
      </Link>
    </div>
  );
}
