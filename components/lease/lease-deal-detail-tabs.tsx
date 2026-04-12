"use client"

import * as React from "react"
import Link from "next/link"
import { format } from "date-fns"
import { CheckCircle2, Circle, Upload } from "lucide-react"

import type { LeaseDeal } from "@/lib/mock-data/schemas"
import { customerFixtures } from "@/lib/mock-data/customers"
import { thirdPartiesFixtures } from "@/lib/mock-data/third-parties"
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
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// ── Lookup maps ───────────────────────────────────────────────────────────────

const customerMap = new Map(customerFixtures.map((c) => [c.id, c]))
const thirdPartyMap = new Map(thirdPartiesFixtures.map((t) => [t.id, t]))

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(dateStr?: string) {
  if (!dateStr) return "—"
  try {
    return format(new Date(dateStr), "dd MMM yyyy")
  } catch {
    return dateStr
  }
}

function InfoRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-normal text-muted-foreground">{label}</span>
      <span className="text-sm font-normal">{value ?? "—"}</span>
    </div>
  )
}

// ── Status timeline ───────────────────────────────────────────────────────────

const DEAL_STATUS_STEPS = [
  "Initiated",
  "EligibilityPending",
  "Eligible",
  "Processing",
  "DocumentsCollected",
  "Dispatched",
  "Completed",
] as const

function DealStatusTimeline({ currentStatus }: { currentStatus: string }) {
  const currentIndex = DEAL_STATUS_STEPS.indexOf(currentStatus as typeof DEAL_STATUS_STEPS[number])
  const isRejected = currentStatus === "Rejected"

  return (
    <div className="flex flex-col gap-2">
      {DEAL_STATUS_STEPS.map((step, index) => {
        const isPast = !isRejected && index < currentIndex
        const isCurrent = !isRejected && index === currentIndex
        return (
          <div key={step} className="flex items-center gap-3">
            {isPast || isCurrent ? (
              <CheckCircle2
                className={`h-4 w-4 shrink-0 ${isCurrent ? "text-primary" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
            ) : (
              <Circle className="h-4 w-4 shrink-0 text-muted-foreground/40" aria-hidden="true" />
            )}
            <span
              className={`text-xs font-normal ${
                isCurrent
                  ? "text-primary font-semibold"
                  : isPast
                  ? "text-muted-foreground"
                  : "text-muted-foreground/40"
              }`}
            >
              {step.replace(/([a-z])([A-Z])/g, "$1 $2")}
            </span>
          </div>
        )
      })}
      {isRejected && (
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span className="text-xs font-semibold text-destructive">Rejected</span>
        </div>
      )}
    </div>
  )
}

// ── Checklist display ─────────────────────────────────────────────────────────

function ChecklistItem({ label, checked }: { label: string; checked: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {checked ? (
        <CheckCircle2 className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" aria-hidden="true" />
      )}
      <span className="text-sm font-normal">{label}</span>
    </div>
  )
}

// ── Photo slot ────────────────────────────────────────────────────────────────

const INSPECTION_PHOTO_TYPES = [
  "Front", "Back", "Left", "Right", "Chassis", "Engine", "Meter",
  "Dealer + Vehicle", "Customer + Vehicle",
]

function PhotoGrid({ photos }: { photos: Array<{ type: string; filename: string; url: string }> }) {
  const photoMap = new Map(photos.map((p) => [p.type, p]))

  return (
    <div className="grid grid-cols-3 gap-3">
      {INSPECTION_PHOTO_TYPES.map((type) => {
        const photo = photoMap.get(type)
        return (
          <div
            key={type}
            className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center min-h-[100px]"
          >
            {photo ? (
              <>
                <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
                <span className="text-xs font-normal text-muted-foreground">{type}</span>
                <span className="text-xs text-muted-foreground truncate max-w-full">{photo.filename}</span>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-muted-foreground/40" aria-hidden="true" />
                <span className="text-xs font-normal text-muted-foreground/60">{type}</span>
                <span className="text-xs text-muted-foreground/40">No photo</span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Mock activity log ─────────────────────────────────────────────────────────

const MOCK_ACTIVITY = [
  { date: "2024-11-08", user: "Cashier", event: "Status updated", detail: "Moved to Processing" },
  { date: "2024-10-20", user: "System", event: "Documents collected", detail: "All customer docs marked received" },
  { date: "2024-10-05", user: "Cashier", event: "Deal created", detail: "New lease deal initiated" },
]

// ── Mock cash advance blockers ────────────────────────────────────────────────

const MOCK_BLOCKERS = [
  { id: 1, description: "Bank statement verification pending", status: "Pending" },
  { id: 2, description: "Customer signature required", status: "Resolved" },
]

const MOCK_DELAY_INQUIRIES = [
  { id: 1, date: "2024-10-15", inquiry: "Why is processing taking long?", feedback: "Awaiting bank statement" },
]

// ── Customer doc checklist labels ─────────────────────────────────────────────

const CUSTOMER_DOC_LABELS: Record<string, string> = {
  nicCopy: "NIC Copy",
  drivingLicence: "Driving Licence",
  salarySlip: "Salary Slip",
  bankStatement: "Bank Statement",
  utilityBill: "Utility Bill",
  guarantorNicCopy: "Guarantor NIC Copy",
  passportPhotos: "Passport Photos",
  bankPassbookPhoto: "Bank Passbook Photo",
  addressProof: "Address Proof",
  relationshipProof: "Relationship Proof",
  affidavit: "Affidavit",
}

const VEHICLE_DOC_LABELS: Record<string, string> = {
  crBookCopy: "CR Book Copy",
  ownerNicCopy: "Owner NIC Copy",
  insuranceCopy: "Insurance Copy",
  revenueLicence: "Revenue Licence",
  registrationBook: "Registration Book",
  deletionLetter: "Deletion Letter",
  extraKey: "Extra Key",
  transferPaper: "Transfer Paper",
  previousOwnerNic: "Previous Owner NIC",
}

// ── Main component ─────────────────────────────────────────────────────────────

interface LeaseDealDetailTabsProps {
  id: string
}

export function LeaseDealDetailTabs({ id }: LeaseDealDetailTabsProps) {
  const { data: deal, isLoading, isError } = useEntityDetail<LeaseDeal>(
    "lease-deals",
    "/api/lease-deals",
    id,
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  if (isError || !deal) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Failed to load lease deal details.</p>
        </CardContent>
      </Card>
    )
  }

  const customer = customerMap.get(deal.customerId)
  const company = thirdPartyMap.get(deal.financeCompanyId)

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/lease-deals">Lease Deals</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Deal #{id}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Quick stats + timeline */}
      <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-semibold">
              {deal.vehicleDescription}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <InfoRow
                label="Deal Type"
                value={
                  <Badge
                    variant={deal.dealType === "ApplicationProcessing" ? "default" : "secondary"}
                    className="text-xs font-normal"
                  >
                    {deal.dealType === "ApplicationProcessing" ? "Application" : "Referral"}
                  </Badge>
                }
              />
              <InfoRow
                label="Loan Amount"
                value={<CurrencyDisplay amount={deal.loanAmount} />}
              />
              <InfoRow
                label="Finance Company"
                value={company?.name ?? deal.financeCompanyId}
              />
              <InfoRow label="Status" value={<StatusBadge status={deal.status} />} />
              <InfoRow label="File Number" value={deal.fileNumber} />
              <InfoRow label="Processing Fee" value={deal.processingFee ? <CurrencyDisplay amount={deal.processingFee} /> : undefined} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <DealStatusTimeline currentStatus={deal.status} />
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="customer">Customer &amp; Guarantors</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="cash-advance">Cash Advance</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>

        {/* ── Overview tab ── */}
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Deal Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <InfoRow label="Deal ID" value={deal.id} />
                <InfoRow label="Created" value={formatDate(deal.createdAt)} />
                <InfoRow label="Updated" value={formatDate(deal.updatedAt)} />
                <InfoRow label="Deal Type" value={deal.dealType.replace(/([a-z])([A-Z])/g, "$1 $2")} />
                <InfoRow label="Loan Amount" value={<CurrencyDisplay amount={deal.loanAmount} />} />
                <InfoRow label="Finance Company" value={company?.name ?? deal.financeCompanyId} />
                <InfoRow label="Status" value={<StatusBadge status={deal.status} />} />
                <InfoRow label="Customer Eligibility" value={deal.customerEligibility ?? "—"} />
                <InfoRow label="Processing Fee" value={deal.processingFee ? <CurrencyDisplay amount={deal.processingFee} /> : undefined} />
                <InfoRow label="File Number" value={deal.fileNumber} />
                <InfoRow label="Dispatched At" value={formatDate(deal.dispatchedAt)} />
                <InfoRow label="Cash Advance" value={deal.cashAdvanceFacility ? "Enabled" : "Disabled"} />
                {deal.cashAdvanceFacility && deal.cashAdvanceAmount && (
                  <InfoRow label="Cash Advance Amount" value={<CurrencyDisplay amount={deal.cashAdvanceAmount} />} />
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Customer & Guarantors tab ── */}
        <TabsContent value="customer" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Customer Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <InfoRow label="Full Name" value={customer?.fullName ?? deal.customerId} />
                <InfoRow label="NIC / Passport" value={customer?.nicPassport} />
                <InfoRow label="Phone" value={customer?.phone} />
                <InfoRow label="Address" value={customer?.address} />
                <InfoRow label="Email" value={customer?.email} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Guarantors</CardTitle>
            </CardHeader>
            <CardContent>
              {deal.guarantors.length === 0 ? (
                <p className="text-sm text-muted-foreground">No guarantors on this deal.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>NIC</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Eligibility</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deal.guarantors.map((g, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{g.name}</TableCell>
                        <TableCell className="text-sm tabular-nums">{g.nic}</TableCell>
                        <TableCell className="text-sm tabular-nums">{g.phone}</TableCell>
                        <TableCell>
                          {g.eligibility ? (
                            <StatusBadge status={g.eligibility} />
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Documents tab ── */}
        <TabsContent value="documents" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-semibold">Customer Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(deal.customerDocChecklist).map(([key, checked]) => (
                  <ChecklistItem
                    key={key}
                    label={CUSTOMER_DOC_LABELS[key] ?? key}
                    checked={checked}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-semibold">Vehicle Documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(deal.vehicleDocChecklist).map(([key, checked]) => (
                  <ChecklistItem
                    key={key}
                    label={VEHICLE_DOC_LABELS[key] ?? key}
                    checked={checked}
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          {deal.dealType === "ApplicationProcessing" && (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl font-semibold">Inspection Photos</CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoGrid photos={deal.inspectionPhotos} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Cash Advance tab ── */}
        <TabsContent value="cash-advance" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Cash Advance Facility</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-normal text-muted-foreground">Status:</span>
                <Badge variant={deal.cashAdvanceFacility ? "default" : "secondary"} className="text-xs font-normal">
                  {deal.cashAdvanceFacility ? "Enabled" : "Disabled"}
                </Badge>
              </div>
              {deal.cashAdvanceFacility && deal.cashAdvanceAmount && (
                <>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4">
                    <InfoRow label="Advance Amount" value={<CurrencyDisplay amount={deal.cashAdvanceAmount} />} />
                    <InfoRow label="Disbursement" value="Pending disbursement" />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Processing Blockers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {MOCK_BLOCKERS.map((blocker) => (
                  <div key={blocker.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-sm font-normal">{blocker.description}</span>
                    <StatusBadge status={blocker.status} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Customer Delay Inquiries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {MOCK_DELAY_INQUIRIES.map((item) => (
                  <div key={item.id} className="rounded-md border px-3 py-2 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">{formatDate(item.date)}</span>
                    </div>
                    <p className="text-sm font-normal">{item.inquiry}</p>
                    <p className="text-xs text-muted-foreground">Feedback: {item.feedback}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Activity Log tab ── */}
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-semibold">Activity Log</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {MOCK_ACTIVITY.map((entry, i) => (
                  <div key={i} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      {i < MOCK_ACTIVITY.length - 1 && (
                        <div className="w-px flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="pb-4 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold">{entry.event}</span>
                        <span className="text-xs text-muted-foreground">by {entry.user}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{entry.detail}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(entry.date)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
