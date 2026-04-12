import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function StockReportLoading() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-48 rounded bg-muted animate-pulse" />
      <div className="h-8 w-64 rounded bg-muted animate-pulse" />
      <SkeletonTable columns={6} rows={8} />
    </div>
  )
}
