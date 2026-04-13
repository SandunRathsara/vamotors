"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import type { Vehicle } from "@/lib/mock-data/schemas"
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

const PURCHASE_TYPE_LABELS: Record<string, string> = {
  Cash: "Cash",
  LeaseSettlement: "Lease Settlement",
  BrandNew: "Brand-New",
}

const PURCHASE_TYPE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  Cash: "default",
  LeaseSettlement: "secondary",
  BrandNew: "outline",
}

export const purchasesColumns: ColumnDef<Vehicle>[] = [
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
    id: "purchaseDate",
    accessorKey: "purchaseDate",
    header: "Purchase Date",
    cell: ({ row }) => {
      try {
        return (
          <span className="text-sm tabular-nums">
            {format(new Date(row.original.purchaseDate), "dd MMM yyyy")}
          </span>
        )
      } catch {
        return <span className="text-sm">{row.original.purchaseDate}</span>
      }
    },
    enableSorting: true,
  },
  {
    id: "vehicle",
    header: "Vehicle",
    accessorFn: (row) => `${row.make} ${row.model}`,
    cell: ({ row }) => {
      const v = row.original
      return (
        <Link
          href={`/vehicles/${v.id}`}
          className="text-sm hover:underline"
        >
          {v.make} {v.model} {v.year}
        </Link>
      )
    },
    enableSorting: true,
  },
  {
    id: "purchaseType",
    accessorKey: "purchaseType",
    header: "Purchase Type",
    cell: ({ row }) => {
      const type = row.original.purchaseType
      return (
        <Badge variant={PURCHASE_TYPE_VARIANTS[type] ?? "secondary"} className="text-xs font-normal">
          {PURCHASE_TYPE_LABELS[type] ?? type}
        </Badge>
      )
    },
    enableSorting: false,
  },
  {
    id: "purchasePrice",
    accessorKey: "purchasePrice",
    header: "Purchase Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.purchasePrice} />,
    enableSorting: true,
  },
  {
    id: "costBasis",
    accessorKey: "costBasis",
    header: "Cost Basis",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.costBasis} />,
    enableSorting: true,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
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
            <Link href={`/vehicles/${row.original.id}`}>View</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
]
