import { SkeletonTable } from "@/components/shared/skeleton-table"

// Inbox-only: a parent loading.tsx would stream HTTP200 before the exact
// authorized /approvals/[id] lookup can return NOT_FOUND404.

export default function ApprovalsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="h-8 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
      </div>
      <SkeletonTable columns={8} rows={8} />
    </div>
  )
}
