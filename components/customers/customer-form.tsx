"use client"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  CustomerDTO,
  CustomerInput,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { privateRequest, RequestError } from "@/lib/security-client"
import { customerInput } from "@/lib/server/validators"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"

export const customerFields = [
  ["fullName", "Full name", true],
  ["callingName", "Calling name", true],
  ["nicOrPassport", "NIC or passport", true],
  ["address", "Address", true],
  ["phone", "Phone", true],
  ["email", "Email", false],
  ["drivingLicence", "Driving licence", false],
  ["notes", "Notes", false],
] as const
export type VisibleCustomer = Visible<CustomerDTO> & {
  redactedFields?: string[]
}
export function CustomerForm({
  initial,
  onSaved,
}: {
  initial?: VisibleCustomer
  onSaved: (result: Applied) => void
}) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const queries = useQueryClient()
  const [draft, setDraft] = useState(
    () =>
      Object.fromEntries(
        customerFields.map(([field]) => [field, initial?.[field] ?? ""])
      ) as Record<keyof CustomerInput, string>
  )
  const [reason, setReason] = useState("")
  const [key, setKey] = useState<string | null>(null)
  const [revision, setRevision] = useState(initial?.revision)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [stale, setStale] = useState(false)
  const [latest, setLatest] = useState<VisibleCustomer | null>(null)
  const blocked =
    initial &&
    (!initial.id ||
      !revision ||
      customerFields.some(([f]) => initial.redactedFields?.includes(f)))
  async function reload() {
    setPending(true)
    try {
      const result = await privateRequest<{ data: VisibleCustomer }>(
        `/api/v1/queries/customer?id=${initial!.id}`
      )
      setLatest(result.data)
    } catch {
      setError("Unable to reload current customer. Your draft is retained.")
    } finally {
      setPending(false)
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || stale || blocked) return
    const parsed = customerInput.safeParse(
      Object.fromEntries(
        Object.entries(draft).filter(
          ([field, value]) =>
            customerFields.find(([f]) => f === field)?.[2] || value.trim()
        )
      )
    )
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")
      )
      return
    }
    const currentKey = key ?? crypto.randomUUID()
    setKey(currentKey)
    setPending(true)
    setError("")
    try {
      const result = await privateRequest<Applied>(
        `/api/v1/commands/${initial ? "updateCustomer" : "createCustomer"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schemaVersion: 1,
            idempotencyKey: currentKey,
            expected: initial
              ? [{ type: "Customer", id: initial.id, revision }]
              : [],
            input: initial
              ? {
                  id: initial.id,
                  values: parsed.data,
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                }
              : parsed.data,
          }),
        }
      )
      await queries.invalidateQueries({ queryKey: ["customers"] })
      onSaved(result)
    } catch (cause) {
      const code = cause instanceof RequestError ? cause.code : "NETWORK_ERROR"
      setStale(["STALE_REVISION", "REVISION_REQUIRED"].includes(code))
      setError(
        `${code}. Your draft is retained. A network retry keeps the same key; stale edits require reload and explicit reconfirmation.`
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5">
      {blocked && (
        <p role="status">
          Editing is unavailable because required fields or revision references
          are not readable.
        </p>
      )}
      <fieldset
        disabled={pending || !!blocked}
        className="grid min-w-0 gap-4 sm:grid-cols-2"
      >
        {customerFields.map(([field, label, required]) => (
          <div
            key={field}
            className={
              field === "notes" || field === "address"
                ? "space-y-2 sm:col-span-2"
                : "space-y-2"
            }
          >
            <Label htmlFor={`customer-${field}`}>
              {label}
              {required ? " *" : " (optional)"}
            </Label>
            <Input
              id={`customer-${field}`}
              name={field}
              disabled={
                !ability.can(initial ? "update" : "create", "Customer", field)
              }
              required={required}
              type={
                field === "email" ? "email" : field === "phone" ? "tel" : "text"
              }
              autoComplete={
                field === "fullName"
                  ? "name"
                  : field === "phone"
                    ? "tel"
                    : field === "email"
                      ? "email"
                      : "off"
              }
              minLength={field === "phone" ? 3 : required ? 1 : undefined}
              maxLength={
                field === "phone"
                  ? 30
                  : field === "email"
                    ? 254
                    : ["fullName", "callingName"].includes(field)
                      ? 200
                      : ["nicOrPassport", "drivingLicence"].includes(field)
                        ? 100
                        : 2000
              }
              value={draft[field]}
              onChange={(e) => {
                setDraft({ ...draft, [field]: e.target.value })
                setKey(null)
              }}
              className="min-h-11 text-base"
            />
          </div>
        ))}
        {initial && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="customer-reason">
              Correction reason (required when changing identity)
            </Label>
            <Input
              id="customer-reason"
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setKey(null)
              }}
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
        <section
          className="space-y-3 rounded-md border p-4"
          aria-label="Conflict resolution"
        >
          <p>
            This record changed. Reload current values, compare them with your
            retained draft, then explicitly reconfirm.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={reload}
          >
            Reload current customer
          </Button>
          {latest && (
            <>
              <dl className="grid gap-2 text-sm">
                {customerFields.map(([f, label]) => (
                  <div key={f}>
                    <dt className="font-medium">
                      Current {label.toLowerCase()}
                    </dt>
                    <dd className="break-words">
                      {latest[f] ?? "Not provided or unavailable"}
                    </dd>
                  </div>
                ))}
              </dl>
              <Button
                type="button"
                className="h-auto min-h-11 max-w-full whitespace-normal"
                disabled={
                  !latest.revision ||
                  customerFields.some(([f]) =>
                    latest.redactedFields?.includes(f)
                  )
                }
                onClick={() => {
                  setRevision(latest.revision)
                  setKey(null)
                  setStale(false)
                  setError("")
                  setLatest(null)
                }}
              >
                Reconfirm retained draft against revision {latest.revision}
              </Button>
            </>
          )}
        </section>
      )}
      <Button
        type="submit"
        disabled={pending || stale || !!blocked}
        className="min-h-11"
      >
        {pending
          ? "Saving…"
          : initial
            ? "Save customer changes"
            : "Create customer"}
      </Button>
    </form>
  )
}
