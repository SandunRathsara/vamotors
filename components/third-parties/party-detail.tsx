"use client"
import { ImportedBadge } from "@/components/imports/imported-badge"
import { Activity, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import type {
  PartyDetailDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { privateRequest, RequestError } from "@/lib/security-client"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { Button } from "@/components/ui/button"
import { PartyForm, type DirectoryKind } from "./party-form"

export function PartyDetail({ kind, id }: { kind: DirectoryKind; id: string }) {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const type =
    kind === "FINANCE_COMPANY"
      ? "FinanceCompany"
      : kind === "SUPPLIER"
        ? "Supplier"
        : "RepairVendor"
  // An edit owns its opening snapshot, not the transient zero-retention query.
  // AuthBoundary still hides verification and discards on identity/access change.
  const [editing, setEditing] = useState<Visible<PartyDetailDTO> | null>(null)
  const [unresolved, setUnresolved] = useState(false)
  const query = useQuery({
    queryKey: ["party", kind, id],
    retry: false,
    queryFn: () =>
      privateRequest<{
        data: Visible<PartyDetailDTO> & { redactedFields?: string[] }
      }>(`/api/v1/queries/party?type=${kind}&id=${id}`),
  })
  const row = query.data?.data
  const domains =
    kind === "SUPPLIER"
      ? ["purchases"]
      : kind === "REPAIR_VENDOR"
        ? ["repairs"]
        : [
            "settlementPurchases",
            "leaseSales",
            "brokerage",
            "entitlements",
            "remittances",
          ]
  return (
    <section className="mx-auto w-full max-w-4xl space-y-6">
      {!unresolved && (
        <Button variant="outline" asChild>
          <Link prefetch={false} href="/third-parties">
            Back to third parties
          </Link>
        </Button>
      )}
      {query.isPending && <p role="status">Loading party…</p>}
      {query.isError && (
        <p role="alert">
          {query.error instanceof RequestError
            ? query.error.code
            : "Party read failed"}
          . No history result is available.
        </p>
      )}
      {row && (
        <>
          <header>
            <h1 className="text-2xl font-semibold break-words">
              {row.name ?? "Name unavailable"}
            </h1>
            <ImportedBadge provenance={row.provenance} />
            <p>
              {row.active === undefined
                ? "Status unavailable"
                : row.active
                  ? "Active"
                  : "Archived — retained historical identity"}
            </p>
          </header>
          <section
            aria-label="Current contacts"
            className="space-y-3 rounded-lg border p-4"
          >
            <h2 className="font-semibold">Current contacts</h2>
            {row.contacts === undefined ? (
              <p>Unavailable</p>
            ) : row.contacts.length ? (
              row.contacts.map((c, i) => (
                <p className="break-words" key={c.id ?? i}>
                  {c.name} · {c.role} · {c.phone}
                  {c.email ? ` · ${c.email}` : ""}
                  {c.primary ? " · Primary" : ""}
                </p>
              ))
            ) : (
              <p>No current contacts</p>
            )}
          </section>
          {row.directory && (
            <section
              aria-label="Directory details"
              className="rounded-lg border p-4"
            >
              <h2 className="font-semibold">Directory details</h2>
              <dl className="space-y-3">
                {Object.entries(row.directory)
                  .filter(([key]) => key !== "contacts")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-sm text-muted-foreground">{key}</dt>
                      <dd className="break-words">{String(value)}</dd>
                    </div>
                  ))}
              </dl>
            </section>
          )}
          {kind === "FINANCE_COMPANY" && (
            <section className="rounded-lg border p-4">
              <h2 className="font-semibold">Current company policy</h2>
              <pre className="text-sm break-words whitespace-pre-wrap">
                {row.policy
                  ? JSON.stringify(row.policy, null, 2)
                  : "Unavailable"}
              </pre>
            </section>
          )}
          <section aria-label="Domain contributions" className="space-y-4">
            <h2 className="text-lg font-semibold">Related records</h2>
            {domains.map((domain) => {
              const contribution = (
                row.contributions as
                  | Record<
                      string,
                      {
                        state?: string
                        links?: {
                          type?: string
                          id?: string
                          date?: string
                          status?: string
                        }[]
                      }
                    >
                  | undefined
              )?.[domain]
              return (
                <section
                  key={domain}
                  className="space-y-2 rounded-lg border p-4"
                >
                  <h3 className="font-semibold">{domain}</h3>
                  {!contribution ? (
                    <p>Unavailable under current permissions</p>
                  ) : (
                    <>
                      <p>
                        {contribution.state === "PENDING_DOMAIN"
                          ? "History pending — known references below are not complete history."
                          : "Ready — all visible records in this domain at the response time."}
                      </p>
                      {contribution.links?.map((link, i) => (
                        <p key={i} className="break-words">
                          {link.type} · {link.id ?? "Identity unavailable"} ·{" "}
                          {link.date ?? "Date unavailable"} ·{" "}
                          {link.status ?? "Status unavailable"} ·{" "}
                          {link.type === "PURCHASE" && link.id ? (
                            <Link
                              prefetch={false}
                              className="underline"
                              href={`/purchases/${link.id}`}
                            >
                              View purchase
                            </Link>
                          ) : link.type === "REPAIR" && link.id ? (
                            <Link
                              prefetch={false}
                              className="underline"
                              href={`/repairs/${link.id}`}
                            >
                              View repair
                            </Link>
                          ) : (
                            "Navigation pending"
                          )}
                        </p>
                      ))}
                      {contribution.state === "READY" &&
                        contribution.links?.length === 0 && (
                          <p>No visible records in this domain</p>
                        )}
                    </>
                  )}
                </section>
              )
            })}
          </section>
          {row.id && row.revision && ability.can("update", type) && (
            <Button
              disabled={unresolved}
              onClick={() => setEditing(editing ? null : row)}
            >
              {editing ? "Close directory form" : "Edit entry"}
            </Button>
          )}
        </>
      )}
      <Activity mode={row && !query.isError ? "visible" : "hidden"}>
        {editing && (
          <PartyForm
            key={`${kind}:${id}`}
            kind={kind}
            initial={editing}
            onUnresolvedChange={setUnresolved}
            onSaved={() => setEditing(null)}
            onReload={async () => {
              const current = await query.refetch()
              if (current.isError) throw current.error
              return current.data?.data
            }}
          />
        )}
        {unresolved && (
          <p role="status">
            Unresolved command retained for this typed party only. Resolve it
            before leaving this page.
          </p>
        )}
      </Activity>
    </section>
  )
}
