import "server-only"
import { Prisma } from "@prisma/client"
import { subject } from "@casl/ability"
import { z } from "zod"
import type {
  ReportKind,
  ReportRow,
  Visible,
} from "../../.planning/implementation/contracts/api"
import { B, bounded } from "../money"
import { reportKinds } from "../report-kinds"
import { states } from "../state"
import type { Actor } from "./actor"
import type { Tx } from "./db"
import { CommandError, fail } from "./errors"
import { readScope, type EnabledSubject } from "./permissions"
import {
  colomboToday,
  formatDate,
  purchaseInclude,
  visiblePurchase,
  visibleVehicle,
  type Row,
} from "./purchases"
import { dateOnly, id, listParams } from "./validators"
import { reportCellValue, getReportColumns } from "./report-export"

const boolean = z.enum(["true", "false"]).transform((value) => value === "true")
const dateRange = z.object({
  from: dateOnly.optional(),
  through: dateOnly.optional(),
})
const text = z.string().trim().min(1).max(100)
const kindFilters = {
  INVENTORY: ["status", "available", "make", "model"],
  SOLD: ["saleType", "method"],
  PROFIT: ["status", "make", "model", "profitOnly", "lossOnly"],
  ADVANCES: ["advanceStatus"],
  REPAIRS: ["vendorId"],
  CASH_FLOW: ["method"],
  DISPOSALS: [],
} satisfies Record<ReportKind, string[]>

const filterSchema = listParams
  .merge(dateRange)
  .extend({
    kind: z.enum(reportKinds),
    status: z.enum(states).optional(),
    available: boolean.optional(),
    make: text.optional(),
    model: text.optional(),
    saleType: z.enum(["CASH", "TRADE_IN", "ADVANCE", "LEASE"]).optional(),
    method: z.enum(["CASH", "BANK_TRANSFER"]).optional(),
    profitOnly: boolean.optional(),
    lossOnly: boolean.optional(),
    advanceStatus: z.enum(["ACTIVE", "EXPIRED"]).optional(),
    vendorId: id.optional(),
  })
  .strict()

function uniqueParams(params: URLSearchParams) {
  if ([...params.keys()].length !== new Set(params.keys()).size)
    fail("INVALID_INPUT", 422)
  return Object.fromEntries(params)
}

export function reportFilter(params: URLSearchParams) {
  const parsed = filterSchema.safeParse(uniqueParams(params))
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  if (
    (input.from && input.through && input.from > input.through) ||
    (input.profitOnly && input.lossOnly) ||
    Object.entries(input).some(
      ([key, value]) =>
        value !== undefined &&
        ![
          "kind",
          "page",
          "pageSize",
          "from",
          "through",
          ...kindFilters[input.kind],
        ].includes(key)
    )
  )
    fail("INVALID_INPUT", 422)
  return input
}

type Filter = ReturnType<typeof reportFilter>
type ReportRecord = Visible<ReportRow[ReportKind]>
type ReportData = {
  data: ReportRecord[]
  total: number
  totals: Record<string, string>
  notice?: string
}
type ReadReport = (
  tx: Tx,
  actor: Actor,
  filter: Filter,
  asOf: string
) => Promise<ReportRecord[]>
const date = (value: string) => new Date(`${value}T00:00:00.000Z`)
const daysSince = (from: string, through: string) =>
  Math.floor((+date(through) - +date(from)) / 86400000)
const dates = (
  { from, through }: Pick<Filter, "from" | "through">,
  asOf: string
) => ({
  ...(from ? { gte: date(from) } : {}),
  lte: date(through && through < asOf ? through : asOf),
})
const scope = (
  actor: Actor,
  type: EnabledSubject,
  fields: readonly string[] = []
) => readScope(actor.grants, actor.userId, type, fields)
const canRead = (
  actor: Actor,
  type: EnabledSubject,
  row: object,
  fields: string[]
) =>
  fields.every((field) => actor.ability.can("read", subject(type, row), field))
const primary = (
  actor: Actor,
  type: EnabledSubject,
  row: object,
  fields: string[]
) => {
  if (!canRead(actor, type, row, fields)) fail("FIELD_FORBIDDEN", 403)
}
const rowProjection = <K extends ReportKind>(
  row: Visible<ReportRow[K]>
): ReportRecord => row as ReportRecord
const compareRows = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function inventoryWhere(
  actor: Actor,
  filter: Partial<Filter>,
  asOf: string
): Prisma.PurchaseRecordWhereInput {
  const fields = [
    "status",
    "available",
    ...(filter.make ? ["identity.make"] : []),
    ...(filter.model ? ["identity.model"] : []),
  ]
  const vehicle = scope(actor, "Vehicle", ["id", "cycleId", ...fields])
  return {
    closedAt: null,
    activeFor: { isNot: null },
    purchaseDate: dates(filter, asOf),
    status: filter.status,
    available: filter.available,
    AND: [
      scope(actor, "PurchaseRecord", ["id", "purchaseDate", ...fields]),
      {
        vehicle: {
          make: filter.make,
          model: filter.model,
          id: vehicle.id,
          OR: vehicle.OR?.map(({ status, ...conditions }) => ({
            ...conditions,
            ...(status
              ? { activePurchase: { status: status as Row["status"] } }
              : {}),
          })),
        },
      },
    ],
  }
}

const inventory: ReadReport = async (tx, actor, filter, asOf) => {
  const rows = await tx.purchaseRecord.findMany({
    where: inventoryWhere(actor, filter, asOf),
    include: purchaseInclude,
    orderBy: [{ purchaseDate: "desc" }, { id: "asc" }],
  })
  return rows.map((row) => ({
    ...rowProjection<"INVENTORY">(
      visibleVehicle(actor, row) as Visible<ReportRow["INVENTORY"]>
    ),
    purchaseDate: formatDate(row.purchaseDate),
    daysHeld: daysSince(formatDate(row.purchaseDate), asOf),
  }))
}

// Match the corrected date when present. The latest version is the sole
// correction without a successor. Ordinary completions use the saleDate index.
async function completedSales(
  tx: Tx,
  actor: Actor,
  filter: Partial<Filter>,
  asOf: string,
  take?: number
) {
  const bounds = dates(filter, asOf)
  const eligible = await tx.$queryRaw<{ id: string }[]>`
    SELECT c."saleCaseId" AS id
    FROM vamotors."SaleCompletion" c
    WHERE c."saleDate" BETWEEN ${bounds.gte ?? date("0001-01-01")}::date AND ${bounds.lte}::date
      AND NOT EXISTS (SELECT 1 FROM vamotors."SaleCorrection" sc WHERE sc."completionId" = c.id)
    UNION ALL
    SELECT sc."saleCaseId"
    FROM vamotors."SaleCorrection" sc
    WHERE (sc."correctedSnapshot"->>'saleDate') BETWEEN ${filter.from ?? "0001-01-01"} AND ${formatDate(bounds.lte)}
      AND NOT EXISTS (SELECT 1 FROM vamotors."SaleCorrection" next WHERE next."priorVersionId" = sc.id)
  `
  const sales = await tx.saleCase.findMany({
    where: {
      id: { in: eligible.map(({ id }) => id) },
      kind: filter.saleType,
      state: "COMPLETED",
      AND: [
        scope(actor, "SaleCase", [
          "id",
          "kind",
          "state",
          "completion.date",
          ...(filter.method ? ["payments.method"] : []),
        ]),
      ],
      purchaseRecord: scope(actor, "PurchaseRecord", ["id"]),
    },
    include: {
      completion: { select: { saleDate: true } },
      corrections: {
        orderBy: { version: "desc" },
        take: 1,
        select: { correctedSnapshot: true },
      },
      customer: { select: { fullName: true, createdBy: true } },
      receipts: {
        where: {
          direction: "IN",
          reversalOf: null,
          reversal: null,
          category: "SALE",
        },
        select: { method: true },
        distinct: ["method"],
      },
      purchaseRecord: {
        select: {
          id: true,
          createdBy: true,
          vehicle: {
            select: {
              createdBy: true,
              make: true,
              model: true,
              activePurchase: { select: { status: true } },
            },
          },
        },
      },
    },
  })
  const rows = sales
    .map((sale) => {
      const corrected = sale.corrections[0]?.correctedSnapshot as
        | { saleDate?: string }
        | undefined
      return {
        sale,
        date: corrected?.saleDate ?? formatDate(sale.completion!.saleDate),
        method: sale.receipts.length === 1 ? sale.receipts[0].method : null,
      }
    })
    .filter((row) => !filter.method || row.method === filter.method)
  rows.sort(
    (a, b) => compareRows(b.date, a.date) || compareRows(a.sale.id, b.sale.id)
  )
  return take === undefined ? rows : rows.slice(0, take)
}

function vehicleName(
  actor: Actor,
  cycle: {
    createdBy: string
    vehicle: {
      createdBy: string
      make: string
      model: string
      activePurchase?: { status: string } | null
    }
  },
  status?: string
) {
  const fields = ["identity.make", "identity.model"]
  if (
    canRead(actor, "PurchaseRecord", cycle, fields) &&
    canRead(
      actor,
      "Vehicle",
      {
        ...cycle.vehicle,
        status: cycle.vehicle.activePurchase?.status ?? status,
      },
      fields
    )
  )
    return `${cycle.vehicle.make} ${cycle.vehicle.model}`
}

const sold: ReadReport = async (tx, actor, filter, asOf) => {
  scope(actor, "SaleCase", ["price"])
  scope(actor, "PurchaseRecord", [
    "financial.basis",
    "financial.restatedProfit",
  ])
  const sales = await completedSales(tx, actor, filter, asOf)
  const cycles = await tx.purchaseRecord.findMany({
    where: { id: { in: sales.map(({ sale }) => sale.purchaseRecordId) } },
    include: purchaseInclude,
  })
  const byId = new Map(cycles.map((row) => [row.id, row]))
  return sales.map(({ sale, date, method }) => {
    const cycle = byId.get(sale.purchaseRecordId)!
    const financial = visiblePurchase(actor, cycle)
      .financial as ReportRow["SOLD"]["financial"]
    if (
      financial?.basis === undefined ||
      financial.restatedProfit === undefined
    )
      fail("FIELD_FORBIDDEN", 403)
    return rowProjection<"SOLD">({
      saleId: sale.id,
      ...(canRead(actor, "SaleCase", sale, ["cycleId"])
        ? { cycleId: cycle.id }
        : {}),
      date,
      vehicle: vehicleName(actor, sale.purchaseRecord, cycle.status),
      customer:
        canRead(actor, "SaleCase", sale, ["customerId"]) &&
        canRead(actor, "Customer", sale.customer, ["fullName"])
          ? sale.customer.fullName
          : undefined,
      type: sale.kind as ReportRow["SOLD"]["type"],
      method: canRead(actor, "SaleCase", sale, ["payments.method"])
        ? (method as ReportRow["SOLD"]["method"])
        : undefined,
      financial,
    })
  })
}

const profit: ReadReport = async (tx, actor, filter, asOf) => {
  const soldRows =
    (!filter.status || filter.status === "SOLD") &&
    actor.ability.can("read", "SaleCase")
      ? await completedSales(tx, actor, filter, asOf)
      : []
  const saleDates = new Map(
    soldRows.map((row) => [row.sale.purchaseRecordId, row.date])
  )
  const bounds = dates(filter, asOf)
  const identity = [
    ...(filter.make ? ["identity.make"] : []),
    ...(filter.model ? ["identity.model"] : []),
  ]
  if (identity.length) scope(actor, "Vehicle", identity)
  const list = await tx.purchaseRecord.findMany({
    where: {
      status: filter.status,
      vehicle: { make: filter.make, model: filter.model },
      AND: [
        scope(actor, "PurchaseRecord", [
          "id",
          "status",
          "purchaseDate",
          "financial.basis",
          ...identity,
        ]),
      ],
      OR: [
        { closedAt: null, purchaseDate: bounds },
        {
          id: {
            in: [...saleDates]
              .filter(([, d]) => !filter.from || d >= filter.from)
              .filter(([, d]) => d <= formatDate(bounds.lte))
              .map(([id]) => id),
          },
        },
        { disposal: { occurredDate: bounds } },
      ],
    },
    include: {
      ...purchaseInclude,
      vehicle: { include: { activePurchase: { select: { status: true } } } },
    },
  })
  const rows = list.flatMap((cycle) => {
    if (
      identity.length &&
      !canRead(
        actor,
        "Vehicle",
        {
          ...cycle.vehicle,
          status: cycle.vehicle.activePurchase?.status ?? cycle.status,
        },
        identity
      )
    )
      return []
    if (cycle.disposal) primary(actor, "Disposal", cycle.disposal, ["date"])
    const projected = visiblePurchase(actor, cycle) as Visible<
      import("../../.planning/implementation/contracts/api").PurchaseCycleDTO
    >
    const financial = projected.financial
    if (financial?.basis === undefined && cycle.basisVersions.length)
      fail("FIELD_FORBIDDEN", 403)
    if (cycle.saleCompletion && financial?.restatedProfit === undefined)
      fail("FIELD_FORBIDDEN", 403)
    const result =
      financial?.restatedProfit !== undefined
        ? BigInt(financial.restatedProfit)
        : null
    if (
      (filter.profitOnly && (result === null || result <= 0n)) ||
      (filter.lossOnly && (result === null || result >= 0n))
    )
      return []
    const price = financial?.salePrice ? BigInt(financial.salePrice) : 0n
    const margin =
      result !== null && price > 0n
        ? bounded((result * 10000n) / price, B * 10000n).toString()
        : undefined
    const components: NonNullable<ReportRow["PROFIT"]["components"]> = []
    if (financial && financial.purchase !== undefined)
      components.push({
        type: "PURCHASE",
        id: cycle.id,
        date: formatDate(cycle.purchaseDate),
        amount: financial.purchase,
        description: "Purchase",
      })
    if (financial?.repairs !== undefined)
      for (const repair of projected.repairs ?? [])
        if (repair.id && repair.sentDate && repair.invoiceAmount !== undefined)
          components.push({
            type: "REPAIR",
            id: repair.id,
            date: repair.invoiceDate ?? repair.sentDate,
            amount: repair.invoiceAmount,
            description: repair.summary ?? "Repair invoice",
          })
    if (financial?.additionalCosts !== undefined)
      for (const cost of projected.costs ?? [])
        if (cost.id && cost.incurredDate && cost.amount !== undefined)
          components.push({
            type: "COST",
            id: cost.id,
            date: cost.incurredDate,
            amount: cost.amount,
            description: cost.description ?? "Additional cost",
          })
    return [
      {
        cycleId: cycle.id,
        vehicle: vehicleName(actor, cycle, cycle.status),
        status: cycle.status,
        date:
          saleDates.get(cycle.id) ??
          formatDate(cycle.disposal?.occurredDate ?? cycle.purchaseDate),
        financial,
        components: components.length ? components : undefined,
        marginPercent: margin === undefined ? undefined : formatPercent(margin),
      },
    ]
  })
  return rows.sort(
    (a, b) => compareRows(b.date, a.date) || compareRows(a.cycleId, b.cycleId)
  )
}

function formatPercent(hundredths: string) {
  const absolute = hundredths.replace(/^-/, "").padStart(3, "0")
  return `${hundredths.startsWith("-") ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`
}

const repairs: ReadReport = async (tx, actor, filter, asOf) => {
  const rows = await tx.repairRecord.findMany({
    where: {
      returnedDate: null,
      sentDate: dates(filter, asOf),
      vendorId: filter.vendorId,
      cycle: {
        status: "IN_REPAIR",
        closedAt: null,
        AND: [scope(actor, "PurchaseRecord", ["id", "repairs"])],
      },
      AND: [
        scope(actor, "RepairRecord", [
          "id",
          "sentDate",
          "returnedDate",
          ...(filter.vendorId ? ["vendorId"] : []),
        ]),
      ],
      ...(filter.vendorId
        ? { vendor: scope(actor, "RepairVendor", ["id"]) }
        : {}),
    },
    include: {
      vendor: { select: { id: true, createdBy: true, name: true } },
      cycle: {
        select: {
          status: true,
          createdBy: true,
          vehicle: { select: { createdBy: true, make: true, model: true } },
        },
      },
    },
    orderBy: [{ sentDate: "desc" }, { id: "asc" }],
  })
  return rows.map((repair) =>
    rowProjection<"REPAIRS">({
      repairId: repair.id,
      cycleId: repair.cycleId,
      vehicle: vehicleName(actor, repair.cycle, repair.cycle.status),
      vendorId:
        canRead(actor, "RepairRecord", repair, ["vendorId"]) &&
        canRead(actor, "RepairVendor", repair.vendor, ["id"])
          ? repair.vendorId
          : undefined,
      vendor:
        canRead(actor, "RepairRecord", repair, ["vendorId"]) &&
        canRead(actor, "RepairVendor", repair.vendor, ["name"])
          ? repair.vendor.name
          : undefined,
      request: canRead(actor, "RepairRecord", repair, ["request"])
        ? repair.request
        : undefined,
      sentDate: formatDate(repair.sentDate),
      daysInRepair: daysSince(formatDate(repair.sentDate), asOf),
    })
  )
}

const disposals: ReadReport = async (tx, actor, filter, asOf) => {
  scope(actor, "Disposal", ["proceeds"])
  scope(actor, "PurchaseRecord", ["financial.basis"])
  const cycles = await tx.purchaseRecord.findMany({
    where: {
      disposal: {
        occurredDate: dates(filter, asOf),
        AND: [scope(actor, "Disposal", ["id", "date"])],
      },
      AND: [scope(actor, "PurchaseRecord", ["id", "disposal"])],
    },
    include: {
      ...purchaseInclude,
      vehicle: { include: { activePurchase: { select: { status: true } } } },
    },
  })
  const rows = cycles.map((cycle) => {
    const raw = cycle.disposal!
    const purchase = visiblePurchase(actor, cycle)
    const projected = purchase.disposal as object | undefined
    if (
      !projected ||
      (purchase.financial as { basis?: string } | undefined)?.basis ===
        undefined ||
      !canRead(actor, "Disposal", raw, ["basisVersionId", "proceeds"])
    )
      fail("FIELD_FORBIDDEN", 403)
    const latest = cycle.basisVersions.at(-1)
    return {
      reason: (projected as { reason?: string }).reason,
      approval: (
        projected as { approval?: Visible<ReportRow["DISPOSALS"]["approval"]> }
      ).approval,
      method: (projected as { method?: string })
        .method as ReportRow["DISPOSALS"]["method"],
      proceeds: raw.proceeds.toString(),
      cycleId: cycle.id,
      vehicle: vehicleName(actor, cycle, cycle.status),
      date: formatDate(raw.occurredDate),
      basis: cycle.basisVersions
        .find((basis) => basis.id === raw.basisVersionId)!
        .total.toString(),
      netLoss: raw.netLoss.toString(),
      restatedBasis: latest?.total.toString(),
      restatedLoss: latest
        ? (latest.total - raw.proceeds).toString()
        : undefined,
    }
  })
  return rows.sort(
    (a, b) => compareRows(b.date, a.date) || compareRows(a.cycleId, b.cycleId)
  )
}

const advanceNotice =
  "Outstanding advances will be available once reservation records are connected."
const cashNotice =
  "Cash totals include posted purchase, cost, repair, disposal, sale, facility and brokerage fee payments. Reservation and commission reconciliation cash are pending integration."

// Replace the advances reader and extend cashSources when T10/T13 publish facts.
const reportSources: Record<Exclude<ReportKind, "CASH_FLOW">, ReadReport> = {
  INVENTORY: inventory,
  SOLD: sold,
  PROFIT: profit,
  ADVANCES: async () => [],
  REPAIRS: repairs,
  DISPOSALS: disposals,
}

type CashSource = {
  kind: string
  joins: Prisma.Sql
  requirements: [alias: string, type: EnabledSubject, fields: string[]][]
}
const payments = [
  "id",
  "date",
  "direction",
  "amount",
  "method",
  "category",
].map((field) => `payments.${field}`)
const cashSources: CashSource[] = [
  {
    kind: "PURCHASE",
    joins: Prisma.sql`JOIN vamotors."PurchaseRecord" p ON p.id = m."sourceId"`,
    requirements: [["p", "PurchaseRecord", ["id", ...payments]]],
  },
  {
    kind: "COST",
    joins: Prisma.sql`JOIN vamotors."VehicleCost" c ON c.id = m."sourceId" JOIN vamotors."PurchaseRecord" p ON p.id = c."cycleId"`,
    requirements: [
      ["p", "PurchaseRecord", ["id", ...payments.map((f) => `costs.${f}`)]],
      ["c", "VehicleCost", ["id", ...payments]],
    ],
  },
  {
    kind: "DISPOSAL",
    joins: Prisma.sql`JOIN vamotors."Disposal" d ON d.id = m."sourceId" JOIN vamotors."PurchaseRecord" p ON p.id = d."cycleId"`,
    requirements: [
      ["p", "PurchaseRecord", ["id", "disposal"]],
      ["d", "Disposal", ["id", ...payments]],
    ],
  },
  {
    kind: "REPAIR",
    joins: Prisma.sql`JOIN vamotors."RepairRecord" r ON r.id = m."sourceId" JOIN vamotors."PurchaseRecord" p ON p.id = r."cycleId"`,
    requirements: [
      ["p", "PurchaseRecord", ["id", "repairs"]],
      ["r", "RepairRecord", ["id", ...payments]],
    ],
  },
  {
    kind: "SALE",
    joins: Prisma.sql`JOIN vamotors."SaleCase" s ON s.id = m."sourceId"`,
    requirements: [["s", "SaleCase", ["id", ...payments]]],
  },
  {
    kind: "FACILITY",
    joins: Prisma.sql`JOIN vamotors."CashFacility" f ON f.id = m."sourceId" JOIN vamotors."BrokerageDeal" b ON b.id = f."dealId"`,
    requirements: [
      ["f", "CashFacility", ["id", "payments"]],
      ["b", "BrokerageDeal", ["id", "facility"]],
    ],
  },
  {
    kind: "BROKERAGE_FEE",
    joins: Prisma.sql`JOIN vamotors."BrokerageDeal" b ON b.id = m."sourceId"`,
    requirements: [["b", "BrokerageDeal", ["id", "processingFee"]]],
  },
]

function cashScope(
  actor: Actor,
  [alias, type, fields]: CashSource["requirements"][number]
) {
  const conditions = scope(actor, type, fields).OR
  if (!conditions) return Prisma.sql`true`
  // Alias and column names come from the hardcoded source list and registry.
  return Prisma.sql`(${Prisma.join(
    conditions.map(
      (rule) => Prisma.sql`(
    ${Prisma.join(
      Object.entries(rule).map(
        ([key, value]) =>
          Prisma.sql`${Prisma.raw(`${alias}."${key}"`)} = ${value}::uuid`
      ),
      " AND "
    )})`
    ),
    " OR "
  )})`
}

async function cashFlow(
  tx: Tx,
  actor: Actor,
  filter: Filter,
  asOf: string,
  full: boolean
): Promise<ReportData> {
  const bounds = dates(filter, asOf)
  const source = Prisma.join(
    cashSources.map(
      ({ kind, joins, requirements }) => Prisma.sql`
    SELECT m."paymentId", m."sourceType", m."sourceId", m.date, m.amount, m.direction, m.method, m.category
    FROM vamotors."CashMovement" m ${joins}
    WHERE m."sourceType" = ${kind} AND m.date BETWEEN ${bounds.gte ?? date("0001-01-01")}::date AND ${bounds.lte}::date
      ${filter.method ? Prisma.sql`AND m.method = ${filter.method}` : Prisma.empty}
      AND ${Prisma.join(
        requirements.map((entry) => cashScope(actor, entry)),
        " AND "
      )}
  `
    ),
    " UNION ALL "
  )
  const [totals, records] = await Promise.all([
    tx.$queryRaw<{ total: number; cashIn: string; cashOut: string }[]>`
      SELECT count(*)::int AS total,
             coalesce(sum(amount) FILTER (WHERE direction = 'IN'), 0)::text AS "cashIn",
             coalesce(sum(amount) FILTER (WHERE direction = 'OUT'), 0)::text AS "cashOut"
      FROM (${source}) movements
    `,
    tx.$queryRaw<ReportRow["CASH_FLOW"][]>`
      SELECT "paymentId", "sourceType", "sourceId", date::text, amount::text, direction, method, category
      FROM (${source}) movements
      ORDER BY movements.date DESC, "sourceType", "paymentId"
      ${full ? Prisma.empty : Prisma.sql`LIMIT ${filter.pageSize} OFFSET ${(filter.page - 1) * filter.pageSize}`}
    `,
  ])
  const { total, cashIn, cashOut } = totals[0]
  return {
    data: records,
    total,
    notice: cashNotice,
    totals: {
      cashIn: moneyTotal(BigInt(cashIn)),
      cashOut: moneyTotal(BigInt(cashOut)),
      net: moneyTotal(BigInt(cashIn) - BigInt(cashOut)),
    },
  }
}

function moneyTotal(value: bigint) {
  if (value < -B || value > B) fail("MONEY_OVERFLOW", 422)
  return value.toString()
}

export async function reportQuery(
  tx: Tx,
  actor: Actor,
  filter: Filter,
  full = false
) {
  const { kind, page, pageSize } = filter
  if (
    !actor.ability.can("read", "Report", kind) ||
    (full && !actor.ability.can("export", "Report", kind))
  )
    fail("FORBIDDEN", 403)
  const asOf = colomboToday()
  const result =
    kind === "CASH_FLOW"
      ? await cashFlow(tx, actor, filter, asOf, full)
      : await (async (): Promise<ReportData> => {
          const rows = await reportSources[kind](tx, actor, filter, asOf)
          const totals = Object.fromEntries(
            getReportColumns(kind).flatMap((column) => {
              if (!column.totalKey) return []
              const values = rows
                .map((row) => reportCellValue(kind, row, column.key))
                .filter((value): value is string => typeof value === "string")
              // Totals cover every visible value in the filtered result.
              if (!values.length) return []
              return [
                [
                  column.totalKey,
                  moneyTotal(
                    values.reduce((total, value) => total + BigInt(value), 0n)
                  ),
                ],
              ]
            })
          )
          const offset = (page - 1) * pageSize
          return {
            data: full ? rows : rows.slice(offset, offset + pageSize),
            total: rows.length,
            totals,
            ...(kind === "ADVANCES" ? { notice: advanceNotice } : {}),
          }
        })()
  return { ...result, kind, page, pageSize, asOf, redactedFields: [] }
}

export async function dashboardQuery(
  tx: Tx,
  actor: Actor,
  params: URLSearchParams
) {
  const parsed = dateRange.strict().safeParse(uniqueParams(params))
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const asOf = colomboToday()
  const { through = asOf, from = `${through.slice(0, 7)}-01` } = parsed.data
  if (from > through || through > asOf) fail("INVALID_INPUT", 422)
  const availableMetric = async <T>(
    query: () => Promise<T>
  ): Promise<T | null> => {
    try {
      return await query()
    } catch (error) {
      if (error instanceof CommandError && [403, 404].includes(error.status))
        return null
      throw error
    }
  }
  const [stock, held, inRepair, sales] = await Promise.all([
    availableMetric(() =>
      tx.purchaseRecord.count({
        where: inventoryWhere(actor, { status: "IN_STOCK" }, asOf),
      })
    ),
    availableMetric(() =>
      tx.purchaseRecord.count({
        where: inventoryWhere(
          actor,
          { status: "IN_STOCK", available: false },
          asOf
        ),
      })
    ),
    availableMetric(() =>
      tx.purchaseRecord.count({
        where: inventoryWhere(actor, { status: "IN_REPAIR" }, asOf),
      })
    ),
    availableMetric(() => completedSales(tx, actor, { from, through }, asOf)),
  ])
  return {
    asOf,
    from,
    through,
    stock,
    held,
    inRepair,
    completedSales: sales?.length ?? null,
    advances: null,
    recentSales:
      sales?.slice(0, 8).map(({ sale, date }) => ({
        id: sale.id,
        date,
        type: sale.kind,
        vehicle: vehicleName(actor, sale.purchaseRecord),
        ...(canRead(actor, "SaleCase", sale, ["price"])
          ? { price: sale.agreedPrice.toString() }
          : {}),
      })) ?? null,
  }
}
