"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileSearch,
  Library,
  Gauge,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

// Central place the dashboard's information architecture is defined — add a
// new top-level dashboard page by adding one entry here.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/reviews", label: "Reviews", icon: FileSearch },
  { href: "/dashboard/evidence", label: "Evidence", icon: Library },
  { href: "/dashboard/usage", label: "Usage", icon: Gauge },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-3">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Notary Check
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                // "/dashboard" itself must not match every nested route —
                // every other entry matches its own subtree.
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={isActive} render={<Link href={item.href} />}>
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}
