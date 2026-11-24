"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  Dependency,
  InvoicePending,
  SaleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { Button } from "@/components/ui/button"
import { privateRequest, RequestError } from "@/lib/security-client"

export function SaleInvoices({
  sale,
  cycleRevision,
}: {
  sale: Visible<SaleDTO>
  cycleRevision?: number
}) {
  const queries = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [retry, setRetry] = useState<{
    body: string
    saleRevision: number
    cycleRevision: number
  }>()
  const versions = sale.invoices ?? []
  const current = versions.find((row) => row.saleRevision === sale.revision)
  const reload = () =>
    queries.invalidateQueries({ queryKey: ["sales", "detail", sale.id] })

  async function issue() {
    if (!sale.id || !sale.revision || !sale.cycleId || !cycleRevision || busy)
      return
    setBusy(true)
    setMessage("")
    const expected: Dependency[] = [
      { type: "SaleCase", id: sale.id, revision: sale.revision },
      { type: "PurchaseRecord", id: sale.cycleId, revision: cycleRevision },
    ]
    if (current?.id && current.revision && current.state !== "READY")
      expected.push({
        type: "InvoiceVersion",
        id: current.id,
        revision: current.revision,
      })
    const previous =
      retry?.saleRevision === sale.revision &&
      retry.cycleRevision === cycleRevision
        ? retry
        : undefined
    const body =
      previous?.body ??
      JSON.stringify({
        schemaVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        expected,
        input: {
          saleId: sale.id,
          saleRevision: sale.revision,
          regenerate: versions.length > 0,
        },
      })
    setRetry({ body, saleRevision: sale.revision, cycleRevision })
    try {
      const result = await privateRequest<Applied | InvoicePending>(
        "/api/v1/commands/issueInvoice",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }
      )
      if (result.status === "APPLIED") {
        setRetry(undefined)
        setMessage("Invoice ready to download.")
      } else {
        setMessage(
          "Invoice generation could not finish. Retry to use the same version."
        )
      }
      await reload()
    } catch (error) {
      const code = error instanceof RequestError ? error.code : undefined
      if (code === "STALE_REVISION" || code === "REVISION_REQUIRED") {
        setRetry(undefined)
        await Promise.all([
          reload(),
          queries.invalidateQueries({
            queryKey: ["purchases", "detail", sale.cycleId],
          }),
        ])
        setMessage(
          "Sale details changed. Check the current invoice versions and try again."
        )
      } else {
        setMessage(
          code
            ? `Invoice generation failed (${code}).`
            : "Invoice generation was interrupted. Retry to check its status."
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const canIssue = sale.nextActions?.includes("issueInvoice")
  if (!canIssue && versions.length === 0) return null
  const needsUpdate =
    !versions.some(
      (row) => row.saleRevision === sale.revision && row.state === "READY"
    ) && versions.some((row) => row.state === "READY")
  return (
    <section
      aria-label="Invoices"
      className="space-y-3 rounded-lg border p-4 text-sm"
    >
      <h2 className="font-semibold">Invoices</h2>
      {needsUpdate && (
        <p>
          Earlier invoices are available. Generate an invoice for the current
          sale details.
        </p>
      )}
      {canIssue && (
        <Button type="button" onClick={issue} disabled={busy || !cycleRevision}>
          {busy
            ? "Generating invoice…"
            : current?.state === "FAILED" || retry
              ? "Retry invoice"
              : needsUpdate || current?.state === "READY"
                ? "Regenerate invoice"
                : "Generate invoice"}
        </Button>
      )}
      {message && <p role="status">{message}</p>}
      {versions.length > 0 && (
        <ul className="space-y-2">
          {versions.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1"
            >
              <span>
                {row.number} ·{" "}
                {row.state === "READY"
                  ? "Ready"
                  : row.state === "FAILED"
                    ? "Failed"
                    : "Pending"}
              </span>
              {row.state === "READY" && (
                <a
                  className="underline"
                  href={`/api/v1/sales/${sale.id}/invoices/${row.version}`}
                >
                  Download version {row.version}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
