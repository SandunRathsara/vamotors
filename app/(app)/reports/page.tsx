import { PageHeader } from "@/components/shared/page-header"
import { ReportHubCards } from "@/components/reports/report-hub-cards"

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Financial and operational reports for your dealership"
      />
      <ReportHubCards />
    </div>
  )
}
