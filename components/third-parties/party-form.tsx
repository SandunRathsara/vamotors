"use client"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  DirectoryInput,
  PartyDTO,
  Visible,
  QueryData,
} from "@/.planning/implementation/contracts/api"
import { directoryInput, financeInput } from "@/lib/server/validators"
import { parseMajor, major } from "@/lib/money"
import { privateRequest, RequestError } from "@/lib/security-client"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

export type DirectoryKind = "SUPPLIER" | "REPAIR_VENDOR" | "FINANCE_COMPANY"
export type VisibleParty = Visible<PartyDTO> & { redactedFields?: string[] }
export const directoryFields = [
  ["name", "Name"],
  ["nicOrRegNumber", "NIC or registration number"],
  ["address", "Address"],
  ["phone", "Phone"],
  ["hotline", "Hotline"],
  ["specialisation", "Specialisation"],
  ["notes", "Notes"],
] as const
export function PartyForm({
  kind,
  initial,
  onSaved,
  onUnresolvedChange,
  onReload,
}: {
  kind: DirectoryKind
  initial?: VisibleParty
  onSaved: (result: Applied) => void
  onUnresolvedChange: (value: boolean) => void
  onReload: () => Promise<VisibleParty | undefined>
}) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const finance = kind === "FINANCE_COMPANY"
  const type = finance
    ? "FinanceCompany"
    : kind === "SUPPLIER"
      ? "Supplier"
      : "RepairVendor"
  const action = initial ? "update" : "create"
  const queries = useQueryClient()
  const [draft, setDraft] = useState(() => ({
    name: initial?.directory?.name ?? initial?.name ?? "",
    category: initial?.directory?.category ?? "INDIVIDUAL",
    nicOrRegNumber: initial?.directory?.nicOrRegNumber ?? "",
    address: initial?.directory?.address ?? "",
    phone: initial?.directory?.phone ?? "",
    hotline: initial?.directory?.hotline ?? "",
    specialisation: initial?.directory?.specialisation ?? "",
    notes: initial?.directory?.notes ?? "",
    recurring: initial?.directory?.recurring ?? false,
    contacts: (
      (finance ? initial?.contacts : initial?.directory?.contacts) ?? []
    ).map((c) => ({
      name: c.name ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      role: c.role ?? "",
      primary: c.primary ?? false,
    })),
  }))
  const [reason, setReason] = useState("")
  const [policy, setPolicy] = useState(() => ({
    path: initial?.policy?.path ?? "APPLICATION",
    basis: initial?.policy?.commission?.basis ?? "FINANCED_PRINCIPAL",
    rateBps: String(initial?.policy?.commission?.rateBps ?? ""),
    fixed:
      initial?.policy?.commission?.basis === "FIXED" &&
      initial.policy.commission.fixed !== undefined
        ? major(BigInt(initial.policy.commission.fixed))
        : "",
    processingFee:
      initial?.policy?.processingFee !== undefined
        ? major(BigInt(initial.policy.processingFee))
        : "",
    reconciliationMethod:
      initial?.policy?.reconciliationMethod ?? "PERIOD_NOTICE",
  }))
  const settings = useQuery({
    queryKey: ["settings"],
    enabled: finance,
    retry: false,
    queryFn: () =>
      privateRequest<{ data: Visible<QueryData["settings"]> }>(
        "/api/v1/queries/settings"
      ),
  })
  const [settingsRef, setSettingsRef] = useState<{
    id: string
    revision: number
  } | null>(null)
  const [command, setCommand] = useState<{ url: string; body: string } | null>(
    null
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  const [revision, setRevision] = useState(initial?.revision)
  const [latest, setLatest] = useState<VisibleParty | null>(null)
  const blocked =
    !!initial &&
    (!initial.id ||
      !initial.revision ||
      initial.redactedFields?.some((f) =>
        finance
          ? f === "name" ||
            f === "contacts" ||
            f === "policy" ||
            f.startsWith("policy.")
          : f === "directory" || f.startsWith("directory.")
      ))
  const dependency = settingsRef ?? settings.data?.data
  const missingSettings = finance && (!dependency?.id || !dependency.revision)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || stale || blocked || (missingSettings && !command)) return
    const values = {
      ...Object.fromEntries(
        Object.entries(draft)
          .filter(([key]) => key !== "specialisation" || kind !== "SUPPLIER")
          .filter(([, value]) => typeof value !== "string" || !!value.trim())
      ),
      contacts: draft.contacts.map((c) => ({
        ...c,
        ...(c.email.trim() ? { email: c.email } : { email: undefined }),
      })),
    }
    let financeValues: unknown
    if (finance) {
      try {
        financeValues = {
          name: draft.name,
          contacts: values.contacts,
          policy: {
            path: policy.path,
            commission: {
              basis: policy.basis,
              rateBps: policy.rateBps.trim() ? Number(policy.rateBps) : NaN,
              ...(policy.basis === "FIXED"
                ? { fixed: parseMajor(policy.fixed) }
                : {}),
            },
            processingFee: parseMajor(policy.processingFee),
            reconciliationMethod: policy.reconciliationMethod,
          },
        }
      } catch {
        setError(
          "Enter valid nonnegative money with at most two decimals. Draft retained."
        )
        return
      }
    }
    const parsed = finance
      ? financeInput.safeParse(financeValues)
      : directoryInput.safeParse(values)
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      )
      return
    }
    const submitted = command ?? {
      url: `/api/v1/commands/${finance ? (initial ? "updateFinanceCompany" : "createFinanceCompany") : initial ? "updateDirectoryParty" : "createDirectoryParty"}`,
      body: JSON.stringify({
        schemaVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        expected: [
          ...(initial ? [{ type, id: initial.id, revision }] : []),
          ...(finance
            ? [
                {
                  type: "Settings",
                  id: dependency!.id,
                  revision: dependency!.revision,
                },
              ]
            : []),
        ],
        input: {
          ...(finance
            ? parsed.data
            : { type: kind, values: parsed.data as DirectoryInput }),
          ...(initial ? { id: initial.id } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      }),
    }
    setCommand(submitted)
    onUnresolvedChange(true)
    setPending(true)
    setError("")
    try {
      const result = await privateRequest<Applied>(submitted.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: submitted.body,
      })
      setCommand(null)
      onUnresolvedChange(false)
      await queries.invalidateQueries({ queryKey: ["parties"] })
      await queries.invalidateQueries({ queryKey: ["party"] })
      onSaved(result)
    } catch (cause) {
      const code = cause instanceof RequestError ? cause.code : "NETWORK_ERROR"
      setStale(["STALE_REVISION", "REVISION_REQUIRED"].includes(code))
      if (
        cause instanceof RequestError &&
        cause.status < 500 &&
        ![
          "COMMAND_IN_PROGRESS",
          "IDEMPOTENCY_MISMATCH",
          "STALE_REVISION",
          "REVISION_REQUIRED",
        ].includes(code)
      ) {
        setCommand(null)
        onUnresolvedChange(false)
      }
      setError(
        `${code}. Draft retained. Retry sends the identical command. A stale edit needs a new, explicitly confirmed intent.`
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5 rounded-lg border p-4 sm:p-6">
      <h2 className="text-lg font-semibold">
        {initial ? "Edit directory entry" : "New directory entry"}
      </h2>
      {blocked && (
        <p role="status">
          Editing unavailable: required fields or revision are not readable.
        </p>
      )}
      {missingSettings && (
        <p role="status">
          Finance writes unavailable: actual Settings identity and revision must
          be readable. {settings.isError ? "Settings read failed." : ""}
        </p>
      )}
      <fieldset
        disabled={pending || !!command || !!blocked}
        className="grid min-w-0 gap-4 sm:grid-cols-2"
      >
        {directoryFields
          .filter(([key]) => !finance || key === "name")
          .filter(([key]) => kind !== "SUPPLIER" || key !== "specialisation")
          .map(([key, label]) => (
            <div key={key} className="space-y-2">
              <Label htmlFor={`party-${key}`}>
                {label}
                {key === "name" ? " *" : " (optional)"}
              </Label>
              <Input
                id={`party-${key}`}
                name={key}
                value={draft[key]}
                required={key === "name"}
                maxLength={
                  key === "name"
                    ? 200
                    : key === "nicOrRegNumber"
                      ? 100
                      : ["phone", "hotline"].includes(key)
                        ? 30
                        : 2000
                }
                disabled={!ability.can(action, type, key)}
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
                className="min-h-11 text-base"
              />
            </div>
          ))}
        {!finance && (
          <div className="space-y-2">
            <Label htmlFor="party-category">Category *</Label>
            <select
              id="party-category"
              value={draft.category}
              disabled={!ability.can(action, type, "category")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  category: e.target.value as "INDIVIDUAL" | "COMPANY",
                })
              }
              className="min-h-11 w-full rounded-md border bg-background px-3 text-base"
            >
              <option value="INDIVIDUAL">Individual</option>
              <option value="COMPANY">Company</option>
            </select>
          </div>
        )}
        {!finance && (
          <Label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.recurring}
              disabled={!ability.can(action, type, "recurring")}
              onChange={(e) =>
                setDraft({ ...draft, recurring: e.target.checked })
              }
            />
            Recurring
          </Label>
        )}
        {finance && (
          <section
            aria-label="Finance policy"
            className="space-y-4 sm:col-span-2"
          >
            <h3 className="font-semibold">Explicit company policy</h3>
            <p className="text-sm text-muted-foreground">
              Fees are this company’s policy, not copied from Settings. Money is
              entered in major currency units.
            </p>
            {(
              [
                ["path", "Processing path", ["APPLICATION", "REFERRAL"]],
                ["basis", "Commission basis", ["FINANCED_PRINCIPAL", "FIXED"]],
                [
                  "reconciliationMethod",
                  "Reconciliation method",
                  ["PERIOD_NOTICE", "PER_DEAL"],
                ],
              ] as const
            ).map(([key, label, options]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`finance-${key}`}>{label}</Label>
                <select
                  id={`finance-${key}`}
                  value={policy[key]}
                  disabled={
                    !ability.can(
                      action,
                      type,
                      key === "basis"
                        ? "policy.commission.basis"
                        : `policy.${key}`
                    )
                  }
                  onChange={(e) =>
                    setPolicy({ ...policy, [key]: e.target.value })
                  }
                  className="min-h-11 w-full rounded-md border bg-background px-3 text-base"
                >
                  {options.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </div>
            ))}
            {(
              [
                [
                  "rateBps",
                  "Commission rate (basis points, 0–10000)",
                  "policy.commission.rateBps",
                ],
                ["fixed", "Fixed commission", "policy.commission.fixed"],
                ["processingFee", "Processing fee", "policy.processingFee"],
              ] as const
            )
              .filter(([key]) => key !== "fixed" || policy.basis === "FIXED")
              .map(([key, label, field]) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`finance-${key}`}>{label} *</Label>
                  <Input
                    id={`finance-${key}`}
                    value={policy[key]}
                    required
                    maxLength={30}
                    inputMode={key === "rateBps" ? "numeric" : "decimal"}
                    disabled={!ability.can(action, type, field)}
                    onChange={(e) =>
                      setPolicy({ ...policy, [key]: e.target.value })
                    }
                    className="min-h-11 text-base"
                  />
                </div>
              ))}
          </section>
        )}
        <section className="space-y-4 sm:col-span-2" aria-label="Contacts">
          <h3 className="font-semibold">Contacts</h3>
          {draft.contacts.map((contact, index) => (
            <fieldset
              key={index}
              disabled={!ability.can(action, type, "contacts")}
              className="grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-2"
            >
              <legend>Contact {index + 1}</legend>
              {(["name", "phone", "email", "role"] as const).map((field) => (
                <div key={field} className="space-y-2">
                  <Label htmlFor={`contact-${index}-${field}`}>
                    {field}
                    {field === "email" ? " (optional)" : " *"}
                  </Label>
                  <Input
                    id={`contact-${index}-${field}`}
                    type={
                      field === "email"
                        ? "email"
                        : field === "phone"
                          ? "tel"
                          : "text"
                    }
                    required={field !== "email"}
                    maxLength={
                      field === "email" ? 254 : field === "phone" ? 30 : 200
                    }
                    value={contact[field]}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        contacts: draft.contacts.map((c, i) =>
                          i === index ? { ...c, [field]: e.target.value } : c
                        ),
                      })
                    }
                    className="min-h-11 text-base"
                  />
                </div>
              ))}
              <Label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={contact.primary}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      contacts: draft.contacts.map((c, i) =>
                        i === index ? { ...c, primary: e.target.checked } : c
                      ),
                    })
                  }
                />
                Primary contact
              </Label>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    contacts: draft.contacts.filter((_, i) => i !== index),
                  })
                }
              >
                Remove contact {index + 1}
              </Button>
            </fieldset>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={
              !ability.can(action, type, "contacts") ||
              draft.contacts.length >= 100
            }
            onClick={() =>
              setDraft({
                ...draft,
                contacts: [
                  ...draft.contacts,
                  { name: "", phone: "", email: "", role: "", primary: false },
                ],
              })
            }
          >
            Add contact
          </Button>
        </section>
        {initial && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="party-reason">
              Correction reason {finance ? "*" : "(optional)"}
            </Label>
            <Input
              id="party-reason"
              maxLength={2000}
              required={finance}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-11 text-base"
            />
          </div>
        )}
      </fieldset>
      {error && (
        <p role="alert" className="text-sm break-words text-destructive">
          {error}
        </p>
      )}
      {stale && (
        <p role="status">
          Close this stale intent, reload the directory, compare the current
          entry and explicitly open a new edit. Your retained draft is shown
          above; no revision is silently substituted.
        </p>
      )}
      {stale && (
        <section className="space-y-3" aria-label="Conflict resolution">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              try {
                const row = await onReload()
                if (finance) {
                  const refreshed = await settings.refetch()
                  if (
                    refreshed.isError ||
                    !refreshed.data?.data.id ||
                    !refreshed.data.data.revision
                  )
                    throw new Error("SETTINGS_UNAVAILABLE")
                  setSettingsRef({
                    id: refreshed.data.data.id,
                    revision: refreshed.data.data.revision,
                  })
                }
                if (row?.id === initial?.id && row?.revision) setLatest(row)
                else
                  setError(
                    "Current entry is not available on this authorized page. Draft retained; no new intent can be confirmed."
                  )
              } catch {
                setError("Reload failed. Draft retained.")
              } finally {
                setPending(false)
              }
            }}
          >
            Reload current directory entry
          </Button>
          {latest && (
            <>
              <pre className="overflow-auto rounded-md border p-3 text-sm">
                {JSON.stringify(finance ? latest : latest.directory, null, 2)}
              </pre>
              <Button
                type="button"
                disabled={
                  !latest.revision ||
                  latest.redactedFields?.some((f) =>
                    finance
                      ? f === "name" ||
                        f === "contacts" ||
                        f === "policy" ||
                        f.startsWith("policy.")
                      : f === "directory" || f.startsWith("directory.")
                  )
                }
                onClick={() => {
                  setRevision(latest.revision)
                  setCommand(null)
                  onUnresolvedChange(false)
                  setStale(false)
                  setLatest(null)
                  setError("")
                }}
              >
                Reconfirm retained draft against revision {latest.revision}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setCommand(null)
              onUnresolvedChange(false)
            }}
          >
            Discard stale command (keep draft visible)
          </Button>
        </section>
      )}
      <Button
        type="submit"
        disabled={
          pending || stale || !!blocked || (missingSettings && !command)
        }
        className="min-h-11"
      >
        {pending
          ? "Saving…"
          : command
            ? "Retry unchanged command"
            : initial
              ? "Save directory changes"
              : "Create directory entry"}
      </Button>
    </form>
  )
}
