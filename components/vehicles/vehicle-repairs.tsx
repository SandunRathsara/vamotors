"use client"

import { format } from "date-fns"

import type { Vehicle } from "@/lib/mock-data/schemas"
import { repairsFixtures } from "@/lib/mock-data/repairs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"

interface VehicleRepairsProps {
  vehicle: Vehicle
}

export function VehicleRepairs({ vehicle }: VehicleRepairsProps) {
  const repairs = repairsFixtures.filter((r) => r.vehicleId === vehicle.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Repair History</CardTitle>
      </CardHeader>
      <CardContent>
        {repairs.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-normal">Date Sent</TableHead>
                <TableHead className="text-xs font-normal">Vendor</TableHead>
                <TableHead className="text-xs font-normal">Repair Request</TableHead>
                <TableHead className="text-xs font-normal">Date Returned</TableHead>
                <TableHead className="text-xs font-normal text-right">Cost</TableHead>
                <TableHead className="text-xs font-normal">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {repairs.map((repair) => (
                <TableRow key={repair.id}>
                  <TableCell className="text-sm">
                    {format(new Date(repair.dateSent), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-sm">{repair.vendorId}</TableCell>
                  <TableCell className="text-sm">{repair.repairRequest}</TableCell>
                  <TableCell className="text-sm">
                    {repair.dateReturned
                      ? format(new Date(repair.dateReturned), "dd MMM yyyy")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-right">
                    {repair.invoiceAmount != null ? (
                      <CurrencyDisplay amount={repair.invoiceAmount} />
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={repair.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No repairs recorded for this vehicle.</p>
        )}
      </CardContent>
    </Card>
  )
}
