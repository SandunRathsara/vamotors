import Link from "next/link"
import { pageActor } from "@/lib/server/pages"
import { abilityFor } from "@/lib/server/permissions"
import { reportKinds, reportPages } from "@/lib/report-kinds"

export default async function ReportsPage() {
  const { actor } = await pageActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const reports = reportKinds.filter((kind) =>
    ability.can("read", "Report", kind)
  )
  const audit = ability.can("read", "AuditLog")
  return (
    <section className="mx-auto w-full max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">Reports</h1>
      {reports.length || audit ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((kind) => (
            <li key={kind}>
              <Link
                prefetch={false}
                href={reportPages[kind].href}
                className="flex h-full min-h-20 items-center rounded-lg border bg-card p-4 font-medium hover:bg-accent"
              >
                {reportPages[kind].label}
              </Link>
            </li>
          ))}
          {audit && (
            <li>
              <Link
                prefetch={false}
                href="/reports/audit"
                className="flex h-full min-h-20 items-center rounded-lg border bg-card p-4 font-medium hover:bg-accent"
              >
                Record audit history
              </Link>
            </li>
          )}
        </ul>
      ) : (
        <p>Your role has no report access.</p>
      )}
    </section>
  )
}
