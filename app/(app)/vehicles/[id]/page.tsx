import { VehicleDetailTabs } from "@/components/vehicles/vehicle-detail-tabs"

type VehicleDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function VehicleDetailPage({ params }: VehicleDetailPageProps) {
  const { id } = await params
  return <VehicleDetailTabs id={id} />
}
