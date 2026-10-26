import { PageHeader } from "@/components/shared/page-header"
import { RateSheetsView } from "@/components/lease/rate-sheets-view"

export default function LeaseRateSheetsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Rate Sheets"
        description="Finance company lease rates by vehicle model and loan amount"
      />
      <RateSheetsView />
    </div>
  )
}
