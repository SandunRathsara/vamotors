import { PageHeader } from "@/components/shared/page-header"
import { ReconciliationTable } from "@/components/lease/reconciliation-table"

export default function LeaseReconciliationPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Commission Reconciliation"
        description="Track and reconcile lease commission payments"
      />
      <ReconciliationTable />
    </div>
  )
}
