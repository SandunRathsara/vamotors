"use client"

import { format } from "date-fns"

import type { Vehicle } from "@/lib/mock-data/schemas"
import { repairsFixtures } from "@/lib/mock-data/repairs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Separator } from "@/components/ui/separator"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { cn } from "@/lib/utils"

interface VehicleFinancialsProps {
  vehicle: Vehicle
}

export function VehicleFinancials({ vehicle }: VehicleFinancialsProps) {
  const repairs = repairsFixtures.filter(
    (r) => r.vehicleId === vehicle.id && r.status === "Completed",
  )
  const repairCosts = repairs.reduce((sum, r) => sum + (r.invoiceAmount ?? 0), 0)
  const additionalCostTotal = vehicle.additionalCosts.reduce((sum, c) => sum + c.amount, 0)
  const totalCostBasis = vehicle.purchasePrice + repairCosts + additionalCostTotal
  const potentialProfitLoss = vehicle.listedPrice - totalCostBasis
  const isProfitable = potentialProfitLoss >= 0

  return (
    <div className="space-y-6">
      {/* Cost Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-semibold">Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Purchase Price</span>
            <CurrencyDisplay amount={vehicle.purchasePrice} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Repair Costs</span>
            <CurrencyDisplay amount={repairCosts} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Additional Costs</span>
            <CurrencyDisplay amount={additionalCostTotal} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Total Cost Basis</span>
            <CurrencyDisplay amount={totalCostBasis} className="text-lg font-semibold" />
          </div>

          <Separator />

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Listed Price</span>
            <CurrencyDisplay amount={vehicle.listedPrice} />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Potential {isProfitable ? "Profit" : "Loss"}</span>
            <CurrencyDisplay
              amount={Math.abs(potentialProfitLoss)}
              className={cn(isProfitable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Additional Costs Table */}
      {vehicle.additionalCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">Additional Costs</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs font-normal">Date</TableHead>
                  <TableHead className="text-xs font-normal">Description</TableHead>
                  <TableHead className="text-xs font-normal text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vehicle.additionalCosts.map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell className="text-sm">
                      {format(new Date(cost.date), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-sm">{cost.description}</TableCell>
                    <TableCell className="text-sm text-right">
                      <CurrencyDisplay amount={cost.amount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
