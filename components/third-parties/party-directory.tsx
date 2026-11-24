"use client"
import { useState } from "react"
import {
  parseAsInteger,
  parseAsString,
  parseAsStringEnum,
  useQueryStates,
} from "nuqs"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Link from "next/link"
import {
  PartyForm,
  directoryFields,
  type VisibleParty,
  type DirectoryKind,
} from "./party-form"

export function PartyDirectory() {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const defaultKind = ability.can("read", "Supplier")
    ? "SUPPLIER"
    : ability.can("read", "RepairVendor")
      ? "REPAIR_VENDOR"
      : "FINANCE_COMPANY"
  const [{ type: kind, page: pageParam, q: search, active }, setFilters] =
    useQueryStates({
      type: parseAsStringEnum<DirectoryKind>([
        "SUPPLIER",
        "REPAIR_VENDOR",
        "FINANCE_COMPANY",
      ]).withDefault(defaultKind),
      page: parseAsInteger.withDefault(1),
      q: parseAsString.withDefault(""),
      active: parseAsStringEnum(["", "true", "false"]).withDefault(""),
    })
  const page = Math.max(1, pageParam)
  const type =
    kind === "FINANCE_COMPANY"
      ? "FinanceCompany"
      : kind === "SUPPLIER"
        ? "Supplier"
        : "RepairVendor"
  const [form, setForm] = useState<{ initial?: VisibleParty } | null>(null)
  const [unresolved, setUnresolved] = useState(false)
  const [archive, setArchive] = useState<{
    row: VisibleParty
    reason: string
    body?: string
    stale?: boolean
  } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const queries = useQueryClient()
  const query = useQuery({
    queryKey: ["parties", kind, search, page, active],
    retry: false,
    queryFn: () =>
      privateRequest<{
        data: { data: VisibleParty[]; total: number; pageSize: number }
      }>(
        `/api/v1/queries/parties?type=${kind}&page=${page}&pageSize=20&q=${encodeURIComponent(search)}${active ? `&active=${active}` : ""}`
      ),
  })
  const list = query.data?.data
  const locked = unresolved || !!archive?.body || pending
  async function changeStatus() {
    if (!archive || !archive.reason.trim() || archive.stale || pending) return
    const body =
      archive.body ??
      JSON.stringify({
        schemaVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        expected: [
          { type, id: archive.row.id, revision: archive.row.revision },
        ],
        input: {
          type: kind,
          id: archive.row.id,
          active: !archive.row.active,
          reason: archive.reason.trim(),
        },
      })
    setArchive({ ...archive, body })
    setPending(true)
    setError("")
    try {
      await privateRequest("/api/v1/commands/archiveParty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      setArchive(null)
      await queries.invalidateQueries({ queryKey: ["parties"] })
      await queries.invalidateQueries({ queryKey: ["party"] })
    } catch (cause) {
      const code = cause instanceof RequestError ? cause.code : "NETWORK_ERROR"
      const stale = ["STALE_REVISION", "REVISION_REQUIRED"].includes(code)
      const retain =
        !(cause instanceof RequestError) ||
        cause.status >= 500 ||
        ["COMMAND_IN_PROGRESS", "IDEMPOTENCY_MISMATCH"].includes(code) ||
        stale
      setArchive({ ...archive, body: retain ? body : undefined, stale })
      setError(
        `${code}. Reason and intent retained; retry sends the identical command.`
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Third parties</h1>
        <p className="text-sm text-muted-foreground">
          Persistent directories. Archived entries and former contacts remain
          retained.
        </p>
      </header>
      <nav aria-label="Directory categories" className="flex flex-wrap gap-3">
        {(["SUPPLIER", "REPAIR_VENDOR", "FINANCE_COMPANY"] as const).map(
          (value) => (
            <Button
              key={value}
              variant={kind === value ? "default" : "outline"}
              disabled={
                locked ||
                !ability.can(
                  "read",
                  value === "FINANCE_COMPANY"
                    ? "FinanceCompany"
                    : value === "SUPPLIER"
                      ? "Supplier"
                      : "RepairVendor"
                )
              }
              onClick={() => {
                void setFilters({ type: value, page: 1, q: "" })
                setForm(null)
                setArchive(null)
              }}
            >
              {value === "SUPPLIER"
                ? "Suppliers"
                : value === "REPAIR_VENDOR"
                  ? "Repair vendors"
                  : "Finance companies"}
            </Button>
          )
        )}
      </nav>
      <p className="text-sm text-muted-foreground">
        Open an entry to see its linked purchases, repairs or finance records.
      </p>
      {(form || ability.can("create", type)) && (
        <Button
          disabled={locked}
          onClick={() => {
            setForm(form ? null : {})
            setArchive(null)
          }}
        >
          {form ? "Close directory form" : "New entry"}
        </Button>
      )}
      {form && (
        <PartyForm
          key={`${kind}:${form.initial?.id ?? "new"}`}
          kind={kind}
          initial={form.initial}
          onUnresolvedChange={setUnresolved}
          onSaved={() => setForm(null)}
          onReload={async () => {
            if (!form.initial?.id) return undefined
            return (
              await privateRequest<{ data: VisibleParty }>(
                `/api/v1/queries/party?type=${kind}&id=${form.initial.id}`
              )
            ).data
          }}
        />
      )}
      {unresolved && (
        <p role="status">
          Keep this page open to resolve the unchanged command. Navigation and
          other writes are disabled here.
        </p>
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void setFilters({
            q: String(new FormData(e.currentTarget).get("q") ?? ""),
            page: 1,
          })
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="party-search">Search name</Label>
          <Input
            id="party-search"
            key={kind + ":" + search}
            name="q"
            defaultValue={search}
            maxLength={200}
            className="min-h-11 text-base"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="party-active">Status</Label>
          <select
            id="party-active"
            value={active}
            onChange={(e) => {
              const value = e.target.value
              void setFilters({
                active: value === "true" || value === "false" ? value : "",
                page: 1,
              })
            }}
            className="min-h-11 rounded-md border bg-background px-3"
          >
            <option value="">All retained entries</option>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {query.isPending && <p role="status">Loading directory…</p>}
      {query.isError && (
        <p role="alert">
          Directory unavailable.{" "}
          {query.error instanceof RequestError
            ? query.error.code
            : "Request failed"}
        </p>
      )}
      {list && (
        <>
          <p role="status">{list.total} entries</p>
          <ul className="space-y-4">
            {list.data.map((row, i) => (
              <li key={row.id ?? i} className="space-y-4 rounded-lg border p-4">
                <h2 className="font-semibold break-words">
                  {row.name ?? "Name unavailable"} ·{" "}
                  {row.active === undefined
                    ? "Status unavailable"
                    : row.active
                      ? "Active"
                      : "Archived"}
                </h2>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {directoryFields
                    .filter(() => kind !== "FINANCE_COMPANY")
                    .filter(
                      ([f]) => kind !== "SUPPLIER" || f !== "specialisation"
                    )
                    .map(([f, label]) => (
                      <div key={f}>
                        <dt className="text-sm text-muted-foreground">
                          {label}
                        </dt>
                        <dd className="break-words">
                          {row.directory?.[f] ??
                            (row.redactedFields?.includes(`directory.${f}`) ||
                            row.redactedFields?.includes("directory")
                              ? "Unavailable"
                              : "Not provided")}
                        </dd>
                      </div>
                    ))}
                  {kind !== "FINANCE_COMPANY" && (
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        Category
                      </dt>
                      <dd>{row.directory?.category ?? "Unavailable"}</dd>
                    </div>
                  )}
                  {kind !== "FINANCE_COMPANY" && (
                    <div>
                      <dt className="text-sm text-muted-foreground">
                        Recurring
                      </dt>
                      <dd>
                        {row.directory?.recurring === undefined
                          ? "Unavailable"
                          : row.directory.recurring
                            ? "Yes"
                            : "No"}
                      </dd>
                    </div>
                  )}
                  {kind === "FINANCE_COMPANY" && (
                    <div>
                      <dt>Finance policy</dt>
                      <dd>
                        <pre className="text-sm break-words whitespace-pre-wrap">
                          {row.policy
                            ? JSON.stringify(row.policy, null, 2)
                            : "Unavailable"}
                        </pre>
                      </dd>
                    </div>
                  )}
                </dl>
                <section aria-label="Current contacts">
                  <h3 className="font-medium">Contacts</h3>
                  {row.contacts === undefined ? (
                    <p>Unavailable</p>
                  ) : row.contacts.length ? (
                    row.contacts.map((c, j) => (
                      <p key={c.id ?? j} className="break-words">
                        {c.name} · {c.role} · {c.phone}
                        {c.email ? ` · ${c.email}` : ""}
                        {c.primary ? " · Primary" : ""}
                      </p>
                    ))
                  ) : (
                    <p>No current contacts</p>
                  )}
                </section>
                <div className="flex flex-wrap gap-3">
                  {row.id && !locked && (
                    <Button variant="outline" asChild>
                      <Link
                        prefetch={false}
                        href={`/third-parties/${row.id}?type=${kind}`}
                      >
                        View details
                      </Link>
                    </Button>
                  )}
                  {row.id && row.revision && ability.can("update", type) && (
                    <Button
                      variant="outline"
                      disabled={locked}
                      onClick={() => {
                        setForm({ initial: row })
                        setArchive(null)
                      }}
                    >
                      Edit {row.name ?? "entry"}
                    </Button>
                  )}
                  {row.id &&
                    row.revision &&
                    row.active !== undefined &&
                    ability.can("archive", type, "active") && (
                      <Button
                        variant="outline"
                        disabled={locked}
                        onClick={() => {
                          setArchive({ row, reason: "" })
                          setForm(null)
                          setError("")
                        }}
                      >
                        {row.active ? "Archive" : "Reactivate"}{" "}
                        {row.name ?? "entry"}
                      </Button>
                    )}
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => void setFilters({ page: page - 1 })}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * list.pageSize >= list.total}
              onClick={() => void setFilters({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </>
      )}
      {archive && (
        <form
          className="space-y-3 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault()
            void changeStatus()
          }}
        >
          <h2 className="font-semibold">
            {archive.row.active ? "Archive" : "Reactivate"} {archive.row.name}
          </h2>
          <Label htmlFor="party-archive-reason">Reason *</Label>
          <Input
            id="party-archive-reason"
            required
            value={archive.reason}
            maxLength={2000}
            disabled={pending || !!archive.body}
            onChange={(e) => setArchive({ ...archive, reason: e.target.value })}
            className="min-h-11 text-base"
          />
          {error && <p role="alert">{error}</p>}
          <Button type="submit" disabled={pending || archive.stale}>
            {pending
              ? "Saving…"
              : archive.body
                ? "Retry unchanged status command"
                : "Confirm status change"}
          </Button>
          {archive.stale && (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const result = await query.refetch()
                if (!result.isError) {
                  setArchive(null)
                  setError("")
                }
              }}
            >
              Discard stale intent and reload current entries
            </Button>
          )}
        </form>
      )}
    </section>
  )
}
