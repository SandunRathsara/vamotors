"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { ReportTable } from "@/components/reports/report-table"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { StatusBadge } from "@/components/shared/status-badge"

type StockRow = {
  vehicle: {
    id: string
    make: string
    model: string
    year: number
    status: string
    listedPrice: number
    purchaseDate: string
    isAvailableForSale: boolean
  }
  daysSincePurchase: number
  repairCount: number
  totalRepairCost: number
}

const columns: ColumnDef<StockRow>[] = [
  {
    id: "vehicle",
    header: "Vehicle",
    cell: ({ row }) => (
      <span className="font-normal">
        {row.original.vehicle.make} {row.original.vehicle.model} {row.original.vehicle.year}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.vehicle.status} />,
  },
  {
    accessorKey: "vehicle.listedPrice",
    header: "Listed Price",
    cell: ({ row }) => <CurrencyDisplay amount={row.original.vehicle.listedPrice} />,
  },
  {
    accessorKey: "daysSincePurchase",
    header: "Days in Stock",
    cell: ({ row }) => <span>{row.original.daysSincePurchase}</span>,
  },
  {
    id: "availability",
    header: "Availability",
    cell: ({ row }) => (
      <span className={row.original.vehicle.isAvailableForSale ? "text-primary" : "text-muted-foreground"}>
        {row.original.vehicle.isAvailableForSale ? "Available" : "Unavailable"}
      </span>
    ),
  },
  {
    accessorKey: "vehicle.purchaseDate",
    header: "Purchase Date",
    cell: ({ row }) => <span>{row.original.vehicle.purchaseDate}</span>,
  },
]

export default function StockReportPage() {
  return (
    <ReportTable<StockRow>
      title="Stock Summary"
      columns={columns}
      endpoint="/api/reports/stock"
      queryKey="report-stock"
      dateRangeFilter={false}
    />
  )
}
