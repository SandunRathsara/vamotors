"use client"

import { useRef, useState, type FormEvent } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  CashInput,
  CustomerDTO,
  Dependency,
  Pending,
  PurchaseCycleDTO,
  SaleDTO,
  UploadReady,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { major, parseMajor } from "@/lib/money"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  currentSettingsRef,
  FinanceCompanyField,
  FinancePaymentFields,
  type CompanyOption,
} from "./commitment-fields"

const actions = {
  convertReservation: "Complete cash conversion",
  startFinance: "Convert to lease sale",
  cancelRetained: "Cancel and retain advance",
  requestApproval: "Request refund approval",
  recordDO: "Record delivery order",
  confirmDOAndHandover: "Confirm handover",
  recordLenderReceipt: "Record lender receipt",
} as const
type Action = keyof typeof actions

const money = (value?: string) =>
  value === undefined ? "Unavailable" : major(BigInt(value))
const colomboToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(
    new Date()
  )

function send<T>(name: string, body: string) {
  return privateRequest<T>(`/api/v1/commands/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  })
}
const envelope = (input: unknown, expected: Dependency[]) =>
  JSON.stringify({
    schemaVersion: 1,
    idempotencyKey: crypto.randomUUID(),
    expected,
    input,
  })

export function CommitmentActions({
  sale,
  cycle,
  customer,
}: {
  sale: Visible<SaleDTO>
  cycle?: Visible<PurchaseCycleDTO>
  customer?: Visible<CustomerDTO>
}) {
  const queryClient = useQueryClient()
  const [active, setActive] = useState<Action>()
  const [company, setCompany] = useState<CompanyOption>()
  const [hold, setHold] = useState(false)
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState("")
  const [approval, setApproval] = useState("")
  const [linkedDO, setLinkedDO] = useState<string>()
  const retry = useRef<{ action: Action; body: string }>(null)
  const uploadRetry = useRef<{
    file: File
    init: string
    ready?: UploadReady
    completion?: string
    uploaded?: boolean
  }>(null)
  const reservation = sale.reservation,
    lease = sale.finance
  const reserved = sale.state === "RESERVED" || sale.state === "EXPIRED"
  const pendingFinance =
    sale.state === "FINANCE_PENDING" || sale.state === "DO_RECEIVED"
  const refundable = reserved || pendingFinance
  const next = (Object.keys(actions) as Action[]).filter(
    (name) =>
      sale.nextActions?.includes(name) &&
      (name !== "requestApproval" || refundable)
  )
  const advance = BigInt(reservation?.amount ?? "0")
  const remaining = BigInt(sale.price ?? "0") - advance
  const refundCredit = advance + BigInt(lease?.down ?? "0")
  const contractVisible =
    sale.id &&
    sale.revision &&
    cycle?.id &&
    cycle.revision &&
    sale.price &&
    (!reserved ||
      (reservation?.id && reservation.revision && reservation.amount))
  const refDate = colomboToday()

  async function upload(file: File, saleRef: Dependency) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!uploadRetry.current || uploadRetry.current.file !== file) {
      const digest = await crypto.subtle.digest("SHA-256", bytes)
      const sha256 = Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, "0")
      ).join("")
      uploadRetry.current = {
        file,
        init: envelope(
          {
            target: { type: "SALE_CASE", id: sale.id },
            purpose: "DO",
            filename: file.name,
            contentType: file.type,
            size: file.size,
            sha256,
          },
          [saleRef]
        ),
      }
    }
    const transfer = uploadRetry.current
    const ready = (transfer.ready ??= await send<UploadReady>(
      "initUpload",
      transfer.init
    ))
    if (!transfer.uploaded) {
      const stored = await fetch(ready.putUrl, {
        method: "PUT",
        headers: ready.requiredHeaders,
        body: bytes,
        credentials: "same-origin",
      })
      if (!stored.ok)
        throw new RequestError("DELIVERY_ORDER_UPLOAD_FAILED", stored.status)
      transfer.uploaded = true
    }
    transfer.completion ??= envelope({ uploadId: ready.uploadId }, [
      saleRef,
      { type: "UploadIntent", id: ready.uploadId, revision: ready.revision },
    ])
    return (await send<Applied>("completeUpload", transfer.completion)).result
      .id
  }

  async function submit(event: FormEvent<HTMLFormElement>, action: Action) {
    event.preventDefault()
    if (pending || !sale.id || !sale.revision || !cycle?.id || !cycle.revision)
      return
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const payment = (amount: string): CashInput => ({
      amount,
      date: text("date"),
      method: text("method") === "CASH" ? "CASH" : "BANK_TRANSFER",
      ...(text("reference") ? { reference: text("reference") } : {}),
    })
    const saleRef: Dependency = {
      type: "SaleCase",
      id: sale.id,
      revision: sale.revision,
    }
    const expected: Dependency[] = [
      saleRef,
      { type: "PurchaseRecord", id: cycle.id, revision: cycle.revision },
    ]
    if (reservation?.id && reservation.revision)
      expected.push({
        type: "Reservation",
        id: reservation.id,
        revision: reservation.revision,
      })
    setPending(true)
    setProblem("")
    try {
      let body =
        retry.current?.action === action ? retry.current.body : undefined
      if (!body) {
        const handover = {
          date: text("date"),
          mileage: Number(text("mileage")),
        }
        const disposition = hold
          ? { kind: "HOLD", reason: text("holdReason") }
          : { kind: "RELEASE" }
        const reason = text("reason")
        const reservationId = reservation?.id
        let input: unknown
        switch (action) {
          case "convertReservation":
            input = {
              reservationId,
              ...handover,
              balance: remaining === 0n ? null : payment(remaining.toString()),
            }
            break
          case "startFinance": {
            if (!customer?.id || !customer.revision || !company)
              throw Error("Select an active finance company")
            const down = payment(parseMajor(text("downPayment")))
            expected.push(
              await currentSettingsRef(),
              {
                type: "Customer",
                id: customer.id,
                revision: customer.revision,
              },
              {
                type: "FinanceCompany",
                id: company.id,
                revision: company.revision,
              }
            )
            input = {
              reservationId,
              cycleId: cycle.id,
              customerId: customer.id,
              price: sale.price,
              companyId: company.id,
              financeAmount: (remaining - BigInt(down.amount)).toString(),
              termMonths: Number(text("termMonths")),
              downPayment: down,
              reference: text("reference") || undefined,
            }
            break
          }
          case "cancelRetained":
            input = {
              reservationId,
              disposition,
              reason,
              retainedAmount: advance.toString(),
            }
            break
          case "requestApproval": {
            const amount = parseMajor(text("refundAmount"))
            input = {
              reason,
              proposal: {
                kind: "REFUND",
                input: {
                  ...(reserved ? { reservationId } : { saleCaseId: sale.id }),
                  disposition,
                  reason,
                  refund: payment(amount),
                  retainedAmount: (refundCredit - BigInt(amount)).toString(),
                },
              },
            }
            break
          }
          case "recordDO": {
            const file = form.get("deliveryOrder")
            const attachmentId =
              linkedDO ??
              (file instanceof File && file.size > 0
                ? await upload(file, saleRef)
                : undefined)
            if (!attachmentId) throw Error("Choose the delivery order file")
            setLinkedDO(attachmentId)
            input = {
              saleCaseId: sale.id,
              attachmentId,
              issueDate: text("date"),
            }
            break
          }
          case "confirmDOAndHandover":
            input = { saleCaseId: sale.id, ...handover }
            break
          case "recordLenderReceipt":
            input = {
              saleCaseId: sale.id,
              payment: payment(parseMajor(text("lenderAmount"))),
            }
            break
        }
        body = envelope(input, expected)
        retry.current = { action, body }
      }
      const response = await send<Applied | Pending>(action, body)
      if (response.status === "PENDING_APPROVAL") {
        setApproval(response.approvalId)
        void queryClient.invalidateQueries({ queryKey: ["approvals"] })
      } else
        for (const key of response.invalidate)
          void queryClient.invalidateQueries({ queryKey: [key] })
      retry.current = null
      uploadRetry.current = null
      setLinkedDO(undefined)
      setActive(undefined)
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.status < 500 &&
        error.code !== "COMMAND_IN_PROGRESS"
      ) {
        retry.current = null
        if (
          error.code === "STALE_REVISION" ||
          error.code === "UPLOAD_EXPIRED"
        ) {
          uploadRetry.current = null
          setLinkedDO(undefined)
          void queryClient.invalidateQueries({ queryKey: ["sales"] })
          void queryClient.invalidateQueries({ queryKey: ["purchases"] })
        }
      }
      setProblem(error instanceof Error ? error.message : "Sale action failed")
    } finally {
      setPending(false)
    }
  }

  async function downloadOrder(attachmentId: string) {
    try {
      const { data } = await privateRequest<{ data: { url: string } }>(
        `/api/v1/queries/download?attachmentId=${encodeURIComponent(attachmentId)}`
      )
      window.location.assign(data.url)
    } catch (error) {
      setProblem(
        error instanceof Error ? error.message : "Delivery order unavailable"
      )
    }
  }

  if (!reservation && !lease) return null

  return (
    <section className="space-y-4 rounded-lg border p-4">
      {reservation && (
        <div className="space-y-1">
          <h2 className="font-semibold">Advance reservation</h2>
          <p>
            Advance {money(reservation.amount)} · {reservation.percentDisplay}{" "}
            of listed price · Valid through {reservation.validThrough}
          </p>
          <p>
            {reservation.effectiveStatus?.replaceAll("_", " ")}
            {reservation.expiryFlagPending ? " · expiry flag pending" : ""}
          </p>
          {reservation.retainedAmount && (
            <p>Retained amount {money(reservation.retainedAmount)}</p>
          )}
        </div>
      )}
      {lease && (
        <div className="space-y-1">
          <h2 className="font-semibold">Inventory lease</h2>
          <p>
            {lease.companyName} · {lease.termMonths} months
          </p>
          <p>
            Down payment {money(lease.down)} · Finance {money(lease.principal)}{" "}
            · Lender outstanding {money(lease.lenderOutstanding)}
          </p>
          {lease.doAttachmentId && (
            <Button
              type="button"
              variant="link"
              onClick={() => void downloadOrder(lease.doAttachmentId!)}
            >
              Download delivery order
              {lease.issueDate ? ` issued ${lease.issueDate}` : ""}
            </Button>
          )}
        </div>
      )}
      {contractVisible && next.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-medium">Next steps</h3>
          <div className="flex flex-wrap gap-2">
            {next.map((action) => (
              <Button
                key={action}
                type="button"
                variant={active === action ? "default" : "outline"}
                disabled={pending}
                onClick={() => {
                  setActive(action)
                  setProblem("")
                }}
              >
                {actions[action]}
              </Button>
            ))}
          </div>
          {active && next.includes(active) && (
            <form
              key={active}
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => void submit(event, active)}
            >
              {active === "startFinance" && (
                <>
                  <FinanceCompanyField
                    value={company?.id ?? ""}
                    onChange={setCompany}
                  />
                  <FinancePaymentFields />
                  <p className="self-end pb-2">
                    Balance before down payment {money(remaining.toString())}
                  </p>
                </>
              )}
              {active === "recordDO" && (
                <Label className="grid gap-2">
                  Delivery order file
                  <Input
                    type="file"
                    name="deliveryOrder"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    required={!linkedDO}
                    onChange={() => {
                      uploadRetry.current = null
                      retry.current = null
                      setLinkedDO(undefined)
                    }}
                  />
                </Label>
              )}
              {active === "recordLenderReceipt" && (
                <Label className="grid gap-2">
                  Received amount (LKR)
                  <Input name="lenderAmount" required inputMode="decimal" />
                </Label>
              )}
              {active === "requestApproval" && (
                <Label className="grid gap-2">
                  Refund amount (LKR)
                  <Input
                    name="refundAmount"
                    inputMode="decimal"
                    required
                    defaultValue={money(refundCredit.toString())}
                    readOnly={pendingFinance}
                  />
                </Label>
              )}
              {active !== "cancelRetained" && (
                <Label className="grid gap-2">
                  {active === "recordDO"
                    ? "DO issue date"
                    : ["convertReservation", "confirmDOAndHandover"].includes(
                          active
                        )
                      ? "Handover date"
                      : "Payment date"}
                  <Input
                    type="date"
                    name="date"
                    required
                    max={refDate}
                    defaultValue={refDate}
                  />
                </Label>
              )}
              {["convertReservation", "confirmDOAndHandover"].includes(
                active
              ) && (
                <Label className="grid gap-2">
                  Handover mileage (km)
                  <Input
                    type="number"
                    name="mileage"
                    min={0}
                    required
                    defaultValue={cycle?.mileage?.at(-1)?.reading}
                  />
                </Label>
              )}
              {([
                "startFinance",
                "recordLenderReceipt",
                "requestApproval",
              ].includes(active) ||
                (active === "convertReservation" && remaining > 0n)) && (
                <>
                  <Label className="grid gap-2">
                    Payment method
                    <select
                      name="method"
                      className="h-9 rounded-md border bg-background px-3"
                    >
                      <option value="BANK_TRANSFER">Bank transfer</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </Label>
                  <Label className="grid gap-2">
                    Payment reference
                    <Input name="reference" maxLength={200} />
                  </Label>
                </>
              )}
              {active === "convertReservation" && (
                <p>Balance to collect {money(remaining.toString())}</p>
              )}
              {["cancelRetained", "requestApproval"].includes(active) && (
                <>
                  <Label className="grid gap-2">
                    Reason
                    <Input name="reason" required maxLength={2000} />
                  </Label>
                  <Label className="grid gap-2">
                    Stock disposition
                    <select
                      value={hold ? "HOLD" : "RELEASE"}
                      onChange={(event) =>
                        setHold(event.target.value === "HOLD")
                      }
                      className="h-9 rounded-md border bg-background px-3"
                    >
                      <option value="RELEASE">
                        Release to available stock
                      </option>
                      <option value="HOLD">Hold stock</option>
                    </select>
                  </Label>
                  {hold && (
                    <Label className="grid gap-2">
                      Hold reason
                      <Input name="holdReason" required maxLength={2000} />
                    </Label>
                  )}
                </>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : actions[active]}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
      {approval && (
        <Link href={`/approvals/${approval}`} className="underline">
          Open refund approval request
        </Link>
      )}
    </section>
  )
}
