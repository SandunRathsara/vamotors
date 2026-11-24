"use client"
import Link from "next/link"
import {
  Car,
  LayoutDashboard,
  Users,
  Calculator,
  FileUp,
  FileText,
  ClipboardCheck,
  Banknote,
} from "lucide-react"
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
  const finance = abilityFor(actor.presentationGrants, actor.user.id)
  const reconciliation = finance.can("read", "ReconciliationRun") && finance.can("read", "CommissionEntitlement")
  const compareRates =
    finance.can("read", "RateSheet") && finance.can("read", "FinanceCompany")
  const publishRates =
    finance.can("create", "RateSheet") && finance.can("read", "FinanceCompany")
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
          {finance.can("read", "ApprovalRequest") && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/approvals" prefetch={false}>
                  <ClipboardCheck />
                  Approvals
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {finance.can("read", "ImportBatch") && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/imports" prefetch={false}>
                  <FileUp />
                  Import staging
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {(compareRates || publishRates) && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/lease-rate-sheets" prefetch={false}>
                  <Calculator />
                  Rate sheets
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {compareRates && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/lease-comparison" prefetch={false}>
                  <Calculator />
                  Lease comparison
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
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
          {finance.can("read", "Report") && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <Link href="/reports" prefetch={false}>
                  <FileText />
                  Reports
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {reconciliation && (
            <SidebarMenuItem>
              <div className="px-2 pt-3 pb-1 text-xs font-medium text-sidebar-foreground/70">Finance</div>
              <SidebarMenuButton asChild>
                <Link href="/lease-reconciliation" prefetch={false}>
                  <Banknote />
                  Reconciliation
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
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
