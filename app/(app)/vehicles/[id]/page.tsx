import { pageActor } from "@/lib/server/pages"
import { AcquisitionDetail } from "@/components/purchases/acquisition-workspace"
export default async function VehiclePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await pageActor()
  return <AcquisitionDetail vehicle id={(await params).id} />
}
