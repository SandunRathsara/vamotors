import { PageHeader } from "@/components/shared/page-header"
import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function RepairsLoading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Repairs" description="Track vehicle repair history" />
      <SkeletonTable columns={9} rows={8} />
    </div>
  )
}
