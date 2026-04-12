"use client"

import * as React from "react"
import Link from "next/link"
import { format } from "date-fns"

import type { ThirdParty } from "@/lib/mock-data/schemas"
import { useEntityDetail } from "@/hooks/use-entity-query"
import { useEntityMutation } from "@/hooks/use-entity-mutation"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
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

// ── Extended type from GET [id] route ─────────────────────────────────────────

type SupplierHistory = {
  vehicleId: string
  make: string
  model: string
  year: number
  purchaseType: string
  purchaseDate: string
  purchasePrice: number
  status: string
}

type RepairVendorHistory = {
  repairId: string
  vehicleId: string
  vehicleMake?: string
  vehicleModel?: string
  vehicleYear?: number
  repairRequest: string
  dateSent: string
  dateReturned?: string
  invoiceAmount?: number
  status: string
}

type FinanceCompanyHistory = {
  saleId: string
  vehicleId: string
  vehicleMake?: string
  vehicleModel?: string
  vehicleYear?: number
  customerId: string
  customerName?: string
  date: string
  financeAmount?: number
  salePrice: number
  status: string
}

type ThirdPartyWithHistory = ThirdParty & {
  historyData: SupplierHistory[] | RepairVendorHistory[] | FinanceCompanyHistory[]
}

// ── Helper components ─────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  Supplier: "Supplier",
  RepairVendor: "Repair Vendor",
  FinanceCompany: "Finance Company",
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

// ── Supplier variant ──────────────────────────────────────────────────────────

function SupplierDetail({ tp }: { tp: ThirdPartyWithHistory }) {
  const history = tp.historyData as SupplierHistory[]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-semibold">Purchase History</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No purchases recorded from this supplier.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Vehicle</TableHead>
                <TableHead className="text-xs">Purchase Type</TableHead>
                <TableHead className="text-xs">Purchase Date</TableHead>
                <TableHead className="text-xs text-right">Purchase Price</TableHead>
                <TableHead className="text-xs">Current Status</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item) => (
                <TableRow key={item.vehicleId}>
                  <TableCell className="text-sm">
                    {item.make} {item.model} {item.year}
                  </TableCell>
                  <TableCell className="text-sm">{item.purchaseType}</TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {formatDate(item.purchaseDate)}
                  </TableCell>
                  <TableCell className="text-right">
                    <CurrencyDisplay amount={item.purchasePrice} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/vehicles/${item.vehicleId}`}
                      className="text-xs underline text-muted-foreground hover:text-foreground"
                    >
                      View Vehicle
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Repair Vendor variant ─────────────────────────────────────────────────────

function RepairVendorDetail({ tp }: { tp: ThirdPartyWithHistory }) {
  const history = tp.historyData as RepairVendorHistory[]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-semibold">Repair History</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No repairs recorded for this vendor.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Vehicle</TableHead>
                <TableHead className="text-xs">Repair Request</TableHead>
                <TableHead className="text-xs">Date Sent</TableHead>
                <TableHead className="text-xs">Date Returned</TableHead>
                <TableHead className="text-xs text-right">Invoice</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item) => {
                const vehicleLabel = item.vehicleMake
                  ? `${item.vehicleMake} ${item.vehicleModel} ${item.vehicleYear ?? ""}`
                  : item.vehicleId
                const truncatedRequest =
                  item.repairRequest.length > 50
                    ? `${item.repairRequest.slice(0, 50)}…`
                    : item.repairRequest
                return (
                  <TableRow key={item.repairId}>
                    <TableCell className="text-sm">
                      <Link
                        href={`/vehicles/${item.vehicleId}`}
                        className="hover:underline"
                      >
                        {vehicleLabel}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground" title={item.repairRequest}>
                      {truncatedRequest}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatDate(item.dateSent)}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {formatDate(item.dateReturned)}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.invoiceAmount != null ? (
                        <CurrencyDisplay amount={item.invoiceAmount} />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Finance Company variant ───────────────────────────────────────────────────

function FinanceCompanyDetail({ tp }: { tp: ThirdPartyWithHistory }) {
  const history = tp.historyData as FinanceCompanyHistory[]
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xl font-semibold">Lease Deals</CardTitle>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No lease deals recorded with this finance company.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Customer</TableHead>
                <TableHead className="text-xs">Vehicle</TableHead>
                <TableHead className="text-xs text-right">Finance Amount</TableHead>
                <TableHead className="text-xs text-right">Sale Price</TableHead>
                <TableHead className="text-xs">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((item) => {
                const vehicleLabel = item.vehicleMake
                  ? `${item.vehicleMake} ${item.vehicleModel} ${item.vehicleYear ?? ""}`
                  : item.vehicleId
                return (
                  <TableRow key={item.saleId}>
                    <TableCell className="text-sm tabular-nums">
                      {formatDate(item.date)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link
                        href={`/customers/${item.customerId}`}
                        className="hover:underline"
                      >
                        {item.customerName ?? item.customerId}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">
                      <Link
                        href={`/sales/${item.saleId}`}
                        className="hover:underline"
                      >
                        {vehicleLabel}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">
                      {item.financeAmount != null ? (
                        <CurrencyDisplay amount={item.financeAmount} />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <CurrencyDisplay amount={item.salePrice} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main detail view ──────────────────────────────────────────────────────────

interface ThirdPartyDetailViewProps {
  id: string
}

export function ThirdPartyDetailView({ id }: ThirdPartyDetailViewProps) {
  const [archiveOpen, setArchiveOpen] = React.useState(false)

  const { data: tp, isLoading, isError } = useEntityDetail<ThirdPartyWithHistory>(
    "third-parties",
    "/api/third-parties",
    id,
  )

  const { mutate: archiveMutate, isPending: isArchiving } = useEntityMutation({
    entityKey: "third-parties",
    endpoint: `/api/third-parties/${id}`,
    method: "PATCH",
    successMessage: "Third party archived.",
  })

  function confirmArchive() {
    archiveMutate(
      { isActive: false } as Parameters<typeof archiveMutate>[0],
      { onSuccess: () => setArchiveOpen(false) },
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="rounded-lg border p-6 space-y-4">
          <Skeleton className="h-6 w-48" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border p-6 space-y-3">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !tp) {
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

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/third-parties" className="text-xs">Third Parties</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage className="text-xs">{tp.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Info Card with Archive action */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
          <div className="space-y-1">
            <CardTitle className="text-xl font-semibold">{tp.name}</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary" className="text-xs">
                {TYPE_LABELS[tp.type] ?? tp.type}
              </Badge>
              <Badge variant={tp.isActive ? "default" : "outline"} className="text-xs">
                {tp.isActive ? "Active" : "Archived"}
              </Badge>
            </div>
          </div>
          {tp.isActive && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => setArchiveOpen(true)}
            >
              Archive
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <InfoRow label="Name" value={tp.name} />
            {tp.category && <InfoRow label="Category" value={tp.category} />}
            <InfoRow label="Type" value={TYPE_LABELS[tp.type] ?? tp.type} />

            {/* Finance Company extra fields */}
            {tp.type === "FinanceCompany" && (
              <>
                {tp.commissionRate != null && (
                  <InfoRow label="Commission Rate" value={`${tp.commissionRate}%`} />
                )}
                {tp.processingPathType && (
                  <InfoRow label="Processing Path" value={tp.processingPathType} />
                )}
              </>
            )}

            {/* RepairVendor specialisation via category */}
            {tp.type === "RepairVendor" && tp.category && (
              <InfoRow label="Specialisation" value={tp.category} />
            )}
          </div>

          {/* Contact Persons */}
          {tp.contactPersons.length > 0 && (
            <>
              <Separator className="my-4" />
              <div className="space-y-2">
                <span className="text-xs font-normal text-muted-foreground">Contact Persons</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {tp.contactPersons.map((c, i) => (
                    <div key={i} className="rounded-lg border p-3 text-sm space-y-0.5">
                      <p className="font-normal">{c.name}</p>
                      {c.role && <p className="text-xs text-muted-foreground">{c.role}</p>}
                      <p className="text-xs tabular-nums">{c.phone}</p>
                      {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Type-based history section */}
      {tp.type === "Supplier" && <SupplierDetail tp={tp} />}
      {tp.type === "RepairVendor" && <RepairVendorDetail tp={tp} />}
      {tp.type === "FinanceCompany" && <FinanceCompanyDetail tp={tp} />}

      {/* Archive confirmation dialog */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Archive Third Party</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Archive{" "}
            <span className="font-medium text-foreground">{tp.name}</span>? They will no
            longer appear in selection lists. Existing records will be unaffected.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setArchiveOpen(false)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmArchive}
              disabled={isArchiving}
            >
              {isArchiving ? "Archiving..." : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
