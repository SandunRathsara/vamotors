import { headers } from "next/headers"
import { authenticate } from "@/lib/server/actor"
import { repairPagePurchase } from "@/lib/server/repair-detail"
import { RepairDetail } from "@/components/repairs/repair-workspace"

export default async function RepairPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const cycle = await repairPagePurchase(
    await authenticate(await headers()),
    id
  )
  return <RepairDetail cycleId={String(cycle.id)} repairId={id} />
}
