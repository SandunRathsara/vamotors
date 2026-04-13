"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import type { Sale } from "@/lib/mock-data/schemas"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { customerFixtures } from "@/lib/mock-data/customers"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// Build lookup maps from fixtures
const vehicleMap = new Map(vehicleFixtures.map((v) => [v.id, v]))
const customerMap = new Map(customerFixtures.map((c) => [c.id, c]))

const SALE_TYPE_LABELS: Record<string, string> = {
  Cash: "Cash",
  Advance: "Advance",
  LeaseFinance: "Lease / Finance",
  TradeIn: "Trade-In",
}

const SALE_TYPE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  Cash: "default",
  Advance: "outline",
  LeaseFinance: "secondary",
  TradeIn: "secondary",
}

export const salesColumns: ColumnDef<Sale>[] = [
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
    id: "date",
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => {
      try {
        return (
          <span className="text-sm tabular-nums">
            {format(new Date(row.original.date), "dd MMM yyyy")}
          </span>
        )
      } catch {
        return <span className="text-sm">{row.original.date}</span>
      }
    },
    enableSorting: true,
    meta: { label: "Date" },
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
    meta: { label: "Vehicle" },
  },
  {
    id: "saleType",
    accessorKey: "saleType",
    header: "Sale Type",
    cell: ({ row }) => {
      const type = row.original.saleType
      return (
        <Badge variant={SALE_TYPE_VARIANTS[type] ?? "secondary"} className="text-xs font-normal">
          {SALE_TYPE_LABELS[type] ?? type}
        </Badge>
      )
    },
    enableSorting: false,
    filterFn: "equals",
  },
  {
    id: "customer",
    header: "Customer",
    accessorFn: (row) => {
      const c = customerMap.get(row.customerId)
      return c ? c.fullName : row.customerId
    },
    cell: ({ row }) => {
      const c = customerMap.get(row.original.customerId)
      const label = c ? c.callingName || c.fullName : row.original.customerId
      return (
        <Link
          href={`/customers/${row.original.customerId}`}
          className="text-sm hover:underline"
        >
          {label}
        </Link>
      )
    },
    enableSorting: true,
    meta: { label: "Customer" },
  },
  {
    id: "salePrice",
    accessorKey: "salePrice",
    header: "Sale Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.salePrice} />,
    enableSorting: true,
    meta: { label: "Sale Price" },
  },
  {
    id: "profitLoss",
    accessorKey: "profitLoss",
    header: "Profit / Loss",
    cell: ({ row }) => {
      const pl = row.original.profitLoss
      if (pl === undefined || pl === null) {
        return <span className="text-sm text-muted-foreground">—</span>
      }
      return (
        <span className={cn("text-sm font-normal tabular-nums", pl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
          <CurrencyDisplay amount={pl} />
        </span>
      )
    },
    enableSorting: true,
    meta: { label: "Profit / Loss" },
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
            <Link href={`/sales/${row.original.id}`}>View</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
]
