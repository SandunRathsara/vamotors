import { pageActor } from "@/lib/server/pages"
import { RepairsList } from "@/components/repairs/repair-workspace"
export default async function RepairsPage() {
  await pageActor()
  return <RepairsList />
}
