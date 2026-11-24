"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import { SaleSummaryRow, type VisibleCycle } from "./sales-columns"

export function SalesTable() {
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ["sales", "list", page],
    retry: false,
    queryFn: () =>
      privateRequest<{
        data: { data: VisibleCycle[]; total: number; pageSize: number }
      }>(
        `/api/v1/queries/purchases?statuses=${encodeURIComponent(JSON.stringify(["SOLD"]))}&page=${page}&pageSize=20`
      ),
  })

  if (query.isPending) {
    return (
      <div className="py-10 text-sm text-muted-foreground" role="status">
        Loading completed sales…
      </div>
    )
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm">
        Sales unavailable:{" "}
        {query.error instanceof RequestError ? query.error.code : "ERROR"}
      </p>
    )
  }

  const cycles = query.data.data.data
  const total = query.data.data.total

  if (cycles.length === 0) {
    return (
      <div className="rounded-lg border p-6 text-sm text-muted-foreground">
        No completed sales recorded yet. Use Complete Immediate Sale above or on an available stock purchase cycle.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left">
          <thead className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Vehicle</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Sale Date</th>
              <th className="px-3 py-2 text-right">Sale Price</th>
              <th className="px-3 py-2 text-right">Profit</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((cycle) => (
              <SaleSummaryRow key={cycle.id} cycle={cycle} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span>{total} sold cycles</span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={page * 20 >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
