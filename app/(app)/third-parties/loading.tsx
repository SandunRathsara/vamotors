import { PageHeader } from "@/components/shared/page-header"
import { SkeletonTable } from "@/components/shared/skeleton-table"

export default function ThirdPartiesLoading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Third Parties"
        description="Manage suppliers, repair vendors, and finance companies"
      />
      <SkeletonTable columns={9} rows={8} />
    </div>
  )
}
