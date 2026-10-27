"use client"
import { useRef, useState } from "react"
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
import { purchaseInput } from "@/lib/server/validators"
import { privateRequest, RequestError } from "@/lib/security-client"
import { major, parseMajor } from "@/lib/money"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
          purchasePrice: parseMajor(draft.purchasePrice ?? ""),
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
        Cash and brand-new only. This records a full seller payment on the
        actual purchase date. Physical receipt, settlement, repurchase and
        trade-in are pending; stock remains Purchased and unavailable.
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
            ["purchaseType", "Purchase type", ["CASH", "BRAND_NEW"]],
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
          ].map(([key, label, type, required]) => (
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
  const query = useQuery({
    queryKey: [name, page, search],
    retry: false,
    queryFn: () =>
      privateRequest<{
        data: { data: (Cycle & Vehicle)[]; total: number; pageSize: number }
      }>(
        `/api/v1/queries/${name}?page=${page}&pageSize=20&q=${encodeURIComponent(search)}`
      ),
  })
  function navigate(next: number, q = search) {
    router.replace(`?page=${next}&q=${encodeURIComponent(q)}`, {
      scroll: false,
    })
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
          ["Purchase type", cycle.purchaseType],
          ["Acquisition kind", cycle.acquisitionKind],
          ["Purchase date", cycle.purchaseDate],
          ["Seller", cycle.seller?.name],
          ["Purchase price", amount(cycle.purchasePrice)],
          ["Listed price", amount(cycle.listedPrice)],
          ["Basis", amount(cycle.financial?.basis)],
          ["Currency", cycle.financial?.currency],
          ["Seller outstanding", amount(cycle.outstanding?.seller)],
          ["Settlement outstanding", amount(cycle.outstanding?.settlement)],
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
              {p.direction} {amount(p.amount)} · {p.date} · {p.method}
              <br />
              Payment {p.id}
              <br />
              Owner {p.owner?.type} {p.owner?.id}
              <br />
              Command {p.commandId}
            </li>
          ))}
        </ul>
      ) : (
        <p>No recorded payment facts.</p>
      )}
      <h3 className="font-semibold">Dated mileage</h3>
      {cycle.mileage?.map((m) => (
        <p key={m.id}>
          {m.reading} · {m.date} {m.remark}
        </p>
      )) ?? <p>Unavailable</p>}
      <h3 className="font-semibold">Basis evidence</h3>
      {cycle.basisVersions?.map((b) => (
        <p key={b.id} className="break-words">
          Version {b.version}: {amount(b.total)} · {b.reason} · {b.id}
        </p>
      )) ?? <p>Unavailable</p>}
      <p>
        Receipt, availability changes, costs, repairs, sales and disposal
        workflows remain pending. No completed downstream history is implied.
      </p>
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
              <CycleDetail key={cycle.id ?? i} cycle={cycle} />
            ))
          ) : (
            <CycleDetail cycle={row} />
          )}
        </>
      )}
    </section>
  )
}
