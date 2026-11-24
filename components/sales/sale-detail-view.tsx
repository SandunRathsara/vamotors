"use client"

import { useState } from "react"
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
import { Textarea } from "@/components/ui/textarea"

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

  async function submitIntake(e: React.FormEvent) {
    e.preventDefault()
    if (!sale?.id || !sale.revision || !cycle?.id || !cycle.revision || intakePending)
      return
    setIntakePending(true)
    setIntakeMsg("")
    try {
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
      const res = await privateRequest<Applied>("/api/v1/commands/intakeTradeIn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(env),
      })
      setIntakeMsg(`Trade-in intake completed (${res.commandId}).`)
      setIntakeOpen(false)
      for (const k of res.invalidate)
        void queries.invalidateQueries({ queryKey: [k] })
    } catch (err) {
      setIntakeMsg(
        err instanceof RequestError ? err.code : err instanceof Error ? err.message : "ERROR"
      )
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
              cashCorrections: [],
            },
          },
          reason: editReason,
        },
      })
      const res = await privateRequest<Pending>("/api/v1/commands/requestApproval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(env),
      })
      setEditApprovalId(res.approvalId)
      setEditMsg(`Sale edit approval requested (${res.approvalId}).`)
      void queries.invalidateQueries({ queryKey: ["approvals"] })
    } catch (err) {
      setEditMsg(
        err instanceof RequestError ? err.code : err instanceof Error ? err.message : "ERROR"
      )
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
        <h1 className="text-2xl font-semibold">Sale {sale.id}</h1>
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

      {sale.nextActions?.includes("requestApproval") && (
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
