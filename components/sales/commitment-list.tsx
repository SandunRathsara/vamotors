"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  Page,
  SaleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import { major } from "@/lib/money"

export function CommitmentList({ canRunExpiry }: { canRunExpiry: boolean }) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState("")
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState("")
  const [problem, setProblem] = useState("")
  const retry = useRef("")
  const listing = useQuery({
    queryKey: ["sales", "commitments", kind, page],
    queryFn: () =>
      privateRequest<{ data: Page<Visible<SaleDTO>> }>(
        `/api/v1/queries/sales?page=${page}&pageSize=20${kind ? `&kind=${kind}` : ""}`
      ),
    retry: false,
  })
  async function catchUp() {
    if (pending) return
    setPending(true)
    setProblem("")
    try {
      let through: string | undefined
      let cursor: string | null = null
      let expired = 0,
        warned = 0
      do {
        retry.current ||= JSON.stringify({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected: [],
          input: { limit: 100, through, ...(cursor ? { cursor } : {}) },
        })
        const run = await privateRequest<{
          cutoff: string
          nextCursor: string | null
          expired: number
          warned: number
          failures: { code: string }[]
        }>("/api/v1/commands/runExpiry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: retry.current,
        })
        expired += run.expired
        warned += run.warned
        if (run.failures.length)
          throw Error(
            `Catch-up incomplete (${run.failures[0].code}). Retry to check remaining records.`
          )
        retry.current = ""
        through = run.cutoff
        cursor = run.nextCursor
      } while (cursor)
      setResult(`Warnings sent ${warned}. Advances expired ${expired}.`)
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.status < 500 &&
        error.code !== "COMMAND_IN_PROGRESS"
      )
        retry.current = ""
      setProblem(error instanceof Error ? error.message : "Catch-up failed")
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["sales"] })
      void queryClient.invalidateQueries({ queryKey: ["notifications"] })
      setPending(false)
    }
  }

  const results = listing.data?.data
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Reservations and inventory lease sales
        </h2>
        {canRunExpiry && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void catchUp()}
          >
            {pending ? "Checking advances…" : "Run expiry catch-up"}
          </Button>
        )}
      </div>
      {result && <p role="status">{result}</p>}
      {problem && <p role="alert">{problem}</p>}
      <label className="flex items-center gap-3 text-sm">
        Sale type
        <select
          className="h-9 rounded-md border bg-background px-3"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value)
            setPage(1)
          }}
        >
          <option value="">All reservations and leases</option>
          <option value="ADVANCE">Advance</option>
          <option value="LEASE">Lease</option>
        </select>
      </label>
      {listing.isPending && (
        <p role="status">Loading reservations and lease sales…</p>
      )}
      {listing.isError && (
        <p role="alert">Reservations and leases are unavailable.</p>
      )}
      {results &&
        (results.data.length ? (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  {[
                    "Sale",
                    "Type",
                    "Status",
                    "Agreed price",
                    "Valid through",
                  ].map((name) => (
                    <th key={name} scope="col" className="px-3 py-2">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.data.map((sale) => (
                  <tr key={sale.id} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <Link className="underline" href={`/sales/${sale.id}`}>
                        {sale.reference || sale.id}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {sale.kind === "ADVANCE" ? "Advance" : "Lease"}
                    </td>
                    <td className="px-3 py-2">
                      {sale.state?.replaceAll("_", " ")}
                    </td>
                    <td className="px-3 py-2">
                      {sale.price === undefined
                        ? "—"
                        : major(BigInt(sale.price))}
                    </td>
                    <td className="px-3 py-2">
                      {sale.reservation?.validThrough ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No matching reservations or lease sales.
          </p>
        ))}
      {!!results && results.total > 20 && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span>Page {page}</span>
          <Button
            variant="outline"
            disabled={page * 20 >= results.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  )
}
