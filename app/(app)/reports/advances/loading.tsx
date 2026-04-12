import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function AdvancesReportLoading() {
  return (
    <div className="space-y-6">
      <div className="h-5 w-48 rounded bg-muted animate-pulse" />
      <div className="h-8 w-64 rounded bg-muted animate-pulse" />
      <div className="flex gap-4">
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
      </div>
      <SkeletonTable columns={8} rows={8} />
    </div>
  )
}
