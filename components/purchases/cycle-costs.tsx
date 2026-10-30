"use client"
import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import {
  cycleMoneyEnvelope,
  type CycleMoneyCommand,
} from "@/lib/server/validators"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Cycle = Visible<PurchaseCycleDTO>
type Correction = {
  paymentId: string
  replace: boolean
  amount: string
  date: string
  method: string
  reference: string
  reason: string
}
const labels: Record<CycleMoneyCommand, string> = {
  addCost: "Add incurred cost",
  editCost: "Correct cost terms",
  payCost: "Pay cost",
  editPurchase: "Correct purchase terms",
  payPurchase: "Pay seller outstanding",
  reversePayment: "Correct payment entry",
}
const display = (value?: string) =>
  value === undefined ? "Unavailable" : major(BigInt(value))

/** Kept outside query-result mounting: uncertain responses retain exact bytes. */
export function CycleCosts({ cycle }: { cycle: Cycle }) {
  const queries = useQueryClient(),
    alert = useRef<HTMLParagraphElement>(null)
  const [name, setName] = useState<CycleMoneyCommand | null>(null),
    [snapshot, setSnapshot] = useState<Cycle>({})
  const [draft, setDraft] = useState<Record<string, string>>({
    method: "CASH",
    sourceType: "PURCHASE",
  })
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [body, setBody] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [latest, setLatest] = useState<Cycle | null>(null),
    [message, setMessage] = useState("")
  const change = (key: string, value: string) =>
    setDraft((old) => ({ ...old, [key]: value }))
  const cost = snapshot.costs?.find((c) => c.id === draft.costId)
  const sources = [
    { type: "PURCHASE", id: snapshot.id, payments: snapshot.payments },
    ...(snapshot.costs ?? []).map((c) => ({
      type: "COST",
      id: c.id,
      payments: c.payments,
    })),
  ]
  const source = sources.find((s) => s.id === draft.sourceId)
  const eligible = (payments: Cycle["payments"]) =>
    payments?.filter(
      (p) =>
        p.id &&
        p.amount !== undefined &&
        p.date &&
        p.method &&
        !p.reversalOf &&
        !payments.some((r) => r.reversalOf === p.id)
    ) ?? []
  const actions = (cycle.nextActions ?? []).filter(
    (n): n is CycleMoneyCommand => Object.hasOwn(labels, n)
  )
  const problem = (text: string) => {
    setMessage(text)
    requestAnimationFrame(() => alert.current?.focus())
  }
  function begin(next: CycleMoneyCommand) {
    setName(next)
    setSnapshot(cycle)
    setBody(null)
    setStale(false)
    setLatest(null)
    setCorrections([])
    setMessage("")
    setDraft({
      method: "CASH",
      sourceType: "PURCHASE",
      sourceId: cycle.id ?? "",
      purchaseDate: cycle.purchaseDate ?? "",
      purchasePrice:
        cycle.purchasePrice === undefined ? "" : display(cycle.purchasePrice),
      notes: cycle.notes ?? "",
    })
  }
  function selectCost(costId: string) {
    const selected = snapshot.costs?.find((c) => c.id === costId)
    setDraft((old) => ({
      ...old,
      costId,
      category: selected?.category ?? "",
      description: selected?.description ?? "",
      amount: selected?.amount === undefined ? "" : display(selected.amount),
      incurredDate: selected?.incurredDate ?? "",
    }))
  }
  const cash = (values = draft) => ({
    amount: parseMajor(values.paymentAmount ?? ""),
    date: values.paymentDate ?? "",
    method: values.method,
    ...(values.reference?.trim() ? { reference: values.reference } : {}),
  })
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name || pending || stale) return
    setPending(true)
    try {
      let submitted = body
      if (!submitted) {
        if (!snapshot.id || !snapshot.revision)
          throw new Error("Readable current cycle ID/revision required")
        const expected: Dependency[] = [
          {
            type: "PurchaseRecord",
            id: snapshot.id,
            revision: snapshot.revision,
          },
        ]
        let input: unknown
        if (name === "addCost" || name === "editCost") {
          input = {
            ...(name === "addCost"
              ? { cycleId: snapshot.id }
              : { costId: draft.costId, reason: draft.reason }),
            category: draft.category,
            description: draft.description,
            amount: parseMajor(draft.amount ?? ""),
            incurredDate: draft.incurredDate,
            ...(name === "addCost" && draft.recordPayment === "yes"
              ? { payment: cash() }
              : {}),
          }
        } else if (name === "editPurchase") {
          if (!snapshot.vehicleId || !snapshot.identityRevision)
            throw new Error("Readable physical Vehicle ID/revision required")
          expected.push({
            type: "Vehicle",
            id: snapshot.vehicleId,
            revision: snapshot.identityRevision,
          })
          input = {
            cycleId: snapshot.id,
            reason: draft.reason,
            patch: {
              purchaseDate: draft.purchaseDate,
              purchasePrice: parseMajor(draft.purchasePrice ?? ""),
              notes: draft.notes?.trim() ? draft.notes : null,
            },
            cashCorrections: corrections.map((c) => ({
              paymentId: c.paymentId,
              reason: c.reason,
              ...(c.replace
                ? {
                    replacement: {
                      amount: parseMajor(c.amount),
                      date: c.date,
                      method: c.method,
                      ...(c.reference.trim() ? { reference: c.reference } : {}),
                    },
                  }
                : {}),
            })),
          }
        } else if (name === "reversePayment")
          input = {
            sourceType: source?.type,
            sourceId: source?.id,
            paymentId: draft.paymentId,
            reason: draft.reason,
            ...(draft.recordPayment === "yes" ? { replacement: cash() } : {}),
          }
        else
          input = {
            ...(name === "payCost"
              ? { costId: draft.costId }
              : { cycleId: snapshot.id, recipient: "SELLER" }),
            payment: cash(),
          }
        const target =
          name === "reversePayment" && source?.type === "COST"
            ? snapshot.costs?.find((c) => c.id === source.id)
            : ["editCost", "payCost"].includes(name)
              ? cost
              : undefined
        if (target) {
          if (!target.id || !target.revision)
            throw new Error("Readable current cost ID/revision required")
          expected.push({
            type: "VehicleCost",
            id: target.id,
            revision: target.revision,
          })
        }
        const parsed = cycleMoneyEnvelope(name).safeParse({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected,
          input,
        })
        if (!parsed.success)
          throw new Error(
            "Enter valid amounts/dates and nonblank descriptions/reasons. No extra fields or zero payments."
          )
        submitted = JSON.stringify(parsed.data)
        setBody(submitted)
      }
      const result = await privateRequest<Applied>(`/api/v1/commands/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: submitted,
      })
      setBody(null)
      setName(null)
      problem(
        "Cycle money change committed. Payment corrections are accounting entries, not proof of an actual refund. Reloaded terms require a separate fresh intent."
      )
      for (const key of result.invalidate)
        await queries.invalidateQueries({ queryKey: [key] })
    } catch (cause) {
      const code =
        cause instanceof RequestError
          ? cause.code
          : cause instanceof Error
            ? cause.message
            : "NETWORK_ERROR"
      setStale(
        ["STALE_REVISION", "REVISION_REQUIRED", "INVALID_STATE"].includes(code)
      )
      if (cause instanceof RequestError && cause.status === 422) setBody(null)
      problem(
        `${code}. Draft retained. Uncertain retries send the original body/key; stale intents require explicit reload/reconfirmation.`
      )
    } finally {
      setPending(false)
    }
  }
  function field(key: string, label: string, type = "text", required = true) {
    const id = `cycle-money-${key}`
    return (
      <div className="min-w-0 space-y-2" key={key}>
        <Label htmlFor={id}>
          {label}
          {required ? " *" : ""}
        </Label>
        <Input
          id={id}
          type={type}
          required={required}
          maxLength={key === "reference" ? 200 : 2000}
          value={draft[key] ?? ""}
          onChange={(e) => change(key, e.target.value)}
          className="min-h-11 text-base"
        />
      </div>
    )
  }
  function paymentFields() {
    return (
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        {field("paymentAmount", "Actual payment amount (major units)")}
        {field("paymentDate", "Actual payment date", "date")}
        <div className="space-y-2">
          <Label htmlFor="cycle-money-method">Payment method *</Label>
          <select
            id="cycle-money-method"
            value={draft.method}
            onChange={(e) => change("method", e.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
          </select>
        </div>
        {field("reference", "Payment reference", "text", false)}
      </div>
    )
  }
  return (
    <section
      aria-label="Cycle costs and corrections"
      className="min-w-0 space-y-4 rounded-lg border p-4"
    >
      <h2 className="text-xl font-semibold">
        Incurred costs and actual payments
      </h2>
      <p>
        Basis uses incurred amounts, not amounts paid. Purchase 100 + cost 5 =
        basis 105; paying 2 leaves cost outstanding 3 and cash out 102.
        Zero/unpaid costs create no payment.
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ["Purchase terms", cycle.financial?.purchase],
          ["Additional incurred costs", cycle.financial?.additionalCosts],
          ["Current incurred basis", cycle.financial?.basis],
          ["Actual cash out", cycle.financial?.cashOut],
          ["Correction cash in", cycle.financial?.cashIn],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd>{display(value)}</dd>
          </div>
        ))}
      </dl>
      {cycle.costs === undefined ? (
        <p>Costs unavailable under current access.</p>
      ) : (
        <ul className="space-y-4">
          {cycle.costs.map((c, i) => (
            <li
              key={c.id ?? i}
              className="min-w-0 space-y-2 rounded-md border p-3 break-words"
            >
              <h3 className="font-semibold">
                {c.category ?? "Category unavailable"}:{" "}
                {c.description ?? "Description unavailable"}
              </h3>
              <p>
                Incurred {display(c.amount)} ·{" "}
                {c.incurredDate ?? "Date unavailable"} · outstanding{" "}
                {display(c.outstanding)}
              </p>
              {c.id && (
                <p>
                  Cost {c.id} · revision {c.revision ?? "Unavailable"}
                </p>
              )}
              {c.payments === undefined ? (
                <p>Payments unavailable</p>
              ) : c.payments.length ? (
                <ul>
                  {c.payments.map((p, j) => (
                    <li key={p.id ?? j}>
                      {p.direction} {display(p.amount)} · {p.date} · {p.method}
                      <br />
                      Payment {p.id}{" "}
                      {p.reversalOf && <>· exact reversal of {p.reversalOf}</>}{" "}
                      {p.reason && <>· {p.reason}</>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No actual payment recorded.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {!name && (
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
            <Button key={action} onClick={() => begin(action)}>
              {labels[action]}
            </Button>
          ))}
          {!actions.length && (
            <p>No authorized cost/term action in this state.</p>
          )}
        </div>
      )}
      {name && (
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <h3 className="font-semibold">
            {labels[name]} · cycle revision {snapshot.revision}
          </h3>
          <p>
            Cost reduction below net paid is rejected. First correct the payment
            entry, commit and reload; then submit a reasoned cost edit. These
            are two independent truthful commits, not an atomic refund.
          </p>
          <fieldset disabled={pending || !!body} className="min-w-0 space-y-4">
            {["editCost", "payCost"].includes(name) && (
              <div className="space-y-2">
                <Label htmlFor="cycle-money-cost">Cost *</Label>
                <select
                  id="cycle-money-cost"
                  required
                  value={draft.costId ?? ""}
                  onChange={(e) => selectCost(e.target.value)}
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                >
                  <option value="">Select readable cost</option>
                  {snapshot.costs
                    ?.filter(
                      (c) =>
                        c.id &&
                        c.revision &&
                        c.amount !== undefined &&
                        c.outstanding !== undefined &&
                        (name !== "payCost" || BigInt(c.outstanding) > 0n)
                    )
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.description} · outstanding {display(c.outstanding)}
                      </option>
                    ))}
                </select>
              </div>
            )}
            {(name === "addCost" || name === "editCost") && (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                {field("category", "Cost category")}
                {field("description", "Cost description")}
                {field("amount", "Incurred amount (major units)")}
                {field("incurredDate", "Actual incurred date", "date")}
              </div>
            )}
            {name === "editPurchase" && (
              <>
                {field("purchaseDate", "Corrected purchase date", "date")}
                {field(
                  "purchasePrice",
                  "Corrected purchase price (major units)"
                )}
                {field("notes", "Purchase notes", "text", false)}
                <h4 className="font-semibold">
                  Explicit seller payment corrections
                </h4>
                {eligible(snapshot.payments).map((p) => (
                  <div key={p.id} className="space-y-2 rounded-md border p-3">
                    <Label className="flex min-h-11 items-center gap-3">
                      <input
                        type="checkbox"
                        checked={corrections.some((c) => c.paymentId === p.id)}
                        onChange={(e) =>
                          setCorrections(
                            e.target.checked
                              ? [
                                  ...corrections,
                                  {
                                    paymentId: p.id!,
                                    replace: false,
                                    amount: display(p.amount),
                                    date: p.date!,
                                    method: p.method!,
                                    reference: p.reference ?? "",
                                    reason: "",
                                  },
                                ]
                              : corrections.filter((c) => c.paymentId !== p.id)
                          )
                        }
                      />
                      Reverse recorded {display(p.amount)} on {p.date} ({p.id})
                    </Label>
                    {corrections
                      .filter((c) => c.paymentId === p.id)
                      .map((c) => {
                        const update = (patch: Partial<Correction>) =>
                          setCorrections((old) =>
                            old.map((v) =>
                              v.paymentId === c.paymentId
                                ? { ...v, ...patch }
                                : v
                            )
                          )
                        return (
                          <div key={c.paymentId} className="space-y-3">
                            <Label htmlFor={`why-${c.paymentId}`}>
                              Payment correction reason *
                            </Label>
                            <Input
                              id={`why-${c.paymentId}`}
                              required
                              value={c.reason}
                              maxLength={2000}
                              onChange={(e) =>
                                update({ reason: e.target.value })
                              }
                            />
                            <Label className="flex min-h-11 items-center gap-3">
                              <input
                                type="checkbox"
                                checked={c.replace}
                                onChange={(e) =>
                                  update({ replace: e.target.checked })
                                }
                              />
                              Append replacement actual payment
                            </Label>
                            {c.replace && (
                              <div className="grid gap-3 sm:grid-cols-2">
                                {(
                                  [
                                    [
                                      "amount",
                                      "Replacement amount (major units)",
                                      "text",
                                    ],
                                    ["date", "Replacement actual date", "date"],
                                    [
                                      "reference",
                                      "Replacement reference (optional)",
                                      "text",
                                    ],
                                  ] as const
                                ).map(([key, label, type]) => (
                                  <div key={key}>
                                    <Label htmlFor={`${key}-${c.paymentId}`}>
                                      {label}
                                    </Label>
                                    <Input
                                      id={`${key}-${c.paymentId}`}
                                      type={type}
                                      required={key !== "reference"}
                                      value={c[key]}
                                      onChange={(e) =>
                                        update({ [key]: e.target.value })
                                      }
                                    />
                                  </div>
                                ))}
                                <div>
                                  <Label htmlFor={`method-${c.paymentId}`}>
                                    Replacement method
                                  </Label>
                                  <select
                                    id={`method-${c.paymentId}`}
                                    value={c.method}
                                    onChange={(e) =>
                                      update({ method: e.target.value })
                                    }
                                    className="min-h-11 w-full rounded-md border bg-background px-3"
                                  >
                                    <option value="CASH">Cash</option>
                                    <option value="BANK_TRANSFER">
                                      Bank transfer
                                    </option>
                                  </select>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                  </div>
                ))}
              </>
            )}
            {name === "reversePayment" && (
              <>
                <Label htmlFor="cycle-money-source">Payment owner *</Label>
                <select
                  id="cycle-money-source"
                  value={draft.sourceId ?? ""}
                  onChange={(e) => {
                    change("sourceId", e.target.value)
                    change("paymentId", "")
                  }}
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                >
                  {sources
                    .filter((s) => s.id && eligible(s.payments).length)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.type} {s.id}
                      </option>
                    ))}
                </select>
                <Label htmlFor="cycle-money-payment">Original payment *</Label>
                <select
                  id="cycle-money-payment"
                  required
                  value={draft.paymentId ?? ""}
                  onChange={(e) => change("paymentId", e.target.value)}
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                >
                  <option value="">Select original unreversed payment</option>
                  {eligible(source?.payments).map((p) => (
                    <option key={p.id} value={p.id}>
                      {display(p.amount)} · {p.date} · {p.id}
                    </option>
                  ))}
                </select>
              </>
            )}
            {(name === "addCost" || name === "reversePayment") && (
              <Label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={draft.recordPayment === "yes"}
                  onChange={(e) =>
                    change("recordPayment", e.target.checked ? "yes" : "no")
                  }
                />
                {name === "addCost"
                  ? "Record a positive actual payment now"
                  : "Append an explicit replacement actual payment"}
              </Label>
            )}
            {(name === "payCost" ||
              name === "payPurchase" ||
              draft.recordPayment === "yes") &&
              paymentFields()}
            {["editCost", "editPurchase", "reversePayment"].includes(name) &&
              field("reason", "Mandatory correction reason")}
          </fieldset>
          {stale && (
            <section className="space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    setLatest(
                      (
                        await privateRequest<{ data: Cycle }>(
                          `/api/v1/queries/purchase?cycleId=${snapshot.id}`
                        )
                      ).data
                    )
                  } catch {
                    problem(
                      "Current cycle reload failed. Original draft and envelope retained."
                    )
                  }
                }}
              >
                Reload current cycle
              </Button>
              {latest && (
                <>
                  <p>
                    Current revision {latest.revision} · {latest.status} · basis{" "}
                    {display(latest.financial?.basis)}. Review before
                    reconfirming; your entered values stay unchanged.
                  </p>
                  <Button
                    type="button"
                    disabled={
                      !latest.id ||
                      !latest.revision ||
                      !latest.nextActions?.includes(name)
                    }
                    onClick={() => {
                      setSnapshot(latest)
                      setLatest(null)
                      setBody(null)
                      setStale(false)
                      setMessage("")
                    }}
                  >
                    Reconfirm retained draft as new money intent
                  </Button>
                </>
              )}
            </section>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending || stale}>
              {pending
                ? "Committing…"
                : body
                  ? "Retry unchanged money intent"
                  : "Confirm cycle money change"}
            </Button>
            {(!body || stale) && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setName(null)
                  setBody(null)
                  setStale(false)
                }}
              >
                Cancel money draft
              </Button>
            )}
          </div>
        </form>
      )}
      {message && (
        <p role="status" ref={alert} tabIndex={-1} className="break-words">
          {message}
        </p>
      )}
      <p>
        Repairs, closed-cycle restatement, sales/repurchase, settlement-channel
        changes, mileage/listed-price and physical-identity edits remain queued;
        none are fabricated here.
      </p>
    </section>
  )
}
