import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function SalesReportLoading() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-48 animate-pulse rounded bg-muted" />
      <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      <div className="flex gap-4">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
      </div>
      <SkeletonTable columns={8} rows={8} />
    </div>
  )
}
