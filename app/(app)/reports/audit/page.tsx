import Link from "next/link"
import { headers } from "next/headers"
import type {
  AuditDTO,
  Page,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { authenticate } from "@/lib/server/actor"
import { CommandError } from "@/lib/server/errors"
import { pageActor } from "@/lib/server/pages"
import { abilityFor } from "@/lib/server/permissions"
import { auditRecordTypes, securityQuery } from "@/lib/server/queries"

export default async function AuditReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { actor } = await pageActor()
  const canRead = abilityFor(actor.presentationGrants, actor.user.id).can(
    "read",
    "AuditLog"
  )
  const filters = await searchParams
  const { type, id, relatedId, from, through, action } = filters
  const params = new URLSearchParams()
  let result: Page<Visible<AuditDTO>> | undefined
  let error: string | undefined
  if (canRead && typeof type === "string" && typeof id === "string" && id) {
    params.set("type", type)
    params.set("id", id)
    for (const key of [
      "relatedId",
      "from",
      "through",
      "action",
      "page",
    ] as const) {
      const value = filters[key]
      if (typeof value === "string" && value.trim()) params.set(key, value)
    }
    try {
      result = (await securityQuery(
        await authenticate(await headers()),
        "audit",
        params
      )) as Page<Visible<AuditDTO>>
    } catch (cause) {
      if (!(cause instanceof CommandError)) throw cause
      error =
        cause.status === 422
          ? "Check the record type, IDs and filters."
          : "This record’s audit history is unavailable."
    }
  }
  const pageHref = (number: number) => {
    const next = new URLSearchParams(params)
    next.set("page", String(number))
    return `/reports/audit?${next}`
  }
  return (
    <section className="mx-auto max-w-5xl space-y-5">
      <Link href="/reports" className="text-sm underline">
        All reports
      </Link>
      <h1 className="text-2xl font-semibold">Record audit history</h1>
      {canRead ? (
        <>
          <form
            action="/reports/audit"
            className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
          >
            <label className="grid gap-1.5 text-sm">
              Record type
              <select
                name="type"
                defaultValue={
                  typeof type === "string" ? type : "PurchaseRecord"
                }
                className="h-9 rounded-md border bg-background px-2"
              >
                {auditRecordTypes.map((recordType) => (
                  <option key={recordType}>{recordType}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              Record ID
              <Input
                name="id"
                required
                defaultValue={typeof id === "string" ? id : ""}
                className="w-80 max-w-full"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              Related ID
              <Input
                name="relatedId"
                defaultValue={typeof relatedId === "string" ? relatedId : ""}
              />
              <span className="text-xs text-muted-foreground">
                Role ID for UserRole, permission ID for RolePermission
              </span>
            </label>
            <label className="grid gap-1.5 text-sm">
              From date (UTC)
              <Input
                type="date"
                name="from"
                defaultValue={typeof from === "string" ? from : ""}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              Through date (UTC)
              <Input
                type="date"
                name="through"
                defaultValue={typeof through === "string" ? through : ""}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              Action
              <Input
                name="action"
                maxLength={100}
                defaultValue={typeof action === "string" ? action : ""}
              />
            </label>
            <Button type="submit">View history</Button>
          </form>
          {error && <p role="alert">{error}</p>}
          {result && (
            <>
              <p>
                {result.total} audit {result.total === 1 ? "entry" : "entries"}
              </p>
              <ol className="divide-y rounded-lg border">
                {result.data.map((entry, index) => (
                  <li key={entry.id ?? index} className="space-y-1 p-4">
                    <p className="font-medium">
                      {entry.action ?? "Audit entry"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {[entry.at, entry.actor?.userId ?? entry.actor?.kind]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {entry.reason && <p className="text-sm">{entry.reason}</p>}
                    {!!entry.fields?.length && (
                      <dl className="space-y-1 text-sm">
                        {entry.fields.map((field, i) => (
                          <div key={field.path ?? i} className="break-all">
                            <dt className="font-medium">{field.path}</dt>
                            <dd>
                              {JSON.stringify(field.before) ?? "—"} →{" "}
                              {JSON.stringify(field.after) ?? "—"}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </li>
                ))}
              </ol>
              <nav aria-label="Audit pages" className="flex gap-4">
                {result.page > 1 && (
                  <Link className="underline" href={pageHref(result.page - 1)}>
                    Previous
                  </Link>
                )}
                {result.page * result.pageSize < result.total && (
                  <Link className="underline" href={pageHref(result.page + 1)}>
                    Next
                  </Link>
                )}
              </nav>
            </>
          )}
        </>
      ) : (
        <p>Your role has no audit history access.</p>
      )}
    </section>
  )
}
