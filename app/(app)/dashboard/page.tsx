import { Dashboard } from "@/components/dashboard/dashboard"
import { pageActor } from "@/lib/server/pages"
import { colomboToday } from "@/lib/server/purchases"

export default async function DashboardPage() {
  await pageActor()
  return (
    <section className="mx-auto w-full max-w-6xl space-y-5">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <Dashboard today={colomboToday()} />
    </section>
  )
}
