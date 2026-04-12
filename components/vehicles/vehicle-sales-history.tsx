"use client"

import { format } from "date-fns"

import type { Vehicle } from "@/lib/mock-data/schemas"
import { salesFixtures } from "@/lib/mock-data/sales"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"

interface VehicleSalesHistoryProps {
  vehicle: Vehicle
}

export function VehicleSalesHistory({ vehicle }: VehicleSalesHistoryProps) {
  const sales = salesFixtures.filter((s) => s.vehicleId === vehicle.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Sales History</CardTitle>
      </CardHeader>
      <CardContent>
        {sales.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-normal">Date</TableHead>
                <TableHead className="text-xs font-normal">Customer</TableHead>
                <TableHead className="text-xs font-normal">Sale Type</TableHead>
                <TableHead className="text-xs font-normal text-right">Sale Price</TableHead>
                <TableHead className="text-xs font-normal">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((sale) => (
                <TableRow key={sale.id}>
                  <TableCell className="text-sm">
                    {format(new Date(sale.date), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-sm">{sale.customerId}</TableCell>
                  <TableCell className="text-sm">{sale.saleType}</TableCell>
                  <TableCell className="text-sm text-right">
                    <CurrencyDisplay amount={sale.salePrice} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={sale.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No sales recorded for this vehicle.</p>
        )}
      </CardContent>
    </Card>
  )
}
