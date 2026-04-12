"use client"

import Link from "next/link"
import { format } from "date-fns"

import type { Customer, Sale } from "@/lib/mock-data/schemas"
import { useEntityDetail } from "@/hooks/use-entity-query"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// Extended type — the GET [id] route joins sales
type CustomerWithSales = Customer & {
  sales: (Sale & {
    vehicleMake?: string
    vehicleModel?: string
    vehicleYear?: number
  })[]
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

const SALE_TYPE_LABELS: Record<string, string> = {
  Cash: "Cash",
  Advance: "Advance",
  LeaseFinance: "Lease / Finance",
  TradeIn: "Trade-In",
}

interface CustomerDetailViewProps {
  id: string
}

export function CustomerDetailView({ id }: CustomerDetailViewProps) {
  const { data: customer, isLoading, isError } = useEntityDetail<CustomerWithSales>(
    "customers",
    "/api/customers",
    id,
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-40" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !customer) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">
          Could not load this record. It may have been removed or the request failed.
        </p>
        <button
          type="button"
          onClick={() => history.back()}
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Go back
        </button>
      </div>
    )
  }

  const sales = customer.sales ?? []

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/customers" className="text-xs">Customers</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="text-xs">{customer.fullName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Customer Info Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-semibold">{customer.fullName}</CardTitle>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <InfoRow label="Full Name" value={customer.fullName} />
            <InfoRow label="Calling Name" value={customer.callingName} />
            <InfoRow label="NIC / Passport" value={customer.nicPassport} />
            <InfoRow label="Phone" value={customer.phone} />
            <InfoRow label="Email" value={customer.email} />
            <InfoRow label="Driving Licence" value={customer.drivingLicence} />
            <InfoRow
              label="Address"
              value={<span className="whitespace-pre-wrap">{customer.address}</span>}
            />
            <InfoRow label="Customer Since" value={formatDate(customer.createdAt)} />
          </div>
        </CardContent>
      </Card>

      {/* Purchase / Sale History */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-semibold">Purchase History</CardTitle>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No purchases recorded for this customer.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Vehicle</TableHead>
                  <TableHead className="text-xs">Sale Type</TableHead>
                  <TableHead className="text-xs">Sale Date</TableHead>
                  <TableHead className="text-xs text-right">Sale Price</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((sale) => {
                  const vehicleLabel = sale.vehicleMake
                    ? `${sale.vehicleMake} ${sale.vehicleModel} ${sale.vehicleYear ?? ""}`
                    : sale.vehicleId
                  return (
                    <TableRow key={sale.id}>
                      <TableCell className="text-sm">
                        <Link
                          href={`/sales/${sale.id}`}
                          className="hover:underline"
                        >
                          {vehicleLabel}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {SALE_TYPE_LABELS[sale.saleType] ?? sale.saleType}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">
                        {formatDate(sale.date)}
                      </TableCell>
                      <TableCell className="text-right">
                        <CurrencyDisplay amount={sale.salePrice} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={sale.status} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
