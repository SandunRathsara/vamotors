import { Skeleton } from "@/components/ui/skeleton"

function SkeletonCard({ rows = 2 }: { rows?: number }) {
  return (
    <div className="rounded-lg border bg-card p-6 space-y-4">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: rows * 2 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
      <SkeletonCard rows={3} />
      <SkeletonCard rows={2} />
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="space-y-1.5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-32 w-full" />
      </div>
      <SkeletonCard rows={1} />
      <div className="flex justify-end">
        <Skeleton className="h-9 w-28" />
      </div>
    </div>
  )
}
