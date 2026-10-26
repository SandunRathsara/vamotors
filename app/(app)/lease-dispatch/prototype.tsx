import { PageHeader } from "@/components/shared/page-header"
import { DispatchTables } from "@/components/lease/dispatch-tables"

export default function LeaseDispatchPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Lease Dispatch"
        description="Manage document dispatch to finance companies"
      />
      <DispatchTables />
    </div>
  )
}
