import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"

export default function PurchasesLoading() {
  return (
    <div className="space-y-6">
      <PageHeader title="Purchases" description="Record vehicle purchases into inventory" />

      {/* Tab triggers skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-9 w-28" />
      </div>

      {/* Form skeleton */}
      <div className="space-y-6">
        <div className="rounded-lg border p-6 space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-6 space-y-4">
          <Skeleton className="h-6 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
