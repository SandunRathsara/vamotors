"use client"

import { useQuery } from "@tanstack/react-query"
import { Car, Wrench, Clock, TrendingUp } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

type DashboardData = {
  inStock: number
  inRepair: number
  activeAdvances: number
  recentSales: number
}

const KPI_ITEMS = [
  { key: "inStock" as const, label: "In Stock", icon: Car },
  { key: "inRepair" as const, label: "In Repair", icon: Wrench },
  { key: "activeAdvances" as const, label: "Active Advances", icon: Clock },
  { key: "recentSales" as const, label: "Recent Sales (7d)", icon: TrendingUp },
]

export function KPICards() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error("Failed to load dashboard data")
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {KPI_ITEMS.map(({ key, label, icon: Icon }) => (
        <Card key={key}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground">
              {label}
            </CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{data?.[key] ?? 0}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
