import { PageHeader } from "@/components/shared/page-header"
import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function VehiclesLoading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Vehicles" description="Manage your vehicle inventory" />
      <SkeletonTable columns={9} rows={8} />
    </div>
  )
}
