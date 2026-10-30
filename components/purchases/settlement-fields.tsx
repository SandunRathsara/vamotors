"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { Settlement } from "@/.planning/implementation/contracts/api"
import type { VisibleParty } from "@/components/third-parties/party-form"
import { privateRequest } from "@/lib/security-client"
import { major, parseMajor, sum, C } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export function settlementFromDraft(draft: Record<string, string>): Settlement {
  const terms = {
    reference: draft.settlementReference,
    amount: parseMajor(draft.settlementAmount ?? ""),
    cashToSeller: parseMajor(draft.cashToSeller ?? ""),
  }
  return draft.institutionType === "FINANCE_COMPANY"
    ? {
        ...terms,
        institutionType: "FINANCE_COMPANY",
        companyId: draft.companyId,
      }
    : {
        ...terms,
        institutionType: draft.institutionType as "BANK" | "PRIVATE_PARTY",
        institutionName: draft.institutionName,
      }
}
export function settlementTotal(draft: Record<string, string>) {
  try {
    return major(
      sum(
        [
          BigInt(parseMajor(draft.settlementAmount ?? "")),
          BigInt(parseMajor(draft.cashToSeller ?? "")),
        ],
        C
      )
    )
  } catch {
    return "Unavailable — enter both exact components"
  }
}

/** Shared by the two real v1 forms; no legacy /api/purchases payload. */
export function SettlementFields({
  draft,
  change,
  company,
  selectCompany,
}: {
  draft: Record<string, string>
  change: (key: string, value: string) => void
  company: VisibleParty | null
  selectCompany: (party: VisibleParty | null) => void
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [error, setError] = useState("")
  const companies = useQuery({
    queryKey: ["parties", "settlement-selector", search, page],
    enabled: draft.institutionType === "FINANCE_COMPANY",
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: VisibleParty[]; total: number } }>(
        `/api/v1/queries/parties?type=FINANCE_COMPANY&active=true&pageSize=20&page=${page}&q=${encodeURIComponent(search)}`
      ),
  })
  return (
    <section
      aria-label="Settlement terms"
      className="min-w-0 space-y-4 rounded-md border p-3"
    >
      <Label htmlFor="settlement-institution-type">
        Settlement institution type *
      </Label>
      <select
        id="settlement-institution-type"
        value={draft.institutionType ?? ""}
        required
        onChange={(e) => {
          change("institutionType", e.target.value)
          selectCompany(null)
        }}
        className="min-h-11 w-full rounded-md border bg-background px-3"
      >
        <option value="">Select institution type</option>
        <option value="FINANCE_COMPANY">Finance company directory</option>
        <option value="BANK">Bank</option>
        <option value="PRIVATE_PARTY">Private party</option>
      </select>
      {draft.institutionType === "FINANCE_COMPANY" ? (
        <>
          <Label htmlFor="settlement-company-search">
            Search active finance companies
          </Label>
          <Input
            id="settlement-company-search"
            value={search}
            maxLength={200}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="min-h-11 text-base"
          />
          {companies.isPending && (
            <p role="status">Loading finance companies…</p>
          )}
          {companies.isError && (
            <p role="alert">
              Company read failed.{" "}
              <Button
                type="button"
                variant="outline"
                onClick={() => void companies.refetch()}
              >
                Retry company read
              </Button>
            </p>
          )}
          <Label htmlFor="settlement-company">
            Settlement finance company *
          </Label>
          <select
            id="settlement-company"
            required
            value={draft.companyId ?? ""}
            onChange={(e) => {
              change("companyId", e.target.value)
              selectCompany(
                companies.data?.data.data.find(
                  (p) => p.id === e.target.value
                ) ?? null
              )
            }}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="">Select readable active company</option>
            {draft.companyId &&
              !companies.data?.data.data.some(
                (p) => p.id === draft.companyId
              ) && (
                <option value={draft.companyId}>
                  {company?.name ?? "Current company — load current selection"}
                </option>
              )}
            {companies.data?.data.data
              .filter((p) => p.id && p.revision && p.active && p.name)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous companies
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={
                !companies.data || page * 20 >= companies.data.data.total
              }
              onClick={() => setPage(page + 1)}
            >
              More companies
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!draft.companyId}
              onClick={async () => {
                try {
                  const r = await privateRequest<{ data: VisibleParty }>(
                    `/api/v1/queries/party?type=FINANCE_COMPANY&id=${draft.companyId}`
                  )
                  selectCompany(r.data)
                  setError("")
                } catch {
                  setError(
                    "Current company read failed. Selection and draft retained."
                  )
                }
              }}
            >
              Load current selected company
            </Button>
          </div>
          <p>
            Selected revision:{" "}
            {company?.id === draft.companyId
              ? (company.revision ?? "Unavailable")
              : "Unavailable"}
          </p>
        </>
      ) : (
        draft.institutionType && (
          <>
            <Label htmlFor="settlement-name">
              Settlement institution name *
            </Label>
            <Input
              id="settlement-name"
              required
              maxLength={200}
              value={draft.institutionName ?? ""}
              onChange={(e) => change("institutionName", e.target.value)}
              className="min-h-11 text-base"
            />
          </>
        )
      )}
      {[
        ["settlementReference", "Settlement reference", false],
        ["settlementAmount", "Institution amount (major units)", true],
        ["cashToSeller", "Cash to seller (major units)", true],
      ].map(([key, label, money]) => (
        <div key={String(key)} className="space-y-2">
          <Label htmlFor={`settlement-${key}`}>{label} *</Label>
          <Input
            id={`settlement-${key}`}
            required
            maxLength={money ? 30 : 200}
            inputMode={money ? "decimal" : undefined}
            value={draft[String(key)] ?? ""}
            onChange={(e) => change(String(key), e.target.value)}
            className="min-h-11 text-base"
          />
        </div>
      ))}
      <p aria-live="polite">
        Computed purchase total: {settlementTotal(draft)}
      </p>
      <p>
        Only positive components create initial OUT payments, on the common
        actual purchase date and payment method. This is an acquisition, not a
        finance sale or a loan.
      </p>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
