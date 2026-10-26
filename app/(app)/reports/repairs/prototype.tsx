"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"
import { CurrencyDisplay } from "@/components/shared/currency-display"

type RepairRow = {
  repair: {
    id: string
    repairRequest: string
    dateSent: string
    dateReturned?: string
    invoiceAmount?: number
    status: string
  }
  vehicle: { make: string; model: string; year: number } | undefined
  vendor: { name: string } | undefined
}

const columns: ColumnDef<RepairRow>[] = [
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
    id: "garage",
    header: "Garage",
    cell: ({ row }) => (
      <span>{row.original.vendor?.name ?? "—"}</span>
    ),
  },
  {
    accessorKey: "repair.repairRequest",
    header: "Repair Request",
    cell: ({ row }) => (
      <span className="max-w-[240px] truncate block">{row.original.repair.repairRequest}</span>
    ),
  },
  {
    accessorKey: "repair.dateSent",
    header: "Date Sent",
    cell: ({ row }) => <span>{row.original.repair.dateSent}</span>,
  },
  {
    accessorKey: "repair.dateReturned",
    header: "Date Returned",
    cell: ({ row }) => (
      <span>{row.original.repair.dateReturned ?? "—"}</span>
    ),
  },
  {
    id: "daysTaken",
    header: "Days Taken",
    cell: ({ row }) => {
      const { dateSent, dateReturned } = row.original.repair
      if (!dateReturned) return <span className="text-muted-foreground">—</span>
      const days = Math.floor(
        (new Date(dateReturned).getTime() - new Date(dateSent).getTime()) / (1000 * 60 * 60 * 24)
      )
      return <span>{days}</span>
    },
  },
  {
    accessorKey: "repair.invoiceAmount",
    header: "Cost",
    cell: ({ row }) => {
      const amt = row.original.repair.invoiceAmount
      return amt != null ? <CurrencyDisplay amount={amt} /> : <span className="text-muted-foreground">—</span>
    },
  },
]

export default function RepairsReportPage() {
  return (
    <ReportTable<RepairRow>
      title="Repair Costs"
      columns={columns}
      endpoint="/api/reports/repairs"
      queryKey="report-repairs"
    />
  )
}
