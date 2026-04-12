"use client"

import Link from "next/link"
import { format } from "date-fns"
import { Download } from "lucide-react"

import type { Sale } from "@/lib/mock-data/schemas"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { customerFixtures } from "@/lib/mock-data/customers"
import { thirdPartiesFixtures } from "@/lib/mock-data/third-parties"
import { useEntityDetail } from "@/hooks/use-entity-query"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { SaleTimeline } from "./sale-timeline"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

// Build lookup maps
const vehicleMap = new Map(vehicleFixtures.map((v) => [v.id, v]))
const customerMap = new Map(customerFixtures.map((c) => [c.id, c]))
const thirdPartyMap = new Map(thirdPartiesFixtures.map((t) => [t.id, t]))

const SALE_TYPE_LABELS: Record<string, string> = {
  Cash: "Cash",
  Advance: "Advance",
  LeaseFinance: "Lease / Finance",
  TradeIn: "Trade-In",
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
      <span className="text-sm font-normal">{value ?? "—"}</span>
    </div>
  )
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

interface SaleDetailViewProps {
  id: string
}

export function SaleDetailView({ id }: SaleDetailViewProps) {
  const { data: sale, isLoading, isError } = useEntityDetail<Sale>("sales", "/api/sales", id)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <div className="space-y-3 rounded-lg border p-4">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
    )
  }

  if (isError || !sale) {
    return (
      <div className="space-y-3 rounded-lg border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Could not load this record. It may have been removed or the request failed.
        </p>
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          Go back
        </Button>
      </div>
    )
  }

  const vehicle = vehicleMap.get(sale.vehicleId)
  const customer = customerMap.get(sale.customerId)
  const financeCompany = sale.financeCompanyId ? thirdPartyMap.get(sale.financeCompanyId) : undefined
  const tradeInVehicle = sale.tradeInVehicleId ? vehicleMap.get(sale.tradeInVehicleId) : undefined

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/sales">Sales</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Sale #{id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Main content */}
        <div className="space-y-6">
          {/* Payment Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Payment Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {sale.saleType === "Cash" && (
                <div className="grid grid-cols-2 gap-4">
                  <InfoRow label="Sale Price" value={<CurrencyDisplay amount={sale.salePrice} />} />
                  <InfoRow label="Payment Method" value={sale.paymentMethod === "BankTransfer" ? "Bank Transfer" : "Cash"} />
                </div>
              )}

              {sale.saleType === "Advance" && (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <InfoRow label="Agreed Sale Price" value={<CurrencyDisplay amount={sale.salePrice} />} />
                    <InfoRow
                      label="Advance Amount"
                      value={sale.advanceAmount != null ? <CurrencyDisplay amount={sale.advanceAmount} /> : "—"}
                    />
                    <InfoRow
                      label="Advance %"
                      value={sale.advancePercentage != null ? `${sale.advancePercentage}%` : "—"}
                    />
                    <InfoRow label="Expiry Date" value={formatDate(sale.advanceExpiryDate)} />
                    <InfoRow label="Payment Method" value={sale.paymentMethod === "BankTransfer" ? "Bank Transfer" : "Cash"} />
                  </div>
                  <Separator />
                  <div className="rounded-md bg-muted/50 p-4 space-y-1">
                    <p className="text-xs font-normal text-muted-foreground uppercase tracking-wide">Next Steps</p>
                    <p className="text-sm">
                      {sale.status === "AdvancePlaced"
                        ? "Await customer to complete the balance payment before the expiry date."
                        : sale.status === "AdvanceExpired"
                          ? "Advance period has expired. Contact the customer or re-list the vehicle."
                          : "Advance closed."}
                    </p>
                  </div>
                </>
              )}

              {sale.saleType === "LeaseFinance" && (
                <>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    <InfoRow label="Sale Price" value={<CurrencyDisplay amount={sale.salePrice} />} />
                    <InfoRow
                      label="Down Payment"
                      value={sale.downPayment != null ? <CurrencyDisplay amount={sale.downPayment} /> : "—"}
                    />
                    <InfoRow
                      label="Finance Amount"
                      value={sale.financeAmount != null ? <CurrencyDisplay amount={sale.financeAmount} /> : "—"}
                    />
                    <InfoRow label="Finance Company" value={financeCompany?.name ?? sale.financeCompanyId ?? "—"} />
                    <InfoRow label="Ref. Number" value={sale.thirdPartyRefNumber ?? "—"} />
                    <InfoRow
                      label="DO Status"
                      value={sale.doDocumentUrl ? "Received" : "Pending"}
                    />
                  </div>
                  {sale.doDocumentUrl && (
                    <InfoRow
                      label="DO Document"
                      value={
                        <a
                          href={sale.doDocumentUrl}
                          className="text-sm text-primary hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          View Document
                        </a>
                      }
                    />
                  )}
                  <Separator />
                  <Button variant="outline" size="sm" disabled className="gap-2">
                    <Download className="h-4 w-4" />
                    Download Invoice
                  </Button>
                  <p className="text-xs text-muted-foreground">Invoice generation available in a future release.</p>
                </>
              )}

              {sale.saleType === "TradeIn" && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <InfoRow label="Sale Price" value={<CurrencyDisplay amount={sale.salePrice} />} />
                  <InfoRow
                    label="Trade-In Value"
                    value={sale.tradeInValue != null ? <CurrencyDisplay amount={sale.tradeInValue} /> : "—"}
                  />
                  <InfoRow
                    label="Cash Balance"
                    value={
                      sale.tradeInValue != null
                        ? <CurrencyDisplay amount={sale.salePrice - sale.tradeInValue} />
                        : "—"
                    }
                  />
                  {tradeInVehicle && (
                    <InfoRow
                      label="Traded Vehicle"
                      value={
                        <Link href={`/vehicles/${tradeInVehicle.id}`} className="text-primary hover:underline">
                          {tradeInVehicle.make} {tradeInVehicle.model} {tradeInVehicle.year}
                        </Link>
                      }
                    />
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sale Timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Sale Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <SaleTimeline timeline={sale.timeline ?? []} />
            </CardContent>
          </Card>
        </div>

        {/* Right sidebar: Quick Stats + Customer + Vehicle */}
        <div className="space-y-4">
          {/* Quick Stats */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-semibold">Quick Stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <span className="text-xs font-normal text-muted-foreground">Sale Type</span>
                <div>
                  <Badge variant="outline" className="text-xs font-normal">
                    {SALE_TYPE_LABELS[sale.saleType] ?? sale.saleType}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-normal text-muted-foreground">Sale Price</span>
                <p className="text-sm font-normal">
                  <CurrencyDisplay amount={sale.salePrice} />
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-normal text-muted-foreground">Status</span>
                <div>
                  <StatusBadge status={sale.status} />
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-normal text-muted-foreground">Sale Date</span>
                <p className="text-sm font-normal">{formatDate(sale.date)}</p>
              </div>
              {sale.profitLoss != null && (
                <div className="space-y-1">
                  <span className="text-xs font-normal text-muted-foreground">Profit / Loss</span>
                  <p className={`text-sm font-normal ${sale.profitLoss >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                    <CurrencyDisplay amount={sale.profitLoss} />
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customer Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-semibold">Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {customer ? (
                <>
                  <div className="space-y-0.5">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="text-sm font-normal text-primary hover:underline"
                    >
                      {customer.fullName}
                    </Link>
                  </div>
                  <InfoRow label="Phone" value={customer.phone} />
                  <InfoRow label="NIC / Passport" value={customer.nicPassport} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Customer not found.</p>
              )}
            </CardContent>
          </Card>

          {/* Vehicle Info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xl font-semibold">Vehicle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {vehicle ? (
                <>
                  <div className="space-y-0.5">
                    <Link
                      href={`/vehicles/${vehicle.id}`}
                      className="text-sm font-normal text-primary hover:underline"
                    >
                      {vehicle.make} {vehicle.model} {vehicle.year}
                    </Link>
                  </div>
                  <InfoRow label="Colour" value={vehicle.colour} />
                  <InfoRow label="Transmission" value={vehicle.transmission} />
                  <InfoRow label="Mileage at Sale" value={sale.mileageAtSale ? `${sale.mileageAtSale.toLocaleString()} km` : "—"} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Vehicle not found.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
