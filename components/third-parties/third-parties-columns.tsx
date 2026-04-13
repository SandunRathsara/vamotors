"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { MoreHorizontal } from "lucide-react"

import type { ThirdParty } from "@/lib/mock-data/schemas"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const TYPE_LABELS: Record<string, string> = {
  Supplier: "Supplier",
  RepairVendor: "Repair Vendor",
  FinanceCompany: "Finance Company",
}

const TYPE_VARIANTS: Record<string, "default" | "secondary" | "outline"> = {
  Supplier: "default",
  RepairVendor: "secondary",
  FinanceCompany: "outline",
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

interface ArchiveRowActionProps {
  thirdParty: ThirdParty
  onArchive: (tp: ThirdParty) => void
}

function ArchiveRowAction({ thirdParty, onArchive }: ArchiveRowActionProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link href={`/third-parties/${thirdParty.id}`}>View</Link>
        </DropdownMenuItem>
        {thirdParty.isActive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onArchive(thirdParty)}
            >
              Archive
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Factory that accepts an onArchive callback so the table can open the dialog
export function createThirdPartiesColumns(
  onArchive: (tp: ThirdParty) => void,
): ColumnDef<ThirdParty>[] {
  return [
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
      id: "name",
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <Link
          href={`/third-parties/${row.original.id}`}
          className="text-sm font-normal hover:underline"
        >
          {row.original.name}
        </Link>
      ),
      enableSorting: true,
      meta: { label: "Name" },
    },
    {
      id: "type",
      accessorKey: "type",
      header: "Type",
      cell: ({ row }) => {
        const type = row.original.type
        return (
          <Badge variant={TYPE_VARIANTS[type] ?? "secondary"} className="text-xs">
            {TYPE_LABELS[type] ?? type}
          </Badge>
        )
      },
      enableSorting: false,
      filterFn: "equals",
    },
    {
      id: "category",
      accessorKey: "category",
      header: "Category",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.category ?? "—"}
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "totalVolume",
      accessorKey: "totalVolume",
      header: "Total Volume",
      cell: ({ row }) => {
        const vol = row.original.totalVolume
        if (vol == null) return <span className="text-sm text-muted-foreground">—</span>
        return <CurrencyDisplay amount={vol} />
      },
      enableSorting: true,
      meta: { label: "Total Volume" },
    },
    {
      id: "contactPersons",
      header: "Contacts",
      cell: ({ row }) => {
        const contacts = row.original.contactPersons
        if (!contacts || contacts.length === 0) {
          return <span className="text-sm text-muted-foreground">—</span>
        }
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-sm tabular-nums cursor-default underline decoration-dashed underline-offset-2">
                  {contacts.length}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <ul className="space-y-1 text-xs">
                  {contacts.map((c, i) => (
                    <li key={i}>
                      <span className="font-medium">{c.name}</span>
                      {c.role && <span className="text-muted-foreground"> ({c.role})</span>}
                      {" — "}{c.phone}
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      },
      enableSorting: false,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => (
        <Badge
          variant={row.original.isActive ? "default" : "outline"}
          className="text-xs"
        >
          {row.original.isActive ? "Active" : "Archived"}
        </Badge>
      ),
      enableSorting: false,
    },
    {
      id: "lastActivity",
      header: "Last Activity",
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatDate(row.original.updatedAt)}
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <ArchiveRowAction thirdParty={row.original} onArchive={onArchive} />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 48,
    },
  ]
}
