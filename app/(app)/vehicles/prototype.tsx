import { PageHeader } from "@/components/shared/page-header"
import { VehiclesTable } from "@/components/vehicles/vehicles-table"

export default function VehiclesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicles"
        description="Manage your vehicle inventory"
      />
      <VehiclesTable />
    </div>
  )
}
