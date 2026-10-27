import { pageActor } from "@/lib/server/pages"
import { AcquisitionWorkspace } from "@/components/purchases/acquisition-workspace"
export default async function VehiclesPage() {
  await pageActor()
  return <AcquisitionWorkspace inventory />
}
