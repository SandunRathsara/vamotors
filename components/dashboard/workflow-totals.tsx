"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { RequestError } from "@/lib/security-client"
import { rateRequest } from "@/components/lease/rate-client"

const workflows = [
  { label: "Purchases", href: "/purchases", query: "purchases?pageSize=10" },
  {
    label: "Completed sales",
    href: "/sales",
    query: `purchases?pageSize=10&statuses=${encodeURIComponent('["SOLD"]')}`,
  },
  {
    label: "Lease brokerage deals",
    href: "/lease-deals",
    query: "brokerage?pageSize=10&includeRejected=true",
  },
]

function WorkflowTotal({ label, href, query }: (typeof workflows)[number]) {
  const total = useQuery({
    queryKey: ["dashboard", query],
    retry: false,
    queryFn: () =>
      rateRequest<{ data: { total: number } }>(`/api/v1/queries/${query}`),
  })
  if (total.error instanceof RequestError && total.error.status === 403)
    return null

  return (
    <Link
      href={href}
      className="block rounded-lg border bg-card p-5 text-card-foreground hover:bg-accent"
    >
      <h2 className="text-sm font-medium">{label}</h2>
      <p
        className="mt-2 text-2xl font-semibold tabular-nums"
        aria-live="polite"
      >
        {total.isPending
          ? "Loading…"
          : total.isError
            ? "Unavailable"
            : total.data.data.total}
      </p>
    </Link>
  )
}

export function WorkflowTotals() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {workflows.map((workflow) => (
        <WorkflowTotal key={workflow.href} {...workflow} />
      ))}
    </div>
  )
}
