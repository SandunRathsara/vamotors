"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import type { Customer } from "@/lib/mock-data/schemas"
import { salesFixtures } from "@/lib/mock-data/sales"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Build a sales count + last purchase map per customer
const customerSalesMap = new Map<string, { count: number; lastDate?: string }>()
for (const sale of salesFixtures) {
  const existing = customerSalesMap.get(sale.customerId)
  if (!existing) {
    customerSalesMap.set(sale.customerId, { count: 1, lastDate: sale.date })
  } else {
    const count = existing.count + 1
    const lastDate =
      !existing.lastDate || sale.date > existing.lastDate ? sale.date : existing.lastDate
    customerSalesMap.set(sale.customerId, { count, lastDate })
  }
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

export const customersColumns: ColumnDef<Customer>[] = [
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
    id: "fullName",
    accessorKey: "fullName",
    header: "Name",
    cell: ({ row }) => (
      <Link
        href={`/customers/${row.original.id}`}
        className="text-sm font-normal hover:underline"
      >
        {row.original.fullName}
      </Link>
    ),
    enableSorting: true,
  },
  {
    id: "nicPassport",
    accessorKey: "nicPassport",
    header: "NIC / Passport",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.nicPassport}</span>
    ),
    enableSorting: false,
  },
  {
    id: "phone",
    accessorKey: "phone",
    header: "Phone",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.phone}</span>
    ),
    enableSorting: false,
  },
  {
    id: "email",
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.email ?? "—"}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "address",
    accessorKey: "address",
    header: "Address",
    cell: ({ row }) => {
      const addr = row.original.address
      const truncated = addr.length > 40 ? `${addr.slice(0, 40)}…` : addr
      return (
        <span className="text-sm text-muted-foreground" title={addr}>
          {truncated}
        </span>
      )
    },
    enableSorting: false,
  },
  {
    id: "vehicles",
    header: "Vehicles",
    cell: ({ row }) => {
      const info = customerSalesMap.get(row.original.id)
      return (
        <span className="text-sm tabular-nums">{info?.count ?? 0}</span>
      )
    },
    enableSorting: false,
  },
  {
    id: "lastPurchase",
    header: "Last Purchase",
    cell: ({ row }) => {
      const info = customerSalesMap.get(row.original.id)
      return (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(info?.lastDate)}
        </span>
      )
    },
    enableSorting: false,
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
            <Link href={`/customers/${row.original.id}`}>View</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
]
