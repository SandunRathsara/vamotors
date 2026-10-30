"use client"
import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  AuditDTO,
  Dependency,
  PurchaseCycleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import {
  cycleEditEnvelope,
  type CycleEditCommand,
} from "@/lib/server/validators"
import { physicalFields, abilityFor } from "@/lib/server/permissions"
import { useActor } from "@/components/providers/auth-boundary"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Cycle = Visible<PurchaseCycleDTO>
const labels: Record<CycleEditCommand, string> = {
  addMileage: "Append mileage",
  setListedPrice: "Set asking price",
  editVehicle: "Correct physical details",
}
const fieldLabels: Record<string, string> = {
  engineNumber: "Engine number",
  chassisNumber: "Chassis number",
  make: "Make",
  model: "Model",
  year: "Year",
  colour: "Colour",
  fuelType: "Fuel type",
  transmission: "Transmission",
  vin: "VIN",
  crNumber: "CR number",
  notes: "Vehicle notes",
}

/** Outside the read-result subtree: a failed refetch cannot replace an intent. */
export function CycleEdits({ cycle }: { cycle: Cycle }) {
  const queries = useQueryClient(),
    { actor } = useActor(),
    ability = abilityFor(actor.presentationGrants, actor.user.id),
    alert = useRef<HTMLParagraphElement>(null)
  const [name, setName] = useState<CycleEditCommand | null>(null),
    [snapshot, setSnapshot] = useState<Cycle>({}),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [body, setBody] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [latest, setLatest] = useState<Cycle | null>(null),
    [message, setMessage] = useState("")
  const actions = (cycle.nextActions ?? []).filter((n): n is CycleEditCommand =>
    Object.hasOwn(labels, n)
  )
  const history = useQuery({
    queryKey: ["purchases", "edit-history", cycle.id, cycle.revision],
    enabled: !!cycle.id && ability.can("read", "AuditLog"),
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: Visible<AuditDTO>[] } }>(
        `/api/v1/queries/audit?type=PurchaseRecord&id=${cycle.id}`
      ),
  })
  function problem(text: string) {
    setMessage(text)
    requestAnimationFrame(() => alert.current?.focus())
  }
  function begin(next: CycleEditCommand) {
    setName(next)
    setSnapshot(cycle)
    setBody(null)
    setStale(false)
    setLatest(null)
    setMessage("")
    setDraft(
      next === "editVehicle"
        ? Object.fromEntries(
            physicalFields.map((f) => [f, String(cycle.identity?.[f] ?? "")])
          )
        : next === "setListedPrice"
          ? {
              amount:
                cycle.listedPrice === undefined
                  ? ""
                  : major(BigInt(cycle.listedPrice)),
            }
          : { reading: "", date: "" }
    )
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name || pending || stale) return
    setPending(true)
    try {
      let submitted = body
      if (!submitted) {
        if (
          !snapshot.id ||
          !snapshot.revision ||
          (name !== "setListedPrice" &&
            (!snapshot.vehicleId || !snapshot.identityRevision))
        )
          throw new Error("Readable current owner references required")
        const expected: Dependency[] =
          name === "editVehicle"
            ? []
            : [
                {
                  type: "PurchaseRecord",
                  id: snapshot.id,
                  revision: snapshot.revision,
                },
              ]
        if (name !== "setListedPrice")
          expected.push({
            type: "Vehicle",
            id: snapshot.vehicleId!,
            revision: snapshot.identityRevision!,
          })
        const input =
          name === "editVehicle"
            ? {
                vehicleId: snapshot.vehicleId,
                reason: draft.reason ?? "",
                values: Object.fromEntries(
                  physicalFields
                    .filter(
                      (f) =>
                        !["vin", "crNumber", "notes"].includes(f) ||
                        draft[f]?.trim()
                    )
                    .map((f) => [
                      f,
                      f === "year" ? Number(draft[f]) : (draft[f] ?? ""),
                    ])
                ),
              }
            : name === "setListedPrice"
              ? {
                  cycleId: snapshot.id,
                  amount: parseMajor(draft.amount ?? ""),
                  ...(draft.reason?.trim() ? { reason: draft.reason } : {}),
                }
              : {
                  cycleId: snapshot.id,
                  mileage: {
                    reading: draft.reading?.trim() ? Number(draft.reading) : -1,
                    date: draft.date ?? "",
                    ...(draft.remark?.trim() ? { remark: draft.remark } : {}),
                    ...(draft.decreaseReason?.trim()
                      ? { decreaseReason: draft.decreaseReason }
                      : {}),
                  },
                }
        const parsed = cycleEditEnvelope(name).safeParse({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected,
          input,
        })
        if (!parsed.success)
          throw new Error(
            "Enter valid complete details, actual dates and required reasons. Mileage and asking price may be zero."
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
        "Cycle details committed. Cash, incurred basis and original evidence are unchanged."
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
        [
          "STALE_REVISION",
          "REVISION_REQUIRED",
          "IDENTITY_CONFLICT",
          "INVALID_STATE",
        ].includes(code)
      )
      if (cause instanceof RequestError && cause.status === 422) setBody(null)
      problem(
        `${code}. Draft retained. An uncertain retry sends the original body and key; a conflict requires explicit reload and reconfirmation.`
      )
    } finally {
      setPending(false)
    }
  }
  function field(
    key: string,
    label: string,
    type = "text",
    required = true,
    disabled = false
  ) {
    return (
      <div className="min-w-0 space-y-2" key={key}>
        <Label htmlFor={`cycle-edit-${key}`}>
          {label}
          {required ? " *" : " (optional)"}
        </Label>
        <Input
          id={`cycle-edit-${key}`}
          type={type}
          required={required}
          disabled={disabled}
          maxLength={
            key === "reason" ||
            key === "notes" ||
            key === "remark" ||
            key === "decreaseReason"
              ? 2000
              : 200
          }
          value={draft[key] ?? ""}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
          className="min-h-11 text-base"
        />
      </div>
    )
  }
  return (
    <section
      aria-label="Cycle mileage, asking price and physical edits"
      className="min-w-0 space-y-4 rounded-lg border p-4"
    >
      <h2 className="text-xl font-semibold">
        Mileage, asking price and physical details
      </h2>
      <p>
        Mileage is append-only, ordered by actual date then stable reading ID. A
        backdated entry cannot erase a successor’s unexplained decrease. Asking
        price is independent of incurred basis and actual cash.
      </p>
      {!name && (
        <div className="flex flex-wrap gap-3">
          {actions.map((n) => (
            <Button key={n} onClick={() => begin(n)}>
              {labels[n]}
            </Button>
          ))}
          {!actions.length && <p>No authorized cycle edit in this state.</p>}
        </div>
      )}
      {name && (
        <form onSubmit={submit} className="min-w-0 space-y-4">
          <h3 className="font-semibold">
            {labels[name]} · cycle revision {snapshot.revision} · physical
            revision {snapshot.identityRevision}
          </h3>
          {name === "editVehicle" && (
            <p>
              Full physical values, same vehicle UUID. Blank optional VIN, CR
              number or vehicle notes clears that value; no identity merge or
              new acquisition.
            </p>
          )}
          <fieldset
            disabled={pending || !!body}
            className="grid min-w-0 gap-4 sm:grid-cols-2"
          >
            {name === "addMileage" && (
              <>
                {field("reading", "Actual mileage reading", "number")}
                {field("date", "Actual mileage date", "date")}
                {field("remark", "Mileage remark", "text", false)}
                {field(
                  "decreaseReason",
                  "Reason for a mileage decrease",
                  "text",
                  false
                )}
              </>
            )}
            {name === "setListedPrice" && (
              <>
                {field("amount", "Asking price (major units)")}
                {field("reason", "Asking price reason", "text", false)}
              </>
            )}
            {name === "editVehicle" && (
              <>
                {physicalFields.map((f) =>
                  ["fuelType", "transmission"].includes(f) ? (
                    <div key={f} className="space-y-2">
                      <Label htmlFor={`cycle-edit-${f}`}>
                        {fieldLabels[f]} *
                      </Label>
                      <select
                        id={`cycle-edit-${f}`}
                        disabled={
                          !ability.can("update", "Vehicle", `values.${f}`)
                        }
                        value={draft[f]}
                        onChange={(e) =>
                          setDraft({ ...draft, [f]: e.target.value })
                        }
                        className="min-h-11 w-full rounded-md border bg-background px-3"
                      >
                        {(f === "fuelType"
                          ? ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "OTHER"]
                          : ["MANUAL", "AUTOMATIC", "CVT", "OTHER"]
                        ).map((v) => (
                          <option key={v}>{v}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    field(
                      f,
                      `Physical ${fieldLabels[f]}`,
                      f === "year" ? "number" : "text",
                      !["vin", "crNumber", "notes"].includes(f),
                      !ability.can("update", "Vehicle", `values.${f}`)
                    )
                  )
                )}
                {field("reason", "Mandatory physical correction reason")}
              </>
            )}
          </fieldset>
          {stale && (
            <div className="space-y-3">
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
                      "Current cycle reload failed. Original envelope and draft retained."
                    )
                  }
                }}
              >
                Reload current edit references
              </Button>
              {latest && (
                <>
                  <p>
                    Current cycle revision {latest.revision}, physical revision{" "}
                    {latest.identityRevision}. Review current details before
                    confirming the retained draft.
                  </p>
                  <pre className="max-w-full overflow-auto break-words whitespace-pre-wrap">
                    {JSON.stringify(
                      {
                        identity: latest.identity,
                        mileage: latest.mileage,
                        listedPrice: latest.listedPrice,
                      },
                      null,
                      2
                    )}
                  </pre>
                  <Button
                    type="button"
                    disabled={!latest.nextActions?.includes(name)}
                    onClick={() => {
                      setSnapshot(latest)
                      setLatest(null)
                      setStale(false)
                      setBody(null)
                      setMessage("")
                    }}
                  >
                    Reconfirm retained edit as new intent
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending || stale}>
              {pending
                ? "Committing cycle edit…"
                : body
                  ? "Retry unchanged cycle edit"
                  : "Confirm cycle edit"}
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
                  setLatest(null)
                }}
              >
                Cancel edit draft
              </Button>
            )}
          </div>
        </form>
      )}
      {message && (
        <p ref={alert} tabIndex={-1} role="status" className="break-words">
          {message}
        </p>
      )}
      {history.data && (
        <details>
          <summary className="min-h-11 cursor-pointer">
            Authorized cycle edit history
          </summary>
          {history.data.data.data
            .filter((entry) =>
              ["addMileage", "editVehicle", "setListedPrice"].includes(
                entry.action ?? ""
              )
            )
            .map((entry) => (
              <div
                key={entry.id}
                className="space-y-2 border-t py-3 break-words"
              >
                <p>
                  {entry.action} · {entry.at}
                </p>
                {entry.reason && <p>Reason: {entry.reason}</p>}
                <pre className="max-w-full overflow-auto break-words whitespace-pre-wrap">
                  {JSON.stringify(entry.fields, null, 2)}
                </pre>
              </div>
            ))}
        </details>
      )}
    </section>
  )
}
