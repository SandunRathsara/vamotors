import { KPICards } from "@/components/dashboard/kpi-cards"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { SalesChart } from "@/components/dashboard/sales-chart"
import { ActivityFeed } from "@/components/dashboard/activity-feed"

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <KPICards />

      <QuickActions />

      <div className="grid gap-6 lg:grid-cols-2">
        <SalesChart />
        <ActivityFeed />
      </div>
    </div>
  )
}
