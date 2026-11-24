"use client"
import { useRef, useState } from "react"
import Link from "next/link"
import { parseAsInteger, useQueryState } from "nuqs"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import {
  repairEnvelope,
  repairReversalInput,
  customerEnvelope,
  type RepairCommand,
} from "@/lib/server/validators"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import {
  PartyForm,
  type VisibleParty,
} from "@/components/third-parties/party-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Cycle = Visible<PurchaseCycleDTO>
type Repair = NonNullable<Cycle["repairs"]>[number]
type Name = RepairCommand | "reversePayment"
type Retained = {
  name: Name
  cycleId: string
  target: string
  body: string
  draft: Record<string, string>
  snapshot: Cycle
  vendor: VisibleParty | null
  stale: boolean
}
const labels: Record<Name, string> = {
  sendRepair: "Send for repair",
  returnRepair: "Record actual return and invoice",
  payRepair: "Record repair payment",
  reversePayment: "Correct repair payment entry",
}
const amount = (s?: string) =>
  s === undefined ? "Unavailable" : major(BigInt(s))
const problemText = (e: unknown) =>
  e instanceof RequestError
    ? e.code
    : e instanceof Error
      ? e.message
      : "Request failed"

/** No DTO outstanding field exists. Absence/partial authorization is NOT zero. */
export function authorizedRepairBalance(repair: Repair) {
  if (
    repair.invoiceAmount === undefined ||
    !repair.payments ||
    repair.payments.some(
      (p) =>
        p.amount === undefined || !["OUT", "IN"].includes(p.direction ?? "")
    )
  )
    return undefined
  return (
    BigInt(repair.invoiceAmount) -
    repair.payments.reduce(
      (n, p) =>
        n + (p.direction === "OUT" ? BigInt(p.amount!) : -BigInt(p.amount!)),
      0n
    )
  )
}

export function RepairHistory({
  cycle,
  only,
}: {
  cycle: Cycle
  only?: string
}) {
  return (
    <section
      className="space-y-3 rounded-lg border p-4"
      aria-label="Persisted repair history"
    >
      <h2 className="text-lg font-semibold">Repair history for this cycle</h2>
      {cycle.repairs === undefined ? (
        <p>Repair history unavailable under current permissions.</p>
      ) : cycle.repairs.length === 0 ? (
        <p>No visible repair records.</p>
      ) : (
        cycle.repairs
          .filter((r) => !only || r.id === only)
          .map((r, i) => (
            <article
              className="space-y-2 rounded border p-3 break-words"
              key={r.id ?? i}
            >
              <p>
                {r.sentDate ?? "Sent date unavailable"} ·{" "}
                {r.returnedDate
                  ? `Returned ${r.returnedDate}`
                  : "No visible return date"}
              </p>
              <p>{r.request ?? "Request unavailable"}</p>
              {r.id && (
                <Link
                  prefetch={false}
                  className="underline"
                  href={`/repairs/${r.id}`}
                >
                  View repair details
                </Link>
              )}
              {r.vendorId && (
                <p>
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/third-parties/${r.vendorId}?type=REPAIR_VENDOR`}
                  >
                    Repair vendor and retained history
                  </Link>
                </p>
              )}
              {r.returnedDate && (
                <>
                  <p>
                    Actual invoice: {amount(r.invoiceAmount)} ·{" "}
                    {r.invoiceDate ?? "Invoice date unavailable"}
                  </p>
                  <p>{r.summary ?? "Summary unavailable"}</p>
                  <p>
                    Invoice minus visible net payments:{" "}
                    {authorizedRepairBalance(r) === undefined
                      ? "Unavailable"
                      : major(authorizedRepairBalance(r)!)}
                  </p>
                </>
              )}
              {r.payments?.map((p, index) => (
                <p key={p.id ?? index}>
                  {p.direction ?? "Direction unavailable"} {amount(p.amount)} ·
                  actual cash date {p.date ?? "Unavailable"} ·{" "}
                  {p.method ?? "Method unavailable"}
                  {p.reversalOf
                    ? " · exact correction reversal (not an actual refund)"
                    : ""}
                  {p.reason ? ` · ${p.reason}` : ""}
                  {p.reference ? ` · ${p.reference}` : ""}
                </p>
              ))}
            </article>
          ))
      )}
    </section>
  )
}

export function RepairCommands({
  cycle,
  cycleId,
  only,
}: {
  cycle: Cycle
  cycleId: string
  only?: string
}) {
  const { actor } = useActor(),
    queries = useQueryClient(),
    ability = abilityFor(actor.presentationGrants, actor.user.id)
  const [retained, setRetained] = useState<Retained | null>(
    () =>
      queries
        .getQueriesData<Retained>({
          queryKey: ["repairs", "intent", actor.user.id],
        })
        .map(([, d]) => d)
        .find((d) => d?.cycleId === cycleId && (!only || d.target === only)) ??
      null
  )
  const [name, setName] = useState<Name | null>(retained?.name ?? null),
    [snapshot, setSnapshot] = useState<Cycle>(retained?.snapshot ?? {})
  const [draft, setDraft] = useState<Record<string, string>>(
      retained?.draft ?? { method: "CASH" }
    ),
    [vendor, setVendor] = useState<VisibleParty | null>(
      retained?.vendor ?? null
    )
  const [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [latest, setLatest] = useState<Cycle | null>(null),
    [latestVendor, setLatestVendor] = useState<VisibleParty | null>(null)
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [inline, setInline] = useState(false),
    [inlinePending, setInlinePending] = useState(false)
  const [createdVendorId, setCreatedVendorId] = useState<string | null>(null)
  const alert = useRef<HTMLParagraphElement>(null)
  const vendors = useQuery({
    queryKey: ["parties", "repair-picker", search, page],
    enabled: name === "sendRepair",
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: VisibleParty[]; total: number } }>(
        `/api/v1/queries/parties?type=REPAIR_VENDOR&active=true&pageSize=20&page=${page}&q=${encodeURIComponent(search)}`
      ),
  })
  const key = (r: Retained) => [
    "repairs",
    "intent",
    actor.user.id,
    r.name,
    r.target,
  ]
  const keep = (r: Retained) => {
    queries.setQueryDefaults(key(r), { gcTime: Infinity })
    queries.setQueryData(key(r), r)
    setRetained(r)
  }
  const forget = () => {
    if (retained)
      queries.removeQueries({ queryKey: key(retained), exact: true })
    setRetained(null)
  }
  const problem = (text: string) => {
    setMessage(text)
    requestAnimationFrame(() => alert.current?.focus())
  }
  const change = (field: string, value: string) =>
    setDraft((d) => ({ ...d, [field]: value }))
  const selected = snapshot.repairs?.find((r) => r.id === draft.repairId)
  const locked = pending || !!retained || inlinePending
  function begin(command: Name, repairId?: string) {
    if (retained) return
    setName(command)
    setSnapshot(cycle)
    setDraft({ method: "CASH", repairId: repairId ?? "" })
    setVendor(null)
    setLatest(null)
    setMessage("")
  }
  const cash = () => ({
    amount: parseMajor(draft.paymentAmount ?? ""),
    date: draft.paymentDate ?? "",
    method: draft.method,
    ...(draft.reference?.trim() ? { reference: draft.reference } : {}),
  })
  async function submit(event?: React.FormEvent) {
    event?.preventDefault()
    if (!name || pending || inlinePending || retained?.stale) return
    setPending(true)
    let sent = retained
    try {
      if (!sent) {
        if (!snapshot.id || !snapshot.revision || snapshot.id !== cycleId)
          throw new Error("Current readable purchase ID/revision required")
        const expected: Dependency[] = [
          {
            type: "PurchaseRecord",
            id: snapshot.id,
            revision: snapshot.revision,
          },
        ]
        let input: unknown
        if (name === "sendRepair") {
          if (!vendor?.id || !vendor.revision || !vendor.active || !vendor.name)
            throw new Error(
              "Select an actual readable active vendor with its current revision"
            )
          expected.push({
            type: "RepairVendor",
            id: vendor.id,
            revision: vendor.revision,
          })
          input = {
            cycleId: snapshot.id,
            vendorId: vendor.id,
            request: draft.request,
            sentDate: draft.sentDate,
          }
        } else {
          if (!selected?.id || !selected.revision)
            throw new Error(
              "Current nested repair ID/revision required; reload purchase detail"
            )
          expected.push({
            type: "RepairRecord",
            id: selected.id,
            revision: selected.revision,
          })
          input =
            name === "returnRepair"
              ? {
                  repairId: selected.id,
                  invoiceAmount: parseMajor(draft.invoiceAmount ?? ""),
                  invoiceDate: draft.invoiceDate,
                  returnedDate: draft.returnedDate,
                  summary: draft.summary,
                  ...(draft.recordPayment === "yes" ? { payment: cash() } : {}),
                }
              : name === "payRepair"
                ? { repairId: selected.id, payment: cash() }
                : {
                    sourceType: "REPAIR",
                    sourceId: selected.id,
                    paymentId: draft.paymentId,
                    reason: draft.reason,
                    ...(draft.recordPayment === "yes"
                      ? { replacement: cash() }
                      : {}),
                  }
        }
        const envelope = {
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected,
          input,
        }
        const parsed = (
          name === "reversePayment"
            ? customerEnvelope("createCustomer").extend({
                input: repairReversalInput,
              })
            : repairEnvelope(name)
        ).safeParse(envelope)
        if (!parsed.success)
          throw new Error(
            parsed.error.issues
              .map((e) => `${e.path.join(".")}: ${e.message}`)
              .join("; ")
          )
        sent = {
          name,
          cycleId,
          target: name === "sendRepair" ? cycleId : selected!.id!,
          snapshot,
          draft,
          vendor,
          body: JSON.stringify(parsed.data),
          stale: false,
        }
        keep(sent)
      }
      const result = await privateRequest<Applied>(
        `/api/v1/commands/${sent.name}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: sent.body,
        }
      )
      queries.removeQueries({ queryKey: key(sent), exact: true })
      setRetained(null)
      setName(null)
      setMessage(
        `Committed ${sent.name} once · ${result.commandId}${result.replayed ? " · recovered identical intent" : ""}`
      )
      for (const queryKey of result.invalidate)
        await queries.invalidateQueries({ queryKey: [queryKey] })
    } catch (e) {
      if (
        e instanceof RequestError &&
        ["STALE_REVISION", "REVISION_REQUIRED"].includes(e.code) &&
        sent
      )
        keep({ ...sent, stale: true })
      else if (
        e instanceof RequestError &&
        e.status >= 400 &&
        e.status < 500 &&
        !["COMMAND_IN_PROGRESS", "IDEMPOTENCY_MISMATCH"].includes(e.code)
      ) {
        if (sent) queries.removeQueries({ queryKey: key(sent), exact: true })
        setRetained(null)
      }
      problem(
        `${problemText(e)}. Draft retained. Uncertain responses keep the identical body/key; stale references require explicit reload and reconfirmation.`
      )
    } finally {
      setPending(false)
    }
  }
  async function reload() {
    setPending(true)
    try {
      const next = await privateRequest<{ data: Cycle }>(
        `/api/v1/queries/purchase?cycleId=${cycleId}`
      )
      if (!next.data.id || !next.data.revision)
        throw new Error("Current source references unavailable")
      if (vendor?.id) {
        const v = await privateRequest<{ data: VisibleParty }>(
          `/api/v1/queries/party?type=REPAIR_VENDOR&id=${vendor.id}`
        )
        setLatestVendor(v.data)
      }
      setLatest(next.data)
    } catch (e) {
      problem(
        `${problemText(e)}. Reload failed; original draft/body/key retained.`
      )
    } finally {
      setPending(false)
    }
  }
  async function loadCreatedVendor(id: string) {
    setInlinePending(true)
    try {
      const { data } = await privateRequest<{ data: VisibleParty }>(
        `/api/v1/queries/party?type=REPAIR_VENDOR&id=${id}`
      )
      if (!data.id || !data.revision || !data.active || !data.name)
        throw new Error("Current created vendor references unavailable")
      setVendor(data)
      setCreatedVendorId(null)
      setInline(false)
    } catch (error) {
      problem(
        `${problemText(error)}. Vendor creation committed; retry only its current reference read, not creation. Repair draft retained.`
      )
    } finally {
      setInlinePending(false)
    }
  }
  const cashPrefix = name === "reversePayment" ? "replacement" : "payment"
  const canRecordOptionalCash =
    ability.can("pay", "PurchaseRecord", "cycleId") &&
    ["amount", "date", "method"].every((field) =>
      ability.can("pay", "RepairRecord", `${cashPrefix}.${field}`)
    ) &&
    (name === "reversePayment" ||
      ability.can("pay", "RepairRecord", "repairId"))
  const field = (id: string, label: string, type = "text", required = true) => (
    <div className="space-y-1" key={id}>
      <Label htmlFor={`repair-${id}`}>{label}</Label>
      <Input
        id={`repair-${id}`}
        type={type}
        className="min-h-11 text-base"
        required={required}
        value={draft[id] ?? ""}
        onChange={(e) => change(id, e.target.value)}
      />
    </div>
  )
  const paymentFields = (
    <div className="space-y-3 rounded border p-3">
      {field("paymentAmount", "Actual payment (major currency)")}
      {field("paymentDate", "Actual cash date", "date")}
      <Label htmlFor="repair-method">Payment method</Label>
      <select
        id="repair-method"
        className="min-h-11 w-full rounded border bg-background p-2"
        value={draft.method ?? "CASH"}
        onChange={(e) => change("method", e.target.value)}
      >
        <option value="CASH">Cash</option>
        <option value="BANK_TRANSFER">Bank transfer</option>
      </select>
      {ability.can("pay", "RepairRecord", `${cashPrefix}.reference`) &&
        field("reference", "Payment reference (optional)", "text", false)}
    </div>
  )
  return (
    <section
      className="space-y-4 rounded-lg border p-4 [&_button]:min-h-11"
      aria-label="Repair commands"
    >
      <h2 className="text-lg font-semibold">Direct repair commands</h2>
      <p>
        Send has no invoice or payment. An actual return adds its invoice to
        basis even unpaid and holds stock. Payment changes cash only; release is
        a separate stock command.
      </p>
      <Link
        prefetch={false}
        href="/repairs"
        className="inline-flex min-h-11 items-center underline"
      >
        Current repair cycles
      </Link>
      {!name && !retained && (
        <div className="flex flex-wrap gap-3">
          {!only && cycle.nextActions?.includes("sendRepair") && (
            <Button onClick={() => begin("sendRepair")}>
              {labels.sendRepair}
            </Button>
          )}
          {cycle.repairs
            ?.filter((r) => r.id && (!only || r.id === only))
            .map((r) => (
              <div className="flex flex-wrap gap-2" key={r.id}>
                {!r.returnedDate &&
                  cycle.status === "IN_REPAIR" &&
                  cycle.nextActions?.includes("returnRepair") && (
                    <Button onClick={() => begin("returnRepair", r.id)}>
                      {labels.returnRepair}
                    </Button>
                  )}
                {r.returnedDate && authorizedRepairBalance(r) !== undefined && (
                  <>
                    {authorizedRepairBalance(r)! > 0n &&
                      cycle.nextActions?.includes("payRepair") && (
                        <Button onClick={() => begin("payRepair", r.id)}>
                          {labels.payRepair} ·{" "}
                          {amount(authorizedRepairBalance(r)!.toString())}{" "}
                          remaining
                        </Button>
                      )}
                    {cycle.nextActions?.includes("reversePayment") &&
                      ability.can("pay", "PurchaseRecord", "cycleId") &&
                      ["sourceType", "sourceId", "paymentId", "reason"].every(
                        (field) => ability.can("pay", "RepairRecord", field)
                      ) &&
                      r.payments?.some(
                        (p) =>
                          p.id &&
                          p.direction === "OUT" &&
                          !p.reversalOf &&
                          !r.payments?.some(
                            (reverse) => reverse.reversalOf === p.id
                          )
                      ) && (
                        <Button
                          variant="outline"
                          onClick={() => begin("reversePayment", r.id)}
                        >
                          {labels.reversePayment}
                        </Button>
                      )}
                  </>
                )}
              </div>
            ))}
        </div>
      )}
      {name && (
        <form className="space-y-4" onSubmit={submit}>
          <h3 className="font-semibold">{labels[name]}</h3>
          <fieldset disabled={locked} className="space-y-4">
            {name === "sendRepair" ? (
              <>
                <Label htmlFor="repair-vendor-search">
                  Search active repair vendors
                </Label>
                <Input
                  id="repair-vendor-search"
                  className="min-h-11 text-base"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                />
                {vendors.isPending && (
                  <p role="status">Loading actual repair vendors…</p>
                )}
                {vendors.isError && (
                  <p role="alert">
                    Vendor read failed.{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void vendors.refetch()}
                    >
                      Retry vendor read
                    </button>
                  </p>
                )}
                <Label htmlFor="repair-vendor">Active repair vendor</Label>
                <select
                  id="repair-vendor"
                  required
                  className="min-h-11 w-full rounded border bg-background p-2"
                  value={vendor?.id ?? ""}
                  onChange={(e) =>
                    setVendor(
                      vendors.data?.data.data.find(
                        (v) => v.id === e.target.value
                      ) ?? null
                    )
                  }
                >
                  <option value="">Select actual vendor</option>
                  {vendor?.id &&
                    !vendors.data?.data.data.some(
                      (v) => v.id === vendor.id
                    ) && <option value={vendor.id}>{vendor.name}</option>}
                  {vendors.data?.data.data
                    .filter((v) => v.id && v.revision && v.active && v.name)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ·{" "}
                        {v.directory?.specialisation ??
                          "Specialisation not shown"}
                      </option>
                    ))}
                </select>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={page === 1}
                    onClick={() => void setPage(page - 1)}
                  >
                    Previous vendors
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !vendors.data || page * 20 >= vendors.data.data.total
                    }
                    onClick={() => void setPage(page + 1)}
                  >
                    More vendors
                  </Button>
                </div>
                {ability.can("create", "RepairVendor") && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setInline(!inline)}
                  >
                    {inline
                      ? "Close vendor creation"
                      : "Create repair vendor inline"}
                  </Button>
                )}
                {field("sentDate", "Sent date", "date")}
                <Label htmlFor="repair-request">Repair request</Label>
                <Textarea
                  id="repair-request"
                  required
                  maxLength={2000}
                  value={draft.request ?? ""}
                  onChange={(e) => change("request", e.target.value)}
                />
              </>
            ) : name === "returnRepair" ? (
              <>
                {field(
                  "invoiceAmount",
                  "Actual invoice (major currency; zero allowed)"
                )}
                {field("invoiceDate", "Actual invoice date", "date")}
                {field("returnedDate", "Actual returned date", "date")}
                <Label htmlFor="repair-summary">Actual return summary</Label>
                <Textarea
                  id="repair-summary"
                  required
                  maxLength={2000}
                  value={draft.summary ?? ""}
                  onChange={(e) => change("summary", e.target.value)}
                />
              </>
            ) : null}
            {name === "reversePayment" && (
              <>
                <Label htmlFor="repair-paymentId">
                  Original actual repair payment
                </Label>
                <select
                  id="repair-paymentId"
                  required
                  className="min-h-11 w-full rounded border bg-background p-2"
                  value={draft.paymentId ?? ""}
                  onChange={(e) => change("paymentId", e.target.value)}
                >
                  <option value="">Select unreversed entry</option>
                  {selected?.payments
                    ?.filter(
                      (p) =>
                        p.id &&
                        p.date &&
                        p.method &&
                        p.amount !== undefined &&
                        p.direction === "OUT" &&
                        !p.reversalOf &&
                        !selected.payments?.some((r) => r.reversalOf === p.id)
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {amount(p.amount)} · {p.date} · {p.method}
                      </option>
                    ))}
                </select>
                {field("reason", "Correction reason")}
                <p>
                  Records an exact opposite correction, not an actual cash
                  refund. Original entries remain immutable.
                </p>
              </>
            )}
            {(name === "returnRepair" || name === "reversePayment") &&
              canRecordOptionalCash && (
                <label className="flex min-h-11 items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.recordPayment === "yes"}
                    onChange={(e) =>
                      change("recordPayment", e.target.checked ? "yes" : "no")
                    }
                  />
                  {name === "returnRepair"
                    ? "Also record a positive actual payment"
                    : "Also record a distinct replacement payment"}
                </label>
              )}
            {(name === "payRepair" || draft.recordPayment === "yes") &&
              paymentFields}
          </fieldset>
          {!retained && (
            <div className="flex flex-wrap gap-3">
              <Button disabled={pending || inlinePending} type="submit">
                {pending ? "Committing…" : `Commit ${name}`}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending || inlinePending}
                onClick={() => setName(null)}
              >
                Close form without submitting
              </Button>
            </div>
          )}
          {retained && !retained.stale && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => void submit()}
            >
              Retry identical {retained.name}
            </Button>
          )}
          {retained?.stale && (
            <div className="space-y-3">
              <Button
                type="button"
                disabled={pending}
                onClick={() => void reload()}
              >
                Load current source for reconfirmation
              </Button>
              {latest && (
                <>
                  <p>
                    Current source revision {latest.revision}. This does not
                    submit the draft.
                  </p>
                  <Button
                    type="button"
                    onClick={() => {
                      setSnapshot(latest)
                      if (latestVendor) setVendor(latestVendor)
                      forget()
                      setLatest(null)
                      setMessage(
                        "Current references explicitly confirmed. Submit the retained draft as a new intent when ready."
                      )
                    }}
                  >
                    Confirm current refs as a new repair intent
                  </Button>
                </>
              )}
            </div>
          )}
        </form>
      )}
      {name === "sendRepair" && createdVendorId && (
        <Button
          type="button"
          variant="outline"
          disabled={inlinePending}
          onClick={() => void loadCreatedVendor(createdVendorId)}
        >
          Retry created vendor reference read
        </Button>
      )}
      {name === "sendRepair" && inline && !retained && !createdVendorId && (
        <PartyForm
          kind="REPAIR_VENDOR"
          onUnresolvedChange={setInlinePending}
          onReload={async () => undefined}
          onSaved={(result) => {
            setCreatedVendorId(result.result.id)
            void loadCreatedVendor(result.result.id)
          }}
        />
      )}
      {message && (
        <p ref={alert} tabIndex={-1} role="alert" className="break-words">
          {message}
        </p>
      )}
      {retained && (
        <p role="status">
          Unresolved {retained.name} retained in memory for this
          actor/command/target only. No automatic execution or browser
          persistence. Access loss/logout purges it.
        </p>
      )}
    </section>
  )
}

export function RepairDetail({
  cycleId,
  repairId,
}: {
  cycleId: string
  repairId: string
}) {
  const query = useQuery({
    queryKey: ["purchases", "detail", cycleId],
    retry: false,
    queryFn: () =>
      privateRequest<{ data: Cycle }>(
        `/api/v1/queries/purchase?cycleId=${cycleId}`
      ),
  })
  return (
    <section className="mx-auto w-full max-w-4xl space-y-5">
      <h1 className="text-2xl font-semibold">Persisted repair detail</h1>
      <Link
        prefetch={false}
        className="underline"
        href={`/purchases/${cycleId}`}
      >
        Owning purchase, full history and explicit stock release
      </Link>
      <RepairCommands
        cycle={query.data?.data ?? {}}
        cycleId={cycleId}
        only={repairId}
      />
      {query.isPending && (
        <p role="status">Loading current purchase-owned repair…</p>
      )}
      {query.isError && (
        <p role="alert">
          Current source read failed.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry repair source read
          </button>
        </p>
      )}
      {query.data && <RepairHistory cycle={query.data.data} only={repairId} />}
    </section>
  )
}

export function RepairsList() {
  const [pageParam, setPage] = useQueryState("page", parseAsInteger.withDefault(1))
  const page = Math.max(1, pageParam)
  const query = useQuery({
    queryKey: ["purchases", "repairs-list", page],
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: Cycle[]; total: number } }>(
        `/api/v1/queries/purchases?statuses=${encodeURIComponent(JSON.stringify(["IN_REPAIR"]))}&page=${page}&pageSize=20`
      ),
  })
  return (
    <section className="mx-auto w-full max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Current repair cycles</h1>
      <p>
        This is pagination of authorized IN_REPAIR purchase cycles, not a global
        repair-row count. Dispatch begins from a real received purchase.
        Returned history remains on each cycle, vehicle and vendor.
      </p>
      <Link prefetch={false} className="underline" href="/purchases">
        Find a purchase to send for repair
      </Link>
      {query.isPending && <p role="status">Loading repair cycles…</p>}
      {query.isError && (
        <p role="alert">
          Repair-cycle read failed.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry cycle read
          </button>
        </p>
      )}
      {query.data && (
        <>
          <p>
            {query.data.data.total} visible cycles · page {page}
          </p>
          {query.data.data.data.map((c, i) => (
            <div key={c.id ?? i}>
              <p>
                {c.id ? (
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/purchases/${c.id}`}
                  >
                    Purchase cycle {c.cycleNumber ?? "unavailable"}
                  </Link>
                ) : (
                  "Cycle identity unavailable"
                )}
              </p>
              <RepairHistory cycle={c} />
            </div>
          ))}
          {query.data.data.total === 0 && <p>No visible IN_REPAIR cycles.</p>}
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => void setPage(page - 1)}
            >
              Previous cycles
            </Button>
            <Button
              variant="outline"
              disabled={page * 20 >= query.data.data.total}
              onClick={() => void setPage(page + 1)}
            >
              More cycles
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
