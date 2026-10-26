"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"

type AuditRow = {
  id: string
  timestamp: string
  user: string
  action: string
  entity: string
  detail: string
}

const columns: ColumnDef<AuditRow>[] = [
  {
    accessorKey: "timestamp",
    header: "Timestamp",
    cell: ({ row }) => {
      const ts = new Date(row.original.timestamp)
      return (
        <span className="text-xs text-muted-foreground">
          {ts.toLocaleDateString("en-LK")} {ts.toLocaleTimeString("en-LK", { hour: "2-digit", minute: "2-digit" })}
        </span>
      )
    },
  },
  {
    accessorKey: "user",
    header: "User",
    cell: ({ row }) => <span>{row.original.user}</span>,
  },
  {
    accessorKey: "action",
    header: "Action",
    cell: ({ row }) => <span className="font-normal">{row.original.action}</span>,
  },
  {
    accessorKey: "entity",
    header: "Entity",
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.entity}</span>,
  },
  {
    accessorKey: "detail",
    header: "Changes",
    cell: ({ row }) => (
      <span className="max-w-[300px] truncate block text-xs">{row.original.detail}</span>
    ),
  },
]

export default function AuditReportPage() {
  return (
    <ReportTable<AuditRow>
      title="Audit Trail"
      columns={columns}
      endpoint="/api/reports/audit"
      queryKey="report-audit"
    />
  )
}
