"use client"

import Link from "next/link"
import type {
  PurchaseCycleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { major } from "@/lib/money"

export type VisibleCycle = Visible<PurchaseCycleDTO>

export function formatMoney(value?: string) {
  return value === undefined ? "Unavailable" : major(BigInt(value))
}

export function SaleKindLabel(kind?: string) {
  if (kind === "TRADE_IN") return "Trade-In"
  if (kind === "CASH") return "Cash"
  if (kind === "ADVANCE") return "Advance"
  if (kind === "LEASE") return "Lease"
  return kind ?? "Unavailable"
}

export function SaleSummaryRow({ cycle }: { cycle: VisibleCycle }) {
  const sale =
    cycle.sales?.find((s) => s.state === "COMPLETED") ?? cycle.sales?.[0]
  return (
    <tr className="border-b">
      <td className="px-3 py-3 text-sm">
        {cycle.identity
          ? `${cycle.identity.make ?? ""} ${cycle.identity.model ?? ""} (${cycle.identity.year ?? ""})`
          : (cycle.vehicleId ?? "Unavailable")}
        {cycle.identity?.engineNumber && (
          <div className="text-xs text-muted-foreground">
            {cycle.identity.engineNumber} / {cycle.identity.chassisNumber}
          </div>
        )}
      </td>
      <td className="px-3 py-3 text-sm">{SaleKindLabel(sale?.kind)}</td>
      <td className="px-3 py-3 text-sm tabular-nums">
        {sale?.date ?? "Unavailable"}
      </td>
      <td className="px-3 py-3 text-right text-sm tabular-nums">
        {formatMoney(cycle.financial?.salePrice)}
      </td>
      <td className="px-3 py-3 text-right text-sm tabular-nums">
        {formatMoney(
          cycle.financial?.restatedProfit ?? cycle.financial?.originalProfit
        )}
      </td>
      <td className="px-3 py-3 text-sm">
        {sale?.state ?? cycle.status ?? "Unavailable"}
      </td>
      <td className="px-3 py-3 text-sm">
        {sale?.saleCaseId ? (
          <Link
            prefetch={false}
            className="inline-flex min-h-11 items-center underline"
            href={`/sales/${sale.saleCaseId}`}
          >
            View sale
          </Link>
        ) : (
          <Link
            prefetch={false}
            className="inline-flex min-h-11 items-center underline"
            href={`/purchases/${cycle.id}`}
          >
            Cycle
          </Link>
        )}
      </td>
    </tr>
  )
}
