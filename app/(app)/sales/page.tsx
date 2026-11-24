import { pageActor } from "@/lib/server/pages"
import { RecordSaleDialog } from "@/components/sales/record-sale-dialog"
import { SalesTable } from "@/components/sales/sales-table"

import { abilityFor } from "@/lib/server/permissions"
import { CommitmentList } from "@/components/sales/commitment-list"

export default async function SalesPage() {
  const { actor } = await pageActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const canRunExpiry = ability.can("run", "ReservationExpiryJob", "through")
  const canReadCommitments = ["id", "kind", "state"].every((field) =>
    ability.can("read", "SaleCase", field)
  )
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="text-sm text-muted-foreground">
          Record sales, place advances, and follow through on inventory leases.
        </p>
      </div>
      <RecordSaleDialog />
      {(canReadCommitments || canRunExpiry) && (
        <CommitmentList
          canRunExpiry={canRunExpiry}
          canRead={canReadCommitments}
        />
      )}
      {ability.can("read", "SaleCase", "id") &&
        ability.can("read", "PurchaseRecord", "status") && <SalesTable />}
    </section>
  )
}
