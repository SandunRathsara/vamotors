import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function CashFlowLoading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash Flow"
        description="Transaction history and running financial position"
      />

      {/* Summary card skeletons */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-40" />
          </div>
        ))}
      </div>

      {/* Filter skeleton */}
      <div className="flex gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-40" />
      </div>

      <SkeletonTable columns={5} rows={8} />
    </div>
  )
}
