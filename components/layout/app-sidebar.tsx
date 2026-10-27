"use client"
import Link from "next/link"
import { Car, LayoutDashboard, Users } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useCapabilities } from "@/components/users/use-capabilities"
import { abilityFor } from "@/lib/server/permissions"

export function AppSidebar() {
  const { can, actor } = useCapabilities()
  const customer = abilityFor(actor.presentationGrants, actor.user.id).can(
    "read",
    "Customer"
  )
  const administration = (["User", "Role"] as const).some((t) =>
    ["read", "create", "update", "archive"].some((a) => can(t, a))
  )
  const parties = ["Supplier", "RepairVendor", "FinanceCompany"].some((type) =>
    abilityFor(actor.presentationGrants, actor.user.id).can("read", type)
  )
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <Car className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">VA Motors</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {parties && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/third-parties" prefetch={false}>
                  <Users />
                  Third parties
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {customer && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/customers" prefetch={false}>
                  <Users />
                  Customers
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="/dashboard">
                <LayoutDashboard />
                Overview
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {administration && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/users">
                  <Users />
                  Users &amp; Roles
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  )
}
