import { WorkflowTotals } from "@/components/dashboard/workflow-totals"
import { pageActor } from "@/lib/server/pages"

export default async function DashboardPage() {
  await pageActor()
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <WorkflowTotals />
    </section>
  )
}
