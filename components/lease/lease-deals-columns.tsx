"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import Link from "next/link"
import { Eye } from "lucide-react"

import type { LeaseDeal } from "@/lib/mock-data/schemas"
import { customerFixtures } from "@/lib/mock-data/customers"
import { thirdPartiesFixtures } from "@/lib/mock-data/third-parties"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

const customerMap = new Map(customerFixtures.map((c) => [c.id, c]))
const thirdPartyMap = new Map(thirdPartiesFixtures.map((t) => [t.id, t]))

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

export const leaseDealsColumns: ColumnDef<LeaseDeal>[] = [
  {
    accessorKey: "createdAt",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">{formatDate(row.original.createdAt)}</span>
    ),
  },
  {
    id: "customer",
    header: "Customer",
    cell: ({ row }) => {
      const customer = customerMap.get(row.original.customerId)
      return (
        <span className="text-sm">
          {customer?.fullName ?? row.original.customerId}
        </span>
      )
    },
  },
  {
    accessorKey: "vehicleDescription",
    header: "Vehicle",
    cell: ({ row }) => (
      <span className="text-sm max-w-[200px] truncate block">
        {row.original.vehicleDescription}
      </span>
    ),
  },
  {
    id: "financeCompany",
    header: "Finance Company",
    cell: ({ row }) => {
      const company = thirdPartyMap.get(row.original.financeCompanyId)
      return (
        <span className="text-sm">
          {company?.name ?? row.original.financeCompanyId}
        </span>
      )
    },
  },
  {
    accessorKey: "dealType",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant={row.original.dealType === "ApplicationProcessing" ? "default" : "secondary"} className="text-xs font-normal">
        {row.original.dealType === "ApplicationProcessing" ? "Application" : "Referral"}
      </Badge>
    ),
  },
  {
    accessorKey: "loanAmount",
    header: "Loan Amount",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.loanAmount} />,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => (
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/lease-deals/${row.original.id}`}>
          <Eye className="h-4 w-4 mr-1" aria-hidden="true" />
          View
        </Link>
      </Button>
    ),
  },
]
