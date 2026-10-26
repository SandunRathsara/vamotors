"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { StatusBadge } from "@/components/shared/status-badge"

type AdvanceRow = {
  id: string
  vehicleName: string
  customerName: string
  advanceAmount: number
  advancePercentage: number | undefined
  placedDate: string
  expiryDate: string | undefined
  status: string
  resolution: string
}

const columns: ColumnDef<AdvanceRow>[] = [
  {
    accessorKey: "vehicleName",
    header: "Vehicle",
    cell: ({ row }) => <span>{row.original.vehicleName}</span>,
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) => <span>{row.original.customerName}</span>,
  },
  {
    accessorKey: "advanceAmount",
    header: "Advance Amount",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.advanceAmount} />,
  },
  {
    accessorKey: "advancePercentage",
    header: "Advance %",
    cell: ({ row }) => {
      const pct = row.original.advancePercentage
      return pct != null ? <span>{pct}%</span> : <span className="text-muted-foreground">—</span>
    },
  },
  {
    accessorKey: "placedDate",
    header: "Placed Date",
    cell: ({ row }) => <span>{row.original.placedDate}</span>,
  },
  {
    accessorKey: "expiryDate",
    header: "Expiry Date",
    cell: ({ row }) => (
      <span>{row.original.expiryDate ?? "—"}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "resolution",
    header: "Resolution",
    cell: ({ row }) => <span>{row.original.resolution}</span>,
  },
]

export default function AdvancesReportPage() {
  return (
    <ReportTable<AdvanceRow>
      title="Advances"
      columns={columns}
      endpoint="/api/reports/advances"
      queryKey="report-advances"
    />
  )
}
