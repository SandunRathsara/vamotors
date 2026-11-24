"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useActor } from "@/components/providers/auth-boundary"
import { AcquisitionForm } from "@/components/purchases/acquisition-workspace"
import { RecordSaleDialog } from "@/components/sales/record-sale-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { privateRequest } from "@/lib/security-client"
import { abilityFor } from "@/lib/server/permissions"
import { major } from "@/lib/money"
import type { dashboardQuery } from "@/lib/server/reports"

type Metrics = Awaited<ReturnType<typeof dashboardQuery>>

export function Dashboard({ today }: { today: string }) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const [purchase, setPurchase] = useState(false)
  const [sale, setSale] = useState(false)
  const [range, setRange] = useState({
    from: today.slice(0, 7) + "-01",
    through: today,
  })
  const query = useQuery({
    queryKey: ["dashboard", range],
    retry: false,
    queryFn: () =>
      privateRequest<{ data: Metrics }>(
        `/api/v1/queries/dashboard?${new URLSearchParams(range)}`
      ),
  })
  const metrics = query.data?.data
  const cards = metrics
    ? [
        {
          label: "Vehicles in stock",
          value: metrics.stock,
          href: "/vehicles?status=IN_STOCK",
          detail:
            metrics.held === null
              ? undefined
              : `${metrics.held} held · ${(metrics.stock ?? 0) - metrics.held} available`,
        },
        {
          label: "Vehicles in repair",
          value: metrics.inRepair,
          href: "/repairs",
        },
        {
          label: "Completed sales in period",
          value: metrics.completedSales,
          href: "/sales",
        },
      ].filter(({ value }) => value !== null)
    : []
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {ability.can("create", "PurchaseRecord", "purchasePrice") && (
          <Button onClick={() => setPurchase(!purchase)}>New purchase</Button>
        )}
        {ability.can("create", "SaleCase", "price") && (
          <Button variant="outline" onClick={() => setSale(true)}>
            New sale
          </Button>
        )}
        {ability.can("create", "RepairRecord", "cycleId") &&
          ability.can("read", "PurchaseRecord", "id") && (
            <Button variant="outline" asChild>
              <Link href="/purchases?status=IN_STOCK" prefetch={false}>
                Send for repair
              </Link>
            </Button>
          )}
      </div>
      {purchase && (
        <AcquisitionForm
          onSaved={() => {
            setPurchase(false)
            void query.refetch()
          }}
        />
      )}
      {sale && (
        <RecordSaleDialog
          open={sale}
          onOpenChange={setSale}
          onCompleted={() => {
            setSale(false)
            void query.refetch()
          }}
        />
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          setRange({
            from: String(fields.get("from")),
            through: String(fields.get("through")),
          })
        }}
      >
        <label className="grid gap-1.5 text-sm">
          Sales from{" "}
          <Input
            type="date"
            name="from"
            required
            max={today}
            defaultValue={range.from}
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          Through{" "}
          <Input
            type="date"
            name="through"
            required
            max={today}
            defaultValue={range.through}
          />
        </label>
        <Button variant="outline" type="submit">
          Apply dates
        </Button>
      </form>
      {query.isPending && <p role="status">Loading dashboard…</p>}
      {query.isError && (
        <p role="alert">
          Dashboard unavailable. Check that the date range is in order.
        </p>
      )}
      {metrics && (
        <>
          <p className="text-sm text-muted-foreground">
            Current stock and repair status as of {metrics.asOf}. Sales from{" "}
            {metrics.from} through {metrics.through}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(({ label, value, href, detail }) => (
              <Link
                key={label}
                href={href}
                prefetch={false}
                className="rounded-lg border bg-card p-4 hover:bg-accent"
              >
                <h2 className="text-sm font-medium">{label}</h2>
                <p className="mt-2 text-3xl font-semibold tabular-nums">
                  {value}
                </p>
                {detail && (
                  <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                )}
              </Link>
            ))}
            {ability.can("read", "Report", "ADVANCES") && (
              <div className="rounded-lg border bg-card p-4">
                <h2 className="text-sm font-medium">Active advances</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Reservation records pending integration
                </p>
              </div>
            )}
          </div>
          {metrics.recentSales && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Recent sales</h2>
              {metrics.recentSales.length ? (
                <ul className="divide-y rounded-lg border">
                  {metrics.recentSales.map((row) => (
                    <li
                      key={row.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3"
                    >
                      <Link
                        href={`/sales/${row.id}`}
                        prefetch={false}
                        className="font-medium underline"
                      >
                        {row.vehicle ?? "View sale"}
                      </Link>
                      <span className="text-sm">
                        {row.date} · {row.type.replaceAll("_", " ")}
                      </span>
                      {row.price !== undefined && (
                        <span className="tabular-nums">
                          LKR {major(BigInt(row.price))}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No completed sales in this period.</p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
