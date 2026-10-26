"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"
import { CurrencyDisplay } from "@/components/shared/currency-display"

type ProfitRow = {
  id: string
  vehicleName: string
  purchasePrice: number
  additionalCosts: number
  repairCosts: number
  totalCost: number
  salePrice: number
  profitLoss: number
  margin: number
}

const columns: ColumnDef<ProfitRow>[] = [
  {
    accessorKey: "vehicleName",
    header: "Vehicle",
    cell: ({ row }) => <span className="font-normal">{row.original.vehicleName}</span>,
  },
  {
    accessorKey: "purchasePrice",
    header: "Purchase Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.purchasePrice} />,
  },
  {
    accessorKey: "additionalCosts",
    header: "Additional Costs",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.additionalCosts} />,
  },
  {
    accessorKey: "repairCosts",
    header: "Repair Costs",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.repairCosts} />,
  },
  {
    accessorKey: "totalCost",
    header: "Total Cost",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.totalCost} />,
  },
  {
    accessorKey: "salePrice",
    header: "Sale Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.salePrice} />,
  },
  {
    accessorKey: "profitLoss",
    header: "Profit / Loss",
    cell: ({ row }) => {
      const pl = row.original.profitLoss
      return (
        <CurrencyDisplay
          amount={pl}
          className={pl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
        />
      )
    },
  },
  {
    accessorKey: "margin",
    header: "Margin %",
    cell: ({ row }) => {
      const m = row.original.margin
      return (
        <span className={m >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
          {m.toFixed(1)}%
        </span>
      )
    },
  },
]

export default function ProfitReportPage() {
  return (
    <ReportTable<ProfitRow>
      title="Profit Analysis"
      columns={columns}
      endpoint="/api/reports/profit"
      queryKey="report-profit"
    />
  )
}
