"use client"
import { ImportedBadge } from "@/components/imports/imported-badge"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
  VehicleDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import {
  purchaseInput,
  stockEnvelope,
  type StockCommand,
} from "@/lib/server/validators"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CycleCosts } from "./cycle-costs"
import { CycleEdits } from "./cycle-edits"
import {
  RepairCommands,
  RepairHistory,
} from "@/components/repairs/repair-workspace"
import { RecordSaleDialog } from "@/components/sales/record-sale-dialog"
import { SettlementFields, settlementFromDraft } from "./settlement-fields"
import {
  WriteOffRequest,
  DisposalHistory,
} from "@/components/approvals/write-off"
import {
  PartyForm,
  type VisibleParty,
} from "@/components/third-parties/party-form"

type Cycle = Visible<PurchaseCycleDTO>
type Vehicle = Visible<VehicleDTO>
const amount = (value: string | undefined) =>
  value === undefined ? "Unavailable" : major(BigInt(value))
const physicalFields = [
  ["engineNumber", "Engine number", true],
  ["chassisNumber", "Chassis number", true],
  ["make", "Make", true],
  ["model", "Model", true],
  ["year", "Year", true],
  ["colour", "Colour", true],
  ["vin", "VIN", false],
  ["crNumber", "CR number", false],
  ["notes", "Vehicle notes", false],
] as const

export function AcquisitionForm({
  onSaved,
}: {
  onSaved: (result: Applied) => void
}) {
  const { actor } = useActor(),
    ability = abilityFor(actor.presentationGrants, actor.user.id),
    queries = useQueryClient()
  const [draft, setDraft] = useState<Record<string, string>>({
    fuelType: "PETROL",
    transmission: "AUTOMATIC",
    purchaseType: "CASH",
    paymentMethod: "CASH",
    mileage: "0",
  })
  const [search, setSearch] = useState(""),
    [supplierPage, setSupplierPage] = useState(1),
    [supplier, setSupplier] = useState<VisibleParty | null>(null)
  const [inline, setInline] = useState(false),
    [inlinePending, setInlinePending] = useState(false)
  const [company, setCompany] = useState<VisibleParty | null>(null)
  const [body, setBody] = useState<string | null>(null),
    [pending, setPending] = useState(false),
    [stale, setStale] = useState(false),
    [latest, setLatest] = useState<VisibleParty | null>(null),
    [error, setError] = useState("")
  const alert = useRef<HTMLParagraphElement>(null)
  const suppliers = useQuery({
    queryKey: ["parties", "purchase-selector", search, supplierPage],
    retry: false,
    queryFn: () =>
      privateRequest<{ data: { data: VisibleParty[]; total: number } }>(
        `/api/v1/queries/parties?type=SUPPLIER&active=true&pageSize=20&page=${supplierPage}&q=${encodeURIComponent(search)}`
      ),
  })
  const locked = pending || !!body || inlinePending
  const update = (key: string, value: string) =>
    setDraft({ ...draft, [key]: value })
  function problem(message: string) {
    setError(message)
    requestAnimationFrame(() => alert.current?.focus())
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pending || stale || inlinePending) return
    let submitted = body
    setPending(true)
    try {
      if (!submitted) {
        if (!supplier?.id || !supplier.revision || !supplier.active)
          throw new Error(
            "Select a readable active supplier with its revision."
          )
        const vehicle = Object.fromEntries(
          physicalFields
            .filter(([key, , required]) => required || draft[key]?.trim())
            .map(([key]) => [
              key,
              key === "year" ? Number(draft[key]) : (draft[key] ?? ""),
            ])
        )
        const parsed = purchaseInput.safeParse({
          vehicle: {
            ...vehicle,
            fuelType: draft.fuelType,
            transmission: draft.transmission,
          },
          supplierId: supplier.id,
          purchaseDate: draft.purchaseDate,
          purchaseType: draft.purchaseType,
          ...(draft.purchaseType === "LEASE_SETTLEMENT"
            ? { settlement: settlementFromDraft(draft) }
            : { purchasePrice: parseMajor(draft.purchasePrice ?? "") }),
          ...(draft.listedPrice?.trim()
            ? { listedPrice: parseMajor(draft.listedPrice) }
            : {}),
          paymentMethod: draft.paymentMethod,
          mileage: {
            reading: draft.mileage?.trim() ? Number(draft.mileage) : -1,
            date: draft.mileageDate,
            ...(draft.mileageRemark?.trim()
              ? { remark: draft.mileageRemark }
              : {}),
          },
        })
        if (!parsed.success)
          throw new Error(
            parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          )
        const identity = await privateRequest<{
          data: { id: string; revision: number } | null
        }>(
          `/api/v1/queries/vehicleIdentity?engineNumber=${encodeURIComponent(parsed.data.vehicle.engineNumber)}&chassisNumber=${encodeURIComponent(parsed.data.vehicle.chassisNumber)}`
        )
        const expected: Dependency[] = [
          { type: "Supplier", id: supplier.id, revision: supplier.revision },
          ...(identity.data
            ? [
                {
                  type: "Vehicle" as const,
                  id: identity.data.id,
                  revision: identity.data.revision,
                },
              ]
            : []),
        ]
        if (
          parsed.data.purchaseType === "LEASE_SETTLEMENT" &&
          parsed.data.settlement.institutionType === "FINANCE_COMPANY"
        ) {
          if (
            !company?.id ||
            company.id !== parsed.data.settlement.companyId ||
            !company.revision ||
            !company.active ||
            !company.name
          )
            throw new Error(
              "Select or explicitly load a readable active finance company and revision."
            )
          expected.push({
            type: "FinanceCompany",
            id: company.id,
            revision: company.revision,
          })
        }
        submitted = JSON.stringify({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected,
          input: parsed.data,
        })
        setBody(submitted)
      }
      const result = await privateRequest<Applied>(
        "/api/v1/commands/recordPurchase",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: submitted,
        }
      )
      for (const key of result.invalidate)
        await queries.invalidateQueries({ queryKey: [key] })
      setBody(null)
      onSaved(result)
    } catch (cause) {
      const code =
        cause instanceof RequestError
          ? cause.code
          : cause instanceof Error
            ? cause.message
            : "NETWORK_ERROR"
      const conflict = [
        "STALE_REVISION",
        "REVISION_REQUIRED",
        "IDENTITY_CONFLICT",
      ].includes(code)
      setStale(conflict)
      if (
        cause instanceof RequestError &&
        cause.status < 500 &&
        !conflict &&
        !["COMMAND_IN_PROGRESS", "IDEMPOTENCY_MISMATCH"].includes(code)
      )
        setBody(null)
      problem(
        `${code}. Draft retained. Unresolved retries send the original body and key; conflicts require explicit reload and new intent.`
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      className="space-y-5 rounded-lg border p-4"
      aria-label="New acquisition"
    >
      <h2 className="text-xl font-semibold">Record paid acquisition</h2>
      <p>
        Cash, brand-new and lease settlement acquisitions record actual positive
        payments on the purchase date. Stock remains Purchased and unavailable
        until explicit physical receipt. Repurchase and trade-in remain pending.
      </p>
      <fieldset disabled={locked} className="space-y-3">
        <Label htmlFor="supplier-search">Search active suppliers by name</Label>
        <Input
          id="supplier-search"
          value={search}
          maxLength={200}
          onChange={(e) => {
            setSearch(e.target.value)
            setSupplierPage(1)
          }}
          className="min-h-11 text-base"
        />
        {suppliers.isPending && <p role="status">Loading active suppliers…</p>}
        {suppliers.isError && (
          <p role="alert">
            Supplier read failed. Draft retained.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void suppliers.refetch()}
            >
              Retry supplier read
            </button>
          </p>
        )}
        {suppliers.data && (
          <>
            <Label htmlFor="supplier">Supplier *</Label>
            <select
              id="supplier"
              value={supplier?.id ?? ""}
              className="min-h-11 w-full rounded-md border bg-background px-3"
              onChange={(e) =>
                setSupplier(
                  suppliers.data.data.data.find(
                    (p) => p.id === e.target.value
                  ) ?? null
                )
              }
            >
              <option value="">Select active supplier</option>
              {supplier?.id &&
                !suppliers.data.data.data.some((p) => p.id === supplier.id) && (
                  <option value={supplier.id}>
                    {supplier.name ?? supplier.id}
                  </option>
                )}
              {suppliers.data.data.data
                .filter((p) => p.id && p.revision && p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? "Name unavailable"} ·{" "}
                    {p.directory?.category ?? "Category unavailable"}
                  </option>
                ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={supplierPage === 1}
                onClick={() => setSupplierPage(supplierPage - 1)}
              >
                Previous suppliers
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={supplierPage * 20 >= suppliers.data.data.total}
                onClick={() => setSupplierPage(supplierPage + 1)}
              >
                More suppliers
              </Button>
            </div>
          </>
        )}
        {ability.can("create", "Supplier") && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setInline(!inline)}
          >
            {inline ? "Close supplier form" : "Create supplier inline"}
          </Button>
        )}
      </fieldset>
      {inline && (
        <section aria-label="Inline supplier" className="rounded-md border p-4">
          <PartyForm
            kind="SUPPLIER"
            onUnresolvedChange={setInlinePending}
            onReload={async () => undefined}
            onSaved={async (result) => {
              try {
                const response = await privateRequest<{ data: VisibleParty }>(
                  `/api/v1/queries/party?type=SUPPLIER&id=${result.result.id}`
                )
                setSupplier(response.data)
                setInline(false)
              } catch {
                problem(
                  "Supplier committed, but selection read failed. Retry searching; acquisition draft retained."
                )
              }
            }}
          />
        </section>
      )}
      <form onSubmit={submit} className="space-y-5">
        <fieldset
          disabled={locked}
          className="grid min-w-0 gap-4 sm:grid-cols-2"
        >
          {physicalFields.map(([key, label, required]) => (
            <div key={key} className="min-w-0 space-y-2">
              <Label htmlFor={`acquisition-${key}`}>
                {label}
                {required ? " *" : " (optional)"}
              </Label>
              <Input
                id={`acquisition-${key}`}
                name={key}
                required={required}
                type={key === "year" ? "number" : "text"}
                min={key === "year" ? 1886 : undefined}
                maxLength={
                  key === "notes"
                    ? 2000
                    : ["make", "model", "colour"].includes(key)
                      ? 200
                      : 100
                }
                value={draft[key] ?? ""}
                onChange={(e) => update(key, e.target.value)}
                disabled={!ability.can("create", "Vehicle", key)}
                className="min-h-11 text-base"
              />
            </div>
          ))}
          {[
            [
              "fuelType",
              "Fuel type",
              ["PETROL", "DIESEL", "HYBRID", "ELECTRIC", "OTHER"],
            ],
            [
              "transmission",
              "Transmission",
              ["MANUAL", "AUTOMATIC", "CVT", "OTHER"],
            ],
            [
              "purchaseType",
              "Purchase type",
              ["CASH", "BRAND_NEW", "LEASE_SETTLEMENT"],
            ],
            ["paymentMethod", "Payment method", ["CASH", "BANK_TRANSFER"]],
          ].map(([key, label, options]) => (
            <div key={key as string} className="space-y-2">
              <Label htmlFor={`acquisition-${key}`}>{label} *</Label>
              <select
                id={`acquisition-${key}`}
                value={draft[key as string]}
                onChange={(e) => update(key as string, e.target.value)}
                className="min-h-11 w-full rounded-md border bg-background px-3"
              >
                {(options as string[]).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          ))}
          {[
            ["purchaseDate", "Actual purchase date", "date", true],
            [
              "purchasePrice",
              "Paid purchase price (major units)",
              "text",
              true,
            ],
            [
              "listedPrice",
              "Listed price (major units, optional)",
              "text",
              false,
            ],
            ["mileage", "Initial mileage", "number", true],
            ["mileageDate", "Mileage date", "date", true],
            ["mileageRemark", "Mileage remark (optional)", "text", false],
          ]
            .filter(
              ([key]) =>
                key !== "purchasePrice" ||
                draft.purchaseType !== "LEASE_SETTLEMENT"
            )
            .map(([key, label, type, required]) => (
              <div key={key as string} className="space-y-2">
                <Label htmlFor={`acquisition-${key}`}>
                  {label}
                  {required ? " *" : ""}
                </Label>
                <Input
                  id={`acquisition-${key}`}
                  name={key as string}
                  type={type as string}
                  required={required as boolean}
                  inputMode={
                    (key as string).endsWith("Price") ? "decimal" : undefined
                  }
                  min={type === "number" ? 0 : undefined}
                  max={key === "mileage" ? 99999999 : undefined}
                  value={draft[key as string] ?? ""}
                  onChange={(e) => update(key as string, e.target.value)}
                  className="min-h-11 text-base"
                />
              </div>
            ))}
          {draft.purchaseType === "LEASE_SETTLEMENT" && (
            <SettlementFields
              draft={draft}
              change={update}
              company={company}
              selectCompany={setCompany}
            />
          )}
        </fieldset>
        {error && (
          <p
            role="alert"
            ref={alert}
            tabIndex={-1}
            className="break-words text-destructive"
          >
            {error}
          </p>
        )}
        {stale && (
          <section className="space-y-3 rounded-md border p-4">
            <p>
              Review the current supplier, then explicitly start a new intent
              with your retained draft. An existing vehicle cannot be acquired
              again in this slice.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  if (!supplier?.id) return
                  setLatest(
                    (
                      await privateRequest<{ data: VisibleParty }>(
                        `/api/v1/queries/party?type=SUPPLIER&id=${supplier.id}`
                      )
                    ).data
                  )
                } catch {
                  problem(
                    "Current supplier reload failed. Original intent retained."
                  )
                }
              }}
            >
              Reload current supplier
            </Button>
            {latest && (
              <>
                <p>
                  {latest.name} · revision {latest.revision} ·{" "}
                  {latest.active ? "Active" : "Archived"}
                </p>
                <Button
                  type="button"
                  disabled={!latest.id || !latest.revision || !latest.active}
                  onClick={() => {
                    setSupplier(latest)
                    setLatest(null)
                    setBody(null)
                    setStale(false)
                    setError("")
                  }}
                >
                  Reconfirm retained draft as new intent
                </Button>
              </>
            )}
          </section>
        )}
        <Button
          type="submit"
          disabled={
            pending ||
            stale ||
            inlinePending ||
            !ability.can("create", "PurchaseRecord")
          }
          className="min-h-11"
        >
          {pending
            ? "Recording…"
            : body
              ? "Retry unchanged acquisition"
              : "Record fully paid acquisition"}
        </Button>
      </form>
    </section>
  )
}

export function AcquisitionWorkspace({
  inventory = false,
}: {
  inventory?: boolean
}) {
  const params = useSearchParams(),
    router = useRouter(),
    { actor } = useActor(),
    ability = abilityFor(actor.presentationGrants, actor.user.id)
  const page = Math.max(1, Number(params.get("page") ?? "1")),
    search = params.get("q") ?? "",
    [draftSearch, setDraftSearch] = useState(search),
    [form, setForm] = useState(false)
  const name = inventory ? "inventory" : "purchases"
  const navigation = useRef(params.toString())
  useEffect(() => {
    navigation.current = params.toString()
  }, [params])
  const status = params.get("status") ?? ""
  const availability = params.get("available") ?? ""
  const make = params.get("make") ?? ""
  const model = params.get("model") ?? ""
  const sort = params.get("order") ?? "id"
  const filters = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    q: search,
  })
  if (status) filters.set("statuses", JSON.stringify([status]))
  if (inventory && availability) filters.set("available", availability)
  if (inventory && make) filters.set("make", make)
  if (inventory && model) filters.set("model", model)
  filters.set("sort", JSON.stringify([{ field: sort, direction: "asc" }]))
  const query = useQuery({
    queryKey: [name, filters.toString()],
    retry: false,
    queryFn: () =>
      privateRequest<{
        data: { data: (Cycle & Vehicle)[]; total: number; pageSize: number }
      }>(`/api/v1/queries/${name}?${filters}`),
  })
  function navigate(next: number, q = search) {
    const nextParams = new URLSearchParams(navigation.current)
    nextParams.set("page", String(next))
    nextParams.set("q", q)
    navigation.current = nextParams.toString()
    router.replace(`?${nextParams}`, {
      scroll: false,
    })
  }
  function filter(key: string, value: string) {
    const nextParams = new URLSearchParams(navigation.current)
    if (value) nextParams.set(key, value)
    else nextParams.delete(key)
    nextParams.set("page", "1")
    navigation.current = nextParams.toString()
    router.replace(`?${nextParams}`, { scroll: false })
  }
  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {inventory ? "Vehicle inventory" : "Purchases"}
        </h1>
        <p>
          Persisted acquisitions. Purchased is not received or available stock.
        </p>
      </header>
      {ability.can("create", "PurchaseRecord") && !form && (
        <Button onClick={() => setForm(true)}>New paid acquisition</Button>
      )}
      {form && (
        <AcquisitionForm
          onSaved={(result) => {
            setForm(false)
            router.push(`/purchases/${result.result.id}`)
          }}
        />
      )}
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          navigate(1, draftSearch)
        }}
      >
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="acquisition-search">
            Search make, model, engine or chassis
          </Label>
          <Input
            id="acquisition-search"
            value={draftSearch}
            maxLength={200}
            onChange={(e) => setDraftSearch(e.target.value)}
            className="min-h-11 text-base"
          />
        </div>
        <Button>Search</Button>
      </form>
      <section
        aria-label="Persisted inventory filters"
        className="grid gap-3 sm:grid-cols-2"
      >
        <div className="space-y-2">
          <Label htmlFor="stock-status">Status filter</Label>
          <select
            id="stock-status"
            value={status}
            onChange={(e) => filter("status", e.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            <option value="">All statuses</option>
            <option value="PURCHASED">Purchased</option>
            <option value="IN_STOCK">In Stock</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="stock-sort">Sort ascending</Label>
          <select
            id="stock-sort"
            value={sort}
            onChange={(e) => filter("order", e.target.value)}
            className="min-h-11 w-full rounded-md border bg-background px-3"
          >
            {(inventory
              ? ["id", "status", "available", "listedPrice"]
              : ["id", "purchaseDate", "purchasePrice", "listedPrice", "status"]
            ).map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        {inventory && (
          <>
            <div className="space-y-2">
              <Label htmlFor="stock-available">Availability filter</Label>
              <select
                id="stock-available"
                value={availability}
                onChange={(e) => filter("available", e.target.value)}
                className="min-h-11 w-full rounded-md border bg-background px-3"
              >
                <option value="">All availability</option>
                <option value="true">Available</option>
                <option value="false">Unavailable</option>
              </select>
            </div>
            {[
              ["make", make],
              ["model", model],
            ].map(([key, value]) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={`stock-${key}`}>Exact {key} filter</Label>
                <Input
                  id={`stock-${key}`}
                  defaultValue={value}
                  maxLength={200}
                  onBlur={(e) => {
                    if (e.target.value !== value) filter(key, e.target.value)
                  }}
                  className="min-h-11 text-base"
                />
              </div>
            ))}
          </>
        )}
      </section>
      {query.isPending && <p role="status">Loading persisted {name}…</p>}
      {query.isError && (
        <p role="alert">
          Read unavailable.{" "}
          {query.error instanceof RequestError
            ? query.error.code
            : "Request failed"}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry read
          </button>
        </p>
      )}
      {query.data && (
        <>
          <p role="status">{query.data.data.total} records</p>
          {!query.data.data.total && <p>No matching authorized records.</p>}
          <ul className="grid gap-4 sm:grid-cols-2">
            {query.data.data.data.map((row, i) => (
              <li
                key={row.id ?? i}
                className="min-w-0 space-y-3 rounded-lg border p-4"
              >
                <h2 className="font-semibold break-words">
                  {row.identity?.make ?? "Make unavailable"}{" "}
                  {row.identity?.model ?? ""}
                </h2>
                <p>
                  {row.status ?? "Status unavailable"} ·{" "}
                  {row.available === undefined
                    ? "Availability unavailable"
                    : row.available
                      ? "Available"
                      : "Unavailable stock"}
                </p>
                <p>Engine: {row.identity?.engineNumber ?? "Unavailable"}</p>
                {row.receivedDate && <p>Received: {row.receivedDate}</p>}
                {row.holdReason && (
                  <p className="break-words">Hold: {row.holdReason}</p>
                )}
                {!inventory && row.purchasePrice !== undefined && (
                  <p>Purchase price: {amount(row.purchasePrice)}</p>
                )}
                {row.listedPrice !== undefined && (
                  <p>Listed price: {amount(row.listedPrice)}</p>
                )}
                {row.id && (
                  <Link
                    prefetch={false}
                    className="inline-flex min-h-11 items-center underline"
                    href={
                      inventory ? `/vehicles/${row.id}` : `/purchases/${row.id}`
                    }
                  >
                    View {inventory ? "vehicle" : "purchase"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={page <= 1}
              onClick={() => navigate(page - 1)}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              variant="outline"
              disabled={page * 20 >= query.data.data.total}
              onClick={() => navigate(page + 1)}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

function StockControls({ cycle }: { cycle: Cycle }) {
  const queries = useQueryClient()
  const [name, setName] = useState<StockCommand | null>(null)
  const [snapshot, setSnapshot] = useState(cycle)
  const [received, setReceived] = useState("")
  const [disposition, setDisposition] = useState("RELEASE")
  const [reason, setReason] = useState("")
  const [body, setBody] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [stale, setStale] = useState(false)
  const [latest, setLatest] = useState<Cycle | null>(null)
  const [message, setMessage] = useState("")
  const alert = useRef<HTMLParagraphElement>(null)
  const actions = (cycle.nextActions ?? []).filter((n): n is StockCommand =>
    ["receiveStock", "holdStock", "releaseStock"].includes(n)
  )
  const label = {
    receiveStock: "Receive stock",
    holdStock: "Hold stock",
    releaseStock: "Release stock",
  }
  function problem(text: string) {
    setMessage(text)
    requestAnimationFrame(() => alert.current?.focus())
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!name || pending || stale) return
    setPending(true)
    try {
      let submitted = body
      if (!submitted) {
        if (!snapshot.id || !snapshot.revision)
          throw new Error("Readable cycle revision required")
        const input =
          name === "receiveStock"
            ? {
                cycleId: snapshot.id,
                date: received,
                disposition:
                  disposition === "HOLD"
                    ? { kind: "HOLD", reason }
                    : { kind: "RELEASE" },
              }
            : name === "holdStock"
              ? { cycleId: snapshot.id, reason }
              : { cycleId: snapshot.id }
        const parsed = stockEnvelope(name).safeParse({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected: [
            {
              type: "PurchaseRecord",
              id: snapshot.id,
              revision: snapshot.revision,
            },
          ],
          input,
        })
        if (!parsed.success)
          throw new Error(
            "Enter a valid receipt date and nonblank hold reason (at most 2000 characters)."
          )
        submitted = JSON.stringify(parsed.data)
        setBody(submitted)
      }
      const result = await privateRequest<Applied>(`/api/v1/commands/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: submitted,
      })
      setBody(null)
      setName(null)
      setMessage(
        "Stock change committed. No payment, mileage or cost was recorded."
      )
      for (const key of result.invalidate)
        await queries.invalidateQueries({ queryKey: [key] })
    } catch (cause) {
      const code =
        cause instanceof RequestError
          ? cause.code
          : cause instanceof Error
            ? cause.message
            : "NETWORK_ERROR"
      const conflict = [
        "STALE_REVISION",
        "REVISION_REQUIRED",
        "INVALID_STATE",
      ].includes(code)
      setStale(conflict)
      // Uncertain transport/auth/read failures never replace the original intent.
      if (cause instanceof RequestError && cause.status === 422) setBody(null)
      problem(
        `${code}. Draft retained. Retry sends the original unchanged envelope; conflicts require explicit reload and reconfirmation.`
      )
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      aria-label="Stock controls"
      className="space-y-4 rounded-md border p-4"
    >
      <h3 className="font-semibold">Physical receipt and availability</h3>
      {!name && (
        <div className="flex flex-wrap gap-3">
          {actions.map((n) => (
            <Button
              key={n}
              onClick={() => {
                setName(n)
                setSnapshot(cycle)
                setStale(false)
                setLatest(null)
                setMessage("")
              }}
            >
              {label[n]}
            </Button>
          ))}
          {!actions.length && <p>No authorized stock action in this state.</p>}
        </div>
      )}
      {name && (
        <form onSubmit={submit} className="space-y-4">
          <p>
            {label[name]} · cycle revision {snapshot.revision}. This changes
            stock only, never money or physical identity.
          </p>
          <fieldset disabled={pending || !!body} className="space-y-4">
            {name === "receiveStock" && (
              <>
                <Label htmlFor={`received-${cycle.id}`}>
                  Actual received date *
                </Label>
                <Input
                  id={`received-${cycle.id}`}
                  type="date"
                  required
                  value={received}
                  onChange={(e) => setReceived(e.target.value)}
                  className="min-h-11 text-base"
                />
                <Label htmlFor={`disposition-${cycle.id}`}>
                  Receipt disposition *
                </Label>
                <select
                  id={`disposition-${cycle.id}`}
                  value={disposition}
                  onChange={(e) => setDisposition(e.target.value)}
                  className="min-h-11 w-full rounded-md border bg-background px-3"
                >
                  <option value="RELEASE">Release as available</option>
                  <option value="HOLD">Receive on hold</option>
                </select>
              </>
            )}
            {(name === "holdStock" ||
              (name === "receiveStock" && disposition === "HOLD")) && (
              <>
                <Label htmlFor={`hold-${cycle.id}`}>Hold reason *</Label>
                <Input
                  id={`hold-${cycle.id}`}
                  required
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="min-h-11 text-base"
                />
              </>
            )}
          </fieldset>
          {stale && (
            <section className="space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    setLatest(
                      (
                        await privateRequest<{ data: Cycle }>(
                          `/api/v1/queries/purchase?cycleId=${snapshot.id}`
                        )
                      ).data
                    )
                  } catch {
                    problem(
                      "Current read failed. Original envelope and draft retained."
                    )
                  }
                }}
              >
                Reload current stock
              </Button>
              {latest && (
                <>
                  <p>
                    Current revision {latest.revision} · {latest.status} ·{" "}
                    {latest.available ? "Available" : "Held or not received"}
                  </p>
                  <Button
                    type="button"
                    disabled={
                      !latest.id ||
                      !latest.revision ||
                      !latest.nextActions?.includes(name)
                    }
                    onClick={() => {
                      setSnapshot(latest)
                      setLatest(null)
                      setBody(null)
                      setStale(false)
                      setMessage("")
                    }}
                  >
                    Reconfirm retained draft as new stock intent
                  </Button>
                  {!latest.nextActions?.includes(name) && (
                    <p>
                      This action is no longer available. No replacement intent
                      was submitted.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending || stale} type="submit">
              {pending
                ? "Committing stock…"
                : body
                  ? "Retry unchanged stock intent"
                  : `Confirm ${label[name].toLowerCase()}`}
            </Button>
            {(!body || stale) && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setName(null)
                  setBody(null)
                  setStale(false)
                  setLatest(null)
                }}
              >
                Cancel draft
              </Button>
            )}
          </div>
        </form>
      )}
      {message && (
        <p ref={alert} tabIndex={-1} role="status" className="break-words">
          {message}
        </p>
      )}
    </section>
  )
}

function CycleDetail({ cycle }: { cycle: Cycle }) {
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <h2 className="text-xl font-semibold">
        Purchase cycle {cycle.cycleNumber ?? "Unavailable"}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ["Cycle ID", cycle.id],
          ["Cycle revision", cycle.revision],
          ["Identity revision", cycle.identityRevision],
          ["Status", cycle.status],
          ["Received date", cycle.receivedDate],
          [
            "Availability",
            cycle.available === undefined
              ? undefined
              : cycle.available
                ? "Available"
                : "Unavailable",
          ],
          ["Hold reason", cycle.holdReason],
          ["Purchase type", cycle.purchaseType],
          ["Acquisition kind", cycle.acquisitionKind],
          ["Purchase date", cycle.purchaseDate],
          ["Purchase notes", cycle.notes],
          ["Seller", cycle.seller?.name],
          ["Purchase price", amount(cycle.purchasePrice)],
          ["Listed price", amount(cycle.listedPrice)],
          ["Basis", amount(cycle.financial?.basis)],
          ...(cycle.financial?.salePrice !== undefined
            ? [
                ["Original basis", amount(cycle.financial?.originalBasis)],
                ["Sale price", amount(cycle.financial?.salePrice)],
                ["Original profit", amount(cycle.financial?.originalProfit)],
                ["Restated profit", amount(cycle.financial?.restatedProfit)],
              ]
            : []),
          ["Currency", cycle.financial?.currency],
          ["Seller outstanding", amount(cycle.outstanding?.seller)],
          ["Settlement outstanding", amount(cycle.outstanding?.settlement)],
          ...(cycle.purchaseType === "LEASE_SETTLEMENT"
            ? [
                [
                  "Settlement institution type",
                  cycle.settlement?.institutionType,
                ],
                [
                  "Institution name snapshot",
                  cycle.settlement?.institutionNameSnapshot,
                ],
                ["Settlement reference", cycle.settlement?.reference],
                ["Institution liability", amount(cycle.settlement?.amount)],
                ["Seller liability", amount(cycle.settlement?.cashToSeller)],
              ]
            : []),
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="break-words">{value ?? "Unavailable"}</dd>
          </div>
        ))}
      </dl>
      {cycle.seller?.id && cycle.seller.type === "SUPPLIER" && (
        <Link
          prefetch={false}
          className="inline-flex min-h-11 items-center underline"
          href={`/third-parties/${cycle.seller.id}?type=SUPPLIER`}
        >
          Supplier history
        </Link>
      )}
      {cycle.settlement?.institutionType === "FINANCE_COMPANY" &&
        cycle.settlement.companyId && (
          <Link
            prefetch={false}
            className="inline-flex min-h-11 items-center underline"
            href={`/third-parties/${cycle.settlement.companyId}?type=FINANCE_COMPANY`}
          >
            Settlement company history
          </Link>
        )}
      {cycle.vehicleId && (
        <Link
          prefetch={false}
          className="ml-3 inline-flex min-h-11 items-center underline"
          href={`/vehicles/${cycle.vehicleId}`}
        >
          Physical vehicle
        </Link>
      )}
      <h3 className="font-semibold">Actual source-owned payments</h3>
      {cycle.payments === undefined ? (
        <p>Payments unavailable</p>
      ) : cycle.payments.length ? (
        <ul className="space-y-3">
          {cycle.payments.map((p) => (
            <li key={p.id} className="break-words">
              {p.category ?? "Category unavailable"} ·{" "}
              {p.direction ?? "Direction unavailable"} {amount(p.amount)} ·{" "}
              {p.date ?? "Date unavailable"} ·{" "}
              {p.method ?? "Method unavailable"}
              <br />
              Payment {p.id}
              <br />
              Owner {p.owner?.type} {p.owner?.id}
              <br />
              Command {p.commandId}
              {p.reference && (
                <>
                  <br />
                  Reference: {p.reference}
                </>
              )}
              {p.reversalOf && (
                <>
                  <br />
                  Exact correction reversal of {p.reversalOf}
                </>
              )}
              {p.reason && (
                <>
                  <br />
                  Reason: {p.reason}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No recorded payment facts.</p>
      )}
      <h3 className="font-semibold">Dated mileage</h3>
      {cycle.mileage?.map((m) => (
        <p key={m.id}>
          {m.reading ?? "Unavailable"} · {m.date ?? "Date unavailable"}{" "}
          {m.remark}
          {m.decreaseReason && <> · Decrease reason: {m.decreaseReason}</>}
          {m.id && <> · Reading {m.id}</>}
        </p>
      )) ?? <p>Unavailable</p>}
      <h3 className="font-semibold">Basis evidence</h3>
      {cycle.basisVersions?.map((b) => (
        <p key={b.id} className="break-words">
          Version {b.version}: {amount(b.total)} · {b.reason} · {b.id}
        </p>
      )) ?? <p>Unavailable</p>}
      <DisposalHistory cycle={cycle} />
      {cycle.tradeInSourceSaleId && (
        <p>
          Acquired via Trade-In:{" "}
          <Link
            prefetch={false}
            className="underline"
            href={`/sales/${cycle.tradeInSourceSaleId}`}
          >
            Source sale {cycle.tradeInSourceSaleId}
          </Link>
        </p>
      )}
      {cycle.sales && cycle.sales.length > 0 && (
        <div className="space-y-1">
          <h3 className="font-semibold">Completed Sales</h3>
          {cycle.sales.map((s) => (
            <p key={s.saleCaseId}>
              <Link
                prefetch={false}
                className="underline"
                href={`/sales/${s.saleCaseId}`}
              >
                {s.kind} · {s.state} · {s.date ?? ""} ({s.saleCaseId})
              </Link>
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
export function AcquisitionDetail({
  id,
  vehicle = false,
}: {
  id: string
  vehicle?: boolean
}) {
  const name = vehicle ? "vehicle" : "purchase"
  const query = useQuery({
    queryKey: [vehicle ? "inventory" : "purchases", "detail", id],
    retry: false,
    queryFn: () =>
      privateRequest<{ data: Cycle & Vehicle & { cycles?: Cycle[] } }>(
        `/api/v1/queries/${name}?${vehicle ? "id" : "cycleId"}=${encodeURIComponent(id)}`
      ),
  })
  const row = query.data?.data
  return (
    <section className="mx-auto w-full max-w-5xl space-y-5">
      <h1 className="text-2xl font-semibold">
        {vehicle ? "Physical vehicle" : "Purchase detail"}
      </h1>
      {/* Keep the pending intent outside the query-result subtree. A transient
          observer/read reset must not unmount its immutable request envelope. */}
      <StockControls
        cycle={
          (vehicle ? row?.cycles?.find((c) => c.id === row.cycleId) : row) ?? {}
        }
      />
      <CycleCosts
        cycle={
          (vehicle ? row?.cycles?.find((c) => c.id === row.cycleId) : row) ?? {}
        }
      />
      <CycleEdits
        cycle={
          (vehicle ? row?.cycles?.find((c) => c.id === row.cycleId) : row) ?? {}
        }
      />
      {!vehicle && <RepairCommands cycle={row ?? {}} cycleId={id} />}
      <WriteOffRequest
        target={`${vehicle ? "vehicle" : "purchase"}:${id}`}
        cycle={
          (vehicle ? row?.cycles?.find((c) => c.id === row.cycleId) : row) ?? {}
        }
      />
      {((vehicle ? row?.cycles?.find((c) => c.id === row.cycleId) : row)
        ?.nextActions?.includes("completeImmediate")) && (
        <RecordSaleDialog
          fixedCycle={
            vehicle ? row?.cycles?.find((c) => c.id === row.cycleId) : row
          }
        />
      )}
      {query.isPending && <p role="status">Loading persisted detail…</p>}
      {query.isError && (
        <p role="alert">
          Detail unavailable.{" "}
          {query.error instanceof RequestError
            ? query.error.code
            : "Request failed"}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry detail
          </button>
        </p>
      )}
      {row && (
        <>
          <ImportedBadge provenance={row.provenance} />
          <dl className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
            {physicalFields.map(([key, label]) => (
              <div key={key}>
                <dt className="text-sm text-muted-foreground">{label}</dt>
                <dd className="break-words">
                  {row.identity?.[key] ?? "Not provided or unavailable"}
                </dd>
              </div>
            ))}
          </dl>
          {vehicle ? (
            row.cycles?.map((cycle, i) => (
              <div key={cycle.id ?? i} className="space-y-4">
                <CycleDetail cycle={cycle} />
                <RepairHistory cycle={cycle} />
                {cycle.id && (
                  <Link
                    prefetch={false}
                    className="underline"
                    href={`/purchases/${cycle.id}`}
                  >
                    Manage repairs with current purchase detail
                  </Link>
                )}
              </div>
            ))
          ) : (
            <>
              <CycleDetail cycle={row} />
              <RepairHistory cycle={row} />
            </>
          )}
        </>
      )}
    </section>
  )
}
