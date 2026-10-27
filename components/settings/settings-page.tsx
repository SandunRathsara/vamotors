"use client"

import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  QueryData,
  SettingsInput,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { settingsInput, settingsCommand } from "@/lib/server/validators"
import { abilityFor } from "@/lib/server/permissions"
import { useActor } from "@/components/providers/auth-boundary"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Row = QueryData["settings"]
type Read = Visible<Row> & { redactedFields?: string[] }
const readSettings = () =>
  privateRequest<{ data: Read }>("/api/v1/queries/settings")
const complete = (row: Read | undefined): row is Row =>
  !!row?.id &&
  !!row.revision &&
  !!row.policyVersion &&
  !row.redactedFields?.length &&
  settingsInput.safeParse(
    Object.fromEntries(
      Object.entries(row).filter(
        ([key]) =>
          !["id", "revision", "policyVersion", "redactedFields"].includes(key)
      )
    )
  ).success
const labels: Record<string, string> = {
  "company.name": "Company name",
  "company.identity": "Company identity",
  "company.address": "Company address",
  "company.phone": "Company phone",
  "company.email": "Company email",
  declarations: "Declarations",
  currency: "Currency",
  scale: "Currency scale",
  timezone: "Timezone",
  tiers: "Reservation tiers",
  warningLeadDays: "Warning lead days",
  processingFee: "Processing fee (minor units)",
  dateFormat: "Date format",
  itemsPerPage: "Items per page",
  theme: "Theme",
}

/** Keep the editor outside query-data conditionals: Activity/focus/refetch may
 * remove query data, never the complete unresolved request or opening CAS. */
export function SettingsPage() {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: readSettings,
    retry: false,
  })
  const [opening, setOpening] = useState<Row | null>(null)
  const [saved, setSaved] = useState(false)
  const row = query.data?.data
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Versioned company, reservation and display policy. Historical amounts
          and policy snapshots are unchanged.
        </p>
      </header>
      {query.isPending && <p role="status">Loading persisted settings…</p>}
      {query.isError && (
        <div role="alert">
          Settings read failed. No defaults have been substituted.{" "}
          {opening && "Your draft and pending request are retained."}{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry settings read
          </Button>
        </div>
      )}
      {saved && (
        <p role="status">Settings saved. Reload reads the committed policy.</p>
      )}
      {opening ? (
        <SettingsEditor
          initial={opening}
          onSaved={() => {
            setOpening(null)
            setSaved(true)
          }}
          onClose={() => setOpening(null)}
        />
      ) : (
        <>
          {row && (
            <>
              <p>
                CAS revision: {row.revision ?? "Not readable"} · Policy version:{" "}
                {row.policyVersion ?? "Not readable"}
              </p>
              <SettingsSummary row={row} />
            </>
          )}
          {row && !complete(row) && (
            <p role="status">
              Full-object editing unavailable: required settings fields or
              references are not readable. No replacement values will be
              fabricated.
            </p>
          )}
          {complete(row) &&
            (ability.can("update", "Settings") ? (
              <Button
                onClick={() => {
                  setOpening(structuredClone(row))
                  setSaved(false)
                }}
              >
                Edit settings
              </Button>
            ) : (
              <p role="status">Settings are read-only for your account.</p>
            ))}
        </>
      )}
    </section>
  )
}

function SettingsSummary({ row }: { row: Read }) {
  const entries = Object.entries(row).flatMap(([key, value]) => {
    if (["redactedFields", "id", "revision", "policyVersion"].includes(key))
      return []
    if (key === "company")
      return Object.entries(value ?? {}).map(([child, text]) => [
        `company.${child}`,
        String(text),
      ])
    if (key === "tiers" && Array.isArray(value))
      return [
        [
          key,
          (value as Row["tiers"])
            .map(
              (tier) =>
                `${tier.upperBps === null ? "Unbounded" : `${tier.upperBps} bps`}: ${tier.days} days`
            )
            .join("; "),
        ],
      ]
    return [[key, Array.isArray(value) ? value.join("; ") : String(value)]]
  })
  return (
    <dl className="grid min-w-0 gap-4 rounded-lg border p-4 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="text-sm text-muted-foreground">
            {labels[key] ?? key}
          </dt>
          <dd className="break-words whitespace-pre-wrap">{value || "None"}</dd>
        </div>
      ))}
    </dl>
  )
}

function SettingsEditor({
  initial,
  onSaved,
  onClose,
}: {
  initial: Row
  onSaved: () => void
  onClose: () => void
}) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const queries = useQueryClient()
  const form = useRef<HTMLFormElement>(null)
  const [draft, setDraft] = useState(() => ({
    ...settingsInput.parse(
      Object.fromEntries(
        Object.entries(initial).filter(
          ([key]) =>
            !["id", "revision", "policyVersion", "redactedFields"].includes(key)
        )
      )
    ),
    warningLeadDays: String(initial.warningLeadDays),
    tiers: initial.tiers.map((t) => ({
      upperBps: t.upperBps === null ? "" : String(t.upperBps),
      days: String(t.days),
    })),
  }))
  const [reference, setReference] = useState({
    id: initial.id,
    revision: initial.revision,
  })
  const [reason, setReason] = useState("")
  const [command, setCommand] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [stale, setStale] = useState(false)
  const [rejected, setRejected] = useState(false)
  const [latest, setLatest] = useState<Row | null>(null)
  const [error, setError] = useState("")
  const [invalid, setInvalid] = useState<string[]>([])
  const writable = (path: string) => ability.can("update", "Settings", path)
  const locked = pending || !!command
  function report(message: string, paths: string[] = []) {
    setError(message)
    setInvalid(paths)
    const control =
      paths[0] &&
      form.current?.querySelector<HTMLElement>(`[id="settings-${paths[0]}"]`)
    if (control) control.focus()
    else form.current?.querySelector<HTMLElement>("[role=alert]")?.focus()
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || stale) return
    let body = command
    if (!body) {
      const parsed = settingsCommand.safeParse({
        ...draft,
        reason,
        warningLeadDays: draft.warningLeadDays.trim()
          ? Number(draft.warningLeadDays)
          : NaN,
        tiers: draft.tiers.map((tier, i) => ({
          upperBps:
            i === draft.tiers.length - 1
              ? null
              : tier.upperBps.trim()
                ? Number(tier.upperBps)
                : NaN,
          days: tier.days.trim() ? Number(tier.days) : NaN,
        })),
      })
      if (!parsed.success) {
        report(
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          parsed.error.issues.map((issue) => issue.path.join("."))
        )
        return
      }
      body = JSON.stringify({
        schemaVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        expected: [{ type: "Settings", ...reference }],
        input: parsed.data,
      })
      setCommand(body)
    }
    setPending(true)
    setError("")
    setInvalid([])
    try {
      await privateRequest<Applied>("/api/v1/commands/updateSettings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      setCommand(null)
      await Promise.all(
        ["settings", "parties", "party"].map((key) =>
          queries.invalidateQueries({ queryKey: [key] })
        )
      )
      onSaved()
    } catch (cause) {
      const code = cause instanceof RequestError ? cause.code : "NETWORK_ERROR"
      setStale(["STALE_REVISION", "REVISION_REQUIRED"].includes(code))
      setRejected(
        cause instanceof RequestError &&
          cause.status < 500 &&
          ![
            "STALE_REVISION",
            "REVISION_REQUIRED",
            "IDEMPOTENCY_MISMATCH",
            "COMMAND_IN_PROGRESS",
          ].includes(code)
      )
      // Even a definitive rejection needs an explicit new-intent action. Never
      // rotate an unresolved key, including mismatches and transient read loss.
      report(
        `${code}. Draft, reason and exact request retained. Retry sends the identical request; a stale edit requires refetch and explicit reconfirmation.`
      )
    } finally {
      setPending(false)
    }
  }
  async function reload() {
    setPending(true)
    try {
      const result = await readSettings()
      if (!complete(result.data)) throw new Error("FULL_SETTINGS_NOT_READABLE")
      setLatest(result.data)
    } catch {
      report(
        "Latest settings could not be read in full. Draft, reason and original request retained."
      )
    } finally {
      setPending(false)
    }
  }
  const textField = (
    path: string,
    value: string,
    change: (value: string) => void,
    type = "text"
  ) => (
    <div className="min-w-0 space-y-2" key={path}>
      <Label htmlFor={`settings-${path}`}>{labels[path] ?? path}</Label>
      <Input
        id={`settings-${path}`}
        type={type}
        value={value}
        disabled={locked || !writable(path)}
        aria-invalid={invalid.includes(path)}
        onChange={(e) => change(e.target.value)}
        className="min-h-11"
      />
    </div>
  )
  const selectField = <K extends "dateFormat" | "itemsPerPage" | "theme">(
    key: K,
    options: readonly SettingsInput[K][]
  ) => (
    <div className="space-y-2" key={key}>
      <Label htmlFor={`settings-${key}`}>{labels[key]}</Label>
      <select
        id={`settings-${key}`}
        className="min-h-11 w-full rounded-md border bg-background px-3"
        value={draft[key]}
        disabled={locked || !writable(key)}
        onChange={(e) =>
          setDraft({
            ...draft,
            [key]:
              key === "itemsPerPage" ? Number(e.target.value) : e.target.value,
          })
        }
      >
        {options.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </select>
    </div>
  )
  return (
    <form
      ref={form}
      onSubmit={submit}
      noValidate
      className="space-y-6 rounded-lg border p-4 sm:p-6"
    >
      <h2 className="text-lg font-semibold">Edit settings</h2>
      <p>
        Opening CAS revision: {reference.revision} · Persisted policy version:{" "}
        {initial.policyVersion}. Unchanged fields do not require update
        permission.
      </p>
      <div
        role="alert"
        tabIndex={-1}
        className={
          error ? "rounded border border-destructive p-3 text-destructive" : ""
        }
      >
        {error}
      </div>
      <fieldset className="space-y-4">
        <legend className="mb-3 font-semibold">Company</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(initial.company) as (keyof Row["company"])[]).map(
            (key) =>
              textField(
                `company.${key}`,
                draft.company[key],
                (value) =>
                  setDraft({
                    ...draft,
                    company: { ...draft.company, [key]: value },
                  }),
                key === "email" ? "email" : key === "phone" ? "tel" : "text"
              )
          )}
        </div>
      </fieldset>
      <fieldset
        disabled={locked || !writable("declarations")}
        className="space-y-3"
      >
        <legend className="mb-3 font-semibold">Declarations</legend>
        {draft.declarations.map((text, index) => (
          <div key={index} className="space-y-2">
            <Label htmlFor={`settings-declarations.${index}`}>
              Declaration {index + 1}
            </Label>
            <textarea
              id={`settings-declarations.${index}`}
              className="min-h-24 w-full rounded-md border bg-background p-3"
              value={text}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  declarations: draft.declarations.map((old, i) =>
                    i === index ? e.target.value : old
                  ),
                })
              }
            />
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setDraft({
                  ...draft,
                  declarations: draft.declarations.filter(
                    (_, i) => i !== index
                  ),
                })
              }
            >
              Remove declaration {index + 1}
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={draft.declarations.length >= 100}
          onClick={() =>
            setDraft({ ...draft, declarations: [...draft.declarations, ""] })
          }
        >
          Add declaration
        </Button>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-3 font-semibold">Policy</legend>
        <p className="text-sm text-muted-foreground">
          Currency and scale are frozen after the first business row. Timezone
          changes apply only to future policy snapshots. Fees are explicit
          minor-unit amounts, not lender policy overrides.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {textField("currency", draft.currency, (currency) =>
            setDraft({ ...draft, currency })
          )}
          <div className="space-y-2">
            <Label htmlFor="settings-scale">Currency scale</Label>
            <Input
              id="settings-scale"
              value="2"
              readOnly
              className="min-h-11"
            />
            <p className="text-sm text-muted-foreground">
              Only scale 2 is supported.
            </p>
          </div>
          {textField("timezone", draft.timezone, (timezone) =>
            setDraft({ ...draft, timezone })
          )}
          {textField(
            "warningLeadDays",
            draft.warningLeadDays,
            (warningLeadDays) => setDraft({ ...draft, warningLeadDays }),
            "number"
          )}
          {textField("processingFee", draft.processingFee, (processingFee) =>
            setDraft({ ...draft, processingFee })
          )}
        </div>
      </fieldset>
      <fieldset disabled={locked || !writable("tiers")} className="space-y-4">
        <legend className="mb-3 font-semibold">Reservation tiers</legend>
        <p className="text-sm text-muted-foreground">
          Inclusive increasing bounds in basis points (500 = 5%). The final tier
          is unbounded. Days: 1–31.
        </p>
        {draft.tiers.map((tier, index) => (
          <div
            key={index}
            className="grid gap-3 rounded border p-3 sm:grid-cols-3"
          >
            <div className="space-y-2">
              <Label htmlFor={`settings-tiers.${index}.upperBps`}>
                Tier {index + 1} upper bound (bps)
              </Label>
              <Input
                id={`settings-tiers.${index}.upperBps`}
                className="min-h-11"
                type={index === draft.tiers.length - 1 ? "text" : "number"}
                readOnly={index === draft.tiers.length - 1}
                value={
                  index === draft.tiers.length - 1 ? "Unbounded" : tier.upperBps
                }
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    tiers: draft.tiers.map((t, i) =>
                      i === index ? { ...t, upperBps: e.target.value } : t
                    ),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`settings-tiers.${index}.days`}>
                Tier {index + 1} days
              </Label>
              <Input
                id={`settings-tiers.${index}.days`}
                className="min-h-11"
                type="number"
                value={tier.days}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    tiers: draft.tiers.map((t, i) =>
                      i === index ? { ...t, days: e.target.value } : t
                    ),
                  })
                }
              />
            </div>
            {index < draft.tiers.length - 1 && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 self-end"
                onClick={() =>
                  setDraft({
                    ...draft,
                    tiers: draft.tiers.filter((_, i) => i !== index),
                  })
                }
              >
                Remove tier {index + 1}
              </Button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={draft.tiers.length >= 100}
          onClick={() =>
            setDraft({
              ...draft,
              tiers: [
                ...draft.tiers.slice(0, -1),
                { upperBps: "", days: "" },
                draft.tiers.at(-1)!,
              ],
            })
          }
        >
          Add bounded tier
        </Button>
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="mb-3 font-semibold">Display</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {selectField("dateFormat", ["YYYY-MM-DD", "DD/MM/YYYY"])}
          {selectField("itemsPerPage", [10, 20, 50, 100])}
          {selectField("theme", ["SYSTEM", "LIGHT", "DARK"])}
        </div>
      </fieldset>
      <div className="space-y-2">
        <Label htmlFor="settings-reason">Reason (required)</Label>
        <Input
          id="settings-reason"
          className="min-h-11"
          value={reason}
          disabled={locked}
          aria-invalid={invalid.includes("reason")}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {command && (
        <p role="status">
          An immutable request is retained. Fields and reason are locked until
          its outcome is resolved or a rejected/stale intent is explicitly
          replaced.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button className="min-h-11" disabled={pending || stale} type="submit">
          {pending
            ? "Saving…"
            : command
              ? "Retry identical request"
              : "Save settings"}
        </Button>
        {!command && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onClose}
          >
            Discard draft
          </Button>
        )}
        {stale && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => void reload()}
          >
            Refetch latest for reconciliation
          </Button>
        )}
        {command && rejected && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setCommand(null)
              setRejected(false)
              setError(
                "Rejected intent explicitly reopened. Save creates a new request key."
              )
            }}
          >
            Edit rejected intent
          </Button>
        )}
      </div>
      {latest && stale && (
        <section className="space-y-4 rounded border p-4">
          <h3 className="font-semibold">
            Review current policy before a new intent
          </h3>
          <p>
            Current CAS revision {latest.revision}; policy version{" "}
            {latest.policyVersion}. Your retained draft will replace these
            values.
          </p>
          <SettingsSummary row={latest} />
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setReference({ id: latest.id, revision: latest.revision })
              setLatest(null)
              setCommand(null)
              setStale(false)
              setError(
                "Reconfirmed against the reviewed revision. Save settings creates a new request key."
              )
            }}
          >
            Reconfirm draft against reviewed revision
          </Button>
        </section>
      )}
    </form>
  )
}
