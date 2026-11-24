import Link from "next/link"
import { headers } from "next/headers"
import type { ReportKind } from "@/.planning/implementation/contracts/api"
import { reportPages } from "@/lib/report-kinds"
import { states } from "@/lib/state"
import { authenticate, currentActor } from "@/lib/server/actor"
import { assertEnvironment, database } from "@/lib/server/db"
import { CommandError } from "@/lib/server/errors"
import { pageActor } from "@/lib/server/pages"
import { reportFilter, reportQuery } from "@/lib/server/reports"
import {
  formatReportCell,
  getReportColumns,
  reportCellValue,
} from "@/lib/server/report-export"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { readScope } from "@/lib/server/permissions"

export type ReportPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}
const labels: Record<string, string> = {
  cashIn: "Money in",
  cashOut: "Money out",
  net: "Net movement",
}
const statusLabel = (value: string) => value.replaceAll("_", " ")
const stockFilters: { name: string; label: string }[] = [
  { name: "make", label: "Make" },
  { name: "model", label: "Model" },
]

function SelectFilter({
  name,
  label,
  options,
  params,
}: {
  name: string
  label: string
  options: readonly (string | readonly [string, string])[]
  params: URLSearchParams
}) {
  const id = `report-filter-${name}`
  return (
    <div className="grid gap-1.5 text-sm">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        defaultValue={params.get(name) ?? ""}
        className="h-10 rounded-md border bg-background px-2"
      >
        <option value="">All</option>
        {options.map((option) => {
          const [value, text] =
            typeof option === "string" ? [option, statusLabel(option)] : option
          return (
            <option key={value} value={value}>
              {text}
            </option>
          )
        })}
      </select>
    </div>
  )
}

async function load(kind: ReportKind, params: URLSearchParams) {
  const identity = await authenticate(await headers())
  const query = new URLSearchParams(params)
  query.append("kind", kind)
  const filter = reportFilter(query)
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      const result = await reportQuery(tx, actor, filter)
      const exportAllowed = actor.ability.can("export", "Report", kind)
      let vendors: readonly (readonly [string, string])[] = []
      if (
        kind === "REPAIRS" &&
        actor.ability.can("read", "RepairRecord", "vendorId") &&
        actor.ability.can("read", "RepairVendor", "id") &&
        actor.ability.can("read", "RepairVendor", "name")
      ) {
        try {
          const choices = await tx.repairVendor.findMany({
            where: readScope(actor.grants, actor.userId, "RepairVendor", [
              "id",
              "name",
            ]),
            select: { id: true, name: true },
            orderBy: [{ name: "asc" }, { id: "asc" }],
          })
          vendors = choices.map(({ id, name }) => [id, name])
        } catch (error) {
          if (!(error instanceof CommandError && error.status === 403))
            throw error
        }
      }
      return { result, exportAllowed, vendors }
    },
    { isolationLevel: "RepeatableRead", timeout: 9000 }
  )
}

export async function ReportPage({
  kind,
  searchParams,
}: ReportPageProps & { kind: ReportKind }) {
  await pageActor()
  const params = new URLSearchParams()
  for (const [key, values] of Object.entries(await searchParams))
    for (const value of Array.isArray(values) ? values : [values])
      if (value !== undefined && value !== "") params.append(key, value)

  const config = reportPages[kind]
  let loaded: Awaited<ReturnType<typeof load>> | undefined
  let errorMessage = ""
  try {
    loaded = await load(kind, params)
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    errorMessage =
      error.status === 422
        ? "Check the report filters and select a valid date range."
        : "This report is unavailable with your current permissions."
  }

  const columns = getReportColumns(kind)
  const result = loaded?.result
  const visibleColumns = columns.filter(
    (column) =>
      !result?.data.length ||
      result.data.some(
        (row) => reportCellValue(kind, row, column.key) !== undefined
      )
  )
  const showVehicleFilters =
    kind === "INVENTORY" || kind === "PROFIT" || kind === "PURCHASES"
  const exportParams = new URLSearchParams(params)
  exportParams.delete("page")
  exportParams.delete("pageSize")
  exportParams.set("kind", kind)
  const pageHref = (page: number) => {
    const next = new URLSearchParams(params)
    next.set("page", String(page))
    return `${config.href}?${next}`
  }
  return (
    <section className="mx-auto w-full max-w-7xl space-y-5">
      <Link href="/reports" prefetch={false} className="text-sm underline">
        All reports
      </Link>
      <h1 className="text-2xl font-semibold">{config.label}</h1>
      <form
        action={config.href}
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4"
      >
        {(["from", "through"] as const).map((date) => (
          <label key={date} className="grid gap-1.5 text-sm">
            {date === "from" ? "From" : "Through"}
            <Input
              className="h-10"
              name={date}
              type="date"
              defaultValue={params.get(date) ?? ""}
            />
          </label>
        ))}
        {showVehicleFilters && (
          <>
            <SelectFilter
              name="status"
              label="Status"
              options={states}
              params={params}
            />
            {kind !== "PURCHASES" &&
              stockFilters.map(({ name, label }) => (
                <label className="grid gap-1.5 text-sm" key={name}>
                  {label}
                  <Input
                    className="h-10 w-32"
                    name={name}
                    maxLength={100}
                    defaultValue={params.get(name) ?? ""}
                  />
                </label>
              ))}
          </>
        )}
        {kind === "INVENTORY" && (
          <SelectFilter
            name="available"
            label="Availability"
            options={[
              ["true", "Available"],
              ["false", "Unavailable"],
            ]}
            params={params}
          />
        )}
        {kind === "SOLD" && (
          <SelectFilter
            name="saleType"
            label="Sale type"
            options={["CASH", "TRADE_IN", "ADVANCE", "LEASE"]}
            params={params}
          />
        )}
        {(kind === "SOLD" || kind === "CASH_FLOW") && (
          <SelectFilter
            name="method"
            label="Payment method"
            options={["CASH", "BANK_TRANSFER"]}
            params={params}
          />
        )}
        {kind === "PROFIT" && (
          <>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="profitOnly"
                value="true"
                defaultChecked={params.get("profitOnly") === "true"}
              />{" "}
              Profit only
            </label>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="lossOnly"
                value="true"
                defaultChecked={params.get("lossOnly") === "true"}
              />{" "}
              Loss only
            </label>
          </>
        )}
        {kind === "ADVANCES" && (
          <SelectFilter
            name="advanceStatus"
            label="Status"
            options={["ACTIVE", "EXPIRED"]}
            params={params}
          />
        )}
        {kind === "REPAIRS" && Boolean(loaded?.vendors.length) && (
          <SelectFilter
            name="vendorId"
            label="Vendor"
            options={loaded!.vendors}
            params={params}
          />
        )}
        <Button type="submit">Apply filters</Button>
        <Button variant="ghost" asChild>
          <Link prefetch={false} href={config.href}>
            Reset
          </Link>
        </Button>
      </form>
      {errorMessage && <p role="alert">{errorMessage}</p>}
      {result && (
        <>
          {result.notice && (
            <p role="status" className="rounded-md border bg-muted p-3 text-sm">
              {result.notice}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {result.total} matching{" "}
              {result.total === 1 ? "record" : "records"} · As of {result.asOf}{" "}
              · LKR
            </p>
            {loaded?.exportAllowed && (
              <div className="flex flex-wrap gap-2">
                {["csv", "pdf"].map((format) => (
                  <Button key={format} variant="outline" asChild>
                    <a
                      href={`/api/v1/queries/report?${exportParams}&format=${format}`}
                      download
                    >
                      Export {format.toUpperCase()}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>
          {Object.keys(result.totals).length > 0 && (
            <dl
              aria-label="Filtered totals"
              className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4"
            >
              {Object.entries(result.totals).map(([key, amount]) => (
                <div key={key} className="rounded-md border p-3">
                  <dt className="text-sm text-muted-foreground">
                    {labels[key] ??
                      columns.find((column) => column.totalKey === key)
                        ?.label ??
                      key}
                  </dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {formatReportCell(amount, "money", true)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {result.data.length ? (
            <div
              className="overflow-x-auto rounded-lg border"
              tabIndex={0}
              aria-label="Report results"
            >
              <table className="w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {visibleColumns.map((column) => (
                      <th key={column.key} scope="col" className="px-3 py-2">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((row, index) => (
                    <tr className="border-t" key={index}>
                      {visibleColumns.map((column) => {
                        const value = formatReportCell(
                          reportCellValue(kind, row, column.key),
                          column.format,
                          column.signed
                        )
                        const href =
                          column.key === "cycleId"
                            ? `/purchases/${value}`
                            : column.key === "saleId"
                              ? `/sales/${value}`
                              : column.key === "repairId"
                                ? `/repairs/${value}`
                                : null
                        return (
                          <td
                            key={column.key}
                            className={`px-3 py-2 ${column.key === "components" || column.key === "request" ? "min-w-48" : "whitespace-nowrap"}`}
                          >
                            {href && value ? (
                              <Link
                                prefetch={false}
                                className="underline"
                                href={href}
                              >
                                {value}
                              </Link>
                            ) : (
                              value || "—"
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : !result.notice || result.total > 0 ? (
            <p>No records match these filters.</p>
          ) : null}
          {(result.page > 1 ||
            result.page * result.pageSize < result.total) && (
            <nav aria-label="Report pages" className="flex items-center gap-3">
              {result.page > 1 && (
                <Button variant="outline" asChild>
                  <Link prefetch={false} href={pageHref(result.page - 1)}>
                    Previous page
                  </Link>
                </Button>
              )}
              <span>Page {result.page}</span>
              {result.page * result.pageSize < result.total && (
                <Button variant="outline" asChild>
                  <Link prefetch={false} href={pageHref(result.page + 1)}>
                    Next page
                  </Link>
                </Button>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  )
}
