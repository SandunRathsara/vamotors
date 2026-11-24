"use client"

import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs"
import { useRef, useState, type FormEvent, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { AlertCircle, Banknote, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { major, parseMajor } from "@/lib/money"
import { privateRequest, RequestError } from "@/lib/security-client"
import type {
  Applied,
  Dependency,
  DownloadDTO,
  UploadReady,
} from "@/.planning/implementation/contracts/api"
import type {
  reconciliationCompanies,
  reconciliationView,
  reconciliationRead,
} from "@/lib/server/reconciliation"

type View = Awaited<ReturnType<typeof reconciliationView>>
type Company = Awaited<ReturnType<typeof reconciliationCompanies>>[number]
type Detail = Extract<
  Awaited<ReturnType<typeof reconciliationRead>>,
  { receipt: unknown }
>
type Entitlement = Extract<
  Awaited<ReturnType<typeof reconciliationRead>>,
  { entitlementId: string }
>
type DraftLine = { id: string }
const rowRef = (row: View["data"][number]): Dependency => ({
  type: "CommissionEntitlement",
  id: row.entitlementId,
  revision: row.revision,
})
const remittanceRef = (row: { id: string; revision: number }): Dependency => ({
  type: "Remittance",
  id: row.id,
  revision: row.revision,
})
const selectClass =
  "border-input bg-background min-h-9 w-full rounded-md border px-2 text-sm"
const card = "space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-6"
const money = (value: string) => major(BigInt(value))
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format()
const methods: Record<string, string> = {
  PERIOD_NOTICE: "Periodic notice",
  PER_DEAL: "Per deal",
}
const resolutions: Record<string, string> = {
  KEEP_OPEN: "Keep open / dispute",
  ACCEPT_SHORTFALL: "Write down shortfall",
  CARRY_CREDIT: "Carry credit forward",
  RETURN_OVERPAYMENT: "Return overpayment",
}
const states: Record<string, string> = {
  OPEN: "Open",
  PARTIAL: "Partial",
  SETTLED: "Settled",
  RESOLVED: "Resolved",
  STAGED: "Draft",
  RECEIVED: "Received",
  REVERSED: "Reversed",
}
const uniqueRefs = (refs: Dependency[]) => [
  ...new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values(),
]
const formText = (form: FormData, field: string) =>
  String(form.get(field) ?? "").trim()
const formMoney = (form: FormData, field: string) =>
  parseMajor(formText(form, field)).toString()

async function read<T>(name: string, args: Record<string, string> = {}) {
  return (
    await privateRequest<{ data: T }>(
      `/api/v1/queries/${name}?${new URLSearchParams(args)}`
    )
  ).data
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span>{label}</span>
      {children}
    </label>
  )
}
function Source({ row }: { row: View["data"][number] }) {
  const label = row.source === "VEHICLE_SALE" ? "Vehicle Sale" : "Brokerage"
  const text = `${label} · ${row.sourceId.slice(0, 8)}`
  return row.href ? (
    <Link className="font-medium underline underline-offset-4" href={row.href}>
      {text}
    </Link>
  ) : (
    <span>{text}</span>
  )
}

export function FinanceReconciliation() {
  const queryClient = useQueryClient()
  const companies = useQuery({
    queryKey: ["reconciliation", "companies"],
    queryFn: () => read<Company[]>("reconciliationCompanies"),
  })
  const [{ company: selection, asOf: cutoff, run: runId, overdue }, setFilters] = useQueryStates({
    company: parseAsString.withDefault(""),
    asOf: parseAsString.withDefault(today()),
    run: parseAsString.withDefault(""),
    overdue: parseAsBoolean.withDefault(false),
  })
  const companyId = selection || companies.data?.[0]?.id || ""
  const [selectedRemittance, setSelectedRemittance] = useState("")
  const [selectedEntitlement, setSelectedEntitlement] = useState("")
  const [status, setStatus] = useState<{ message: string; error: boolean }>()
  const [pending, setPending] = useState(false)
  const retry = useRef(new Map<string, string>())
  const view = useQuery({
    queryKey: ["reconciliation", companyId, cutoff, runId],
    queryFn: () =>
      read<View>("reconciliation", {
        companyId,
        asOfDate: cutoff,
        ...(runId ? { runId } : {}),
      }),
    enabled: !!companyId && !!cutoff,
  })
  const data = view.data
  const remittanceId = data?.remittances.some(
    (row) => row.id === selectedRemittance
  )
    ? selectedRemittance
    : ""
  const remittance = useQuery({
    queryKey: ["reconciliation", "remittance", remittanceId],
    queryFn: () => read<Detail>("remittance", { id: remittanceId }),
    enabled: !!remittanceId && !runId,
  })
  const entitlement = useQuery({
    queryKey: ["reconciliation", "entitlement", selectedEntitlement],
    queryFn: () =>
      read<Entitlement>("reconciliationEntitlement", {
        id: selectedEntitlement,
      }),
    enabled: !!selectedEntitlement && !runId,
  })

  async function send<T = Applied>(
    name: string,
    input: unknown,
    refs: Dependency[]
  ) {
    const body = { schemaVersion: 1, expected: uniqueRefs(refs), input }
    const key = JSON.stringify([name, body])
    const idempotencyKey = retry.current.get(key) ?? crypto.randomUUID()
    retry.current.set(key, idempotencyKey)
    const result = await privateRequest<T>(`/api/v1/commands/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: location.origin },
      body: JSON.stringify({ ...body, idempotencyKey }),
    })
    retry.current.delete(key)
    return result
  }

  async function perform(
    event: FormEvent<HTMLFormElement>,
    message: string,
    action: (form: FormData) => Promise<unknown>
  ) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    setPending(true)
    setStatus(undefined)
    try {
      await action(form)
      await queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
      setStatus({ message, error: false })
    } catch (error) {
      const code =
        error instanceof RequestError
          ? error.code
          : error instanceof Error
            ? error.message
            : "Request failed"
      if (code === "STALE_REVISION")
        await queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
      setStatus({
        message:
          code === "STALE_REVISION"
            ? "The balances changed. Review the latest figures and submit again."
            : code.replaceAll("_", " "),
        error: true,
      })
    } finally {
      setPending(false)
    }
  }

  async function upload(form: FormData, owner: Detail) {
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0)
      throw Error("Choose a file.")
    const bytes = await file.arrayBuffer()
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("")
    const expected = remittanceRef(owner)
    const ready = await send<UploadReady>(
      "initUpload",
      {
        target: { type: "REMITTANCE", id: owner.id },
        purpose: formText(form, "purpose"),
        filename: file.name,
        size: file.size,
        contentType: file.type,
        sha256,
      },
      [expected]
    )
    const response = await fetch(ready.putUrl, {
      method: "PUT",
      headers: ready.requiredHeaders,
      body: bytes,
      credentials: "same-origin",
    })
    if (!response.ok) throw Error("Upload failed.")
    await send("completeUpload", { uploadId: ready.uploadId }, [
      expected,
      { type: "UploadIntent", id: ready.uploadId, revision: ready.revision },
    ])
  }

  async function download(id: string) {
    try {
      const receipt = await read<DownloadDTO>("download", { attachmentId: id })
      location.assign(receipt.url)
    } catch {
      setStatus({
        message: "This attachment could not be downloaded.",
        error: true,
      })
    }
  }

  const visible = data?.data.filter((row) => !overdue || row.overdue) ?? []
  const detail = remittance.data
  const error =
    companies.error ?? view.error ?? remittance.error ?? entitlement.error
  return (
    <section className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Finance</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Reconciliation
          </h1>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            queryClient.invalidateQueries({ queryKey: ["reconciliation"] })
          }
        >
          Refresh
        </Button>
      </header>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Finance company">
          <select
            className={selectClass}
            value={companyId}
            onChange={(event) => {
              void setFilters({ company: event.target.value, run: "" })
              setSelectedRemittance("")
              setSelectedEntitlement("")
            }}
          >
            {!companies.data?.length && (
              <option value="">Select a company</option>
            )}
            {companies.data?.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cutoff date">
          <Input
            type="date"
            max={today()}
            value={cutoff}
            disabled={!!runId}
            onChange={(event) => void setFilters({ asOf: event.target.value, run: "" })}
          />
        </Field>
        <Field label="Reconciliation view">
          <select
            className={selectClass}
            value={runId}
            onChange={(event) => void setFilters({ run: event.target.value })}
          >
            <option value="">Live balances</option>
            {data?.runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.asOfDate} · {run.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {status && (
        <p
          role={status.error ? "alert" : "status"}
          className={status.error ? "text-sm text-destructive" : "text-sm"}
        >
          {status.message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error instanceof RequestError
            ? error.code.replaceAll("_", " ")
            : "Finance data could not be loaded."}
        </p>
      )}
      {companies.isPending && <p role="status">Loading finance companies…</p>}
      {companies.data?.length === 0 && (
        <p className="text-muted-foreground">
          No finance companies are available.
        </p>
      )}
      {data && (
        <>
          <div className={card}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">Entitlements</h2>
                <p className="text-sm text-muted-foreground">
                  {data.view === "RUN_SNAPSHOT" ? "Saved run" : "Live"} ·{" "}
                  {methods[data.method]} · Policy v{data.policyVersion} · Cutoff{" "}
                  {data.asOfDate}
                  {data.watermarkDate
                    ? ` · Watermark ${data.watermarkDate}`
                    : ""}
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={overdue}
                  onChange={(event) => void setFilters({ overdue: event.target.checked })}
                />{" "}
                Overdue only
              </label>
            </div>
            <div className="overflow-x-auto" role="region" aria-label="Commission entitlements" tabIndex={0}>
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    {[
                      "Source",
                      "Sent",
                      "Principal",
                      "Commission",
                      "Received",
                      "Outstanding",
                      "Status",
                    ].map((label) => (
                      <th className="p-2 font-medium" key={label} scope="col">
                        {label}
                      </th>
                    ))}
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.entitlementId} className="border-b">
                      <td className="p-2">
                        <Source row={row} />
                      </td>
                      <td className="p-2">{row.sentDate}</td>
                      <td className="p-2 tabular-nums">
                        {row.source === "VEHICLE_SALE"
                          ? money(row.principal)
                          : "—"}
                      </td>
                      <td className="p-2 tabular-nums">
                        {money(row.commission)}
                      </td>
                      <td className="p-2 tabular-nums">
                        {money(row.received)}
                      </td>
                      <td className="p-2 tabular-nums">
                        {money(row.outstanding)}
                      </td>
                      <td className="p-2">
                        <span>{states[row.state]}</span>
                        {row.overdue && (
                          <span className="mt-1 flex items-center gap-1 text-destructive">
                            <AlertCircle size={14} /> Overdue
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        {!runId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setSelectedEntitlement(row.entitlementId)
                            }
                          >
                            Details
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visible.length && (
                <p className="py-6 text-sm text-muted-foreground">
                  {overdue
                    ? "No overdue entitlements at this cutoff."
                    : "No entitlements at this cutoff."}
                </p>
              )}
            </div>
          </div>
          {!runId && entitlement.data && (
            <div className={card}>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Entitlement details</h2>
                <Button
                  variant="ghost"
                  onClick={() => setSelectedEntitlement("")}
                >
                  Close
                </Button>
              </div>
              <Source row={entitlement.data} />
              <p className="text-sm">
                Expected {money(entitlement.data.expected)} · Received{" "}
                {money(entitlement.data.received)} · Difference{" "}
                {money(entitlement.data.discrepancy)}
              </p>
              <p className="text-sm">
                Sent date basis {entitlement.data.sentDateSource.toLowerCase()}{" "}
                · Direct lender receipts{" "}
                {money(entitlement.data.directReceipts)}
              </p>
              {entitlement.data.discrepancies.map((item) => (
                <p className="text-sm" key={item.id}>
                  {resolutions[item.resolution]} ·{" "}
                  {money(item.expectedMinusAllocated)} · {item.reason}
                </p>
              ))}
              {entitlement.data.allocations.map((item) => (
                <p className="text-sm" key={item.id}>
                  {money(item.amount)} ·{" "}
                  {item.reversalOf
                    ? "Allocation reversal"
                    : item.reversedById
                      ? "Reversed allocation"
                      : "Allocated"}
                  <Button
                    variant="link"
                    onClick={() => setSelectedRemittance(item.remittance.id)}
                  >
                    Open remittance
                  </Button>
                </p>
              ))}
            </div>
          )}
          {!runId && (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className={card}>
                <h2 className="flex items-center gap-2 font-semibold">
                  <Banknote size={18} /> Bank remittances
                </h2>
                {data.canStage && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(event) =>
                      perform(
                        event,
                        "Remittance draft created.",
                        async (form) => {
                          const result = await send(
                            "stageRemittance",
                            {
                              companyId,
                              reference: formText(form, "reference"),
                            },
                            [data.company]
                          )
                          setSelectedRemittance(result.result.id)
                        }
                      )
                    }
                  >
                    <Field label="Bank reference">
                      <Input name="reference" required maxLength={200} />
                    </Field>
                    <Button disabled={pending}>Stage remittance</Button>
                  </form>
                )}
                <Field label="Remittance">
                  <select
                    className={selectClass}
                    value={remittanceId}
                    onChange={(event) =>
                      setSelectedRemittance(event.target.value)
                    }
                  >
                    <option value="">Select a remittance</option>
                    {data.remittances.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.reference} · {states[row.state]}
                      </option>
                    ))}
                  </select>
                </Field>
                {detail && (
                  <div className="space-y-4">
                    <p className="text-sm">
                      {methods[detail.method]} · {detail.currency} ·{" "}
                      {states[detail.state]}
                      {detail.receipt
                        ? ` · ${money(detail.unallocated)} unallocated`
                        : ""}
                    </p>
                    {detail.documents.map((doc) => (
                      <Button
                        key={doc.id}
                        variant="outline"
                        size="sm"
                        onClick={() => download(doc.id)}
                      >
                        <FileText size={16} />
                        {doc.purpose === "RECONCILIATION_NOTICE"
                          ? "Download notice"
                          : "Download receipt"}
                      </Button>
                    ))}
                    {detail.state === "STAGED" && detail.canUpload && (
                      <form
                        className="space-y-2"
                        onSubmit={(event) =>
                          perform(event, "Private document uploaded.", (form) =>
                            upload(form, detail)
                          )
                        }
                      >
                        <Field label="Document type">
                          <select className={selectClass} name="purpose">
                            <option value="RECONCILIATION_NOTICE">
                              Reconciliation notice
                            </option>
                            <option value="REMITTANCE_RECEIPT">
                              Bank receipt
                            </option>
                          </select>
                        </Field>
                        <Field label="Private document">
                          <Input
                            name="file"
                            type="file"
                            accept="application/pdf,image/png,image/jpeg,image/webp"
                            required
                          />
                        </Field>
                        <Button size="sm" variant="outline" disabled={pending}>
                          Upload document
                        </Button>
                      </form>
                    )}
                    {detail.state === "STAGED" && detail.canReceive && (
                      <ReceiptForm
                        key={detail.id}
                        detail={detail}
                        pending={pending}
                        onSubmit={(event, lines) =>
                          perform(event, "Bank transfer recorded.", (form) =>
                            send(
                              "recordRemittance",
                              {
                                companyId,
                                draftId: detail.id,
                                payment: {
                                  amount: formMoney(form, "amount"),
                                  method: "BANK_TRANSFER",
                                  reference: detail.reference,
                                  date: formText(form, "date"),
                                },
                                noticeAttachmentId:
                                  formText(form, "notice") || undefined,
                                lines: lines.map(({ id }) => ({
                                  key: formText(form, `key-${id}`),
                                  description: formText(
                                    form,
                                    `description-${id}`
                                  ),
                                  amount: formMoney(form, `amount-${id}`),
                                })),
                              },
                              [detail.company, remittanceRef(detail)]
                            )
                          )
                        }
                      />
                    )}
                    {detail.lines.map((line) => (
                      <p className="text-sm" key={line.id}>
                        {line.key} · {line.description} ·{" "}
                        {money(line.unallocated)} of {money(line.amount)}{" "}
                        unallocated
                      </p>
                    ))}
                    {detail.payments.map((payment) => (
                      <div
                        key={payment.id}
                        className="space-y-2 border-t pt-2 text-sm"
                      >
                        <p>
                          {payment.date} ·{" "}
                          {payment.direction === "IN" ? "In" : "Out"} ·{" "}
                          {money(payment.amount)} ·{" "}
                          {payment.category.replaceAll("_", " ").toLowerCase()}
                        </p>
                        {detail.canPay &&
                          !payment.reversalOf &&
                          !detail.payments.some(
                            (row) => row.reversalOf === payment.id
                          ) && (
                            <details>
                              <summary className="cursor-pointer">
                                Reverse payment
                              </summary>
                              <form
                                className="mt-2 space-y-2"
                                onSubmit={(event) =>
                                  perform(
                                    event,
                                    "Payment reversal posted.",
                                    (form) => {
                                      const discrepancy =
                                        detail.discrepancies.find((row) =>
                                          row.returns.some(
                                            (r) => r.id === payment.id
                                          )
                                        )
                                      return send(
                                        "reversePayment",
                                        {
                                          sourceType: "REMITTANCE",
                                          sourceId: detail.id,
                                          paymentId: payment.id,
                                          reason: formText(form, "reason"),
                                          date: formText(form, "date"),
                                        },
                                        [
                                          detail.company,
                                          remittanceRef(detail),
                                          ...(discrepancy
                                            ? [discrepancy.entitlement]
                                            : []),
                                        ]
                                      )
                                    }
                                  )
                                }
                              >
                                <Field label="Reversal date">
                                  <Input
                                    name="date"
                                    type="date"
                                    defaultValue={today()}
                                    required
                                  />
                                </Field>
                                <Field label="Reversal reason">
                                  <Input name="reason" required />
                                </Field>
                                <Button size="sm" disabled={pending}>
                                  Post reversal
                                </Button>
                              </form>
                            </details>
                          )}
                      </div>
                    ))}
                    {detail.allocations.map((allocation) => (
                      <div
                        key={allocation.id}
                        className="space-y-2 border-t pt-2 text-sm"
                      >
                        <p>
                          Allocation {money(allocation.amount)} ·{" "}
                          {allocation.entitlement.id.slice(0, 8)}
                          {allocation.reversalOf || allocation.reversedById
                            ? " · Reversed"
                            : ""}
                        </p>
                        {data.canReconcile &&
                          !allocation.reversalOf &&
                          !allocation.reversedById && (
                            <details>
                              <summary className="cursor-pointer">
                                Reverse allocation
                              </summary>
                              <form
                                className="mt-2 space-y-2"
                                onSubmit={(event) =>
                                  perform(
                                    event,
                                    "Allocation reversed.",
                                    (form) =>
                                      send(
                                        "reverseAllocation",
                                        {
                                          allocationId: allocation.id,
                                          reason: formText(form, "reason"),
                                        },
                                        [
                                          detail.company,
                                          allocation.remittance,
                                          allocation.entitlement,
                                        ]
                                      )
                                  )
                                }
                              >
                                <Field label="Allocation reversal reason">
                                  <Input name="reason" required />
                                </Field>
                                <Button size="sm" disabled={pending}>
                                  Reverse allocation
                                </Button>
                              </form>
                            </details>
                          )}
                      </div>
                    ))}
                    {detail.discrepancies.map((item) => (
                      <div
                        className="space-y-2 border-t pt-2 text-sm"
                        key={item.id}
                      >
                        <p>
                          {resolutions[item.resolution]} ·{" "}
                          {money(item.expectedMinusAllocated)} · {item.reason}
                        </p>
                        {detail.canPay &&
                          BigInt(item.returnOutstanding) > 0n && (
                            <details>
                              <summary className="cursor-pointer">
                                Return overpayment (
                                {money(item.returnOutstanding)} available)
                              </summary>
                              <form
                                className="mt-2 space-y-2"
                                onSubmit={(event) =>
                                  perform(
                                    event,
                                    "Overpayment return recorded.",
                                    (form) =>
                                      send(
                                        "returnRemittanceOverpayment",
                                        {
                                          remittanceId: detail.id,
                                          discrepancyId: item.id,
                                          reason: formText(form, "reason"),
                                          payment: {
                                            amount: formMoney(form, "amount"),
                                            date: formText(form, "date"),
                                            method: "BANK_TRANSFER",
                                            reference: formText(
                                              form,
                                              "reference"
                                            ),
                                          },
                                        },
                                        [
                                          detail.company,
                                          remittanceRef(detail),
                                          item.entitlement,
                                        ]
                                      )
                                  )
                                }
                              >
                                <Field label="Return amount">
                                  <Input
                                    name="amount"
                                    inputMode="decimal"
                                    required
                                  />
                                </Field>
                                <Field label="Return date">
                                  <Input
                                    name="date"
                                    type="date"
                                    defaultValue={today()}
                                    required
                                  />
                                </Field>
                                <Field label="Return bank reference">
                                  <Input name="reference" required />
                                </Field>
                                <Field label="Return reason">
                                  <Input name="reason" required />
                                </Field>
                                <Button size="sm" disabled={pending}>
                                  Record return
                                </Button>
                              </form>
                            </details>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {data.canReconcile && (
                <RunForm
                  key={companyId}
                  data={data}
                  pending={pending}
                  onSubmit={(event, items, decisions) =>
                    perform(
                      event,
                      "Reconciliation run saved.",
                      async (form) => {
                        const allocations = items.flatMap(({ id }) => {
                          const entitlementId = formText(
                            form,
                            `entitlement-${id}`
                          )
                          return entitlementId
                            ? [
                                {
                                  remittanceId: formText(
                                    form,
                                    `remittance-${id}`
                                  ),
                                  entitlementId,
                                  noticeLineId:
                                    formText(form, `notice-${id}`) || undefined,
                                  amount: formMoney(form, `allocation-${id}`),
                                },
                              ]
                            : []
                        })
                        const resolutions = decisions.map(({ id }) => ({
                          entitlementId: formText(form, `decision-${id}`),
                          kind: formText(form, `kind-${id}`),
                          reason: formText(form, `reason-${id}`),
                        }))
                        const owners = await Promise.all(
                          resolutions.map((item) =>
                            read<Entitlement>("reconciliationEntitlement", {
                              id: item.entitlementId,
                            })
                          )
                        )
                        const remitIds = new Set([
                          ...allocations.map((row) => row.remittanceId),
                          ...owners.flatMap((row) => [
                            ...row.allocations
                              .filter(
                                (item) => !item.reversalOf && !item.reversedById
                              )
                              .map((item) => item.remittance.id),
                            ...row.discrepancies.flatMap((item) =>
                              item.remittanceId ? [item.remittanceId] : []
                            ),
                          ]),
                        ])
                        const entitlementIds = new Set(
                          [...allocations, ...resolutions].map(
                            (row) => row.entitlementId
                          )
                        )
                        const result = await send(
                          "reconcile",
                          {
                            companyId,
                            asOfDate: data.asOfDate,
                            allocations,
                            resolutions,
                          },
                          [
                            data.company,
                            ...data.data
                              .filter((row) =>
                                entitlementIds.has(row.entitlementId)
                              )
                              .map(rowRef),
                            ...data.remittances
                              .filter((row) => remitIds.has(row.id))
                              .map(remittanceRef),
                          ]
                        )
                        void setFilters({ run: result.result.id })
                      }
                    )
                  }
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function ReceiptForm({
  detail,
  pending,
  onSubmit,
}: {
  detail: Detail
  pending: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>, lines: DraftLine[]) => void
}) {
  const [lines, setLines] = useState<DraftLine[]>([])
  return (
    <form
      className="space-y-3 border-t pt-3"
      onSubmit={(event) => onSubmit(event, lines)}
    >
      <h3 className="text-sm font-semibold">Record bank transfer</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Transfer amount">
          <Input inputMode="decimal" name="amount" required />
        </Field>
        <Field label="Bank date">
          <Input
            type="date"
            name="date"
            defaultValue={today()}
            max={today()}
            required
          />
        </Field>
      </div>
      <Field label="Verified notice">
        <select
          name="notice"
          className={selectClass}
          required={detail.method === "PERIOD_NOTICE"}
        >
          <option value="">Select a notice</option>
          {detail.documents
            .filter((row) => row.purpose === "RECONCILIATION_NOTICE")
            .map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.id.slice(0, 8)}
              </option>
            ))}
        </select>
      </Field>
      {lines.map(({ id }, index) => (
        <div key={id} className="grid gap-2 rounded-md border p-2">
          <Field label={`Line ${index + 1} reference`}>
            <Input name={`key-${id}`} required />
          </Field>
          <Field label="Line description">
            <Input name={`description-${id}`} required />
          </Field>
          <Field label="Line amount">
            <Input name={`amount-${id}`} inputMode="decimal" required />
          </Field>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines(lines.filter((row) => row.id !== id))}
          >
            Remove line
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLines([...lines, { id: crypto.randomUUID() }])}
        >
          Add notice line
        </Button>
        <Button size="sm" disabled={pending}>
          Record transfer
        </Button>
      </div>
    </form>
  )
}

function RunForm({
  data,
  pending,
  onSubmit,
}: {
  data: View
  pending: boolean
  onSubmit: (
    event: FormEvent<HTMLFormElement>,
    allocations: DraftLine[],
    decisions: DraftLine[]
  ) => void
}) {
  const [allocations, setAllocations] = useState<DraftLine[]>([])
  const [decisions, setDecisions] = useState<DraftLine[]>([])
  return (
    <form
      className={card}
      onSubmit={(event) => onSubmit(event, allocations, decisions)}
    >
      <h2 className="font-semibold">Reconcile at {data.asOfDate}</h2>
      {allocations.map(({ id }, index) => (
        <AllocationFields
          key={id}
          id={id}
          index={index}
          data={data}
          remove={() =>
            setAllocations(allocations.filter((row) => row.id !== id))
          }
        />
      ))}
      {decisions.map(({ id }) => (
        <div key={id} className="space-y-2 rounded-md border p-3">
          <Field label="Discrepancy entitlement">
            <EntitlementSelect data={data} name={`decision-${id}`} />
          </Field>
          <Field label="Resolution">
            <select name={`kind-${id}`} className={selectClass} required>
              {Object.entries(resolutions).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Resolution reason">
            <Input name={`reason-${id}`} required />
          </Field>
          <Button
            variant="ghost"
            type="button"
            size="sm"
            onClick={() =>
              setDecisions(decisions.filter((row) => row.id !== id))
            }
          >
            Remove resolution
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!data.unallocatedRemittances.length || !data.data.length}
          onClick={() =>
            setAllocations([...allocations, { id: crypto.randomUUID() }])
          }
        >
          Add allocation
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!data.data.length}
          onClick={() =>
            setDecisions([...decisions, { id: crypto.randomUUID() }])
          }
        >
          Add resolution
        </Button>
        <Button disabled={pending}>Save reconciliation run</Button>
      </div>
    </form>
  )
}

function EntitlementSelect({ data, name }: { data: View; name: string }) {
  return (
    <select className={selectClass} name={name} required>
      <option value="">Select an entitlement</option>
      {data.data.map((row) => (
        <option value={row.entitlementId} key={row.entitlementId}>
          {row.source === "VEHICLE_SALE" ? "Vehicle Sale" : "Brokerage"} ·{" "}
          {row.sourceId.slice(0, 8)} · {money(row.outstanding)} due
        </option>
      ))}
    </select>
  )
}

function AllocationFields({
  id,
  index,
  data,
  remove,
}: {
  id: string
  index: number
  data: View
  remove: () => void
}) {
  const options = data.remittances.filter((row) => BigInt(row.unallocated) > 0n)
  const [selected, setSelected] = useState(options[0]?.id ?? "")
  const current = options.find((row) => row.id === selected)
  return (
    <div className="space-y-2 rounded-md border p-3">
      <Field label={`Allocation ${index + 1} remittance`}>
        <select
          className={selectClass}
          name={`remittance-${id}`}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          required
        >
          {!current && <option value="">Select a remittance</option>}
          {options.map((row) => (
            <option value={row.id} key={row.id}>
              {row.reference} · {money(row.unallocated)} available
            </option>
          ))}
        </select>
      </Field>
      <Field label={`Allocation ${index + 1} entitlement`}>
        <EntitlementSelect data={data} name={`entitlement-${id}`} />
      </Field>
      {!!current &&
        (current.method === "PERIOD_NOTICE" || current.lines.length > 0) && (
          <Field label={`Allocation ${index + 1} notice line`}>
            <select
              key={selected}
              name={`notice-${id}`}
              className={selectClass}
              required={current.method === "PERIOD_NOTICE"}
            >
              <option value="">Select a line</option>
              {current.lines
                .filter((line) => BigInt(line.unallocated) > 0n)
                .map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.key} · {money(line.unallocated)} available
                  </option>
                ))}
            </select>
          </Field>
        )}
      <Field label={`Allocation ${index + 1} amount`}>
        <Input name={`allocation-${id}`} inputMode="decimal" required />
      </Field>
      <Button variant="ghost" type="button" size="sm" onClick={remove}>
        Remove allocation
      </Button>
    </div>
  )
}
