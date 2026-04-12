"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { StatusBadge } from "@/components/shared/status-badge"

type SalesRow = {
  sale: {
    id: string
    date: string
    saleType: string
    salePrice: number
    profitLoss?: number
    status: string
  }
  vehicle: { make: string; model: string; year: number; costBasis: number } | undefined
  customer: { fullName: string } | undefined
}

const columns: ColumnDef<SalesRow>[] = [
  {
    accessorKey: "sale.date",
    header: "Date",
    cell: ({ row }) => <span>{row.original.sale.date}</span>,
  },
  {
    id: "vehicle",
    header: "Vehicle",
    cell: ({ row }) => {
      const v = row.original.vehicle
      return v ? (
        <span>{v.make} {v.model} {v.year}</span>
      ) : (
        <span className="text-muted-foreground">Unknown</span>
      )
    },
  },
  {
    id: "saleType",
    header: "Sale Type",
    cell: ({ row }) => <StatusBadge status={row.original.sale.saleType} />,
  },
  {
    id: "customer",
    header: "Customer",
    cell: ({ row }) => (
      <span>{row.original.customer?.fullName ?? "—"}</span>
    ),
  },
  {
    accessorKey: "sale.salePrice",
    header: "Sale Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.sale.salePrice} />,
  },
  {
    id: "costBasis",
    header: "Cost Basis",
    cell: ({ row }) => {
      const cost = row.original.vehicle?.costBasis ?? 0
      return <CurrencyDisplay amount={cost} />
    },
  },
  {
    id: "profitLoss",
    header: "Profit",
    cell: ({ row }) => {
      const pl = row.original.sale.profitLoss
      if (pl == null) return <span className="text-muted-foreground">—</span>
      return (
        <CurrencyDisplay
          amount={pl}
          className={pl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
        />
      )
    },
  },
  {
    id: "margin",
    header: "Margin %",
    cell: ({ row }) => {
      const pl = row.original.sale.profitLoss
      const sp = row.original.sale.salePrice
      if (pl == null || sp === 0) return <span className="text-muted-foreground">—</span>
      const pct = ((pl / sp) * 100).toFixed(1)
      const isPositive = pl >= 0
      return (
        <span className={isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
          {pct}%
        </span>
      )
    },
  },
]

export default function SalesReportPage() {
  return (
    <ReportTable<SalesRow>
      title="Sales Summary"
      columns={columns}
      endpoint="/api/reports/sales"
      queryKey="report-sales"
    />
  )
}
