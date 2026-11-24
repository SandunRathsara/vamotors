import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  Building2,
  Calculator,
  Car,
  ClipboardCheck,
  FileText,
  FileUp,
  Handshake,
  History,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { subject } from "@casl/ability"
import { reportKinds } from "@/lib/report-kinds"
import type { Ability } from "@/lib/server/permissions"

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  visible?: (ability: Ability) => boolean
}

export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: "Operations",
    items: [
      { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
      {
        title: "Vehicles",
        href: "/vehicles",
        icon: Car,
        visible: (a) =>
          a.can("read", "Vehicle") && a.can("read", "PurchaseRecord"),
      },
      {
        title: "Purchases",
        href: "/purchases",
        icon: ShoppingCart,
        visible: (a) =>
          a.can("read", "PurchaseRecord") || a.can("create", "PurchaseRecord"),
      },
      {
        title: "Repairs",
        href: "/repairs",
        icon: Wrench,
        visible: (a) =>
          a.can("read", "PurchaseRecord", "status") &&
          a.can("read", "RepairRecord", "id"),
      },
      {
        title: "Sales & invoices",
        href: "/sales",
        icon: Banknote,
        visible: (a) =>
          a.can("read", "SaleCase") ||
          (a.can("read", "PurchaseRecord") &&
            a.can("create", "SaleCase", "price")) ||
          a.can("run", "ReservationExpiryJob", "through"),
      },
      {
        title: "Approvals",
        href: "/approvals",
        icon: ClipboardCheck,
        visible: (a) => a.can("read", "ApprovalRequest"),
      },
    ],
  },
  {
    label: "Brokerage",
    items: [
      {
        title: "Lease deals",
        href: "/lease-deals",
        icon: Handshake,
        visible: (a) =>
          (a.can("read", "BrokerageDeal", "id") &&
            a.can("read", "BrokerageDeal", "state")) ||
          a.can("create", "BrokerageDeal", "customerId"),
      },
      {
        title: "Dispatch",
        href: "/lease-dispatch",
        icon: Truck,
        visible: (a) =>
          a.can("read", "BrokerageDeal", "id") &&
          a.can("read", "BrokerageDeal", "state") &&
          a.can("create", "DispatchBatch", "sourceIds") &&
          a.can("dispatch", "BrokerageDeal", "dealId"),
      },
      {
        title: "Lease comparison",
        href: "/lease-comparison",
        icon: Calculator,
        visible: (a) =>
          a.can("read", "RateSheet") && a.can("read", "FinanceCompany"),
      },
      {
        title: "Rate sheets",
        href: "/lease-rate-sheets",
        icon: BookOpen,
        visible: (a) =>
          a.can("read", "FinanceCompany") &&
          (a.can("read", "RateSheet") || a.can("create", "RateSheet")),
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        title: "Reconciliation",
        href: "/lease-reconciliation",
        icon: ArrowLeftRight,
        visible: (a) =>
          a.can("read", "ReconciliationRun") &&
          a.can("read", "CommissionEntitlement"),
      },
      {
        title: "Reports",
        href: "/reports",
        icon: FileText,
        visible: (a) =>
          reportKinds.some((kind) => a.can("read", "Report", kind)),
      },
      {
        title: "Audit history",
        href: "/reports/audit",
        icon: History,
        visible: (a) => a.can("read", "AuditLog"),
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        title: "Customers",
        href: "/customers",
        icon: Users,
        visible: (a) =>
          a.can("read", "Customer") || a.can("create", "Customer"),
      },
      {
        title: "Third parties",
        href: "/third-parties",
        icon: Building2,
        visible: (a) =>
          ["Supplier", "RepairVendor", "FinanceCompany"].some((type) =>
            a.can("read", type)
          ),
      },
      {
        title: "Import staging",
        href: "/imports",
        icon: FileUp,
        visible: (a) => a.can("read", "ImportBatch"),
      },
      {
        title: "Settings",
        href: "/settings",
        icon: Settings,
        visible: (a) => a.can("read", "Settings"),
      },
      {
        title: "Users & roles",
        href: "/users",
        icon: UserCog,
        visible: (a) =>
          ["User", "Role"].some((type) =>
            ["read", "create", "update", "archive"].some((action) =>
              a.can(action, subject(type, {}))
            )
          ),
      },
    ],
  },
]
