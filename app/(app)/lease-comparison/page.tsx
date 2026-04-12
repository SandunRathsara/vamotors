import { PageHeader } from "@/components/shared/page-header"
import { LeaseComparisonView } from "@/components/lease/lease-comparison-view"

export default function LeaseComparisonPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lease Comparison"
        description="Compare lease rates across finance companies"
      />
      <LeaseComparisonView />
    </div>
  )
}
