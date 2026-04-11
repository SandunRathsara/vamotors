import {
  LayoutDashboard,
  Car,
  ShoppingCart,
  DollarSign,
  Wrench,
  Users,
  Building2,
  FileText,
  CheckSquare,
  ArrowLeftRight,
  Wallet,
  Handshake,
  BarChart3,
  BookOpen,
  Truck,
  Settings,
  UserCog,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  badge?: boolean
}

export type NavSection = {
  label: string
  items: NavItem[]
}

export const NAV_SECTIONS: NavSection[] = [
  {
    label: "Main",
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { title: "Vehicles", href: "/vehicles", icon: Car },
      { title: "Purchases", href: "/purchases", icon: ShoppingCart },
      { title: "Sales", href: "/sales", icon: DollarSign },
      { title: "Repairs", href: "/repairs", icon: Wrench },
    ],
  },
  {
    label: "Management",
    items: [
      { title: "Customers", href: "/customers", icon: Users },
      { title: "Third Parties", href: "/third-parties", icon: Building2 },
      { title: "Reports", href: "/reports", icon: FileText },
      { title: "Approvals", href: "/approvals", icon: CheckSquare, badge: true },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Reconciliation", href: "/lease-reconciliation", icon: ArrowLeftRight },
      { title: "Cash Flow", href: "/cash-flow", icon: Wallet },
    ],
  },
  {
    label: "Brokerage",
    items: [
      { title: "Lease Deals", href: "/lease-deals", icon: Handshake },
      { title: "Comparison Tool", href: "/lease-comparison", icon: BarChart3 },
      { title: "Rate Sheets", href: "/lease-rate-sheets", icon: BookOpen },
      { title: "Dispatch", href: "/lease-dispatch", icon: Truck },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Settings", href: "/settings", icon: Settings },
      { title: "Users & Roles", href: "/users", icon: UserCog },
    ],
  },
]
