import { pageActor } from "@/lib/server/pages"
import { AcquisitionDetail } from "@/components/purchases/acquisition-workspace"
export default async function PurchasePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await pageActor()
  return <AcquisitionDetail id={(await params).id} />
}
