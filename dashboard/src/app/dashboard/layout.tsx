import { UserButton } from "@clerk/nextjs";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { DashboardNav } from "@/components/dashboard/dashboard-nav";
import { getCurrentOrg } from "@/lib/currentOrg";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  // Resolves (and, on a returning user, reads from Clerk privateMetadata
  // rather than re-minting a key — see lib/currentOrg.ts) once per request.
  // Every page nested under this layout can call getCurrentOrg() again
  // without a second network round trip, since it's wrapped in React's
  // cache().
  await getCurrentOrg();

  return (
    <SidebarProvider>
      <DashboardNav />
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <div className="flex-1" />
          <UserButton />
        </header>
        <main className="flex flex-1 flex-col gap-4 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
