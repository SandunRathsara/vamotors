import { pageActor } from "@/lib/server/pages"
import { RecordSaleDialog } from "@/components/sales/record-sale-dialog"
import { SalesTable } from "@/components/sales/sales-table"

export default async function SalesPage() {
  await pageActor()
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sales</h1>
        <p className="text-sm text-muted-foreground">
          Complete cash and trade-in sales or inspect completed sale histories.
        </p>
      </div>
      <RecordSaleDialog />
      <SalesTable />
    </section>
  )
}
