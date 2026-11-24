"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  CustomerDTO,
  Dependency,
  Pending,
  PurchaseCycleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { privateRequest, RequestError } from "@/lib/security-client"
import { parseMajor, major } from "@/lib/money"
import {
  customerEnvelope,
  commitmentEnvelope,
  saleEnvelope,
  approvalEnvelope,
} from "@/lib/server/validators"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

import { currentSettingsRef, FinanceCompanyField, FinancePaymentFields, useCurrencyLabel, type CompanyOption } from "./commitment-fields"

type VisibleCycle = Visible<PurchaseCycleDTO>

type VisibleCustomer = Visible<CustomerDTO>

export function RecordSaleDialog({
  fixedCycle,
  onCompleted,
  open: controlledOpen,
  onOpenChange,
}: {
  fixedCycle?: VisibleCycle
  onCompleted?: (result: Applied | Pending) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const queries = useQueryClient()
  const currency = useCurrencyLabel()
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const canCreate = (action: string) => {
    if (fixedCycle) return fixedCycle.nextActions?.includes(action as never)
    const fields = ["cycleId", "customerId", "price",
      ...(action === "completeImmediate" ? ["kind", "date", "mileage", "method"] : [action])]
    return ability.can("read", "PurchaseRecord", "status") &&
      ability.can("read", "Customer", "id") &&
      fields.every((field) => ability.can("create", "SaleCase", field))
  }
  const canRecord = canCreate("completeImmediate") || canCreate("placeReservation") || canCreate("startFinance")
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next
    if (onOpenChange) onOpenChange(resolved)
    else setUncontrolledOpen(resolved)
  }
  const [cycleId, setCycleId] = useState(fixedCycle?.id ?? "")
  const [customerSearch, setCustomerSearch] = useState("")
  const [buyer, setBuyer] = useState<VisibleCustomer>()
  const [kind, setKind] = useState(canCreate("completeImmediate") ? "CASH" : canCreate("placeReservation") ? "ADVANCE" : "LEASE")
  const [company, setCompany] = useState<CompanyOption>()
  const immediate = kind === "CASH" || kind === "TRADE_IN"
  const command = kind === "ADVANCE" ? "placeReservation" : kind === "LEASE" ? "startFinance" : "completeImmediate"
  const actionLabel = kind === "ADVANCE" ? "Place advance" : kind === "LEASE" ? "Start lease sale" : "Complete Immediate Sale"
  const [price, setPrice] = useState("")
  const [date, setDate] = useState("")
  const [mileage, setMileage] = useState("")
  const [method, setMethod] = useState<"CASH" | "BANK_TRANSFER">("BANK_TRANSFER")
  const [reference, setReference] = useState("")
  const [reason, setReason] = useState("")

  // Trade-in fields
  const [tradeDesc, setTradeDesc] = useState("")
  const [tradeValue, setTradeValue] = useState("")
  const [includeIntake, setIncludeIntake] = useState(false)
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
  const [intakeMileage, setIntakeMileage] = useState({
    reading: "0",
    date: "",
    remark: "",
    decreaseReason: "",
  })
  const [intakeListed, setIntakeListed] = useState("")

  // Inline customer creation state (preserves all sale inputs!)
  const [inlineCustomerOpen, setInlineCustomerOpen] = useState(false)
  const [inlineCustDraft, setInlineCustDraft] = useState({
    fullName: "",
    callingName: "",
    nicOrPassport: "",
    address: "",
    phone: "",
    email: "",
  })
  const [inlineCustBody, setInlineCustBody] = useState<string | null>(null)
  const [inlineCustPending, setInlineCustPending] = useState(false)
  const [inlineCustErr, setInlineCustErr] = useState("")

  // Retained sale / discount envelope state
  const [body, setBody] = useState<string | null>(null)
  const [discountMode, setDiscountMode] = useState(false)
  const [discountReason, setDiscountReason] = useState("")
  const [discountBody, setDiscountBody] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [stale, setStale] = useState(false)
  const [statusMsg, setStatusMsg] = useState("")
  const [approvalLink, setApprovalLink] = useState<string | null>(null)
  const [saleLink, setSaleLink] = useState<string | null>(null)

  const stockQuery = useQuery({
    queryKey: ["sales", "available-stock"],
    enabled: canRecord && open && !fixedCycle,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: VisibleCycle[] } }>(
        `/api/v1/queries/purchases?statuses=${encodeURIComponent(JSON.stringify(["IN_STOCK"]))}&page=1&pageSize=100`
      ),
  })
  const customersQuery = useQuery({
    queryKey: ["sales", "customers-select", customerSearch.trim()],
    enabled: canRecord && open,
    retry: false,
    queryFn: ({ signal }) =>
      privateRequest<{ data: { data: VisibleCustomer[] } }>(
        `/api/v1/queries/customers?page=1&pageSize=100&q=${encodeURIComponent(customerSearch.trim())}`,
        { signal }
      ),
  })

  const availableCycles = fixedCycle
    ? [fixedCycle]
    : (stockQuery.data?.data.data ?? []).filter((c) => c.available !== false)
  const selectedCycle =
    fixedCycle ?? availableCycles.find((c) => c.id === cycleId)
  const customers = (customersQuery.data?.data.data ?? []).filter(
    (c) => c.active !== false
  )
  const selectedCustomer =
    customers.find((c) => c.id === buyer?.id) ?? buyer
  const customerOptions =
    buyer && !customers.some((c) => c.id === buyer.id)
      ? [buyer, ...customers]
      : customers

  async function submitInlineCustomer() {
    if (inlineCustPending) return
    setInlineCustPending(true)
    setInlineCustErr("")
    try {
      let payload = inlineCustBody
      if (!payload) {
        const parsed = customerEnvelope("createCustomer").safeParse({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected: [],
          input: {
            fullName: inlineCustDraft.fullName,
            callingName: inlineCustDraft.callingName,
            nicOrPassport: inlineCustDraft.nicOrPassport,
            address: inlineCustDraft.address,
            phone: inlineCustDraft.phone,
            ...(inlineCustDraft.email.trim()
              ? { email: inlineCustDraft.email.trim() }
              : {}),
          },
        })
        if (!parsed.success)
          throw Error("Valid customer details (name, NIC/passport, address, phone) required")
        payload = JSON.stringify(parsed.data)
        setInlineCustBody(payload)
      }
      const res = await privateRequest<Applied>(
        "/api/v1/commands/createCustomer",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }
      )
      const { data: customer } = await privateRequest<{ data: VisibleCustomer }>(
        `/api/v1/queries/customer?id=${encodeURIComponent(res.result.id)}`
      )
      setInlineCustBody(null)
      setBuyer(customer)
      await queries.invalidateQueries({ queryKey: ["sales", "customers-select"] })
      await queries.invalidateQueries({ queryKey: ["customers"] })
      setInlineCustomerOpen(false)
      setInlineCustDraft({
        fullName: "",
        callingName: "",
        nicOrPassport: "",
        address: "",
        phone: "",
        email: "",
      })
    } catch (e) {
      const code = e instanceof RequestError ? e.code : e instanceof Error ? e.message : "ERROR"
      if (e instanceof RequestError && e.status < 500 && code !== "IDEMPOTENCY_MISMATCH")
        setInlineCustBody(null)
      setInlineCustErr(code)
    } finally {
      setInlineCustPending(false)
    }
  }

  async function buildSaleEnvelope(form?: FormData) {
    if (!selectedCycle?.id || !selectedCycle.revision)
      throw Error("Select an available IN_STOCK purchase cycle")
    if (!selectedCustomer?.id || !selectedCustomer.revision || selectedCustomer.active === false)
      throw Error("Select an active customer")
    const priceMinor = parseMajor(price)
    const expected: Dependency[] = [
      {
        type: "PurchaseRecord",
        id: selectedCycle.id,
        revision: selectedCycle.revision,
      },
      {
        type: "Customer",
        id: selectedCustomer.id,
        revision: selectedCustomer.revision,
      },
    ]
    if (!immediate) {
      expected.push(await currentSettingsRef())
      const base = { cycleId: selectedCycle.id, customerId: selectedCustomer.id, price: priceMinor,
        reference: reference.trim() || undefined, reason: reason.trim() || undefined }
      const payment = { date, method, reference: reference.trim() || undefined }
      const input = kind === "ADVANCE"
        ? { ...base, receipt: { ...payment, amount: parseMajor(String(form?.get("advance") ?? "")) } }
        : (() => {
          if (!company) throw Error("Select a finance company")
          expected.push({ type: "FinanceCompany", id: company.id, revision: company.revision })
          const down = parseMajor(String(form?.get("downPayment") ?? ""))
          return { ...base, downPayment: { ...payment, amount: down }, companyId: company.id,
            termMonths: Number(form?.get("termMonths")), financeAmount: (BigInt(priceMinor) - BigInt(down)).toString() }
        })()
      return commitmentEnvelope(command === "placeReservation" ? command : "startFinance").parse({
        schemaVersion: 1, idempotencyKey: crypto.randomUUID(), expected, input,
      })
    }
    let tradeInPayload: Record<string, unknown> | undefined
    if (kind === "TRADE_IN") {
      const valMinor = parseMajor(tradeValue)
      let intakeObj: Record<string, unknown> | undefined
      if (includeIntake) {
        const identity = await privateRequest<{
          data: { id: string; revision: number } | null
        }>(
          `/api/v1/queries/vehicleIdentity?engineNumber=${encodeURIComponent(intakeVehicle.engineNumber)}&chassisNumber=${encodeURIComponent(intakeVehicle.chassisNumber)}`
        )
        if (identity.data) {
          expected.push({
            type: "Vehicle",
            id: identity.data.id,
            revision: identity.data.revision,
          })
        }
        intakeObj = {
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
            reading: Number(intakeMileage.reading),
            date: intakeMileage.date || date,
            ...(intakeMileage.remark.trim()
              ? { remark: intakeMileage.remark.trim() }
              : {}),
            ...(intakeMileage.decreaseReason.trim()
              ? { decreaseReason: intakeMileage.decreaseReason.trim() }
              : {}),
          },
          ...(intakeListed.trim() ? { listedPrice: parseMajor(intakeListed) } : {}),
        }
      }
      tradeInPayload = {
        description: tradeDesc,
        value: valMinor,
        ...(intakeObj ? { intake: intakeObj } : {}),
      }
    }
    const parsed = saleEnvelope("completeImmediate").safeParse({
      schemaVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      expected,
      input: {
        cycleId: selectedCycle.id,
        customerId: selectedCustomer.id,
        kind,
        price: priceMinor,
        date,
        mileage: Number(mileage),
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(tradeInPayload ? { tradeIn: tradeInPayload } : {}),
      },
    })
    if (!parsed.success)
      throw Error(
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      )
    return parsed.data
  }

  async function submitSale(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending || stale) return
    const form = new FormData(e.currentTarget)
    setPending(true)
    setStatusMsg("")
    setSaleLink(null)
    setApprovalLink(null)
    try {
      let submitted = body
      if (!submitted) {
        const env = await buildSaleEnvelope(form)
        submitted = JSON.stringify(env)
        setBody(submitted)
      }
      const res = await privateRequest<Applied>(
        `/api/v1/commands/${command}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: submitted,
        }
      )
      setBody(null)
      setSaleLink(`/sales/${res.result.id}`)
      setStatusMsg(immediate ? `Immediate sale completed (${res.commandId}).` : kind === "ADVANCE" ? "Advance placed. Open the sale for conversion and cancellation options." : "Down payment recorded. Open the sale to upload the delivery order.")
      for (const k of res.invalidate)
        void queries.invalidateQueries({ queryKey: [k] })
      onCompleted?.(res)
    } catch (err) {
      const code =
        err instanceof RequestError
          ? err.code
          : err instanceof Error
            ? err.message
            : "ERROR"
      if (code === "APPROVAL_REQUIRED") {
        setDiscountMode(true)
        setBody(null)
        setStatusMsg(
          "Price is below listed price. Enter a discount reason and submit for manager approval."
        )
      } else {
        const isStale = ["STALE_REVISION", "REVISION_REQUIRED", "IDENTITY_CONFLICT"].includes(code)
        setStale(isStale)
        if (err instanceof RequestError && err.status < 500 && !isStale && code !== "IDEMPOTENCY_MISMATCH")
          setBody(null)
        setStatusMsg(code)
      }
    } finally {
      setPending(false)
    }
  }

  async function submitDiscountApproval(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending || stale) return
    const form = new FormData(e.currentTarget)
    setPending(true)
    setStatusMsg("")
    try {
      let submitted = discountBody
      if (!submitted) {
        const base = await buildSaleEnvelope(form)
        const env = approvalEnvelope("requestApproval").parse({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected: base.expected,
          input: {
            proposal: {
              kind: "DISCOUNT",
              command: { name: command, input: base.input },
            },
            reason: discountReason,
          },
        })
        submitted = JSON.stringify(env)
        setDiscountBody(submitted)
      }
      const res = await privateRequest<Pending>(
        "/api/v1/commands/requestApproval",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: submitted,
        }
      )
      setDiscountBody(null)
      setDiscountMode(false)
      setApprovalLink(`/approvals/${res.approvalId}`)
      setStatusMsg(`Discount approval requested (${res.approvalId}).`)
      void queries.invalidateQueries({ queryKey: ["approvals"] })
      onCompleted?.(res)
    } catch (err) {
      const code =
        err instanceof RequestError
          ? err.code
          : err instanceof Error
            ? err.message
            : "ERROR"
      setStatusMsg(code)
      if (err instanceof RequestError && err.status < 500 && code !== "IDEMPOTENCY_MISMATCH")
        setDiscountBody(null)
    } finally {
      setPending(false)
    }
  }

  let netPreview = ""
  try {
    if (price) {
      const p = BigInt(parseMajor(price))
      const t = kind === "TRADE_IN" && tradeValue ? BigInt(parseMajor(tradeValue)) : 0n
      netPreview = major(p - t)
    }
  } catch {
    netPreview = ""
  }

  if (!canRecord) return null
  return (
    <div className="space-y-4">
      <Button type="button" onClick={() => setOpen((v) => !v)}>
        {open ? "Close sale form" : canCreate("completeImmediate") ? "Complete Immediate Sale" : "New reservation or lease sale"}
      </Button>
      {open && (
        <form
          onSubmit={discountMode ? submitDiscountApproval : submitSale}
          className="space-y-4 rounded-lg border p-4"
        >
          <h2 className="text-lg font-semibold">{actionLabel}</h2>

          {!fixedCycle && (
            <div className="space-y-1">
              <Label htmlFor="sale-cycle">Available Stock Cycle</Label>
              <select
                id="sale-cycle"
                className="h-11 w-full rounded-md border bg-background px-3"
                value={cycleId}
                onChange={(e) => setCycleId(e.target.value)}
                required
              >
                <option value="">Select IN_STOCK available vehicle…</option>
                {availableCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.identity?.make} {c.identity?.model} ({c.identity?.year}) · Listed{" "}
                    {c.listedPrice ? major(BigInt(c.listedPrice)) : "None"}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sale-customer-search">Search customers</Label>
            <Input
              id="sale-customer-search"
              type="search"
              maxLength={200}
              placeholder="Name, NIC or passport, or phone"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
            />
            {customersQuery.isError && <p role="status">Customer search is unavailable.</p>}
            {customersQuery.isSuccess && customers.length === 0 && (
              <p role="status">No matching active customers.</p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="sale-customer">Buyer Customer</Label>
              {ability.can("create", "Customer") && <Button
                type="button"
                variant="outline"
                onClick={() => setInlineCustomerOpen((v) => !v)}
              >
                {inlineCustomerOpen ? "Cancel inline customer" : "New customer inline"}
              </Button>}
            </div>
            <select
              id="sale-customer"
              className="h-11 w-full rounded-md border bg-background px-3"
              value={buyer?.id ?? ""}
              onChange={(e) => setBuyer(customerOptions.find((c) => c.id === e.target.value))}
              required
            >
              <option value="">Select active customer…</option>
              {customerOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.fullName} ({c.nicOrPassport})
                </option>
              ))}
            </select>

            {ability.can("create", "Customer") && inlineCustomerOpen && (
              <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                <h3 className="text-sm font-medium">Create Customer Inline</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Full name *"
                    value={inlineCustDraft.fullName}
                    onChange={(e) =>
                      setInlineCustDraft({ ...inlineCustDraft, fullName: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Calling name *"
                    value={inlineCustDraft.callingName}
                    onChange={(e) =>
                      setInlineCustDraft({ ...inlineCustDraft, callingName: e.target.value })
                    }
                  />
                  <Input
                    placeholder="NIC or Passport *"
                    value={inlineCustDraft.nicOrPassport}
                    onChange={(e) =>
                      setInlineCustDraft({
                        ...inlineCustDraft,
                        nicOrPassport: e.target.value,
                      })
                    }
                  />
                  <Input
                    placeholder="Phone *"
                    value={inlineCustDraft.phone}
                    onChange={(e) =>
                      setInlineCustDraft({ ...inlineCustDraft, phone: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Address *"
                    value={inlineCustDraft.address}
                    onChange={(e) =>
                      setInlineCustDraft({ ...inlineCustDraft, address: e.target.value })
                    }
                  />
                  <Input
                    placeholder="Email"
                    value={inlineCustDraft.email}
                    onChange={(e) =>
                      setInlineCustDraft({ ...inlineCustDraft, email: e.target.value })
                    }
                  />
                </div>
                {inlineCustErr && <p role="alert" className="text-sm">{inlineCustErr}</p>}
                <Button
                  type="button"
                  disabled={inlineCustPending}
                  onClick={() => void submitInlineCustomer()}
                >
                  {inlineCustPending ? "Creating customer…" : "Save Customer & Select"}
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="sale-kind">Sale Kind</Label>
              <select
                id="sale-kind"
                className="h-11 w-full rounded-md border bg-background px-3"
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value)
                  setBody(null)
                  setDiscountMode(false)
                }}
              >
                {canCreate("completeImmediate") && <option value="CASH">CASH</option>}
                {canCreate("completeImmediate") && <option value="TRADE_IN">TRADE_IN</option>}
                {canCreate("placeReservation") && <option value="ADVANCE">Advance reservation</option>}
                {canCreate("startFinance") && <option value="LEASE">Inventory lease</option>}
              </select>
            </div>
            <div>
              <Label htmlFor="sale-price">Agreed Sale Price (Major)</Label>
              <Input
                id="sale-price"
                required
                placeholder="e.g. 5000000"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value)
                  setDiscountMode(false)
                }}
              />
            </div>
            <div>
              <Label htmlFor="sale-date">{immediate ? "Sale / Handover Date" : "Payment date"}</Label>
              <Input
                id="sale-date"
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            {immediate && <div>
              <Label htmlFor="sale-mileage">Handover Mileage (km)</Label>
              <Input
                id="sale-mileage"
                type="number"
                min={0}
                required
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
              />
            </div>}
            <div>
              <Label htmlFor="sale-method">Receipt Method</Label>
              <select
                id="sale-method"
                className="h-11 w-full rounded-md border bg-background px-3"
                value={method}
                onChange={(e) =>
                  setMethod(e.target.value as "CASH" | "BANK_TRANSFER")
                }
              >
                <option value="BANK_TRANSFER">BANK_TRANSFER</option>
                <option value="CASH">CASH</option>
              </select>
            </div>
            <div>
              <Label htmlFor="sale-ref">Reference</Label>
              <Input
                id="sale-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          {kind === "ADVANCE" && <Label className="grid gap-2">Advance amount{currency}<Input name="advance" inputMode="decimal" required /></Label>}
          {kind === "LEASE" && <div className="grid gap-3 sm:grid-cols-3">
            <FinanceCompanyField value={company?.id ?? ""} onChange={setCompany} />
            <FinancePaymentFields />
          </div>}
          {kind === "TRADE_IN" && (
            <div className="space-y-3 rounded-md border p-3">
              <h3 className="font-medium">Trade-In Consideration</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  required
                  placeholder="Trade-in vehicle description *"
                  value={tradeDesc}
                  onChange={(e) => setTradeDesc(e.target.value)}
                />
                <Input
                  required
                  placeholder="Trade-in valuation (Major) *"
                  value={tradeValue}
                  onChange={(e) => setTradeValue(e.target.value)}
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeIntake}
                  onChange={(e) => setIncludeIntake(e.target.checked)}
                />
                Intake trade-in vehicle into inventory now (optional)
              </label>
              {includeIntake && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    required
                    placeholder="Engine number *"
                    value={intakeVehicle.engineNumber}
                    onChange={(e) =>
                      setIntakeVehicle({
                        ...intakeVehicle,
                        engineNumber: e.target.value,
                      })
                    }
                  />
                  <Input
                    required
                    placeholder="Chassis number *"
                    value={intakeVehicle.chassisNumber}
                    onChange={(e) =>
                      setIntakeVehicle({
                        ...intakeVehicle,
                        chassisNumber: e.target.value,
                      })
                    }
                  />
                  <Input
                    required
                    placeholder="Make *"
                    value={intakeVehicle.make}
                    onChange={(e) =>
                      setIntakeVehicle({ ...intakeVehicle, make: e.target.value })
                    }
                  />
                  <Input
                    required
                    placeholder="Model *"
                    value={intakeVehicle.model}
                    onChange={(e) =>
                      setIntakeVehicle({ ...intakeVehicle, model: e.target.value })
                    }
                  />
                  <Input
                    required
                    type="number"
                    placeholder="Year *"
                    value={intakeVehicle.year}
                    onChange={(e) =>
                      setIntakeVehicle({ ...intakeVehicle, year: e.target.value })
                    }
                  />
                  <Input
                    required
                    placeholder="Colour *"
                    value={intakeVehicle.colour}
                    onChange={(e) =>
                      setIntakeVehicle({
                        ...intakeVehicle,
                        colour: e.target.value,
                      })
                    }
                  />
                  <Input
                    type="number"
                    min={0}
                    required
                    placeholder="Odometer reading *"
                    value={intakeMileage.reading}
                    onChange={(e) =>
                      setIntakeMileage({
                        ...intakeMileage,
                        reading: e.target.value,
                      })
                    }
                  />
                  <Input
                    placeholder="Listed price (optional)"
                    value={intakeListed}
                    onChange={(e) => setIntakeListed(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {immediate && netPreview && (
            <p className="text-sm text-muted-foreground">
              Net cash receipt due: <strong>{netPreview}</strong>
              {selectedCycle?.listedPrice !== undefined &&
                ` · Listed price: ${major(BigInt(selectedCycle.listedPrice))}`}
            </p>
          )}

          <div>
            <Label htmlFor="sale-reason">Sale Notes / Reason (optional)</Label>
            <Textarea
              id="sale-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {discountMode && (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
              <Label htmlFor="discount-reason">
                Below-Listed Discount Approval Reason *
              </Label>
              <Textarea
                id="discount-reason"
                required
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
              />
            </div>
          )}

          {statusMsg && <p role="status" className="text-sm">{statusMsg}</p>}
          {(approvalLink || discountMode) && (
            <p
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              {approvalLink
                ? "Pending manager approval."
                : "Manager approval is required before recording the sale and payment."}
            </p>
          )}
          {saleLink && (
            <Link prefetch={false} className="inline-block underline" href={saleLink}>
              {immediate ? "Open completed sale detail" : "Open sale and next steps"}
            </Link>
          )}
          {approvalLink && (
            <Link prefetch={false} className="inline-block underline" href={approvalLink}>
              Open pending approval request
            </Link>
          )}

          <div className="flex gap-2">
            {stale && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setStale(false)
                  setBody(null)
                  setDiscountBody(null)
                  void queries.invalidateQueries({ queryKey: ["sales"] })
                  void queries.invalidateQueries({ queryKey: ["purchases"] })
                }}
              >
                Reload latest revisions
              </Button>
            )}
            <Button type="submit" disabled={pending || stale}>
              {pending
                ? "Submitting…"
                : discountMode
                  ? "Request Discount Approval"
                  : actionLabel}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
