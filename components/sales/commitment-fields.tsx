"use client"

import { useQuery } from "@tanstack/react-query"
import { privateRequest } from "@/lib/security-client"
import type { Dependency } from "@/.planning/implementation/contracts/api"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

export type CompanyOption = { id: string; revision: number; name: string }

export function FinanceCompanyField({
  value,
  onChange,
}: {
  value: string
  onChange: (company?: CompanyOption) => void
}) {
  const { data, isError } = useQuery({
    queryKey: ["parties", "lease-company-options"],
    queryFn: () =>
      privateRequest<{ data: { data: CompanyOption[] } }>(
        "/api/v1/queries/parties?type=FINANCE_COMPANY&active=true&pageSize=100&page=1"
      ),
    retry: false,
  })
  return (
    <Label className="grid gap-2">
      Finance company
      <select
        required
        name="company"
        value={value}
        className="h-10 rounded-md border bg-background px-3"
        onChange={(event) =>
          onChange(
            data?.data.data.find((company) => company.id === event.target.value)
          )
        }
      >
        <option value="">
          {isError ? "Finance directory unavailable" : "Select company"}
        </option>
        {data?.data.data.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </Label>
  )
}

export function useCurrencyLabel(enabled = true) {
  const { data } = useQuery({
    queryKey: ["settings", "currency-label"],
    queryFn: () => privateRequest<{ data: { currency?: string } }>("/api/v1/queries/settings"),
    enabled,
    retry: false,
  })
  return data?.data.currency ? ` (${data.data.currency})` : ""
}

export function FinancePaymentFields() {
  const currency = useCurrencyLabel()
  return (
    <>
      <Label className="grid gap-2">
        Down payment{currency}
        <Input inputMode="decimal" name="downPayment" required />
      </Label>
      <Label className="grid gap-2">
        Term (months)
        <Input type="number" name="termMonths" min={1} max={120} required />
      </Label>
    </>
  )
}

export async function currentSettingsRef(): Promise<Dependency> {
  const { data } = await privateRequest<{
    data: { id: string; revision: number }
  }>("/api/v1/queries/settings")
  if (!data.id || !data.revision)
    throw new Error("Settings revision unavailable")
  return { type: "Settings", id: data.id, revision: data.revision }
}
