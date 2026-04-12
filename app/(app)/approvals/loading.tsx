import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function ApprovalsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="h-8 w-40 rounded-md bg-muted animate-pulse" />
        <div className="h-4 w-72 rounded-md bg-muted animate-pulse" />
      </div>
      <SkeletonTable columns={8} rows={8} />
    </div>
  )
}
