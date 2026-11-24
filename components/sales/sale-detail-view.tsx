"use client"
import { ImportedBadge } from "@/components/imports/imported-badge"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  AuditDTO,
  CustomerDTO,
  Dependency,
  Pending,
  PurchaseCycleDTO,
  SaleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { approvalEnvelope, saleEnvelope } from "@/lib/server/validators"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SaleInvoices } from "./sale-invoices"
import { Textarea } from "@/components/ui/textarea"

import { CommitmentActions } from "./commitment-actions"

type VisibleSale = Visible<SaleDTO>
type VisibleCycle = Visible<PurchaseCycleDTO>
type VisibleCustomer = Visible<CustomerDTO>

export function SaleDetailView({ id }: { id: string }) {
  const queries = useQueryClient()
  const saleQuery = useQuery({
    queryKey: ["sales", "detail", id],
    retry: false,
    queryFn: () =>
      privateRequest<{ data: VisibleSale }>(
        `/api/v1/queries/sale?id=${encodeURIComponent(id)}`
      ),
  })
  const sale = saleQuery.data?.data
  const saleId = sale?.id
  const heading = useRef<HTMLHeadingElement>(null)
  const focusedSale = useRef<string | null>(null)

  useEffect(() => {
    if (!saleId || focusedSale.current === saleId || !heading.current) return
    heading.current.focus()
    focusedSale.current = saleId
  }, [saleId])

  const cycleQuery = useQuery({
    queryKey: ["purchases", "detail", sale?.cycleId],
    enabled: !!sale?.cycleId,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: VisibleCycle }>(
        `/api/v1/queries/purchase?cycleId=${encodeURIComponent(sale!.cycleId!)}`
      ),
  })
  const cycle = cycleQuery.data?.data

  const customerQuery = useQuery({
    queryKey: ["customers", "detail", sale?.customerId],
    enabled: !!sale?.customerId,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: VisibleCustomer }>(
        `/api/v1/queries/customer?id=${encodeURIComponent(sale!.customerId!)}`
      ),
  })
  const customer = customerQuery.data?.data

  const auditQuery = useQuery({
    queryKey: ["sales", "audit", id],
    enabled: !!sale?.id,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: Visible<AuditDTO>[] } }>(
        `/api/v1/queries/audit?type=SaleCase&id=${encodeURIComponent(id)}&page=1&pageSize=20`
      ),
  })

  // Standalone intakeTradeIn form state
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeVehicle, setIntakeVehicle] = useState({
    engineNumber: "",
    chassisNumber: "",
    make: "",
    model: "",
    year: String(new Date().getFullYear()),
    colour: "",
    fuelType: "PETROL",
    transmission: "AUTOMATIC",
    vin: "",
    crNumber: "",
    notes: "",
  })
  const [intakeReading, setIntakeReading] = useState("0")
  const [intakeListed, setIntakeListed] = useState("")
  const [intakeMsg, setIntakeMsg] = useState("")
  const [intakePending, setIntakePending] = useState(false)
  const [intakeBody, setIntakeBody] = useState<string | null>(null)

  // Request SALE_EDIT form state
  const [editOpen, setEditOpen] = useState(false)
  const [editReason, setEditReason] = useState("")
  const [editPrice, setEditPrice] = useState("")
  const [editRef, setEditRef] = useState("")
  const [editDate, setEditDate] = useState("")
  const [editMileage, setEditMileage] = useState("")
  const [editTradeDesc, setEditTradeDesc] = useState("")
  const [editTradeVal, setEditTradeVal] = useState("")
  const [editMsg, setEditMsg] = useState("")
  const [editApprovalId, setEditApprovalId] = useState<string | null>(null)
  const [editPending, setEditPending] = useState(false)
  const [editBody, setEditBody] = useState<string | null>(null)

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault()
    if (!sale?.id || !sale.revision || !cycle?.id || !cycle.revision || intakePending)
      return
    setIntakePending(true)
    setIntakeMsg("")
    try {
      let submitted = intakeBody
      if (!submitted) {
        const identity = await privateRequest<{
          data: { id: string; revision: number } | null
        }>(
          `/api/v1/queries/vehicleIdentity?engineNumber=${encodeURIComponent(intakeVehicle.engineNumber)}&chassisNumber=${encodeURIComponent(intakeVehicle.chassisNumber)}`
        )
        const expected: Dependency[] = [
          { type: "SaleCase", id: sale.id, revision: sale.revision },
          { type: "PurchaseRecord", id: cycle.id, revision: cycle.revision },
          ...(identity.data
            ? [{ type: "Vehicle" as const, id: identity.data.id, revision: identity.data.revision }]
            : []),
        ]
        const env = saleEnvelope("intakeTradeIn").parse({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected,
          input: {
            saleId: sale.id,
            vehicle: {
              engineNumber: intakeVehicle.engineNumber,
              chassisNumber: intakeVehicle.chassisNumber,
              make: intakeVehicle.make,
              model: intakeVehicle.model,
              year: Number(intakeVehicle.year),
              colour: intakeVehicle.colour,
              fuelType: intakeVehicle.fuelType,
              transmission: intakeVehicle.transmission,
              ...(intakeVehicle.vin.trim() ? { vin: intakeVehicle.vin.trim() } : {}),
              ...(intakeVehicle.crNumber.trim()
                ? { crNumber: intakeVehicle.crNumber.trim() }
                : {}),
              ...(intakeVehicle.notes.trim()
                ? { notes: intakeVehicle.notes.trim() }
                : {}),
            },
            mileage: {
              reading: Number(intakeReading),
              date: sale.completion?.date ?? "",
            },
            ...(intakeListed.trim() ? { listedPrice: parseMajor(intakeListed) } : {}),
          },
        })
        submitted = JSON.stringify(env)
        setIntakeBody(submitted)
      }
      const res = await privateRequest<Applied>("/api/v1/commands/intakeTradeIn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: submitted,
      })
      setIntakeBody(null)
      setIntakeMsg(`Trade-in intake completed (${res.commandId}).`)
      setIntakeOpen(false)
      for (const k of res.invalidate)
        void queries.invalidateQueries({ queryKey: [k] })
    } catch (err) {
      const code =
        err instanceof RequestError
          ? err.code
          : err instanceof Error
            ? err.message
            : "ERROR"
      if (
        err instanceof RequestError &&
        err.status < 500 &&
        code !== "IDEMPOTENCY_MISMATCH"
      )
        setIntakeBody(null)
      setIntakeMsg(code)
    } finally {
      setIntakePending(false)
    }
  }

  async function submitSaleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!sale?.id || !sale.revision || !cycle?.id || !cycle.revision || editPending)
      return
    setEditPending(true)
    setEditMsg("")
    setEditApprovalId(null)
    try {
      let submitted = editBody
      if (!submitted) {
      const expected: Dependency[] = [
        { type: "SaleCase", id: sale.id, revision: sale.revision },
        { type: "PurchaseRecord", id: cycle.id, revision: cycle.revision },
      ]
      if (sale.tradeIn?.acquiredCycleId && editTradeVal.trim()) {
        const acq = await privateRequest<{ data: VisibleCycle }>(
          `/api/v1/queries/purchase?cycleId=${encodeURIComponent(sale.tradeIn.acquiredCycleId)}`
        )
        if (!acq.data.id || !acq.data.revision) throw Error("Acquired trade-in revision unavailable")
        expected.push({ type: "PurchaseRecord", id: acq.data.id, revision: acq.data.revision })
        if (acq.data.vehicleId && acq.data.identityRevision)
          expected.push({
            type: "Vehicle",
            id: acq.data.vehicleId,
            revision: acq.data.identityRevision,
          })
      }
      const patch: Record<string, unknown> = {}
      if (editPrice.trim()) patch.price = parseMajor(editPrice)
      if (editRef.trim()) patch.reference = editRef.trim()
      if (editDate.trim()) patch.saleDate = editDate.trim()
      if (editMileage.trim()) patch.handoverMileage = Number(editMileage)
      if (sale.kind === "TRADE_IN" && (editTradeDesc.trim() || editTradeVal.trim())) {
        patch.tradeIn = {
          description: editTradeDesc.trim() || sale.tradeIn?.description || "",
          value: editTradeVal.trim() ? parseMajor(editTradeVal) : sale.tradeIn?.value,
        }
      }
      if (!sale.price) throw Error("Current agreed price is unavailable.")
      const oldPrice = BigInt(sale.price)
      const oldTrade =
        sale.kind === "TRADE_IN" && sale.tradeIn?.value
          ? BigInt(sale.tradeIn.value)
          : 0n
      const newPrice = patch.price ? BigInt(patch.price as string) : oldPrice
      const newTrade = patch.tradeIn
        ? BigInt((patch.tradeIn as { value: string }).value)
        : oldTrade
      const cashCorrections: {
        paymentId: string
        reason: string
        replacement?: {
          amount: string
          date: string
          method: "CASH" | "BANK_TRANSFER"
          reference?: string
        }
      }[] = []
      if (newPrice - newTrade !== oldPrice - oldTrade) {
        const receipts = sale.payments ?? []
        const category = sale.kind === "LEASE" ? "DOWN_PAYMENT" : sale.kind === "ADVANCE" ? "BALANCE" : "SALE"
        const openReceipts = receipts.filter(
          (p) =>
            p.category === category &&
            p.direction === "IN" &&
            !p.reversalOf &&
            !receipts.some((r) => r.reversalOf === p.id)
        )
        const original = openReceipts[0]
        if (openReceipts.length !== 1 || !original?.id || !original.amount || !original.date || !original.method)
          throw Error("A single unreversed receipt is required for this amount correction.")
        const amount = BigInt(original.amount) + (newPrice - newTrade) - (oldPrice - oldTrade)
        if (amount < 0n || (sale.finance && amount === 0n))
          throw Error("The corrected price must cover the existing advance credit and lender terms.")
        if (sale.finance) {
          const { companyId, principal, termMonths, doAttachmentId, issueDate } = sale.finance
          if (!companyId || !principal || !termMonths || !doAttachmentId || !issueDate)
            throw Error("The original finance terms are unavailable.")
          patch.finance = {
            companyId, financeAmount: principal, downPayment: amount.toString(), termMonths,
            doAttachmentId, doIssueDate: issueDate,
          }
        }
        cashCorrections.push({
          paymentId: original.id,
          reason: editReason,
          ...(amount ? { replacement: {
            amount: amount.toString(),
            date: original.date,
            method: original.method,
            ...(original.reference ? { reference: original.reference } : {}),
          } } : {}),
        })
      }
      const env = approvalEnvelope("requestApproval").parse({
        schemaVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        expected,
        input: {
          proposal: {
            kind: "SALE_EDIT",
            operation: "EDIT_COMPLETION",
            input: {
              saleId: sale.id,
              reason: editReason,
              patch,
              cashCorrections,
            },
          },
          reason: editReason,
        },
      })
      submitted = JSON.stringify(env)
      setEditBody(submitted)
      }
      const res = await privateRequest<Pending>("/api/v1/commands/requestApproval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: submitted,
      })
      setEditBody(null)
      setEditApprovalId(res.approvalId)
      setEditMsg(`Sale edit approval requested (${res.approvalId}).`)
      void queries.invalidateQueries({ queryKey: ["approvals"] })
    } catch (err) {
      const code =
        err instanceof RequestError
          ? err.code
          : err instanceof Error
            ? err.message
            : "ERROR"
      if (
        err instanceof RequestError &&
        err.status < 500 &&
        code !== "IDEMPOTENCY_MISMATCH"
      )
        setEditBody(null)
      setEditMsg(code)
    } finally {
      setEditPending(false)
    }
  }

  if (saleQuery.isPending) return <p role="status">Loading sale detail…</p>
  if (saleQuery.isError || !sale)
    return <p role="alert">Sale unavailable.</p>

  const moneyStr = (v?: string) => (v === undefined ? "Unavailable" : major(BigInt(v)))

  return (
    <section className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 ref={heading} tabIndex={-1} className="min-w-0 break-words text-2xl font-semibold">
          Sale {sale.id}
        </h1>
        <ImportedBadge provenance={sale.provenance} />
        <Link prefetch={false} className="underline" href="/sales">
          Back to sales
        </Link>
      </div>

      <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Kind / State</dt>
          <dd>{sale.kind ?? "Unavailable"} · {sale.state ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Agreed Price</dt>
          <dd>{moneyStr(sale.price)}</dd>
        </div>
        {sale.reference && (
          <div>
            <dt className="text-xs text-muted-foreground">Third-party Reference</dt>
            <dd className="break-words">{sale.reference}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-muted-foreground">Revision</dt>
          <dd>{sale.revision ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Handover Date / Mileage</dt>
          <dd>
            {sale.completion?.date ?? "Unavailable"} ·{" "}
            {sale.completion?.mileage !== undefined ? `${sale.completion.mileage} km` : "Unavailable"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Customer</dt>
          <dd>
            {sale.customerId ? (
              <Link prefetch={false} className="underline" href={`/customers/${sale.customerId}`}>
                {customer?.fullName ?? sale.customerId}
              </Link>
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Source Cycle</dt>
          <dd>
            {sale.cycleId ? (
              <Link prefetch={false} className="underline" href={`/purchases/${sale.cycleId}`}>
                Purchase cycle {sale.cycleId}
              </Link>
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
      </dl>

      <CommitmentActions sale={sale} cycle={cycle} customer={customer} />

      {cycle?.financial && (
        <div className="rounded-lg border p-4 text-sm space-y-1">
          <h2 className="font-semibold">Cycle Financial Summary</h2>
          <p>
            Original Basis: {moneyStr(cycle.financial.originalBasis)} · Current Basis:{" "}
            {moneyStr(cycle.financial.basis)} · Original Profit:{" "}
            {moneyStr(cycle.financial.originalProfit)} · Restated Profit:{" "}
            {moneyStr(cycle.financial.restatedProfit)}
          </p>
        </div>
      )}

      {sale.tradeIn && (
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <h2 className="font-semibold">Trade-In Consideration</h2>
          <p>
            {sale.tradeIn.description ?? "Unavailable"} · Value: {moneyStr(sale.tradeIn.value)}
          </p>
          {sale.tradeIn.acquiredCycleId ? (
            <Link
              prefetch={false}
              className="underline"
              href={`/purchases/${sale.tradeIn.acquiredCycleId}`}
            >
              Acquired trade-in inventory cycle: {sale.tradeIn.acquiredCycleId}
            </Link>
          ) : (
            sale.nextActions?.includes("intakeTradeIn") && (
              <div>
                <Button type="button" onClick={() => setIntakeOpen((v) => !v)}>
                  {intakeOpen ? "Cancel Trade-In Intake" : "Intake Trade-In Vehicle"}
                </Button>
              </div>
            )
          )}
        </div>
      )}

      {intakeOpen && (
        <form onSubmit={submitIntake} className="space-y-3 rounded-lg border p-4">
          <h3 className="font-semibold">Intake Trade-In Vehicle</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Input required placeholder="Engine number *" value={intakeVehicle.engineNumber} onChange={(e) => setIntakeVehicle({ ...intakeVehicle, engineNumber: e.target.value })} />
            <Input required placeholder="Chassis number *" value={intakeVehicle.chassisNumber} onChange={(e) => setIntakeVehicle({ ...intakeVehicle, chassisNumber: e.target.value })} />
            <Input required placeholder="Make *" value={intakeVehicle.make} onChange={(e) => setIntakeVehicle({ ...intakeVehicle, make: e.target.value })} />
            <Input required placeholder="Model *" value={intakeVehicle.model} onChange={(e) => setIntakeVehicle({ ...intakeVehicle, model: e.target.value })} />
            <Input required type="number" placeholder="Year *" value={intakeVehicle.year} onChange={(e) => setIntakeVehicle({ ...intakeVehicle, year: e.target.value })} />
            <Input required placeholder="Colour *" value={intakeVehicle.colour} onChange={(e) => setIntakeVehicle({ ...intakeVehicle, colour: e.target.value })} />
            <Input required type="number" min={0} placeholder="Odometer *" value={intakeReading} onChange={(e) => setIntakeReading(e.target.value)} />
            <Input placeholder="Listed price (optional)" value={intakeListed} onChange={(e) => setIntakeListed(e.target.value)} />
          </div>
          {intakeMsg && <p role="status" className="text-sm">{intakeMsg}</p>}
          <Button type="submit" disabled={intakePending}>
            {intakePending ? "Acquiring…" : "Confirm Trade-In Intake"}
          </Button>
        </form>
      )}

      <div className="rounded-lg border p-4 space-y-2 text-sm">
        <h2 className="font-semibold">Completion</h2>
        {sale.completion ? (
          <p>
            Completed {sale.completion.date ?? "Unavailable"} · handover{" "}
            {sale.completion.mileage ?? "Unavailable"} km · basis{" "}
            {sale.completion.basisVersionId ?? "Unavailable"}
          </p>
        ) : (
          <p>Completion unavailable</p>
        )}
        <h3 className="font-semibold">Timeline</h3>
        {sale.timeline?.length ? (
          <ol className="space-y-1">
            {sale.timeline.map((event, index) => (
              <li key={`${event.at}:${event.action}:${index}`}>
                {event.at} · {event.action} · {event.actorName}
              </li>
            ))}
          </ol>
        ) : (
          <p>Timeline unavailable</p>
        )}
      </div>

      <div className="rounded-lg border p-4 space-y-2 text-sm">
        <h2 className="font-semibold">Receipts</h2>
        {sale.payments === undefined ? (
          <p>Receipts unavailable</p>
        ) : sale.payments.length === 0 ? (
          <p>No cash receipts recorded (even trade-in value).</p>
        ) : (
          <ul className="space-y-1">
            {sale.payments.map((p) => (
              <li key={p.id}>
                {p.direction} {moneyStr(p.amount)} · {p.date} · {p.method}
                {p.reference ? ` · ${p.reference}` : ""}
                {p.reversalOf ? ` (Reverses ${p.reversalOf})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <SaleInvoices sale={sale} cycleRevision={cycle?.revision} />

      {sale.state === "COMPLETED" && sale.nextActions?.includes("requestApproval") && (
        <div className="space-y-3 rounded-lg border p-4">
          <Button type="button" variant="outline" onClick={() => setEditOpen((v) => !v)}>
            {editOpen ? "Close Sale Edit Request" : "Request Sale Edit Approval"}
          </Button>
          {editOpen && (
            <form onSubmit={submitSaleEdit} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="edit-price">New Agreed Price (Major, optional)</Label>
                  <Input id="edit-price" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                  {sale.finance && <p className="text-sm text-muted-foreground">A price correction adjusts the customer down payment. The original lender principal is preserved.</p>}
                </div>
                <div>
                  <Label htmlFor="edit-ref">New Reference (optional)</Label>
                  <Input id="edit-ref" value={editRef} onChange={(e) => setEditRef(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="edit-date">New Sale Date (optional)</Label>
                  <Input id="edit-date" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="edit-mileage">New Handover Mileage (optional)</Label>
                  <Input id="edit-mileage" type="number" min={0} value={editMileage} onChange={(e) => setEditMileage(e.target.value)} />
                </div>
                {sale.kind === "TRADE_IN" && (
                  <>
                    <div>
                      <Label htmlFor="edit-trade-desc">Trade-In Description</Label>
                      <Input id="edit-trade-desc" value={editTradeDesc} onChange={(e) => setEditTradeDesc(e.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor="edit-trade-val">Trade-In Value (Major)</Label>
                      <Input id="edit-trade-val" value={editTradeVal} onChange={(e) => setEditTradeVal(e.target.value)} />
                    </div>
                  </>
                )}
              </div>
              <div>
                <Label htmlFor="edit-reason">Edit Approval Reason *</Label>
                <Textarea id="edit-reason" required value={editReason} onChange={(e) => setEditReason(e.target.value)} />
              </div>
              {editMsg && <p role="status" className="text-sm">{editMsg}</p>}
              {editApprovalId && (
                <Link prefetch={false} className="underline text-sm" href={`/approvals/${editApprovalId}`}>
                  Open sale edit approval request
                </Link>
              )}
              <Button type="submit" disabled={editPending}>
                {editPending ? "Requesting…" : "Submit Sale Edit Approval"}
              </Button>
            </form>
          )}
        </div>
      )}

      {auditQuery.data && (
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <h2 className="font-semibold">Sale Audit History</h2>
          {auditQuery.data.data.data.map((entry, idx) => (
            <p key={entry.id ?? idx}>
              {entry.action} · {entry.at} {entry.reason ? `· ${entry.reason}` : ""}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
