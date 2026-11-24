"use client"
import { ImportedBadge } from "@/components/imports/imported-badge"

import { CustomerForm } from "@/components/customers/customer-form"
import { checklistItemKey } from "@/lib/brokerage-checklist"

import * as React from "react"
import Link from "next/link"
import { parseAsBoolean, parseAsInteger, parseAsString, useQueryState, useQueryStates } from "nuqs"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  BrokerageDTO,
  CustomerDTO,
  Dependency,
  PartyDTO,
  PhotoCategory,
  QuoteDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Deal = Visible<BrokerageDTO>
type PhotoCategoryName = NonNullable<PhotoCategory>
const categories: PhotoCategoryName[] = [
  "FRONT",
  "BACK",
  "LEFT",
  "RIGHT",
  "CHASSIS",
  "ENGINE",
  "METER",
  "DEALER_WITH_VEHICLE",
  "CUSTOMER_WITH_VEHICLE",
]
const checklistKinds = [
  "CUSTOMER_ID",
  "GUARANTOR_ID",
  "PASSPORT_PHOTOS",
  "BANK_PASSBOOK",
  "ADDRESS_PROOF",
  "RELATIONSHIP_PROOF",
  "AFFIDAVIT",
  "REGISTRATION_BOOK",
  "DELETION_LETTER",
  "REVENUE_LICENSE",
  "EXTRA_KEY",
  "TRANSFER_PAPER",
  "PREVIOUS_OWNER_ID",
  "PROCESSING_DOCUMENT",
] as const
type ChecklistKindName = (typeof checklistKinds)[number]
const participantKinds: ChecklistKindName[] = [
  "CUSTOMER_ID",
  "GUARANTOR_ID",
  "PASSPORT_PHOTOS",
  "BANK_PASSBOOK",
  "ADDRESS_PROOF",
  "RELATIONSHIP_PROOF",
  "AFFIDAVIT",
]
const vehicleKinds: ChecklistKindName[] = [
  "REGISTRATION_BOOK",
  "DELETION_LETTER",
  "REVENUE_LICENSE",
  "TRANSFER_PAPER",
  "PREVIOUS_OWNER_ID",
]
const moneyText = (value?: string) => (value === undefined ? "Unavailable" : major(BigInt(value)))
const problem = (error: unknown) =>
  error instanceof RequestError
    ? error.code
    : error instanceof Error
      ? error.message
      : "Request failed"
const envelope = (input: unknown, expected: Dependency[] = []) => ({
  schemaVersion: 1 as const,
  idempotencyKey: crypto.randomUUID(),
  expected,
  input,
})
async function send(name: string, input: unknown, expected: Dependency[] = []) {
  return privateRequest<Applied>(`/api/v1/commands/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: location.origin },
    body: JSON.stringify(envelope(input, expected)),
  })
}
async function fetchQuery<T>(path: string): Promise<T> {
  return (await privateRequest<{ data: T }>(path)).data
}
function localDateTime() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16)
}

async function sha256(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}
async function uploadDocument(
  dealId: string,
  dealRevision: number,
  purpose: "INSPECTION" | "PARTICIPANT_DOCUMENT" | "VEHICLE_DOCUMENT" | "PROCESSING_DOCUMENT",
  file: File,
  category?: PhotoCategoryName
) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const init = await privateRequest<{
    status: "UPLOAD_READY"
    uploadId: string
    revision: number
    putUrl: string
    requiredHeaders: Record<string, string>
  }>("/api/v1/commands/initUpload", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: location.origin },
    body: JSON.stringify(
      envelope(
        {
          target: { type: "BROKERAGE_DEAL", id: dealId },
          purpose,
          filename: file.name,
          contentType: file.type,
          size: file.size,
          sha256: await sha256(file),
          ...(category ? { category } : {}),
        },
        [{ type: "BrokerageDeal", id: dealId, revision: dealRevision }]
      )
    ),
  })
  const put = await fetch(init.putUrl, {
    method: "PUT",
    headers: init.requiredHeaders,
    body: bytes,
    credentials: "same-origin",
  })
  if (!put.ok) throw new RequestError("UPLOAD_MISMATCH", put.status)
  const done = await privateRequest<Applied>("/api/v1/commands/completeUpload", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: location.origin },
    body: JSON.stringify(
      envelope(
        { uploadId: init.uploadId },
        [
          { type: "UploadIntent", id: init.uploadId, revision: init.revision },
          { type: "BrokerageDeal", id: dealId, revision: dealRevision },
        ]
      )
    ),
  })
  return done.result.id
}
function ref(deal: Deal, company?: Company, facility = false): Dependency[] {
  const refs: Dependency[] = []
  if (deal.id && deal.revision)
    refs.push({ type: "BrokerageDeal", id: deal.id, revision: deal.revision })
  if (company?.id && company.revision)
    refs.push({ type: "FinanceCompany", id: company.id, revision: company.revision })
  if (facility && deal.facility?.id && deal.facility.revision)
    refs.push({ type: "CashFacility", id: deal.facility.id, revision: deal.facility.revision })
  return refs
}
function Status({ state }: { state: string }) {
  return (
    <span className="rounded border px-2 py-0.5 text-xs font-medium">{state}</span>
  )
}

// ── List ─────────────────────────────────────────────────────────────────────
export function BrokerageList({ initialQuoteId }: { initialQuoteId?: string }) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const canRead = ["id", "state"].every((field) => ability.can("read", "BrokerageDeal", field))
  const canOpen = ["customerId", "guarantors", "quoteId", "facility"].every((field) => ability.can("create", "BrokerageDeal", field))
  const [{ page: pageParam, includeRejected, status }, setFilters] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    includeRejected: parseAsBoolean.withDefault(false),
    status: parseAsString.withDefault(""),
  })
  const page = Math.max(1, pageParam)
  const pageSize = 20
  const [showIntake, setShowIntake] = React.useState(Boolean(initialQuoteId))
  const deals = useQuery({
    queryKey: ["brokerage", "list", includeRejected, status, page],
    enabled: canRead,
    queryFn: () =>
      fetchQuery<{ data: Deal[]; total: number }>(
        `/api/v1/queries/brokerage?page=${page}&pageSize=${pageSize}&includeRejected=${includeRejected}${status ? `&status=${encodeURIComponent(status)}` : ""}`
      ),
  })
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Lease brokerage deals</h1>
          <p className="text-muted-foreground text-sm">
            Application and referral processing with persisted quote, checklist,
            facility and dispatch history.
          </p>
        </div>
        {canOpen && <Button onClick={() => setShowIntake((v) => !v)}>
          {showIntake ? "Close intake" : "New brokerage deal"}
        </Button>}
      </div>
      {canOpen && showIntake && <IntakeForm initialQuoteId={initialQuoteId} onDone={() => setShowIntake(false)} />}
      {canRead && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeRejected}
                onChange={(e) => void setFilters({ includeRejected: e.target.checked, page: 1 })}
              />
              Include rejected deals
            </label>
            <div className="space-y-1">
              <Label htmlFor="status-filter">Status filter</Label>
              <select
                id="status-filter"
                className="border-input h-9 rounded border bg-transparent px-2 text-sm"
                value={status}
                onChange={(e) => void setFilters({ status: e.target.value, page: 1 })}
              >
                <option value="">All visible</option>
                {[
                  "INTAKE",
                  "ELIGIBILITY_PENDING",
                  "ELIGIBLE",
                  "INSPECTED",
                  "DOCUMENTS_READY",
                  "DISPATCHED",
                  "REFERRED",
                  "COMPLETED",
                  "REJECTED",
                ].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={() => deals.refetch()}>
              Reload
            </Button>
          </div>
          {deals.isLoading ? (
            <p role="status">Loading brokerage deals…</p>
          ) : deals.error ? (
            <p role="alert">{problem(deals.error)}</p>
          ) : (
            <Table aria-label="Brokerage deals">
              <TableHeader>
                <TableRow>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Approved loan</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(deals.data?.data ?? []).map((deal) => (
                  <TableRow key={deal.id}>
                    <TableCell>
                      {deal.id && (
                        <Link className="underline" href={`/lease-deals/${deal.id}`}>
                          {deal.vehicle?.make ?? "Unavailable"} {deal.vehicle?.model ?? ""}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>{deal.path ?? "Unavailable"}</TableCell>
                    <TableCell>
                      <Status state={deal.state ?? "Unavailable"} />
                    </TableCell>
                    <TableCell>{moneyText(deal.approvedLoan)}</TableCell>
                    <TableCell>revision {deal.revision ?? "?"}</TableCell>
                  </TableRow>
                ))}
                {!deals.data?.data.length && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      No persisted deals match. Rejected deals are hidden by default.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
          {deals.data && (page > 1 || deals.data.total > pageSize) && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" disabled={page === 1} onClick={() => void setFilters({ page: page - 1 })}>
                Previous
              </Button>
              <span>Page {page} · {deals.data.total} deals</span>
              <Button variant="outline" disabled={page * pageSize >= deals.data.total} onClick={() => void setFilters({ page: page + 1 })}>
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function IntakeForm({ initialQuoteId, onDone }: { initialQuoteId?: string; onDone: () => void }) {
  const queries = useQueryClient()
  const customers = useQuery({
    queryKey: ["customers", "brokerage-picker"],
    queryFn: () =>
      fetchQuery<{ data: CustomerDTO[] }>("/api/v1/queries/customers?page=1&pageSize=100"),
  })
  const [quoteId, setQuoteId] = React.useState(initialQuoteId ?? "")
  const [quote, setQuote] = React.useState<Visible<QuoteDTO> | null>(null)
  const [showCustomerForm, setShowCustomerForm] = React.useState(false)
  const [customerId, setCustomerId] = React.useState("")
  const [guarantors, setGuarantors] = React.useState([
    { name: "", identity: "", address: "", phone: "" },
    { name: "", identity: "", address: "", phone: "" },
  ])
  const [message, setMessage] = React.useState("")
  const [pending, setPending] = React.useState(false)
  async function loadQuote() {
    setMessage("")
    try {
      setQuote(await fetchQuery<QuoteDTO>(`/api/v1/queries/quote?id=${quoteId}`))
    } catch (error) {
      setQuote(null)
      setMessage(problem(error))
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!quote?.id || !customerId || pending) return
    setPending(true)
    try {
      const [customer, settings] = await Promise.all([
        fetchQuery<Visible<CustomerDTO>>(`/api/v1/queries/customer?id=${customerId}`),
        fetchQuery<{ id: string; revision: number }>("/api/v1/queries/settings"),
      ])
      if (!customer.revision || !quote.companyId || !quote.companyRevision)
        throw new Error("The customer and quote company must be readable.")
      await send("openBrokerage", {
        customerId,
        guarantors: guarantors.filter((g) => g.name.trim()),
        quoteId: quote.id,
      }, [
        { type: "Customer", id: customerId, revision: customer.revision },
        { type: "Quote", id: quote.id, revision: 1 },
        { type: "FinanceCompany", id: quote.companyId, revision: quote.companyRevision },
        { type: "Settings", id: settings.id, revision: settings.revision },
      ])
      await queries.invalidateQueries({ queryKey: ["brokerage"] })
      onDone()
    } catch (error) {
      setMessage(problem(error))
    } finally {
      setPending(false)
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Open brokerage from a published quote</CardTitle>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={() => setShowCustomerForm((open) => !open)}>
          {showCustomerForm ? "Close customer form" : "New customer"}
        </Button>
        {showCustomerForm && (
          <CustomerForm onSaved={async ({ result }) => {
            await queries.invalidateQueries({ queryKey: ["customers"] })
            setCustomerId(result.id)
            setShowCustomerForm(false)
          }} />
        )}
        <form className="space-y-4" onSubmit={submit}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="quote-id">Quote ID</Label>
              <Input
                id="quote-id"
                value={quoteId}
                onChange={(e) => { setQuoteId(e.target.value); setQuote(null) }}
                required
              />
            </div>
            <Button type="button" variant="outline" onClick={loadQuote}>
              Load live quote
            </Button>
            {quote && (
              <p className="text-sm">
                {quote.vehicle?.make} {quote.vehicle?.model} ·{" "}
                {moneyText(quote.principal)} · {quote.months} months ·{" "}
                {quote.policy?.path}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="intake-customer">Customer</Label>
            <select
              id="intake-customer"
              required
              className="border-input h-9 w-full rounded border bg-transparent px-2 text-sm"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select active customer</option>
              {(customers.data?.data ?? []).filter((c) => c.active).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} · {c.nicOrPassport}
                </option>
              ))}
            </select>
          </div>
          {guarantors.map((guarantor, index) => (
            <fieldset key={index} className="space-y-2 rounded border p-3">
              <legend className="px-1 text-sm">Guarantor {index + 1}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  aria-label={`Guarantor ${index + 1} name`}
                  placeholder="Full name"
                  value={guarantor.name}
                  onChange={(e) =>
                    setGuarantors((rows) =>
                      rows.map((r, i) =>
                        i === index ? { ...r, name: e.target.value } : r
                      )
                    )
                  }
                />
                <Input
                  aria-label={`Guarantor ${index + 1} identity`}
                  placeholder="NIC / passport"
                  value={guarantor.identity}
                  onChange={(e) =>
                    setGuarantors((rows) =>
                      rows.map((r, i) =>
                        i === index ? { ...r, identity: e.target.value } : r
                      )
                    )
                  }
                />
                <Input
                  aria-label={`Guarantor ${index + 1} address`}
                  placeholder="Address"
                  value={guarantor.address}
                  onChange={(e) =>
                    setGuarantors((rows) =>
                      rows.map((r, i) =>
                        i === index ? { ...r, address: e.target.value } : r
                      )
                    )
                  }
                />
                <Input
                  aria-label={`Guarantor ${index + 1} phone`}
                  placeholder="Phone"
                  value={guarantor.phone}
                  onChange={(e) =>
                    setGuarantors((rows) =>
                      rows.map((r, i) =>
                        i === index ? { ...r, phone: e.target.value } : r
                      )
                    )
                  }
                />
              </div>
            </fieldset>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setGuarantors((rows) => [
                  ...rows,
                  { name: "", identity: "", address: "", phone: "" },
                ])
              }
            >
              Add guarantor
            </Button>
            <Button type="submit" disabled={pending}>
              Persist brokerage deal
            </Button>
          </div>
          {message && (
            <p role="alert" className="text-sm">
              {message}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}

// ── Detail ───────────────────────────────────────────────────────────────────
type Company = Visible<PartyDTO>

export function BrokerageDetail({ dealId }: { dealId: string }) {
  const queries = useQueryClient()
  const detail = useQuery({
    queryKey: ["brokerage", "deal", dealId],
    queryFn: () => fetchQuery<Deal>(`/api/v1/queries/brokerageDeal?id=${dealId}`),
  })
  const deal = detail.data
  const company = useQuery({
    queryKey: ["brokerage", "company", deal?.companyId],
    enabled: !!deal?.companyId,
    queryFn: () =>
      fetchQuery<Company>(
        `/api/v1/queries/party?type=FINANCE_COMPANY&id=${deal!.companyId}`
      ),
  })
  const preview = useQuery({
    queryKey: ["brokerage", "preview", dealId],
    enabled: !!deal,
    queryFn: async () => {
      const response = await privateRequest<{
        data: {
          revision: number
          checklistHash: string
          ready: boolean
          blockers: { code: string; field: string; message: string }[]
        }[]
      }>("/api/v1/queries/dispatchPreview", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: location.origin },
        body: JSON.stringify({
          sourceIds: [{ type: "BROKERAGE", id: dealId }],
        }),
      })
      return response.data[0]
    },
  })
  const refresh = React.useCallback(async () => {
    await queries.invalidateQueries({ queryKey: ["brokerage"] })
  }, [queries])
  if (detail.isLoading) return <p>Loading persisted deal…</p>
  if (detail.error) return <p role="alert">{problem(detail.error)}</p>
  if (!deal) return <p>Deal unavailable</p>
  const contacts = company.data?.contacts ?? []
  const checklistHash = preview.data?.checklistHash
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">
            {deal.vehicle?.make} {deal.vehicle?.model}{" "}
            <Status state={deal.state ?? "?"} />
          </h1>
          <ImportedBadge provenance={deal.provenance} />
          <p className="text-muted-foreground text-sm">
            {deal.path} · revision {deal.revision} · approved loan{" "}
            {moneyText(deal.approvedLoan)} · processing fee{" "}
            {moneyText(deal.processingFee)}
          </p>
        </div>
        <Link className="underline" href="/lease-deals">
          Back to deals
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <EligibilityPanel deal={deal} company={company.data} contacts={contacts} refresh={refresh} />
        {deal.path === "APPLICATION" ? (
          <InspectionPanel deal={deal} refresh={refresh} />
        ) : (
          <ReferralPanel deal={deal} company={company.data} contacts={contacts} refresh={refresh} />
        )}
        {deal.path === "APPLICATION" && (
          <ChecklistPanel
            deal={deal}
            checklistHash={checklistHash}
            company={company.data}
            contacts={contacts}
            refresh={refresh}
          />
        )}
        <FinancialPanel deal={deal} company={company.data} contacts={contacts} refresh={refresh} />
        <FacilityPanel deal={deal} refresh={refresh} />
        <IssuesPanel deal={deal} company={company.data} contacts={contacts} refresh={refresh} />
        <TimelinePanel deal={deal} />
      </div>
    </section>
  )
}

function EvidenceLink({ id, label }: { id: string; label: string }) {
  const [error, setError] = React.useState("")
  return <span>
    <Button type="button" variant="link" onClick={async () => {
      try {
        const { url } = await fetchQuery<{ url: string }>(`/api/v1/queries/download?attachmentId=${id}`)
        window.location.assign(url)
      } catch (cause) {
        setError(problem(cause))
      }
    }}>{label}</Button>
    {error && <span role="alert">{error}</span>}
  </span>
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{children}</CardContent>
    </Card>
  )
}

function useSubmit(refresh: () => Promise<void>) {
  const [message, setMessage] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const run = async (task: () => Promise<unknown>) => {
    setPending(true)
    setMessage("")
    try {
      await task()
      await refresh()
      return true
    } catch (error) {
      setMessage(problem(error))
      return false
    } finally {
      setPending(false)
    }
  }
  return { message, pending, run }
}

function ContactSelect({
  id,
  contacts,
}: {
  id: string
  contacts: NonNullable<Company["contacts"]>
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Company contact</Label>
      <select
        id={id}
        name="contactId"
        required
        className="border-input h-9 w-full rounded border bg-transparent px-2 text-sm"
      >
        <option value="">Select active contact</option>
        {contacts.map((contact, index) => (
          <option key={contact.id ?? index} value={contact.id}>
            {contact.name} · {contact.role}
          </option>
        ))}
      </select>
    </div>
  )
}

function EligibilityPanel({
  deal,
  company,
  contacts,
  refresh,
}: {
  deal: Deal
  company?: Company
  contacts: NonNullable<Company["contacts"]>
  refresh: () => Promise<void>
}) {
  const { message, pending, run } = useSubmit(refresh)
  const [target, setTarget] = React.useState("CUSTOMER")
  return (
    <Panel title="Eligibility history">
      <ul className="space-y-1">
        {(deal.eligibility ?? []).map((row, index) => (
          <li key={index}>
            {row.target} {deal.guarantors?.find((g) => g.id === row.guarantorId)?.name} {row.outcome} · {row.at} · {contacts.find((c) => c.id === row.contactId)?.name ?? row.contactId} · {row.feedback}
          </li>
        ))}
        {!deal.eligibility?.length && <li>No eligibility checks yet.</li>}
      </ul>
      {deal.nextActions?.includes("recordEligibility") && (
        <form
          className="space-y-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void run(() =>
              send(
                "recordEligibility",
                {
                  dealId: deal.id,
                  target: data.get("target"),
                  outcome: data.get("outcome"),
                  contactId: data.get("contactId"),
                  checkedAt: new Date(String(data.get("checkedAt"))).toISOString(),
                  feedback: data.get("feedback"),
                  ...(data.get("guarantorId")
                    ? { guarantorId: data.get("guarantorId") }
                    : {}),
                },
                ref(deal, company)
              )
            )
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="elig-target">Target</Label>
              <select
                id="elig-target"
                name="target"
                className="border-input h-9 w-full rounded border bg-transparent px-2"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="CUSTOMER">Customer</option>
                <option value="GUARANTOR">Guarantor</option>
                {deal.path === "APPLICATION" && (
                  <option value="VEHICLE">Vehicle</option>
                )}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="elig-outcome">Outcome</Label>
              <select
                id="elig-outcome"
                name="outcome"
                className="border-input h-9 w-full rounded border bg-transparent px-2"
              >
                <option value="CONFIRMED">Confirmed</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>
            {target === "GUARANTOR" && (
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="elig-guarantor">Guarantor</Label>
                <select
                  id="elig-guarantor"
                  name="guarantorId"
                  required
                  className="border-input h-9 w-full rounded border bg-transparent px-2"
                >
                  {(deal.guarantors ?? []).map((guarantor) => (
                    <option key={guarantor.id} value={guarantor.id}>
                      {guarantor.name} · {guarantor.identity}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ContactSelect id="elig-contact" contacts={contacts} />
            <div className="space-y-1">
              <Label htmlFor="elig-at">Checked at</Label>
              <Input
                id="elig-at"
                name="checkedAt"
                type="datetime-local"
                required
                defaultValue={localDateTime()}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="elig-feedback">Company feedback</Label>
            <Textarea id="elig-feedback" name="feedback" required />
          </div>
          <Button type="submit" disabled={pending}>
            Record eligibility
          </Button>
          {message && <p role="alert">{message}</p>}
        </form>
      )}
    </Panel>
  )
}

function InspectionPanel({
  deal,
  refresh,
}: {
  deal: Deal
  refresh: () => Promise<void>
}) {
  const [message, setMessage] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const [files, setFiles] = React.useState<Record<string, string>>({})
  const existing = new Set((deal.photos ?? []).map((p) => p.category))
  async function upload(category: PhotoCategoryName, file: File) {
    setPending(true)
    setMessage("")
    try {
      const current = await fetchQuery<Deal>(
        `/api/v1/queries/brokerageDeal?id=${deal.id!}`
      )
      const id = await uploadDocument(
        deal.id!,
        current.revision!,
        "INSPECTION",
        file,
        category
      )
      setFiles((rows) => ({ ...rows, [category]: id }))
      await refresh()
    } catch (error) {
      setMessage(problem(error))
    } finally {
      setPending(false)
    }
  }
  async function record() {
    const current = await fetchQuery<Deal>(
      `/api/v1/queries/brokerageDeal?id=${deal.id}`
    )
    const photos = Object.entries(files).map(([category, attachmentId]) => ({
      category,
      attachmentId,
    }))
    try {
      await send("recordInspection", { dealId: deal.id!, photos }, ref(current))
      await refresh()
      setFiles({})
      setMessage("Inspection recorded")
    } catch (error) {
      setMessage(problem(error))
    }
  }
  return (
    <Panel title="Nine-category vehicle inspection">
      <ul className="grid gap-1 sm:grid-cols-2">
        {categories.map((category) => (
          <li key={category} className="space-y-1">
            <Label htmlFor={`photo-${category}`}>
              {category.replaceAll("_", " ")}
            </Label>
            <Input
              id={`photo-${category}`}
              type="file"
              disabled={pending || !["ELIGIBLE", "INSPECTED", "DOCUMENTS_READY"].includes(deal.state ?? "")}
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(category, file)
              }}
            />
            <span className="text-xs">
              {files[category] || existing.has(category)
                ? "Persisted"
                : "Missing"}
            </span>
            {(deal.photos ?? []).filter((photo) => photo.category === category && photo.attachmentId)
              .map((photo) => <EvidenceLink key={photo.attachmentId} id={photo.attachmentId!} label="Download photo" />)}
          </li>
        ))}
      </ul>
      <Button
        type="button"
        disabled={pending || !Object.keys(files).length || !categories.every((category) => files[category] || existing.has(category))}
        onClick={() => void record()}
      >
        Record inspection evidence
      </Button>
      {message && <p role="alert">{message}</p>}
    </Panel>
  )
}

function ReferralPanel({
  deal,
  company,
  contacts,
  refresh,
}: {
  deal: Deal
  company?: Company
  contacts: NonNullable<Company["contacts"]>
  refresh: () => Promise<void>
}) {
  const { message, pending, run } = useSubmit(refresh)
  return (
    <Panel title="Referral handoff">
      <p>
        Referral deals skip application inspection. Record the company agent and
        the customer contact snapshot.
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void run(() =>
            send(
              "referDeal",
              {
                dealId: deal.id,
                contactId: data.get("contactId"),
                referredAt: new Date(String(data.get("referredAt"))).toISOString(),
                sentContact: {
                  name: data.get("sentName"),
                  phone: data.get("sentPhone"),
                },
                feedback: data.get("feedback"),
              },
              ref(deal, company)
            )
          )
        }}
      >
        <ContactSelect id="referral-contact" contacts={contacts} />
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="sent-name">Sent customer name</Label>
            <Input id="sent-name" name="sentName" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sent-phone">Sent customer phone</Label>
            <Input id="sent-phone" name="sentPhone" required />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="referral-at">Referred at</Label>
          <Input
            id="referral-at"
            name="referredAt"
            type="datetime-local"
            required
            defaultValue={localDateTime()}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="referral-feedback">Feedback</Label>
          <Textarea id="referral-feedback" name="feedback" required />
        </div>
        <Button type="submit" disabled={pending || !deal.nextActions?.includes("referDeal")}>
          Refer deal
        </Button>
        {message && <p role="alert">{message}</p>}
      </form>
    </Panel>
  )
}

function ChecklistPanel({
  deal,
  checklistHash,
  company,
  contacts,
  refresh,
}: {
  deal: Deal
  checklistHash?: string
  company?: Company
  contacts: NonNullable<Company["contacts"]>
  refresh: () => Promise<void>
}) {
  const { message, pending, run } = useSubmit(refresh)
  type ChecklistRow = {
    kind: ChecklistKindName
    participantId: string
    applicability: "REQUIRED" | "NOT_REQUIRED" | "OPTIONAL"
    reason: string
    collected: boolean
    quantity: number
    attachmentIds: string[]
    label: string
  }
  const [rows, setRows] = React.useState<ChecklistRow[]>(() => {
    const current = new Map(
      (deal.checklist ?? []).map((item) => [
        `${item.kind}:${item.participantId ?? ""}`,
        item,
      ])
    )
    const entries: { kind: ChecklistKindName; participantId: string }[] = checklistKinds
      .filter((kind) => kind !== "GUARANTOR_ID" && kind !== "PROCESSING_DOCUMENT")
      .map((kind) => ({ kind, participantId: "" }))
    for (const guarantor of deal.guarantors ?? []) {
      if (guarantor.id)
        entries.push({ kind: "GUARANTOR_ID", participantId: guarantor.id })
    }
    return [
      ...entries.map(({ kind, participantId }) => {
      const item = current.get(`${kind}:${participantId}`)
      return {
        kind,
        participantId,
        applicability:
          (item?.applicability as ChecklistRow["applicability"]) ??
          (["RELATIONSHIP_PROOF", "DELETION_LETTER", "AFFIDAVIT"].includes(kind)
            ? "OPTIONAL"
            : "REQUIRED"),
        reason: item?.reason ?? "",
        collected: item?.collected ?? false,
        quantity: item?.quantity ?? (kind === "PASSPORT_PHOTOS" ? 4 : 0),
        attachmentIds: item?.attachmentIds ?? [],
        label: (item as { label?: string } | undefined)?.label ?? "",
      }
      }),
      ...(deal.checklist ?? []).filter((item) => item.kind === "PROCESSING_DOCUMENT").map((item) => ({
        kind: "PROCESSING_DOCUMENT" as const,
        participantId: "",
        applicability: item.applicability ?? "REQUIRED",
        reason: item.reason ?? "",
        collected: item.collected ?? false,
        quantity: item.quantity ?? 0,
        attachmentIds: item.attachmentIds ?? [],
        label: item.label ?? "",
      })),
    ]
  })
  const [uploadMessage, setUploadMessage] = React.useState("")
  const [uploading, setUploading] = React.useState(false)
  async function attach(index: number, file: File) {
    const { kind } = rows[index]!
    setUploading(true)
    try {
    const current = await fetchQuery<Deal>(
      `/api/v1/queries/brokerageDeal?id=${deal.id}`
    )
    const purpose = participantKinds.includes(kind)
      ? "PARTICIPANT_DOCUMENT"
      : vehicleKinds.includes(kind)
        ? "VEHICLE_DOCUMENT"
        : "PROCESSING_DOCUMENT"
      const id = await uploadDocument(deal.id!, current.revision!, purpose, file)
      setRows((all) =>
        all.map((row, i) =>
          i === index
            ? { ...row, attachmentIds: [...row.attachmentIds, id], collected: true }
            : row
        )
      )
      setUploadMessage(`${kind} uploaded`)
      await refresh()
    } catch (error) {
      setUploadMessage(problem(error))
    } finally {
      setUploading(false)
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault()
    void run(() =>
      send(
        "setChecklist",
        {
          dealId: deal.id,
          items: rows.filter((row) => row.kind !== "PASSPORT_PHOTOS" || row.attachmentIds.length > 0).map((row) => ({
            kind: row.kind,
            ...(row.participantId ? { participantId: row.participantId } : {}),
            ...(row.kind === "PROCESSING_DOCUMENT" ? { label: row.label } : {}),
            applicability: row.applicability,
            ...(row.reason ? { reason: row.reason } : {}),
            collected: row.collected,
            quantity: Number(row.quantity),
            attachmentIds: row.attachmentIds,
          })),
        },
        ref(deal)
      )
    ).then((saved) => { if (saved) setUploadMessage("Saved") })
  }
  const [outcome, setOutcome] = React.useState("CLEAN")
  const lastVerification = deal.verification?.at(-1)
  const outstanding = lastVerification?.outcome === "ISSUES" ? lastVerification.issues ?? [] : []
  const editable = ["INSPECTED", "DOCUMENTS_READY"].includes(deal.state ?? "")
  return (
    <Panel title="Document checklist and verification">
      <form className="space-y-2" onSubmit={submit}>
        {rows.map((row, index) => (
          <fieldset key={index} className="space-y-1 rounded border p-2">
            <legend className="text-xs font-medium">
              {row.kind}{row.participantId && ` · ${deal.guarantors?.find((g) => g.id === row.participantId)?.name}`}
            </legend>
            <fieldset disabled={!editable || uploading || pending} className="flex flex-wrap items-center gap-2">
              <select
                aria-label={`${row.kind} applicability`}
                className="border-input h-8 rounded border bg-transparent text-xs"
                value={row.applicability}
                onChange={(e) =>
                  setRows((all) =>
                    all.map((r, i) =>
                      i === index
                        ? {
                            ...r,
                            applicability: e.target
                              .value as ChecklistRow["applicability"],
                          }
                        : r
                    )
                  )
                }
              >
                <option value="REQUIRED">REQUIRED</option>
                <option value="OPTIONAL">OPTIONAL</option>
                <option value="NOT_REQUIRED">NOT_REQUIRED</option>
              </select>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={row.collected}
                  onChange={(e) =>
                    setRows((all) =>
                      all.map((r, i) =>
                        i === index ? { ...r, collected: e.target.checked } : r
                      )
                    )
                  }
                />
                collected
              </label>
              <Input
                aria-label={`${row.kind} quantity`}
                className="h-8 w-20"
                type="number"
                min={0}
                value={row.quantity}
                onChange={(e) =>
                  setRows((all) =>
                    all.map((r, i) =>
                      i === index ? { ...r, quantity: Number(e.target.value) } : r
                    )
                  )
                }
              />
              {row.kind === "PROCESSING_DOCUMENT" && (
                <Input
                  aria-label="Processing document name"
                  className="h-8"
                  placeholder="Document name"
                  value={row.label}
                  onChange={(e) =>
                    setRows((all) =>
                      all.map((r, i) =>
                        i === index ? { ...r, label: e.target.value } : r
                      )
                    )
                  }
                />
              )}
              {["RELATIONSHIP_PROOF", "DELETION_LETTER"].includes(row.kind) &&
                row.applicability === "NOT_REQUIRED" && (
                  <Input
                    aria-label={`${row.kind} not required reason`}
                    className="h-8"
                    placeholder="Reason required"
                    value={row.reason}
                    onChange={(e) =>
                      setRows((all) =>
                        all.map((r, i) =>
                          i === index ? { ...r, reason: e.target.value } : r
                        )
                      )
                    }
                  />
                )}
              {row.kind !== "EXTRA_KEY" && (
                <Input
                  aria-label={`${row.kind} attachment`}
                  className="h-8 max-w-56"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void attach(index, file)
                  }}
                />
              )}
            </fieldset>
            <span className="text-xs">{row.attachmentIds.length} file(s)</span>
            {row.attachmentIds.map((id, attachmentIndex) => (
              <EvidenceLink key={id} id={id} label={`Download file ${attachmentIndex + 1}`} />
            ))}
          </fieldset>
        ))}
        <Button type="button" variant="outline" disabled={!editable || uploading || pending} onClick={() =>
          setRows((current) => [...current, {
            kind: "PROCESSING_DOCUMENT", participantId: "", applicability: "REQUIRED",
            reason: "", collected: false, quantity: 0, attachmentIds: [], label: "",
          }])
        }>
          Add processing document
        </Button>
        <Button type="submit" disabled={!editable || uploading || pending}>
          Save checklist
        </Button>
      </form>
      {uploadMessage && <p role="alert">{uploadMessage}</p>}
      <div className="space-y-2 border-t pt-2">
        <p className="text-xs">Checklist hash: {checklistHash ?? "reload preview"}</p>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const issues = outcome === "RESOLVED"
              ? outstanding.map((issue) => ({ ...issue, resolved: true }))
              : outcome === "ISSUES"
                ? (deal.checklist ?? []).flatMap((item, index) => {
                    const description = String(data.get(`issue-${index}`) ?? "").trim()
                    return description ? [{
                      itemKey: checklistItemKey({ ...item, kind: item.kind ?? "" }),
                      description, resolved: false,
                    }] : []
                  })
                : []
            void run(() =>
              send(
                "verifyDocuments",
                {
                  dealId: deal.id,
                  checklistHash,
                  outcome,
                  issues,
                  contactId: data.get("contactId"),
                  confirmedAt: new Date(
                    String(data.get("confirmedAt"))
                  ).toISOString(),
                  feedback: data.get("feedback"),
                },
                ref(deal, company)
              )
            )
          }}
        >
          <ContactSelect id="verify-contact" contacts={contacts} />
          <div className="space-y-1">
            <Label htmlFor="verify-outcome">Verification outcome</Label>
            <select
              id="verify-outcome"
              name="outcome"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              className="border-input h-9 w-full rounded border bg-transparent px-2"
            >
              <option value="CLEAN">Clean</option>
              <option value="ISSUES">Issues</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          {outcome === "ISSUES" && (deal.checklist ?? []).map((item, index) => {
            const key = checklistItemKey({ ...item, kind: item.kind ?? "" })
            return <div key={key}>
              <Label htmlFor={`verify-issue-${index}`}>{key}</Label>
              <Input id={`verify-issue-${index}`} name={`issue-${index}`}
                defaultValue={outstanding.find((issue) => issue.itemKey === key)?.description} />
            </div>
          })}
          {outcome === "RESOLVED" && (
            <ul>{outstanding.map((issue) => <li key={issue.itemKey}>{issue.itemKey} · {issue.description}</li>)}</ul>
          )}
          <div className="space-y-1">
            <Label htmlFor="verify-at">Confirmed at</Label>
            <Input
              id="verify-at"
              name="confirmedAt"
              type="datetime-local"
              required
              defaultValue={localDateTime()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="verify-feedback">Feedback</Label>
            <Textarea id="verify-feedback" name="feedback" required />
          </div>
          <Button type="submit" disabled={pending || uploading || !editable || !checklistHash || (outcome === "RESOLVED" && !outstanding.length)}>
            Verify documents
          </Button>
        </form>
      </div>
      <div className="space-y-1">
        {(deal.verification ?? []).map((v) => (
          <div key={v.id}>
            <p>{v.outcome} · {v.confirmedAt} · {contacts.find((c) => c.id === v.contactId)?.name ?? v.contactId} · {v.feedback}</p>
            <ul>{v.issues?.map((issue) => <li key={issue.itemKey}>{issue.itemKey} · {issue.description}{issue.resolved && " · resolved"}</li>)}</ul>
          </div>
        ))}
      </div>
      {message && <p role="alert">{message}</p>}
    </Panel>
  )
}

function FinancialPanel({
  deal,
  company,
  contacts,
  refresh,
}: {
  deal: Deal
  company?: Company
  contacts: NonNullable<Company["contacts"]>
  refresh: () => Promise<void>
}) {
  const { message, pending, run } = useSubmit(refresh)
  const [quoteId, setQuoteId] = React.useState("")
  const [quote, setQuote] = React.useState<Visible<QuoteDTO> | null>(null)
  return (
    <Panel title="Loan adjustment, quote reselection and company file">
      <div className="space-y-1">
        <p>
          Requested {moneyText(deal.quote?.principal)} · approved{" "}
          {moneyText(deal.approvedLoan)} · quote status {deal.quoteStatus}
        </p>
        <p>
          Selected quote version {deal.quote?.version}. Original quote{" "}
          {deal.originalQuoteId}.
        </p>
      </div>
      {deal.path === "APPLICATION" && (
        <form
          className="space-y-2 border-t pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void run(() =>
              send(
                "adjustLoan",
                {
                  dealId: deal.id,
                  amount: parseMajor(String(data.get("amount"))),
                  contactId: data.get("contactId"),
                  feedback: data.get("feedback"),
                  confirmedAt: new Date(
                    String(data.get("confirmedAt"))
                  ).toISOString(),
                },
                ref(deal, company, true)
              )
            )
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="adjust-amount">Approved loan (major currency)</Label>
            <Input
              id="adjust-amount"
              name="amount"
              inputMode="decimal"
              defaultValue={deal.approvedLoan ? major(BigInt(deal.approvedLoan)) : ""}
              required
            />
          </div>
          <ContactSelect id="adjust-contact" contacts={contacts} />
          <div className="space-y-1">
            <Label htmlFor="adjust-at">Confirmed at</Label>
            <Input
              id="adjust-at"
              name="confirmedAt"
              type="datetime-local"
              required
              defaultValue={localDateTime()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="adjust-feedback">Feedback</Label>
            <Textarea id="adjust-feedback" name="feedback" required />
          </div>
          <Button type="submit" disabled={pending || !deal.nextActions?.includes("adjustLoan")}>
            Record loan adjustment
          </Button>
        </form>
      )}
      <form
        className="space-y-2 border-t pt-2"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void run(() =>
            send(
              "replaceDealQuote",
              {
                dealId: deal.id,
                quoteId,
                reason: data.get("reason"),
                contactId: data.get("contactId"),
                confirmedAt: new Date(String(data.get("confirmedAt"))).toISOString(),
              },
              [
                ...ref(deal, company, true),
                { type: "Quote", id: quoteId, revision: 1 },
              ]
            )
          )
        }}
      >
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="reselect-quote">Replacement quote ID</Label>
            <Input
              id="reselect-quote"
              value={quoteId}
              onChange={(e) => { setQuoteId(e.target.value); setQuote(null) }}
              required
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              try {
                setQuote(
                  await fetchQuery<QuoteDTO>(`/api/v1/queries/quote?id=${quoteId}`)
                )
              } catch {
                setQuote(null)
              }
            }}
          >
            Load
          </Button>
        </div>
        {quote && (
          <p className="text-xs">
            {moneyText(quote.principal)} · max {moneyText(quote.maximum)} ·{" "}
            {quote.policy?.path}
          </p>
        )}
        <ContactSelect id="reselect-contact" contacts={contacts} />
        <div className="space-y-1">
          <Label htmlFor="reselect-reason">Reason</Label>
          <Textarea id="reselect-reason" name="reason" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="reselect-at">Confirmed at</Label>
          <Input
            id="reselect-at"
            name="confirmedAt"
            type="datetime-local"
            required
            defaultValue={localDateTime()}
          />
        </div>
        <Button type="submit" disabled={pending || !deal.nextActions?.includes("replaceDealQuote") || !quote || quote.companyId !== company?.id}>
          Replace selected quote
        </Button>
      </form>
      <form
        className="space-y-2 border-t pt-2"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void run(() =>
            send(
              "setProcessingFee",
              {
                dealId: deal.id,
                amount: parseMajor(String(data.get("fee"))),
                reason: data.get("reason"),
              },
              ref(deal)
            )
          )
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="fee-amount">Processing fee override</Label>
          <Input
            id="fee-amount"
            name="fee"
            inputMode="decimal"
            defaultValue={deal.processingFee ? major(BigInt(deal.processingFee)) : ""}
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fee-reason">Override reason</Label>
          <Textarea id="fee-reason" name="reason" required />
        </div>
        <Button type="submit" disabled={pending || !["INTAKE", "ELIGIBILITY_PENDING"].includes(deal.state ?? "") || deal.path !== "APPLICATION"}>
          Save fee override
        </Button>
      </form>
      {deal.path === "APPLICATION" && (
        <form
          className="space-y-2 border-t pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            void run(() =>
              send(
                "informCompany",
                {
                  dealId: deal.id,
                  contactId: data.get("contactId"),
                  informedAt: new Date(String(data.get("informedAt"))).toISOString(),
                  fileReference: data.get("fileReference"),
                  feedback: data.get("feedback"),
                },
                ref(deal, company)
              )
            )
          }}
        >
          <p>
            File reference: {deal.fileReference ?? "not informed"} · dispatch
            blocked until informed.
          </p>
          <ContactSelect id="inform-contact" contacts={contacts} />
          <div className="space-y-1">
            <Label htmlFor="inform-ref">File reference</Label>
            <Input id="inform-ref" name="fileReference" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inform-at">Informed at</Label>
            <Input
              id="inform-at"
              name="informedAt"
              type="datetime-local"
              required
              defaultValue={localDateTime()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="inform-feedback">Feedback</Label>
            <Textarea id="inform-feedback" name="feedback" required />
          </div>
          <Button type="submit" disabled={pending || deal.state !== "DOCUMENTS_READY"}>
            Inform company
          </Button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </Panel>
  )
}

function FacilityPanel({
  deal,
  refresh,
}: {
  deal: Deal
  refresh: () => Promise<void>
}) {
  const { message, pending, run } = useSubmit(refresh)
  const facility = deal.facility
  const facilityState = (facility as unknown as { state?: string } | undefined)
    ?.state
  const [deductionRows, setDeductionRows] = React.useState(() =>
    facility?.terms?.deductions?.map((_, index) => index) ?? []
  )
  async function requestFacility(event: React.FormEvent) {
    event.preventDefault()
    const data = new FormData(event.currentTarget as HTMLFormElement)
    const terms = () => ({
      gross: parseMajor(String(data.get("gross"))),
      deductions: deductionRows.map((index) => ({
        label: String(data.get(`deductionLabel-${index}`)),
        amount: parseMajor(String(data.get(`deductionAmount-${index}`))),
        recipient: String(data.get(`deductionRecipient-${index}`)),
        handling: String(data.get(`deductionHandling-${index}`)),
      })),
      fee: parseMajor(String(data.get("fee"))),
      feeMode: String(data.get("feeMode")),
      separatelyRecoverableCharges: parseMajor(String(data.get("separatelyRecoverableCharges"))),
    })
    await run(() =>
      send(
        "requestFacility",
        { dealId: deal.id, terms: terms(), reason: data.get("reason") },
        [
          ...ref(deal),
          ...(facility?.id && facility.revision
            ? [
                {
                  type: "CashFacility" as const,
                  id: facility.id,
                  revision: facility.revision,
                },
              ]
            : []),
        ]
      )
    )
  }
  const paidDeductions = (facility?.terms?.deductions ?? []).flatMap((deduction, index) =>
    deduction.handling === "PAID_BY_DEALERSHIP" && deduction.amount !== "0" ? [{ ...deduction, index }] : []
  )
  const canRequest = !["REJECTED", "COMPLETED"].includes(deal.state ?? "") &&
    (!facility || facilityState === "REQUESTED")
  return (
    <Panel title="Cash facility">
      {facility ? (
        <div className="space-y-1">
          <p>
            {facilityState} · gross {moneyText(facility.terms?.gross)} · net{" "}
            {moneyText(facility.net)} · principal outstanding{" "}
            {moneyText(facility.principalOutstanding)} · charges outstanding{" "}
            {moneyText(facility.chargesOutstanding)} · fee outstanding{" "}
            {moneyText(facility.feeOutstanding)}
          </p>
          {(facility.payments ?? []).map((payment) => (
            <p key={payment.id}>
              {payment.direction} {moneyText(payment.amount)} · {payment.category} ·{" "}
              {payment.date}
              {payment.reversalOf ? " · correction" : ""}
            </p>
          ))}
        </div>
      ) : (
        <p>No facility requested. A request never disburses cash.</p>
      )}
      {canRequest && <form
        className="space-y-2 border-t pt-2"
        onSubmit={requestFacility}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fac-gross">Gross</Label>
            <Input
              id="fac-gross"
              name="gross"
              inputMode="decimal"
              defaultValue={deal.approvedLoan ? major(BigInt(deal.approvedLoan)) : ""}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fac-fee">Fee</Label>
            <Input id="fac-fee" name="fee" inputMode="decimal" defaultValue={facility?.terms?.fee ? major(BigInt(facility.terms.fee)) : "0"} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fac-mode">Fee mode</Label>
            <select
              id="fac-mode"
              name="feeMode"
              defaultValue={facility?.terms?.feeMode}
              className="border-input h-9 w-full rounded border bg-transparent px-2"
            >
              <option value="WITHHELD">Withheld</option>
              <option value="SEPARATE">Separate</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fac-charges">Separately recoverable charges</Label>
            <Input
              id="fac-charges"
              name="separatelyRecoverableCharges"
              inputMode="decimal"
              defaultValue={facility?.terms?.separatelyRecoverableCharges ? major(BigInt(facility.terms.separatelyRecoverableCharges)) : "0"}
              required
            />
          </div>
        </div>
        {deductionRows.map((index) => {
          const deduction = facility?.terms?.deductions?.[index]
          return <fieldset className="space-y-2 rounded border p-2" key={index}>
            <legend>Deduction</legend>
            <Input aria-label="Deduction label" name={`deductionLabel-${index}`} defaultValue={deduction?.label} required />
            <Input aria-label="Deduction amount" name={`deductionAmount-${index}`} defaultValue={deduction?.amount ? major(BigInt(deduction.amount)) : ""} inputMode="decimal" required />
            <Input aria-label="Deduction recipient" name={`deductionRecipient-${index}`} defaultValue={deduction?.recipient} required />
            <select aria-label="Deduction handling" name={`deductionHandling-${index}`} defaultValue={deduction?.handling}>
              <option value="WITHHELD">Withheld</option>
              <option value="PAID_BY_DEALERSHIP">Paid by dealership</option>
            </select>
            <Button type="button" variant="outline" onClick={() => setDeductionRows((rows) => rows.filter((key) => key !== index))}>Remove deduction</Button>
          </fieldset>
        })}
        <Button type="button" variant="outline" disabled={deductionRows.length >= 50}
          onClick={() => setDeductionRows((rows) => [...rows, Math.max(-1, ...rows, (facility?.terms?.deductions?.length ?? 0) - 1) + 1])}>
          Add deduction
        </Button>
        <div className="space-y-1">
          <Label htmlFor="fac-reason">Reason</Label>
          <Textarea id="fac-reason" name="reason" required />
        </div>
        <Button type="submit" disabled={pending}>
          {facility ? "Update requested facility" : "Request facility"}
        </Button>
      </form>}
      {facilityState === "REQUESTED" && (
        <form
          className="space-y-2 border-t pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const cash = (amount: string, suffix = "") => ({
              amount,
              date: data.get(`date${suffix}`),
              method: data.get(`method${suffix}`),
              ...(data.get(`reference${suffix}`) ? { reference: data.get(`reference${suffix}`) } : {}),
            })
            void run(() =>
              send(
                "disburseFacility",
                {
                  dealId: deal.id,
                  payment: facility?.net === "0" ? null : cash(parseMajor(String(data.get("netAmount")))),
                  separatelyPaidDeductions: paidDeductions.map(({ index, amount }) => ({
                    index, payment: cash(amount!, `-${index}`),
                  })),
                },
                [
                  ...ref(deal),
                  {
                    type: "CashFacility",
                    id: facility!.id!,
                    revision: facility!.revision!,
                  },
                ]
              )
            )
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="disb-net">Net payout (actual)</Label>
              <Input
                id="disb-net"
                name="netAmount"
                inputMode="decimal"
                defaultValue={facility?.net ? major(BigInt(facility.net)) : "0.00"}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="disb-date">Actual payout date</Label>
              <Input
                id="disb-date"
                name="date"
                type="date"
                required
                defaultValue={localDateTime().slice(0, 10)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="disb-method">Method</Label>
              <select
                id="disb-method"
                name="method"
                className="border-input h-9 w-full rounded border bg-transparent px-2"
              >
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="disb-ref">Reference</Label>
              <Input id="disb-ref" name="reference" />
            </div>
          </div>
          {paidDeductions.map(({ index, label, recipient, amount }) => (
            <fieldset key={index} className="space-y-2 rounded border p-2">
              <legend>{label} · {recipient} · {moneyText(amount)}</legend>
              <Input aria-label="Deduction payment date" name={`date-${index}`} type="date" required defaultValue={localDateTime().slice(0, 10)} />
              <select aria-label="Deduction payment method" name={`method-${index}`}>
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
              <Input aria-label="Deduction payment reference" name={`reference-${index}`} />
            </fieldset>
          ))}
          <Button type="submit" disabled={pending || !deal.nextActions?.includes("disburseFacility")}>
            Disburse facility
          </Button>
        </form>
      )}
      {["DISBURSED", "PARTIAL"].includes(facilityState ?? "") && (
        <form
          className="space-y-2 border-t pt-2"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const principal = String(data.get("principal") ?? "")
            const charge = String(data.get("charge") ?? "")
            const fee = String(data.get("fee") ?? "")
            const cash = (value: string) =>
              value
                ? {
                    amount: parseMajor(value),
                    date: data.get("date"),
                    method: data.get("method"),
                    ...(data.get("reference")
                      ? { reference: data.get("reference") }
                      : {}),
                  }
                : null
            void run(() =>
              send(
                "recoverFacility",
                {
                  dealId: deal.id,
                  principal: cash(principal),
                  chargeRecovery: cash(charge),
                  fee: cash(fee),
                },
                [
                  ...ref(deal),
                  {
                    type: "CashFacility",
                    id: facility!.id!,
                    revision: facility!.revision!,
                  },
                ]
              )
            )
          }}
        >
          <p>Recovery may continue after rejection; debt is never erased.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="rec-principal">Principal</Label>
              <Input id="rec-principal" name="principal" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-charge">Charges</Label>
              <Input id="rec-charge" name="charge" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-fee">Fee</Label>
              <Input id="rec-fee" name="fee" inputMode="decimal" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-date">Actual date</Label>
              <Input
                id="rec-date"
                name="date"
                type="date"
                required
                defaultValue={localDateTime().slice(0, 10)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-method">Method</Label>
              <select
                id="rec-method"
                name="method"
                className="border-input h-9 w-full rounded border bg-transparent px-2"
              >
                <option value="BANK_TRANSFER">Bank transfer</option>
                <option value="CASH">Cash</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="rec-ref">Reference</Label>
              <Input id="rec-ref" name="reference" />
            </div>
          </div>
          <Button type="submit" disabled={pending}>
            Record recovery
          </Button>
        </form>
      )}
      <form
        className="space-y-2 border-t pt-2"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          void run(() =>
            send(
              "recordBrokerageFee",
              {
                dealId: deal.id,
                category: data.get("category"),
                payment: {
                  amount: parseMajor(String(data.get("amount"))),
                  date: data.get("date"),
                  method: data.get("method"),
                  ...(data.get("reference")
                    ? { reference: data.get("reference") }
                    : {}),
                },
              },
              ref(deal)
            )
          )
        }}
      >
        <p>Actual fee receipt (never inferred by setting the fee).</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="fee-category">Category</Label>
            <select
              id="fee-category"
              name="category"
              className="border-input h-9 w-full rounded border bg-transparent px-2"
            >
              <option value="PROCESSING">Processing</option>
              <option value="ADDITIONAL">Additional</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fee-cash">Actual amount</Label>
            <Input id="fee-cash" name="amount" inputMode="decimal" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fee-date">Actual date</Label>
            <Input
              id="fee-date"
              name="date"
              type="date"
              required
              defaultValue={localDateTime().slice(0, 10)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fee-method">Method</Label>
            <select
              id="fee-method"
              name="method"
              className="border-input h-9 w-full rounded border bg-transparent px-2"
            >
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
            </select>
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          Record fee receipt
        </Button>
      </form>
      {message && <p role="alert">{message}</p>}
    </Panel>
  )
}

function IssuesPanel({
  deal,
  company,
  contacts,
  refresh,
}: {
  deal: Deal
  company?: Company
  contacts: NonNullable<Company["contacts"]>
  refresh: () => Promise<void>
}) {
  const { message, pending, run } = useSubmit(refresh)
  return (
    <Panel title="Issues, inquiries and non-remittance">
      <ul className="space-y-2">
        {(deal.issues ?? []).map((issue) => (
          <li key={issue.id} className="rounded border p-2">
            <p>
              {issue.kind} · {issue.at} · {issue.text}
              {issue.blocksStep ? ` · blocks ${issue.blocksStep}` : ""}
              {issue.resolvedAt ? " · resolved" : ""}
            </p>
            {(issue.feedback ?? []).map((feedback, index) => (
              <p key={index} className="pl-2 text-xs">
                {feedback.at} · {feedback.text}
              </p>
            ))}
            {!issue.resolvedAt && issue.id && (
              <form
                className="mt-2 space-y-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  const data = new FormData(event.currentTarget)
                  void run(() =>
                    send(
                      "recordIssueFeedback",
                      {
                        issueId: issue.id,
                        contactId: data.get("contactId"),
                        at: new Date(String(data.get("at"))).toISOString(),
                        feedback: data.get("feedback"),
                        resolve: data.get("resolve") === "on",
                      },
                      ref(deal, company)
                    )
                  )
                }}
              >
                <ContactSelect id={`issue-contact-${issue.id}`} contacts={contacts} />
                <Input
                  aria-label="Feedback at"
                  name="at"
                  type="datetime-local"
                  required
                  defaultValue={localDateTime()}
                />
                <Textarea aria-label="Feedback" name="feedback" required />
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" name="resolve" /> resolve
                </label>
                <Button type="submit" size="sm" disabled={pending}>
                  Record feedback
                </Button>
              </form>
            )}
          </li>
        ))}
        {!deal.issues?.length && <li>No issues recorded.</li>}
      </ul>
      <form
        className="space-y-2 border-t pt-2"
        onSubmit={(event) => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          const kind = String(data.get("kind"))
          void run(() =>
            send(
              "openIssue",
              {
                dealId: deal.id,
                kind,
                text: data.get("text"),
                at: new Date(String(data.get("at"))).toISOString(),
                ...(kind === "BLOCKER"
                  ? { blocksStep: data.get("blocksStep") }
                  : {}),
              },
              ref(deal)
            )
          )
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="issue-kind">Issue kind</Label>
          <select
            id="issue-kind"
            name="kind"
            className="border-input h-9 w-full rounded border bg-transparent px-2"
          >
            <option value="BLOCKER">Blocker</option>
            <option value="DELAY_INQUIRY">Delay inquiry</option>
            {deal.path === "REFERRAL" && (
              <option value="NON_REMITTANCE">Non-remittance</option>
            )}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="issue-block">Blocked step (blockers)</Label>
          <select
            id="issue-block"
            name="blocksStep"
            className="border-input h-9 w-full rounded border bg-transparent px-2"
          >
            {deal.path === "APPLICATION" && <option value="DISPATCH">Dispatch</option>}
            <option value="COMPLETE">Complete</option>
          </select>
        </div>
        <Textarea aria-label="Issue text" name="text" required />
        <Input
          aria-label="Opened at"
          name="at"
          type="datetime-local"
          required
          defaultValue={localDateTime()}
        />
        <Button type="submit" disabled={pending || deal.state === "COMPLETED"}>
          Open issue
        </Button>
      </form>
      {message && <p role="alert">{message}</p>}
    </Panel>
  )
}

function TimelinePanel({ deal }: { deal: Deal }) {
  return (
    <Panel title="Persisted history and deal actions">
      <ul className="space-y-1">
        {(deal.events ?? []).map((event, index) => (
          <li key={index}>
            {event.at} · {event.kind} · {event.text}
          </li>
        ))}
        {!deal.events?.length && <li>No deal events yet.</li>}
      </ul>
      <div className="space-y-1">
        <p>Next actions: {(deal.nextActions ?? []).join(", ") || "none"}</p>
        <p>
          Guarantors:{" "}
          {(deal.guarantors ?? [])
            .map((g) => `${g.name} (${g.identity})`)
            .join(", ") || "none"}
        </p>
      </div>
      <DealClosure deal={deal} />
    </Panel>
  )
}

function DealClosure({ deal }: { deal: Deal }) {
  const queries = useQueryClient()
  const [message, setMessage] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const party = useQuery({
    queryKey: ["brokerage", "company", deal.companyId],
    enabled: !!deal.companyId,
    queryFn: () =>
      fetchQuery<Company>(
        `/api/v1/queries/party?type=FINANCE_COMPANY&id=${deal!.companyId}`
      ),
  })
  const contacts = party.data?.contacts ?? []
  async function run(name: "rejectDeal" | "completeBrokerage", data: FormData) {
    setPending(true)
    setMessage("")
    try {
      await send(
        name,
        {
          dealId: deal.id,
          contactId: data.get("contactId"),
          at: new Date(String(data.get("at"))).toISOString(),
          ...(name === "rejectDeal"
            ? { reason: data.get("text") }
            : { feedback: data.get("text") }),
        },
        ref(deal, party.data)
      )
      await queries.invalidateQueries({ queryKey: ["brokerage"] })
    } catch (error) {
      setMessage(problem(error))
    } finally {
      setPending(false)
    }
  }
  return (
    <div className="space-y-2 border-t pt-2">
      <form
        className="space-y-1"
        onSubmit={(event) => {
          event.preventDefault()
          void run("rejectDeal", new FormData(event.currentTarget as HTMLFormElement))
        }}
      >
        <p className="text-xs">Reject deal (preserves any disbursed facility debt)</p>
        <ContactSelect id="reject-contact" contacts={contacts} />
        <Input aria-label="Rejected at" name="at" type="datetime-local" required />
        <Textarea aria-label="Rejection reason" name="text" required />
        <Button type="submit" variant="destructive" disabled={pending || !deal.nextActions?.includes("rejectDeal")}>
          Reject deal
        </Button>
      </form>
      <form
        className="space-y-1"
        onSubmit={(event) => {
          event.preventDefault()
          void run("completeBrokerage", new FormData(event.currentTarget as HTMLFormElement))
        }}
      >
        <p className="text-xs">Complete after dispatch or referral</p>
        <ContactSelect id="complete-contact" contacts={contacts} />
        <Input aria-label="Completed at" name="at" type="datetime-local" required />
        <Textarea aria-label="Completion feedback" name="text" required />
        <Button type="submit" disabled={pending || !deal.nextActions?.includes("completeBrokerage")}>
          Complete brokerage
        </Button>
      </form>
      {message && <p role="alert">{message}</p>}
    </div>
  )
}

// ── Dispatch ────────────────────────────────────────────────────────────────
export function BrokerageDispatch() {
  const [pageParam, setPage] = useQueryState("page", parseAsInteger.withDefault(1))
  const page = Math.max(1, pageParam)
  return <DispatchPage key={page} page={page} changePage={(next) => void setPage(next)} />
}

function DispatchPage({ page, changePage }: { page: number; changePage: (page: number) => void }) {
  const queries = useQueryClient()
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const canDispatch = ["sourceIds", "handedOverAt", "courier"].every((field) => ability.can("create", "DispatchBatch", field)) &&
    ability.can("dispatch", "BrokerageDeal", "dealId")
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [message, setMessage] = React.useState("")
  const [pending, setPending] = React.useState(false)
  const list = useQuery({
    queryKey: ["brokerage", "dispatch-list", page],
    queryFn: () =>
      fetchQuery<{ data: Deal[]; total: number }>(
        `/api/v1/queries/brokerage?page=${page}&pageSize=50&status=DOCUMENTS_READY`
      ),
  })
  const deals = list.data?.data ?? []
  const previews = useQuery({
    queryKey: ["brokerage", "dispatch-previews", deals.map((d) => d.id).join(",")],
    enabled: deals.length > 0,
    queryFn: async () => {
      const response = await privateRequest<{
        data: {
          id: string
          revision: number
          checklistHash: string
          ready: boolean
          blockers: { code: string; field: string; message: string }[]
        }[]
      }>("/api/v1/queries/dispatchPreview", {
        method: "POST",
        headers: { "content-type": "application/json", Origin: location.origin },
        body: JSON.stringify({
          sourceIds: deals.map((d) => ({ type: "BROKERAGE", id: d.id })),
        }),
      })
      return new Map(response.data.map((row) => [row.id, row]))
    },
  })
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const data = new FormData(event.currentTarget as HTMLFormElement)
    const members = [...selected].flatMap((id) => {
      const preview = previews.data?.get(id)
      if (!preview?.ready) return []
      return [{ type: "BROKERAGE" as const, id, revision: preview.revision, checklistHash: preview.checklistHash }]
    })
    if (members.length !== selected.size) {
      setMessage("Review the batch again. A selected deal is no longer ready.")
      setSelected(new Set())
      return
    }
    if (!members.length) {
      setMessage("Select at least one ready deal")
      return
    }
    setPending(true)
    setMessage("")
    try {
      await send(
        "dispatchBatch",
        {
          sourceIds: members,
          handedOverAt: new Date(String(data.get("handedOverAt"))).toISOString(),
          courier: data.get("courier"),
          ...(data.get("tracking") ? { tracking: data.get("tracking") } : {}),
        },
        members.map((m) => ({
          type: "BrokerageDeal" as const,
          id: m.id,
          revision: m.revision,
        }))
      )
      await queries.invalidateQueries({ queryKey: ["brokerage"] })
      setSelected(new Set())
    } catch (error) {
      setMessage(problem(error))
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Daily lease dispatch</h1>
        <p className="text-muted-foreground text-sm">
          Atomic 1–50 member manifest. Any incomplete member rejects the entire
          batch with zero writes.
        </p>
      </div>
      {list.isLoading ? (
        <p>Loading ready deals…</p>
      ) : list.error ? (
        <p role="alert">{problem(list.error)}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Select</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>File reference</TableHead>
              <TableHead>Ready</TableHead>
              <TableHead>Blockers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.map((deal) => {
              const preview = previews.data?.get(deal.id ?? "")
              return (
                <TableRow key={deal.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`Select ${deal.id}`}
                      disabled={!canDispatch || !preview?.ready}
                      checked={selected.has(deal.id ?? "")}
                      onChange={(e) =>
                        setSelected((set) => {
                          const next = new Set(set)
                          if (e.target.checked) next.add(deal.id!)
                          else next.delete(deal.id!)
                          return next
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {deal.vehicle?.make} {deal.vehicle?.model}
                  </TableCell>
                  <TableCell>{deal.fileReference ?? "missing"}</TableCell>
                  <TableCell>{preview?.ready ? "ready" : "blocked"}</TableCell>
                  <TableCell>
                    {(preview?.blockers ?? [])
                      .map((b) => `${b.code}:${b.field}`)
                      .join(", ") || "—"}
                  </TableCell>
                </TableRow>
              )
            })}
            {!deals.length && (
              <TableRow>
                <TableCell colSpan={5}>No documents-ready deals.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      {previews.error && <p role="alert">{problem(previews.error)}</p>}
      {(page > 1 || (list.data?.total ?? 0) > 50) && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" disabled={page === 1 || pending}
            onClick={() => changePage(page - 1)}>Previous</Button>
          <span>Page {page}</span>
          <Button type="button" variant="outline" disabled={page * 50 >= (list.data?.total ?? 0) || pending}
            onClick={() => changePage(page + 1)}>Next</Button>
        </div>
      )}
      {canDispatch && <form className="space-y-2" onSubmit={submit}>
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="dispatch-at">Handed over at</Label>
            <Input
              id="dispatch-at"
              name="handedOverAt"
              type="datetime-local"
              required
              defaultValue={localDateTime()}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dispatch-courier">Courier</Label>
            <Input id="dispatch-courier" name="courier" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="dispatch-tracking">Tracking</Label>
            <Input id="dispatch-tracking" name="tracking" />
          </div>
        </div>
        <Button type="submit" disabled={pending || !selected.size}>
          Dispatch selected deals
        </Button>
        {message && <p role="alert">{message}</p>}
      </form>}
    </section>
  )
}
