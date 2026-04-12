import { PageHeader } from "@/components/shared/page-header"
import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function CustomersLoading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Manage customer records" />
      <SkeletonTable columns={9} rows={8} />
    </div>
  )
}
