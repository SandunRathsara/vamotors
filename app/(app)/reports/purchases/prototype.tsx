"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { StatusBadge } from "@/components/shared/status-badge"

type PurchaseRow = {
  id: string
  date: string
  make: string
  model: string
  year: number
  purchaseType: string
  supplierName: string
  purchasePrice: number
  additionalCostsTotal: number
  totalCost: number
}

const columns: ColumnDef<PurchaseRow>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span>{row.original.date}</span>,
  },
  {
    id: "vehicle",
    header: "Vehicle",
    cell: ({ row }) => (
      <span>{row.original.make} {row.original.model} {row.original.year}</span>
    ),
  },
  {
    accessorKey: "purchaseType",
    header: "Purchase Type",
    cell: ({ row }) => <StatusBadge status={row.original.purchaseType} />,
  },
  {
    accessorKey: "supplierName",
    header: "Supplier",
    cell: ({ row }) => <span>{row.original.supplierName}</span>,
  },
  {
    accessorKey: "purchasePrice",
    header: "Purchase Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.purchasePrice} />,
  },
  {
    accessorKey: "additionalCostsTotal",
    header: "Additional Costs",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.additionalCostsTotal} />,
  },
  {
    accessorKey: "totalCost",
    header: "Total Cost",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.totalCost} className="font-semibold" />,
  },
]

export default function PurchasesReportPage() {
  return (
    <ReportTable<PurchaseRow>
      title="Purchase Summary"
      columns={columns}
      endpoint="/api/reports/purchases"
      queryKey="report-purchases"
    />
  )
}
