import { PageHeader } from "@/components/shared/page-header"
import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function SalesLoading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Sales" description="Track all vehicle sales" />
      <SkeletonTable columns={9} rows={8} />
    </div>
  )
}
