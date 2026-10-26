"use client"
import Link from "next/link"
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { subject } from "@casl/ability"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  CustomerForm,
  customerFields,
  type VisibleCustomer,
} from "./customer-form"

export function CustomerDirectory({ id }: { id?: string }) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const queries = useQueryClient()
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState("")
  const [archiveKey, setArchiveKey] = useState<string | null>(null)
  const [archiveStale, setArchiveStale] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const query = useQuery({
    queryKey: ["customers", id ?? "list", search, page],
    queryFn: async () =>
      id
        ? privateRequest<{ data: VisibleCustomer }>(
            `/api/v1/queries/customer?id=${id}`
          )
        : privateRequest<{
            data: { data: VisibleCustomer[]; total: number; pageSize: number }
          }>(
            `/api/v1/queries/customers?page=${page}&pageSize=20&q=${encodeURIComponent(search)}`
          ),
    retry: false,
  })
  const row = id ? (query.data?.data as VisibleCustomer | undefined) : undefined
  const list = !id
    ? (query.data?.data as
        | { data: VisibleCustomer[]; total: number; pageSize: number }
        | undefined)
    : undefined
  const history = useQuery({
    queryKey: ["customers", id, "audit"],
    enabled: !!id && !!row?.id && ability.can("read", "AuditLog"),
    retry: false,
    queryFn: () =>
      privateRequest<{
        data: {
          data: {
            id?: string
            action?: string
            at?: string
            fields?: { path?: string; before?: unknown; after?: unknown }[]
          }[]
        }
      }>(`/api/v1/queries/audit?type=Customer&id=${id}&page=1&pageSize=20`),
  })
  const canCreate =
    ["id", "revision"].every((f) =>
      ability.can("read", subject("Customer", { createdBy: actor.user.id }), f)
    ) &&
    customerFields
      .filter(([, , required]) => required)
      .every(([f]) =>
        ability.can(
          "create",
          subject("Customer", { createdBy: actor.user.id }),
          f
        )
      )
  // Hints only: the server checks the persisted ownership and changed fields.
  const canEdit =
    row &&
    ability.can("update", "Customer") &&
    row.id &&
    row.revision &&
    !customerFields.some(([f]) => row.redactedFields?.includes(f))
  const canArchive =
    row &&
    ability.can("archive", "Customer", "active") &&
    row.id &&
    row.revision &&
    row.active !== undefined
  async function archive() {
    if (!row || !reason.trim() || pending || archiveStale) return
    const key = archiveKey ?? crypto.randomUUID()
    setArchiveKey(key)
    setPending(true)
    setError("")
    try {
      await privateRequest("/api/v1/commands/archiveParty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: 1,
          idempotencyKey: key,
          expected: [{ type: "Customer", id: row.id, revision: row.revision }],
          input: {
            type: "CUSTOMER",
            id: row.id,
            active: !row.active,
            reason: reason.trim(),
          },
        }),
      })
      await queries.invalidateQueries({ queryKey: ["customers"] })
      setReason("")
      setArchiveKey(null)
    } catch (cause) {
      const code = cause instanceof RequestError ? cause.code : "NETWORK_ERROR"
      setArchiveStale(["STALE_REVISION", "REVISION_REQUIRED"].includes(code))
      setError(
        `${code}. Reason retained. Reload and reconfirm before changing archive status.`
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {id ? "Customer details" : "Customers"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Persistent customer directory. Archived customers remain in history.
          </p>
        </div>
        {id ? (
          <Link
            prefetch={false}
            href="/customers"
            className="inline-flex min-h-11 items-center underline"
          >
            Back to customers
          </Link>
        ) : (
          canCreate && (
            <Button className="min-h-11" onClick={() => setCreating(!creating)}>
              {creating ? "Close new customer form" : "New customer"}
            </Button>
          )
        )}
      </header>
      {creating && (
        <section className="rounded-lg border p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">New customer</h2>
          <CustomerForm
            onSaved={(result) => {
              window.location.assign(`/customers/${result.result.id}`)
            }}
          />
        </section>
      )}
      {!id && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setSearch(q)
            setPage(1)
          }}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="customer-search">
              Search name, NIC/passport or phone
            </Label>
            <Input
              id="customer-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={200}
              className="min-h-11 text-base"
            />
          </div>
          <Button type="submit" className="min-h-11">
            Search
          </Button>
        </form>
      )}
      {query.isPending && <p role="status">Loading customers…</p>}
      {query.isError && (
        <p role="alert">
          Customer data is unavailable.{" "}
          {query.error instanceof RequestError
            ? query.error.code
            : "Request failed"}
        </p>
      )}
      {list && (
        <>
          <p role="status">
            {list.total} customer{list.total === 1 ? "" : "s"}
          </p>
          <ul className="divide-y rounded-lg border">
            {list.data.map((customer, i) => (
              <li
                key={customer.id ?? i}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium break-words">
                    {customer.fullName ?? "Name unavailable"}
                  </p>
                  <p className="text-sm break-words text-muted-foreground">
                    {customer.phone ?? "Phone unavailable"} ·{" "}
                    {customer.active === undefined
                      ? "Status unavailable"
                      : customer.active
                        ? "Active"
                        : "Archived"}
                  </p>
                </div>
                {customer.id && (
                  <a
                    href={`/customers/${customer.id}`}
                    className="inline-flex min-h-11 items-center underline"
                  >
                    View customer
                  </a>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * list.pageSize >= list.total}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
      {row && (
        <>
          <dl className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 sm:p-6">
            {customerFields.map(([f, label]) => (
              <div key={f}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="break-words">
                  {row[f] ??
                    (row.redactedFields?.includes(f)
                      ? "Unavailable"
                      : "Not provided")}
                </dd>
              </div>
            ))}
            <div>
              <dt className="text-sm text-muted-foreground">Status</dt>
              <dd>
                {row.active === undefined
                  ? "Unavailable"
                  : row.active
                    ? "Active"
                    : "Archived"}
              </dd>
            </div>
            {row.provenance && (
              <div>
                <dt className="text-sm text-muted-foreground">Provenance</dt>
                <dd>
                  {row.provenance.imported === false
                    ? "Created in this application (not imported)"
                    : "Imported"}
                </dd>
              </div>
            )}
          </dl>
          {canEdit && (
            <Button variant="outline" onClick={() => setEditing(!editing)}>
              {editing ? "Close edit form" : "Edit customer"}
            </Button>
          )}
          {editing && (
            <CustomerForm
              initial={row}
              onSaved={async () => {
                await query.refetch()
                setEditing(false)
              }}
            />
          )}
          {canArchive && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void archive()
              }}
              className="space-y-3 rounded-lg border p-4"
            >
              <h2 className="font-semibold">
                {row.active ? "Archive customer" : "Reactivate customer"}
              </h2>
              <p className="text-sm text-muted-foreground">
                No customer or history is deleted.
              </p>
              <Label htmlFor="archive-reason">Reason</Label>
              <Input
                id="archive-reason"
                required
                maxLength={2000}
                value={reason}
                disabled={pending}
                onChange={(e) => {
                  setReason(e.target.value)
                  setArchiveKey(null)
                }}
                className="min-h-11 text-base"
              />
              {error && <p role="alert">{error}</p>}
              {archiveStale && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={async () => {
                    const refreshed = await query.refetch()
                    if (refreshed.isError) {
                      setError("Unable to reload status. Reason retained.")
                      return
                    }
                    setArchiveKey(null)
                    setArchiveStale(false)
                    setError(
                      "Current status reloaded. Check it and explicitly submit again."
                    )
                  }}
                >
                  Reload status and reconfirm
                </Button>
              )}
              <Button
                type="submit"
                disabled={pending || archiveStale}
                className="min-h-11"
              >
                {pending
                  ? "Saving…"
                  : row.active
                    ? "Confirm archive"
                    : "Confirm reactivation"}
              </Button>
            </form>
          )}
          <section className="space-y-2">
            <h2 className="font-semibold">Linked business history</h2>
            <p className="text-sm text-muted-foreground">
              {row.links?.length
                ? "Authorized linked records"
                : "No linked business records are available under your current permissions. Sale and brokerage history will appear when those domains are implemented."}
            </p>
          </section>
          {row.links?.map((link) => (
            <p key={`${link.type}:${link.id}`} className="text-sm break-words">
              {link.type} · {link.id} · {link.date} · {link.status}
              {link.amount !== undefined ? ` · ${link.amount} minor units` : ""}
            </p>
          ))}
          {history.data && (
            <section className="space-y-3" aria-label="Customer audit history">
              <h2 className="font-semibold">Customer change history</h2>
              {history.data.data.data.map((entry, i) => (
                <article
                  key={entry.id ?? i}
                  className="space-y-2 rounded-md border p-4"
                >
                  <p className="text-sm">
                    {entry.action} · {entry.at}
                  </p>
                  {entry.fields?.map((change, j) => (
                    <p key={j} className="text-sm break-words">
                      <strong>{change.path}</strong>:{" "}
                      {JSON.stringify(change.before)} →{" "}
                      {JSON.stringify(change.after)}
                    </p>
                  ))}
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </section>
  )
}
