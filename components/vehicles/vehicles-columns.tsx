"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import type { Vehicle } from "@/lib/mock-data/schemas"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export const vehicleColumns: ColumnDef<Vehicle>[] = [
  {
    id: "index",
    header: "#",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">
        {row.index + 1}
      </span>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
  {
    id: "makeModel",
    header: "Make / Model",
    accessorFn: (row) => `${row.make} ${row.model}`,
    cell: ({ row }) => (
      <Link
        href={`/vehicles/${row.original.id}`}
        className="font-normal text-sm hover:underline"
      >
        {row.original.make} {row.original.model}
      </Link>
    ),
    enableSorting: true,
  },
  {
    id: "year",
    accessorKey: "year",
    header: "Year",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{row.original.year}</span>
    ),
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
    id: "isAvailableForSale",
    accessorKey: "isAvailableForSale",
    header: "Availability",
    cell: ({ row }) => {
      const available = row.original.isAvailableForSale
      return (
        <span className="flex items-center gap-1.5 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full ${available ? "bg-green-500" : "bg-red-500"}`}
          />
          {available ? "Available" : "Unavailable"}
        </span>
      )
    },
    enableSorting: false,
    filterFn: "equals",
  },
  {
    id: "listedPrice",
    accessorKey: "listedPrice",
    header: "Listed Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.listedPrice} />,
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
    id: "purchaseType",
    accessorKey: "purchaseType",
    header: "Source",
    cell: ({ row }) => {
      const map: Record<string, string> = {
        Cash: "Cash",
        LeaseSettlement: "Lease Settlement",
        BrandNew: "Brand New",
      }
      return (
        <span className="text-sm">{map[row.original.purchaseType] ?? row.original.purchaseType}</span>
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
