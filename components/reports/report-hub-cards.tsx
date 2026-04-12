import Link from "next/link"
import {
  Package,
  TrendingUp,
  ShoppingCart,
  Wrench,
  Clock,
  BarChart3,
  FileText,
} from "lucide-react"

import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

const REPORT_CARDS = [
  {
    title: "Stock Summary",
    description: "Current vehicle inventory by status",
    icon: Package,
    href: "/reports/stock",
  },
  {
    title: "Sales Summary",
    description: "Sales activity and revenue by period",
    icon: TrendingUp,
    href: "/reports/sales",
  },
  {
    title: "Purchase Summary",
    description: "Purchase history and costs",
    icon: ShoppingCart,
    href: "/reports/purchases",
  },
  {
    title: "Repair Costs",
    description: "Repair expenses by vendor and vehicle",
    icon: Wrench,
    href: "/reports/repairs",
  },
  {
    title: "Advances",
    description: "Active and expired advance payments",
    icon: Clock,
    href: "/reports/advances",
  },
  {
    title: "Profit Analysis",
    description: "Per-vehicle profit breakdown",
    icon: BarChart3,
    href: "/reports/profit",
  },
  {
    title: "Audit Trail",
    description: "System-wide change history",
    icon: FileText,
    href: "/reports/audit",
  },
]

export function ReportHubCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {REPORT_CARDS.map((card) => {
        const Icon = card.icon
        return (
          <Link key={card.href} href={card.href}>
            <Card className="h-full cursor-pointer transition-colors hover:bg-accent/50">
              <CardHeader className="flex flex-row items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base font-semibold">{card.title}</CardTitle>
                  <CardDescription className="text-xs">{card.description}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        )
      })}
    </div>
  )
}
