"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import type { Repair } from "@/lib/mock-data/schemas"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { thirdPartiesFixtures } from "@/lib/mock-data/third-parties"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Build lookup maps from fixtures
const vehicleMap = new Map(vehicleFixtures.map((v) => [v.id, v]))
const vendorMap = new Map(thirdPartiesFixtures.map((t) => [t.id, t]))

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

export const repairsColumns: ColumnDef<Repair>[] = [
  {
    id: "index",
    header: "#",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">{row.index + 1}</span>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
  {
    id: "vehicle",
    header: "Vehicle",
    accessorFn: (row) => {
      const v = vehicleMap.get(row.vehicleId)
      return v ? `${v.make} ${v.model}` : row.vehicleId
    },
    cell: ({ row }) => {
      const v = vehicleMap.get(row.original.vehicleId)
      const label = v ? `${v.make} ${v.model} ${v.year}` : row.original.vehicleId
      return (
        <Link
          href={`/vehicles/${row.original.vehicleId}`}
          className="text-sm hover:underline"
        >
          {label}
        </Link>
      )
    },
    enableSorting: true,
  },
  {
    id: "vendor",
    header: "Vendor",
    accessorFn: (row) => {
      const v = vendorMap.get(row.vendorId)
      return v ? v.name : row.vendorId
    },
    cell: ({ row }) => {
      const v = vendorMap.get(row.original.vendorId)
      return <span className="text-sm">{v ? v.name : row.original.vendorId}</span>
    },
    enableSorting: true,
  },
  {
    id: "repairRequest",
    accessorKey: "repairRequest",
    header: "Repair Request",
    cell: ({ row }) => {
      const text = row.original.repairRequest
      const truncated = text.length > 60 ? `${text.slice(0, 60)}…` : text
      return <span className="text-sm text-muted-foreground" title={text}>{truncated}</span>
    },
    enableSorting: false,
  },
  {
    id: "dateSent",
    accessorKey: "dateSent",
    header: "Date Sent",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{formatDate(row.original.dateSent)}</span>
    ),
    enableSorting: true,
  },
  {
    id: "dateReturned",
    accessorKey: "dateReturned",
    header: "Date Returned",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{formatDate(row.original.dateReturned)}</span>
    ),
    enableSorting: true,
  },
  {
    id: "invoiceAmount",
    accessorKey: "invoiceAmount",
    header: "Cost",
    cell: ({ row }) => {
      const amount = row.original.invoiceAmount
      if (amount == null) return <span className="text-sm text-muted-foreground">—</span>
      return <CurrencyDisplay amount={amount} />
    },
    enableSorting: true,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    enableSorting: false,
    filterFn: "equals",
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/vehicles/${row.original.vehicleId}`}>View Vehicle</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
]
