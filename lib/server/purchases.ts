import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import type {
  Applied,
  Dependency,
  PurchaseCycleDTO,
  VehicleDTO,
  VehicleInput,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Authority as Actor, type Identity } from "./actor"
import {
  disposalInclude,
  disposalDTO,
  disposalAuth,
  visibleDisposal,
  requireWriteOffAuthority,
} from "./disposals"
import { transaction, nextBusinessSequence } from "./transactions"
import { audit, writeReadVersion } from "./audit"
import { inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import {
  purchaseEnvelope,
  id,
  vehicleInput,
  dateOnly,
  listParams,
  stockEnvelope,
  cycleMoneyEnvelope,
  cycleMoneyInputs,
  cycleEditEnvelope,
  cycleEditInputs,
  type CycleEditCommand,
  type CycleMoneyCommand,
  type StockCommand,
} from "./validators"
import {
  project,
  readScope,
  requireFields,
  costReadFields,
  sourcePaymentFields,
  mileageReadFields,
  physicalFields,
} from "./permissions"
import { fail, CommandError } from "./errors"
import { currentSettings } from "./settings"
import { cashTotals, bounded, C, sum } from "../money"

export const normalizeVehicleIdentity = (value: string) =>
  value.toUpperCase().replace(/[\t\n\r\f\v ]/g, "")
const date = (value: Date) => value.toISOString().slice(0, 10)
export const colomboToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
const include = {
  vehicle: true,
  supplier: true,
  seller: true,
  payments: {
    orderBy: [{ occurredDate: "asc" as const }, { id: "asc" as const }],
  },
  costs: {
    orderBy: { id: "asc" as const },
    include: {
      payments: {
        orderBy: [{ occurredDate: "asc" as const }, { id: "asc" as const }],
      },
    },
  },
  mileage: {
    orderBy: [{ recordedDate: "asc" as const }, { id: "asc" as const }],
  },
  basisVersions: { orderBy: { version: "asc" as const } },
  settingsVersion: true,
  disposal: { include: disposalInclude },
} satisfies Prisma.PurchaseRecordInclude
type Row = Prisma.PurchaseRecordGetPayload<{ include: typeof include }>
type Cost = Row["costs"][number]
type Payment = Row["payments"][number] | Cost["payments"][number]
const netPaid = (payments: readonly Payment[]) => {
  const cash = cashTotals(
    payments.map((p) => ({
      direction: p.direction as "IN" | "OUT",
      amount: p.amount.toString(),
    }))
  )
  return bounded(BigInt(cash.outgoing) - BigInt(cash.incoming), C)
}
function paymentDTO(p: Payment) {
  return {
    id: p.id,
    owner: {
      type: "costId" in p ? ("COST" as const) : ("PURCHASE" as const),
      id: "costId" in p ? p.costId : p.cycleId,
    },
    commandId: p.commandId,
    amount: p.amount.toString(),
    direction: p.direction as "OUT" | "IN",
    category: p.category,
    date: date(p.occurredDate),
    method: p.method as "CASH" | "BANK_TRANSFER",
    recordedAt: p.recordedAt.toISOString(),
    ...(p.reference !== null ? { reference: p.reference } : {}),
    ...(p.reversalOf ? { reversalOf: p.reversalOf } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
  }
}
function costDTO(cost: Cost): PurchaseCycleDTO["costs"][number] {
  return {
    id: cost.id,
    revision: cost.revision,
    category: cost.category,
    description: cost.description,
    amount: cost.amount.toString(),
    incurredDate: date(cost.incurredDate),
    payments: cost.payments.map(paymentDTO),
    outstanding: (cost.amount - netPaid(cost.payments)).toString(),
    provenance: { imported: false },
  }
}
const costAuth = (cost: Cost) => ({
  ...costDTO(cost),
  createdBy: cost.createdBy,
})
function physical(row: Row["vehicle"]): VehicleInput {
  return {
    engineNumber: row.engineNumber,
    chassisNumber: row.chassisNumber,
    make: row.make,
    model: row.model,
    year: row.year,
    colour: row.colour,
    fuelType: row.fuelType as VehicleInput["fuelType"],
    transmission: row.transmission as VehicleInput["transmission"],
    ...(row.vin !== null ? { vin: row.vin } : {}),
    ...(row.crNumber !== null ? { crNumber: row.crNumber } : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
  }
}
export function purchaseDTO(row: Row): PurchaseCycleDTO {
  const seller = row.supplier ?? row.seller
  if (!seller) fail("INTERNAL_ERROR", 500)
  const cash = cashTotals(
    [
      ...row.payments,
      ...row.costs.flatMap((c) => c.payments),
      ...(row.disposal?.payments ?? []),
    ].map((p) => ({
      direction: p.direction as "IN" | "OUT",
      amount: p.amount.toString(),
    }))
  )
  const paid = netPaid(row.payments)
  const basis = row.basisVersions.at(-1)
  // Legacy foundation fixtures have no financial evidence. Never synthesize a
  // cash fact or historical basis version to fill a DTO.
  return {
    id: row.id,
    revision: row.revision,
    vehicleId: row.vehicleId,
    identity: physical(row.vehicle),
    identityRevision: row.vehicle.revision,
    cycleNumber: row.cycleNumber,
    purchaseType: row.purchaseType as PurchaseCycleDTO["purchaseType"],
    acquisitionKind: row.acquisitionKind as PurchaseCycleDTO["acquisitionKind"],
    seller: {
      type: row.supplier ? "SUPPLIER" : "CUSTOMER",
      id: seller.id,
      name: "name" in seller ? seller.name : seller.fullName,
      active: seller.active,
    },
    purchaseDate: date(row.purchaseDate),
    purchasePrice: row.purchasePrice.toString(),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    ...(row.listedPrice !== null
      ? { listedPrice: row.listedPrice.toString() }
      : {}),
    status: row.status,
    available: row.available,
    ...(row.holdReason !== null ? { holdReason: row.holdReason } : {}),
    ...(row.receivedDate ? { receivedDate: date(row.receivedDate) } : {}),
    closedAt: row.closedAt?.toISOString() ?? null,
    payments: row.payments.map(paymentDTO),
    outstanding: {
      seller: (row.purchasePrice - paid).toString(),
      settlement: "0",
    },
    costs: row.costs.map(costDTO),
    repairs: [],
    mileage: row.mileage.map((m) => ({
      id: m.id,
      reading: m.reading,
      date: date(m.recordedDate),
      ...(m.remark ? { remark: m.remark } : {}),
      ...(m.decreaseReason ? { decreaseReason: m.decreaseReason } : {}),
    })),
    ...(basis
      ? {
          financial: {
            currency: basis.currency,
            scale: 2 as const,
            purchase: row.purchasePrice.toString(),
            repairs: "0",
            additionalCosts: sum(
              row.costs.map((c) => c.amount),
              C
            ).toString(),
            basis: basis.total.toString(),
            cashIn: cash.incoming,
            cashOut: cash.outgoing,
            net: cash.net,
          },
        }
      : {}),
    basisVersions: row.basisVersions.map((b) => ({
      id: b.id,
      version: b.version,
      total: b.total.toString(),
      reason: b.reason,
    })),
    sales: [],
    disposal: row.disposal ? disposalDTO(row.disposal) : null,
    provenance: { imported: false },
    nextActions: [],
  }
}
export function vehicleDTO(row: Row): VehicleDTO {
  const cycle = purchaseDTO(row)
  return {
    id: row.vehicleId,
    identity: cycle.identity,
    cycleId: row.id,
    revision: row.revision,
    identityRevision: row.vehicle.revision,
    status: row.status,
    available: row.available,
    ...(cycle.holdReason ? { holdReason: cycle.holdReason } : {}),
    ...(cycle.listedPrice !== undefined
      ? { listedPrice: cycle.listedPrice }
      : {}),
    ...(cycle.financial ? { financial: cycle.financial } : {}),
    mileage: cycle.mileage.map(({ id: unused, ...m }) => {
      void unused
      return m
    }),
    provenance: cycle.provenance,
  }
}
export const auth = (row: Row) => ({
  ...purchaseDTO(row),
  createdBy: row.createdBy,
})
export const vehicleAuth = (row: Row) => ({
  ...vehicleDTO(row),
  createdBy: row.vehicle.createdBy,
})

function paymentProjection(
  actor: Actor,
  row: Row,
  p: PurchaseCycleDTO["payments"][number],
  cost?: Cost
) {
  const root = subject("PurchaseRecord", auth(row)),
    child = cost ? subject("VehicleCost", costAuth(cost)) : null
  const output: Record<string, unknown> = {}
  for (const path of sourcePaymentFields) {
    const rootPath = `${cost ? "costs." : ""}payments.${path}`
    if (
      !actor.ability.can("read", root, rootPath) ||
      (child && !actor.ability.can("read", child, `payments.${path}`))
    )
      continue
    const [first, second] = path.split(".")
    const value = second
      ? (p[first as keyof typeof p] as Record<string, unknown>)[second]
      : p[first as keyof typeof p]
    if (value === undefined) continue
    if (second)
      output[first] = { ...(output[first] as object), [second]: value }
    else output[first] = value
  }
  return output
}
function visibleCost(
  actor: Actor,
  row: Row,
  cost: Cost,
  value = costDTO(cost)
) {
  if (!actor.ability.can("read", subject("VehicleCost", costAuth(cost))))
    return null
  const root = subject("PurchaseRecord", auth(row)),
    { redactedFields: unused, ...projected } = project(
      actor.ability,
      "VehicleCost",
      { ...value, createdBy: cost.createdBy }
    )
  void unused
  delete projected.createdBy
  for (const field of Object.keys(projected)) {
    if (field === "payments") continue
    if (!actor.ability.can("read", root, `costs.${field}`))
      delete projected[field]
  }
  if (
    actor.ability.can("read", root, "costs.payments") ||
    sourcePaymentFields.some((f) =>
      actor.ability.can("read", root, `costs.payments.${f}`)
    )
  ) {
    if (
      actor.ability.can(
        "read",
        subject("VehicleCost", costAuth(cost)),
        "payments"
      ) ||
      sourcePaymentFields.some((f) =>
        actor.ability.can(
          "read",
          subject("VehicleCost", costAuth(cost)),
          `payments.${f}`
        )
      )
    )
      projected.payments = value.payments.map((p) =>
        paymentProjection(actor, row, p, cost)
      )
  } else delete projected.payments
  if (
    !actor.ability.can("read", root, "costs.amount") ||
    !actor.ability.can(
      "read",
      subject("VehicleCost", costAuth(cost)),
      "amount"
    ) ||
    !actor.ability.can("read", root, "costs.payments.amount") ||
    !actor.ability.can(
      "read",
      subject("VehicleCost", costAuth(cost)),
      "payments.amount"
    ) ||
    !actor.ability.can("read", root, "costs.payments.direction") ||
    !actor.ability.can(
      "read",
      subject("VehicleCost", costAuth(cost)),
      "payments.direction"
    )
  )
    delete projected.outstanding
  return projected
}

function correctionSourceReadable(actor: Actor, row: Row) {
  const source = subject("PurchaseRecord", auth(row))
  return (
    [
      "purchaseDate",
      "purchasePrice",
      "notes",
      "payments.amount",
      "payments.reason",
    ].every((f) => actor.ability.can("read", source, f)) &&
    row.costs.every((c) =>
      [
        "category",
        "description",
        "amount",
        "incurredDate",
        "payments.amount",
        "payments.reason",
      ].every(
        (f) =>
          actor.ability.can("read", source, `costs.${f}`) &&
          actor.ability.can("read", subject("VehicleCost", costAuth(c)), f)
      )
    )
  )
}

/** Independently authorize both roots and linked seller, then project every read.
 * A broad Vehicle/party grant never launders a hidden purchase or its money. */
export function visiblePurchase(actor: Actor, row: Row) {
  const result = project(actor.ability, "PurchaseRecord", auth(row))
  const root = subject("PurchaseRecord", auth(row))
  if (row.disposal) {
    const disposal = actor.ability.can("read", root, "disposal")
      ? visibleDisposal(actor, row.disposal)
      : null
    if (disposal) result.disposal = disposal
    else {
      delete result.disposal
      result.redactedFields.push("disposal")
    }
    if (
      !["amount", "direction"].every(
        (f) =>
          actor.ability.can("read", root, "disposal") &&
          actor.ability.can(
            "read",
            subject("Disposal", disposalAuth(row.disposal!)),
            `payments.${f}`
          )
      )
    ) {
      if (result.financial)
        for (const f of ["cashIn", "cashOut", "net"]) {
          delete (result.financial as Record<string, unknown>)[f]
          result.redactedFields.push(`financial.${f}`)
        }
    }
  }
  if (
    actor.ability.can("read", root, "payments") ||
    sourcePaymentFields.some((p) =>
      actor.ability.can("read", root, `payments.${p}`)
    )
  )
    result.payments = row.payments.map((p) =>
      paymentProjection(actor, row, paymentDTO(p))
    )
  const costsReadable =
    actor.ability.can("read", root, "costs") ||
    costReadFields.some((p) => actor.ability.can("read", root, `costs.${p}`))
  if (costsReadable)
    result.costs = row.costs.flatMap((c) => {
      const value = visibleCost(actor, row, c)
      return value ? [value] : []
    })
  const allCosts = row.costs.every(
    (c) =>
      actor.ability.can(
        "read",
        subject("VehicleCost", costAuth(c)),
        "amount"
      ) && actor.ability.can("read", root, "costs.amount")
  )
  const allCostCash = row.costs.every((c) =>
    ["amount", "direction"].every(
      (f) =>
        actor.ability.can("read", root, `costs.payments.${f}`) &&
        actor.ability.can(
          "read",
          subject("VehicleCost", costAuth(c)),
          `payments.${f}`
        )
    )
  )
  const reasonsReadable = correctionSourceReadable(actor, row)
  if (result.financial) {
    const financial = result.financial as Record<string, unknown>
    if (!allCosts)
      for (const f of ["additionalCosts", "basis"]) {
        delete financial[f]
        result.redactedFields.push(`financial.${f}`)
      }
    if (!allCostCash)
      for (const f of ["cashIn", "cashOut", "net"]) {
        delete financial[f]
        result.redactedFields.push(`financial.${f}`)
      }
  }
  if (!allCosts) {
    delete result.basisVersions
    result.redactedFields.push("basisVersions")
  } else if (
    actor.ability.can("read", root, "basisVersions") ||
    ["id", "version", "total", "reason"].some((f) =>
      actor.ability.can("read", root, `basisVersions.${f}`)
    )
  )
    result.basisVersions = purchaseDTO(row).basisVersions.map((b) =>
      Object.fromEntries(
        Object.entries(b).filter(
          ([f]) =>
            actor.ability.can("read", root, `basisVersions.${f}`) &&
            (f !== "reason" || b.version === 1 || reasonsReadable)
        )
      )
    )
  if (!reasonsReadable && row.basisVersions.some((b) => b.version > 1))
    result.redactedFields.push("basisVersions.reason")
  const purchaseCashReadable = ["amount", "direction"].every((f) =>
    actor.ability.can("read", root, `payments.${f}`)
  )
  if (!purchaseCashReadable) {
    delete result.outstanding
    result.redactedFields.push("outstanding")
    if (result.financial)
      for (const f of ["cashIn", "cashOut", "net"]) {
        delete (result.financial as Record<string, unknown>)[f]
        result.redactedFields.push(`financial.${f}`)
      }
  }
  if ("nextActions" in result) {
    const readable =
      [
        "id",
        "revision",
        "status",
        "available",
        "receivedDate",
        "holdReason",
      ].every((f) =>
        actor.ability.can("read", subject("PurchaseRecord", auth(row)), f)
      ) &&
      ["id", "identityRevision"].every((f) =>
        actor.ability.can("read", subject("Vehicle", vehicleAuth(row)), f)
      )
    result.nextActions =
      readable &&
      row.acquisitionCommandId &&
      !row.closedAt &&
      row.vehicle.activePurchaseId === row.id
        ? (["receiveStock", "holdStock", "releaseStock"] as const).filter(
            (name) => {
              if (
                name === "receiveStock"
                  ? row.status !== "PURCHASED"
                  : row.status !== "IN_STOCK"
              )
                return false
              if (name === "releaseStock" && row.available) return false
              const { action, fields } = stockCapability(name)
              return fields.every((f) =>
                actor.ability.can(
                  action,
                  subject("PurchaseRecord", auth(row)),
                  f
                )
              )
            }
          )
        : []
  }
  const v = subject("Vehicle", vehicleAuth(row))
  for (const field of ["identity", "identityRevision", "vehicleId"] as const) {
    if (!(field in result)) continue
    const source = field === "vehicleId" ? "id" : field
    if (!actor.ability.can("read", v, source)) {
      if (field === "identity" && actor.ability.can("read", v)) {
        const projected = project(actor.ability, "Vehicle", vehicleAuth(row))
        if (projected.identity)
          result.identity = Object.fromEntries(
            Object.entries(result.identity as object).filter(
              ([key]) => key in (projected.identity as object)
            )
          )
        else delete result.identity
        result.redactedFields.push(
          ...projected.redactedFields.filter((f) => f.startsWith("identity"))
        )
      } else {
        delete result[field]
        result.redactedFields.push(field)
      }
    }
  }
  const mileageFields = mileageReadFields.filter(
    (f) =>
      actor.ability.can("read", root, `mileage.${f}`) &&
      actor.ability.can("read", v, f === "id" ? "id" : `mileage.${f}`)
  )
  if (mileageFields.some((f) => f !== "id"))
    result.mileage = purchaseDTO(row).mileage.map((m) =>
      Object.fromEntries(
        Object.entries(m).filter(([f]) =>
          mileageFields.includes(f as (typeof mileageFields)[number])
        )
      )
    )
  else {
    delete result.mileage
    result.redactedFields.push("mileage")
  }
  if (result.seller) {
    const type = row.supplier ? "Supplier" : "Customer"
    const target = row.supplier ?? row.seller!
    const link = result.seller as Record<string, unknown>
    for (const field of ["id", "name", "active"]) {
      if (
        !actor.ability.can(
          "read",
          subject(type, target),
          field === "name" && type === "Customer" ? "fullName" : field
        )
      ) {
        delete link[field]
        result.redactedFields.push(`seller.${field}`)
      }
    }
  }
  if (
    !actor.ability.can(
      "read",
      subject("PurchaseRecord", auth(row)),
      "purchasePrice"
    )
  ) {
    for (const field of [
      "financial",
      "payments",
      "outstanding",
      "basisVersions",
    ]) {
      if (field in result) {
        delete result[field]
        result.redactedFields.push(field)
      }
    }
  }
  if ("nextActions" in result)
    result.nextActions = [
      ...(result.nextActions as string[]),
      ...availableMoneyActions(actor, row),
      ...availableCycleEdits(actor, row),
    ]
  if (
    "nextActions" in result &&
    row.acquisitionCommandId &&
    !row.closedAt &&
    !row.disposal &&
    row.vehicle.activePurchaseId === row.id &&
    row.acquisitionKind === "SUPPLIER" &&
    ["CASH", "BRAND_NEW"].includes(row.purchaseType) &&
    ["PURCHASED", "IN_STOCK"].includes(row.status)
  ) {
    try {
      requireWriteOffAuthority(
        actor,
        auth(row),
        vehicleAuth(row),
        result,
        {
          cycleId: row.id,
          date: "",
          reason: "",
          method: "OTHER",
          proceeds: "0",
        },
        true
      )
      ;(result.nextActions as string[]).push("requestApproval")
    } catch (error) {
      if (!(error instanceof CommandError)) throw error
    }
  }
  result.redactedFields = [
    ...new Set(result.redactedFields.filter((f) => f !== "createdBy")),
  ]
  return result
}
export function visibleVehicle(actor: Actor, row: Row) {
  const result = project(actor.ability, "Vehicle", vehicleAuth(row))
  const purchase = visiblePurchase(actor, row)
  for (const field of [
    "status",
    "available",
    "holdReason",
    "listedPrice",
    "financial",
    "mileage",
  ])
    if (!(field in purchase) && field in result) {
      delete result[field]
      result.redactedFields.push(field)
    }
  if (result.financial && purchase.financial) {
    result.financial = Object.fromEntries(
      Object.entries(result.financial as object).filter(
        ([k]) => k in (purchase.financial as object)
      )
    )
  }
  if (purchase.mileage)
    result.mileage = (purchase.mileage as Record<string, unknown>[]).map(
      ({ id: unused, ...m }) => {
        void unused
        return m
      }
    )
  if (result.identity) {
    const identity = purchase.identity as Record<string, unknown> | undefined
    result.identity = Object.fromEntries(
      Object.entries(result.identity as object).filter(
        ([f]) => identity && f in identity
      )
    )
    if (!Object.keys(result.identity as object).length) delete result.identity
  }
  result.redactedFields = result.redactedFields.filter((f) => f !== "createdBy")
  return result
}
export const loadPurchase = (tx: Tx, cycleId: string) =>
  tx.purchaseRecord.findUnique({ where: { id: cycleId }, include })
const load = loadPurchase
function physicalScope(
  actor: Actor,
  fields: string[] = []
): Prisma.VehicleWhereInput {
  const scope = readScope(actor.grants, actor.userId, "Vehicle", fields)
  if (scope.id) return { id: scope.id }
  if (!scope.OR) return {}
  return {
    OR: scope.OR.map(({ status, ...condition }) => ({
      ...condition,
      ...(status
        ? {
            purchases: {
              some: {
                status,
                OR: [
                  { activeFor: { isNot: null } },
                  {
                    closedAt: { not: null },
                    vehicle: { activePurchaseId: null },
                  },
                ],
              },
            },
          }
        : {}),
    })),
  } as Prisma.VehicleWhereInput
}
function requireRef(expected: Dependency[], ref: Dependency) {
  const supplied = expected.find((r) => r.type === ref.type && r.id === ref.id)
  if (!supplied) fail("REVISION_REQUIRED", 428)
  if (supplied.revision !== ref.revision)
    throw new CommandError("STALE_REVISION", 409, false, [ref])
}
export async function recordPurchase(
  identity: Identity,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const amounts =
    raw && typeof raw === "object"
      ? (raw as { input?: { purchasePrice?: unknown; listedPrice?: unknown } })
          .input
      : undefined
  for (const value of [amounts?.purchasePrice, amounts?.listedPrice])
    if (typeof value === "string" && /^[1-9][0-9]{14,}$/.test(value))
      fail("MONEY_OVERFLOW", 422)
  const parsed = purchaseEnvelope.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    input = envelope.input,
    config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: "recordPurchase",
      idempotencyKey: envelope.idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      const result = prior.result as Applied["result"]
      if (result.type !== "PurchaseRecord") fail("INTERNAL_ERROR", 500)
      const row = await load(tx, result.id)
      if (!row) fail("NOT_FOUND", 404)
      if (row.acquisitionCommandId !== prior.id || result.revision !== 1)
        fail("INTERNAL_ERROR", 500)
      requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
        "id",
        "revision",
      ])
      requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
        "id",
        "identityRevision",
      ])
      requireFields(actor.ability, "PurchaseRecord", "create", auth(row), [
        "vehicle",
        "supplierId",
        "purchaseDate",
        "purchaseType",
        "purchasePrice",
        "mileage",
        "paymentMethod",
        ...(row.listedPrice !== null ? ["listedPrice"] : []),
      ])
      requireFields(
        actor.ability,
        "Vehicle",
        "create",
        vehicleAuth(row),
        Object.keys(physical(row.vehicle))
      )
      if (!row.supplier) fail("INTERNAL_ERROR", 500)
      requireFields(actor.ability, "Supplier", "read", row.supplier, [
        "id",
        "revision",
      ])
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected: [
          { type: "PurchaseRecord", id: row.id, revision: row.revision },
          {
            type: "Vehicle",
            id: row.vehicleId,
            revision: row.vehicle.revision,
          },
        ],
        invalidate: [
          "inventory",
          "purchases",
          "parties",
          "reports",
          "dashboard",
        ],
      }
    }
    const candidate = { createdBy: actor.userId, status: "PURCHASED" }
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "create",
      candidate,
      Object.keys(input)
    )
    requireFields(
      actor.ability,
      "Vehicle",
      "create",
      { ...candidate },
      Object.keys(input.vehicle)
    )
    const engine = normalizeVehicleIdentity(input.vehicle.engineNumber),
      chassis = normalizeVehicleIdentity(input.vehicle.chassisNumber)
    // Identity lock names are sorted, parameterized, and acquired after auth.
    for (const key of [`engine:${engine}`, `chassis:${chassis}`].sort())
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`
    const existing = await tx.vehicle.findUnique({
      where: {
        normalizedEngine_normalizedChassis: {
          normalizedEngine: engine,
          normalizedChassis: chassis,
        },
      },
    })
    if (existing) {
      requireFields(
        actor.ability,
        "Vehicle",
        "read",
        {
          id: existing.id,
          revision: existing.revision,
          createdBy: existing.createdBy,
        },
        ["id", "revision"]
      )
      requireRef(envelope.expected, {
        type: "Vehicle",
        id: existing.id,
        revision: existing.revision,
      })
      const writtenOff = await tx.purchaseRecord.findFirst({
        where: { vehicleId: existing.id, status: "WRITTEN_OFF" },
      })
      if (writtenOff) fail("IDENTITY_WRITTEN_OFF")
      // No closed-cycle fabrication or repurchase until real sales ship.
      fail("IDENTITY_CONFLICT")
    }
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
    })
    if (!supplier) fail("NOT_FOUND", 404)
    requireFields(
      actor.ability,
      "Supplier",
      "read",
      { ...supplier, directory: { category: supplier.category } },
      [
        "id",
        "revision",
        "active",
        ...(input.purchaseType === "BRAND_NEW" ? ["directory.category"] : []),
      ]
    )
    requireRef(envelope.expected, {
      type: "Supplier",
      id: supplier.id,
      revision: supplier.revision,
    })
    if (
      !supplier.active ||
      (input.purchaseType === "BRAND_NEW" && supplier.category !== "COMPANY")
    )
      fail("INVALID_STATE")
    const today = colomboToday()
    if (
      input.purchaseDate > today ||
      input.mileage.date > today ||
      input.mileage.date < input.purchaseDate
    )
      fail("INVALID_INPUT", 422)
    // Cash does not consume a browser Settings dependency. Snapshot server policy
    // under the shared business lock; future settings cannot reinterpret history.
    const settings = await currentSettings(tx)
    const settingsRow = await tx.settings.findUniqueOrThrow({
      where: { id: settings.id },
    })
    const sequence = await nextBusinessSequence(tx),
      commandId = randomUUID(),
      vehicleId = randomUUID(),
      cycleId = randomUUID()
    const result = { type: "PurchaseRecord" as const, id: cycleId, revision: 1 }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    await tx.vehicle.create({
      data: {
        id: vehicleId,
        ...input.vehicle,
        normalizedEngine: engine,
        normalizedChassis: chassis,
        activePurchaseId: cycleId,
        createdBy: actor.userId,
      },
    })
    await tx.purchaseRecord.create({
      data: {
        id: cycleId,
        vehicleId,
        cycleNumber: 1,
        purchaseType: input.purchaseType,
        acquisitionKind: "SUPPLIER",
        supplierId: supplier.id,
        purchaseDate: new Date(input.purchaseDate),
        purchasePrice: BigInt(input.purchasePrice),
        ...(input.listedPrice !== undefined
          ? { listedPrice: BigInt(input.listedPrice) }
          : {}),
        createdBy: actor.userId,
        acquisitionCommandId: commandId,
        settingsVersionId: settingsRow.currentVersionId,
      },
    })
    await tx.purchasePayment.create({
      data: {
        cycleId,
        commandId,
        lineKey: "seller",
        amount: BigInt(input.purchasePrice),
        direction: "OUT",
        category: "SELLER",
        occurredDate: new Date(input.purchaseDate),
        method: input.paymentMethod,
        currency: settings.currency,
        scale: settings.scale,
      },
    })
    await tx.mileageReading.create({
      data: {
        vehicleId,
        cycleId,
        commandId,
        reading: input.mileage.reading,
        recordedDate: new Date(input.mileage.date),
        remark: input.mileage.remark,
        decreaseReason: input.mileage.decreaseReason,
      },
    })
    await tx.cycleBasisVersion.create({
      data: {
        cycleId,
        commandId,
        version: 1,
        purchase: BigInt(input.purchasePrice),
        total: BigInt(input.purchasePrice),
        components: { purchase: input.purchasePrice, repairs: [], costs: [] },
        currency: settings.currency,
        scale: settings.scale,
        reason: "Initial paid acquisition",
      },
    })
    await tx.statusEvent.create({
      data: {
        cycleId,
        commandId,
        to: "PURCHASED",
        action: "recordPurchase",
        userId: actor.userId,
        occurredAt: new Date(input.purchaseDate),
      },
    })
    const row = (await load(tx, cycleId))!
    requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
      "id",
      "revision",
    ])
    requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
      "id",
      "identityRevision",
    ])
    for (const [entityType, entityId, after] of [
      ["PurchaseRecord", cycleId, purchaseDTO(row)],
      ["Vehicle", vehicleId, vehicleDTO(row)],
    ] as const) {
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType,
        entityId,
        action: "recordPurchase",
        before: null,
        after,
      })
      await writeReadVersion(tx, {
        commandId,
        sequence,
        entityType,
        entityId,
        revision: 1,
        payload: after,
      })
    }
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [result, { type: "Vehicle", id: vehicleId, revision: 1 }],
      invalidate: ["inventory", "purchases", "parties", "reports", "dashboard"],
    }
  })
}

/** Business input paths only. No Vehicle write authority is consumed by a view change. */
export function stockCapability(name: StockCommand, held = false) {
  return name === "receiveStock"
    ? {
        action: "receive",
        fields: [
          "date",
          "disposition.kind",
          ...(held ? ["disposition.reason"] : []),
        ],
      }
    : name === "holdStock"
      ? { action: "update", fields: ["reason"] }
      : { action: "release", fields: ["cycleId"] }
}

export async function executeStock(
  identity: Identity,
  name: StockCommand,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const parsed = stockEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    input = envelope.input,
    config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  const held = "disposition" in input && input.disposition.kind === "HOLD"
  const capability = stockCapability(name, held)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: name,
      idempotencyKey: envelope.idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    // Resolve FK on the server; lock physical root before cycle. No identity edit.
    const targetId = prior
      ? (prior.result as Applied["result"]).id
      : input.cycleId
    const planned = await load(tx, targetId)
    if (!planned) fail("NOT_FOUND", 404)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`Vehicle:${planned.vehicleId}`}, 0))::text`
    await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${targetId}::uuid FOR UPDATE`
    const row = (await load(tx, targetId))!
    requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
      "id",
      "revision",
    ])
    requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
      "id",
      "identityRevision",
    ])
    requireFields(
      actor.ability,
      "PurchaseRecord",
      capability.action,
      auth(row),
      capability.fields
    )
    const affected = () => [
      { type: "PurchaseRecord" as const, id: row.id, revision: row.revision },
      {
        type: "Vehicle" as const,
        id: row.vehicleId,
        revision: row.vehicle.revision,
      },
    ]
    const invalidate: Applied["invalidate"] = [
      "inventory",
      "purchases",
      "parties",
      "reports",
      "dashboard",
    ]
    if (prior) {
      const result = prior.result as Applied["result"]
      if (result.type !== "PurchaseRecord" || result.id !== input.cycleId)
        fail("IDEMPOTENCY_MISMATCH")
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      // No execution-only state/CAS checks on recovery of a committed intent.
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected: affected(),
        invalidate,
      }
    }
    requireRef(envelope.expected, {
      type: "PurchaseRecord",
      id: row.id,
      revision: row.revision,
    })
    if (
      !row.acquisitionCommandId ||
      row.closedAt ||
      row.vehicle.activePurchaseId !== row.id ||
      (name === "receiveStock"
        ? row.status !== "PURCHASED"
        : row.status !== "IN_STOCK")
    )
      fail("INVALID_STATE")
    if (row.revision === 2147483647) fail("REVISION_EXHAUSTED")
    const received = "date" in input ? input.date : undefined
    if (
      received &&
      (received < date(row.purchaseDate) || received > colomboToday())
    )
      fail("INVALID_INPUT", 422)
    const reason =
      "reason" in input
        ? input.reason
        : "disposition" in input && input.disposition.kind === "HOLD"
          ? input.disposition.reason
          : null
    const available =
      name === "releaseStock" || (name === "receiveStock" && !held)
    // A fresh no-change intent is not a mutation; an exact retry uses its receipt above.
    if (
      name !== "receiveStock" &&
      row.available === available &&
      row.holdReason === reason
    )
      fail("INVALID_STATE")
    const sequence = await nextBusinessSequence(tx),
      commandId = randomUUID()
    const result = {
      type: "PurchaseRecord" as const,
      id: row.id,
      revision: row.revision + 1,
    }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    const updated = await tx.purchaseRecord.updateMany({
      where: { id: row.id, revision: row.revision },
      data: {
        status: "IN_STOCK",
        available,
        holdReason: reason,
        ...(received ? { receivedDate: new Date(received) } : {}),
        revision: { increment: 1 },
      },
    })
    if (updated.count !== 1) fail("STALE_REVISION")
    await tx.statusEvent.create({
      data: {
        cycleId: row.id,
        commandId,
        from: row.status,
        to: "IN_STOCK",
        action: name,
        userId: actor.userId,
        occurredAt: received ? new Date(received) : new Date(),
      },
    })
    const after = (await load(tx, row.id))!
    for (const [entityType, entityId, before, payload, revision] of [
      [
        "PurchaseRecord",
        row.id,
        purchaseDTO(row),
        purchaseDTO(after),
        after.revision,
      ],
      [
        "Vehicle",
        row.vehicleId,
        vehicleDTO(row),
        vehicleDTO(after),
        row.vehicle.revision,
      ],
    ] as const) {
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType,
        entityId,
        action: name,
        ...(reason ? { reason } : {}),
        before,
        after: payload,
      })
      await writeReadVersion(tx, {
        commandId,
        sequence,
        entityType,
        entityId,
        revision,
        payload,
      })
    }
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [result, affected()[1]],
      invalidate,
    }
  })
}

type EditIntent = {
  [N in CycleEditCommand]: {
    name: N
    input: z.infer<(typeof cycleEditInputs)[N]>
  }
}[CycleEditCommand]
function cycleEditAuthority(
  actor: Actor,
  row: Row,
  intent: EditIntent,
  changed: readonly string[] = []
) {
  requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
    "id",
    "revision",
    "status",
    "closedAt",
  ])
  requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
    "id",
    "identityRevision",
  ])
  if (intent.name === "editVehicle") {
    requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
      "vehicleId",
      "identityRevision",
    ])
    for (const type of ["PurchaseRecord", "Vehicle"] as const)
      requireFields(
        actor.ability,
        type,
        "read",
        type === "Vehicle" ? vehicleAuth(row) : auth(row),
        physicalFields.map((f) => `identity.${f}`)
      )
    requireFields(actor.ability, "Vehicle", "update", vehicleAuth(row), [
      "vehicleId",
      "reason",
      ...changed.map((f) => `values.${f}`),
    ])
  } else {
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "update",
      auth(row),
      intent.name === "addMileage"
        ? [
            "cycleId",
            ...Object.keys(intent.input.mileage).map((f) => `mileage.${f}`),
          ]
        : [
            "cycleId",
            "amount",
            ...(intent.input.reason !== undefined ? ["reason"] : []),
          ]
    )
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "read",
      auth(row),
      intent.name === "addMileage"
        ? [
            "vehicleId",
            "identityRevision",
            "purchaseDate",
            "mileage.reading",
            "mileage.date",
            "mileage.decreaseReason",
          ]
        : ["listedPrice"]
    )
    if (intent.name === "addMileage")
      requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
        "mileage.reading",
        "mileage.date",
        "mileage.decreaseReason",
      ])
  }
}
function availableCycleEdits(actor: Actor, row: Row): CycleEditCommand[] {
  if (
    !row.acquisitionCommandId ||
    row.closedAt ||
    row.vehicle.activePurchaseId !== row.id ||
    !["PURCHASED", "IN_STOCK"].includes(row.status) ||
    row.acquisitionKind !== "SUPPLIER" ||
    !["CASH", "BRAND_NEW"].includes(row.purchaseType)
  )
    return []
  const candidates: EditIntent[] = [
    {
      name: "addMileage",
      input: { cycleId: row.id, mileage: { reading: 0, date: "" } },
    },
    { name: "setListedPrice", input: { cycleId: row.id, amount: "0" } },
    {
      name: "editVehicle",
      input: {
        vehicleId: row.vehicleId,
        values: physical(row.vehicle),
        reason: "",
      },
    },
  ]
  return candidates.flatMap((intent) => {
    try {
      cycleEditAuthority(actor, row, intent)
      if (
        intent.name === "editVehicle" &&
        !physicalFields.some((f) =>
          actor.ability.can(
            "update",
            subject("Vehicle", vehicleAuth(row)),
            `values.${f}`
          )
        )
      )
        return []
      return [intent.name]
    } catch {
      return []
    }
  })
}

/** Three existing open-cycle commands; no synthetic lifecycle/proposal records. */
export async function executeCycleEdit(
  identity: Identity,
  name: CycleEditCommand,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const amount = (raw as { input?: { amount?: unknown } } | null)?.input?.amount
  if (typeof amount === "string" && /^[1-9][0-9]{14,}$/.test(amount))
    fail("MONEY_OVERFLOW", 422)
  const parsed = cycleEditEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    intent = { name, input: envelope.input } as EditIntent,
    config = runtimeConfig(),
    digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity),
      scope = {
        environmentId: config.ENVIRONMENT_ID,
        actorKey: `USER:${actor.userId}`,
        commandName: name,
        idempotencyKey: envelope.idempotencyKey,
      },
      prior = await tx.commandReceipt.findUnique({
        where: { environmentId_actorKey_commandName_idempotencyKey: scope },
      })
    const planned =
      intent.name === "editVehicle"
        ? await tx.purchaseRecord.findFirst({
            where: {
              vehicleId: intent.input.vehicleId,
              vehicle: { activePurchaseId: { not: null } },
            },
            include,
            orderBy: { cycleNumber: "desc" },
          })
        : await load(tx, intent.input.cycleId)
    if (!planned) fail("NOT_FOUND", 404)
    if (intent.name === "editVehicle") {
      const keys = new Set([
        `engine:${planned.vehicle.normalizedEngine}`,
        `chassis:${planned.vehicle.normalizedChassis}`,
        `engine:${normalizeVehicleIdentity(intent.input.values.engineNumber)}`,
        `chassis:${normalizeVehicleIdentity(intent.input.values.chassisNumber)}`,
      ])
      for (const key of [...keys].sort())
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`
    }
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`Vehicle:${planned.vehicleId}`},0))::text`
    await tx.$queryRaw`SELECT id FROM vamotors."Vehicle" WHERE id=${planned.vehicleId}::uuid FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${planned.id}::uuid FOR UPDATE`
    const row = (await load(tx, planned.id))!
    let changed =
      intent.name === "editVehicle"
        ? physicalFields.filter(
            (f) =>
              (intent.input.values as VehicleInput)[f] !==
              physical(row.vehicle)[f]
          )
        : []
    if (prior && intent.name === "editVehicle") {
      const proof = await tx.auditEntry.findFirst({
        where: {
          commandId: prior.id,
          entityType: "Vehicle",
          entityId: row.vehicleId,
        },
      })
      if (!proof) fail("INTERNAL_ERROR", 500)
      changed = physicalFields.filter((f) =>
        Object.hasOwn(proof.fieldDiff as object, `identity.${f}`)
      )
    }
    cycleEditAuthority(actor, row, intent, changed)
    const affected: Dependency[] = [
      { type: "PurchaseRecord", id: row.id, revision: row.revision },
      { type: "Vehicle", id: row.vehicleId, revision: row.vehicle.revision },
    ]
    const invalidate: Applied["invalidate"] = [
      "inventory",
      "purchases",
      "parties",
      "reports",
      "dashboard",
    ]
    if (prior) {
      const result = prior.result as Applied["result"]
      if (
        prior.inputHash !== digest ||
        result.type !==
          (name === "editVehicle" ? "Vehicle" : "PurchaseRecord") ||
        result.id !== (name === "editVehicle" ? row.vehicleId : row.id)
      )
        fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected,
        invalidate,
      }
    }
    for (const ref of affected.filter((r) =>
      intent.name === "editVehicle"
        ? r.type === "Vehicle"
        : intent.name === "setListedPrice"
          ? r.type === "PurchaseRecord"
          : true
    ))
      requireRef(envelope.expected, ref)
    if (
      !row.acquisitionCommandId ||
      row.closedAt ||
      row.vehicle.activePurchaseId !== row.id ||
      row.acquisitionKind !== "SUPPLIER" ||
      !["CASH", "BRAND_NEW"].includes(row.purchaseType) ||
      !["PURCHASED", "IN_STOCK"].includes(row.status)
    )
      fail("INVALID_STATE")
    if (
      row.revision === 2147483647 ||
      (intent.name !== "setListedPrice" && row.vehicle.revision === 2147483647)
    )
      fail("REVISION_EXHAUSTED")
    if (intent.name === "editVehicle") {
      if (!changed.length) fail("INVALID_STATE")
      const collision = await tx.vehicle.findUnique({
        where: {
          normalizedEngine_normalizedChassis: {
            normalizedEngine: normalizeVehicleIdentity(
              intent.input.values.engineNumber
            ),
            normalizedChassis: normalizeVehicleIdentity(
              intent.input.values.chassisNumber
            ),
          },
        },
      })
      if (collision && collision.id !== row.vehicleId) fail("IDENTITY_CONFLICT")
    }
    if (
      intent.name === "setListedPrice" &&
      row.listedPrice === BigInt(intent.input.amount)
    )
      fail("INVALID_STATE")
    const mileageId = randomUUID()
    if (intent.name === "addMileage") {
      const m = intent.input.mileage
      if (m.date < date(row.purchaseDate) || m.date > colomboToday())
        fail("INVALID_INPUT", 422)
      const history = await tx.mileageReading.findMany({
        where: { vehicleId: row.vehicleId },
        orderBy: [{ recordedDate: "asc" }, { id: "asc" }],
      })
      for (const cid of new Set(history.map((m) => m.cycleId))) {
        const owner = cid === row.id ? row : (await load(tx, cid))!
        requireFields(actor.ability, "PurchaseRecord", "read", auth(owner), [
          "mileage.reading",
          "mileage.date",
          "mileage.decreaseReason",
        ])
      }
      const before = history
        .filter(
          (h) =>
            date(h.recordedDate) < m.date ||
            (date(h.recordedDate) === m.date && h.id < mileageId)
        )
        .at(-1)
      const after = history.find(
        (h) =>
          date(h.recordedDate) > m.date ||
          (date(h.recordedDate) === m.date && h.id > mileageId)
      )
      if (
        (before && m.reading < before.reading && !m.decreaseReason) ||
        (after && after.reading < m.reading && !after.decreaseReason)
      )
        fail("INVALID_INPUT", 422)
    }
    const sequence = await nextBusinessSequence(tx),
      commandId = randomUUID(),
      result: Applied["result"] =
        intent.name === "editVehicle"
          ? {
              type: "Vehicle",
              id: row.vehicleId,
              revision: row.vehicle.revision + 1,
            }
          : { type: "PurchaseRecord", id: row.id, revision: row.revision + 1 }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    if (intent.name === "addMileage")
      await tx.mileageReading.create({
        data: {
          id: mileageId,
          vehicleId: row.vehicleId,
          cycleId: row.id,
          commandId,
          reading: intent.input.mileage.reading,
          recordedDate: new Date(intent.input.mileage.date),
          remark: intent.input.mileage.remark,
          decreaseReason: intent.input.mileage.decreaseReason,
        },
      })
    if (intent.name !== "setListedPrice")
      await tx.vehicle.update({
        where: { id: row.vehicleId },
        data: {
          revision: { increment: 1 },
          ...(intent.name === "editVehicle"
            ? {
                ...intent.input.values,
                vin: intent.input.values.vin ?? null,
                crNumber: intent.input.values.crNumber ?? null,
                notes: intent.input.values.notes ?? null,
                normalizedEngine: normalizeVehicleIdentity(
                  intent.input.values.engineNumber
                ),
                normalizedChassis: normalizeVehicleIdentity(
                  intent.input.values.chassisNumber
                ),
              }
            : {}),
        },
      })
    await tx.purchaseRecord.update({
      where: { id: row.id },
      data: {
        revision: { increment: 1 },
        ...(intent.name === "setListedPrice"
          ? { listedPrice: BigInt(intent.input.amount) }
          : {}),
      },
    })
    const after = (await load(tx, row.id))!,
      reason =
        intent.name === "addMileage"
          ? intent.input.mileage.decreaseReason
          : intent.input.reason
    for (const [entityType, entityId, before, payload, revision] of [
      [
        "PurchaseRecord",
        row.id,
        purchaseDTO(row),
        purchaseDTO(after),
        after.revision,
      ],
      [
        "Vehicle",
        row.vehicleId,
        vehicleDTO(row),
        vehicleDTO(after),
        after.vehicle.revision,
      ],
    ] as const) {
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType,
        entityId,
        action: name,
        reason,
        before,
        after: payload,
      })
      await writeReadVersion(tx, {
        commandId,
        sequence,
        entityType,
        entityId,
        revision,
        payload,
      })
    }
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [
        { type: "PurchaseRecord", id: after.id, revision: after.revision },
        {
          type: "Vehicle",
          id: after.vehicleId,
          revision: after.vehicle.revision,
        },
      ],
      invalidate,
    }
  })
}

type MoneyInput<N extends CycleMoneyCommand> = z.infer<
  (typeof cycleMoneyInputs)[N]
>
type MoneyIntent = {
  [N in CycleMoneyCommand]: { name: N; input: MoneyInput<N> }
}[CycleMoneyCommand]
const cashFields = (cash: { reference?: string }, prefix = "payment") =>
  [
    "amount",
    "date",
    "method",
    ...(cash.reference !== undefined ? ["reference"] : []),
  ].map((f) => `${prefix}.${f}`)
function moneyAuthority(
  actor: Actor,
  row: Row,
  intent: MoneyIntent,
  cost?: Cost
) {
  const { name, input } = intent
  requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
    "id",
    "revision",
  ])
  requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
    "id",
    "identityRevision",
  ])
  if (cost)
    requireFields(actor.ability, "VehicleCost", "read", costAuth(cost), [
      "id",
      "revision",
    ])
  if (name === "payPurchase")
    requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
      "purchasePrice",
      "outstanding.seller",
      "payments.amount",
      "payments.direction",
    ])
  if (name === "payCost" || (name === "reversePayment" && cost)) {
    requireFields(actor.ability, "VehicleCost", "read", costAuth(cost!), [
      "amount",
      "outstanding",
      "payments.amount",
      "payments.direction",
    ])
    requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
      "costs.id",
      "costs.revision",
      "costs.amount",
      "costs.outstanding",
      "costs.payments.amount",
      "costs.payments.direction",
    ])
  }
  if (
    name === "reversePayment" ||
    (name === "editPurchase" && input.cashCorrections.length)
  ) {
    const required = [
      "id",
      "amount",
      "direction",
      "date",
      "method",
      "reversalOf",
    ]
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "read",
      auth(row),
      required.map((f) => `${cost ? "costs." : ""}payments.${f}`)
    )
    if (cost)
      requireFields(
        actor.ability,
        "VehicleCost",
        "read",
        costAuth(cost),
        required.map((f) => `payments.${f}`)
      )
  }
  if (name === "addCost") {
    requireFields(actor.ability, "PurchaseRecord", "update", auth(row), [
      "cycleId",
    ])
    const candidate = { createdBy: actor.userId }
    requireFields(actor.ability, "VehicleCost", "read", candidate, [
      "id",
      "revision",
    ])
    requireFields(actor.ability, "VehicleCost", "create", candidate, [
      "cycleId",
      "category",
      "description",
      "amount",
      "incurredDate",
    ])
    if (input.payment) {
      requireFields(actor.ability, "PurchaseRecord", "pay", auth(row), [
        "cycleId",
      ])
      requireFields(
        actor.ability,
        "VehicleCost",
        "pay",
        candidate,
        cashFields(input.payment)
      )
    }
  } else if (name === "editCost") {
    requireFields(actor.ability, "PurchaseRecord", "update", auth(row), [
      "cycleId",
    ])
    requireFields(
      actor.ability,
      "VehicleCost",
      "update",
      costAuth(cost!),
      Object.keys(input)
    )
  } else if (name === "editPurchase") {
    requireFields(actor.ability, "PurchaseRecord", "update", auth(row), [
      "cycleId",
      "reason",
      ...Object.keys(input.patch).map((f) => `patch.${f}`),
    ])
    if (input.cashCorrections.length)
      requireFields(actor.ability, "PurchaseRecord", "pay", auth(row), [
        "cycleId",
        "cashCorrections.paymentId",
        "cashCorrections.reason",
        ...input.cashCorrections.flatMap((c) =>
          c.replacement
            ? cashFields(c.replacement, "cashCorrections.replacement")
            : []
        ),
      ])
  } else {
    const fields =
      name === "reversePayment"
        ? [
            "sourceType",
            "sourceId",
            "paymentId",
            "reason",
            ...(input.replacement
              ? cashFields(input.replacement, "replacement")
              : []),
          ]
        : [
            name === "payCost" ? "costId" : "cycleId",
            ...(name === "payPurchase" ? ["recipient"] : []),
            ...cashFields(input.payment),
          ]
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "pay",
      auth(row),
      cost ? ["cycleId"] : fields
    )
    if (cost)
      requireFields(actor.ability, "VehicleCost", "pay", costAuth(cost), fields)
  }
}
function availableMoneyActions(actor: Actor, row: Row): CycleMoneyCommand[] {
  if (
    !row.acquisitionCommandId ||
    row.closedAt ||
    row.vehicle.activePurchaseId !== row.id ||
    !["PURCHASED", "IN_STOCK"].includes(row.status)
  )
    return []
  const allowed = (intent: MoneyIntent, cost?: Cost) => {
    try {
      moneyAuthority(actor, row, intent, cost)
      return true
    } catch {
      return false
    }
  }
  const result: CycleMoneyCommand[] = []
  if (
    allowed({
      name: "addCost",
      input: {
        cycleId: row.id,
        category: "",
        description: "",
        amount: "0",
        incurredDate: "",
      },
    })
  )
    result.push("addCost")
  if (
    [
      "purchaseDate",
      "purchasePrice",
      "notes",
      "vehicleId",
      "identityRevision",
    ].every((f) =>
      actor.ability.can("read", subject("PurchaseRecord", auth(row)), f)
    ) &&
    allowed({
      name: "editPurchase",
      input: {
        cycleId: row.id,
        reason: "",
        patch: { purchaseDate: "", purchasePrice: "1", notes: null },
        cashCorrections: [],
      },
    })
  )
    result.push("editPurchase")
  const cash = { amount: "1", date: "", method: "CASH" as const }
  if (
    row.purchasePrice > netPaid(row.payments) &&
    allowed({
      name: "payPurchase",
      input: { cycleId: row.id, recipient: "SELLER", payment: cash },
    })
  )
    result.push("payPurchase")
  for (const c of row.costs) {
    const readable = [
      "id",
      "revision",
      "category",
      "description",
      "amount",
      "incurredDate",
      "outstanding",
    ].every(
      (f) =>
        actor.ability.can("read", subject("VehicleCost", costAuth(c)), f) &&
        actor.ability.can(
          "read",
          subject("PurchaseRecord", auth(row)),
          `costs.${f}`
        )
    )
    if (!readable) continue
    if (
      allowed(
        {
          name: "editCost",
          input: {
            costId: c.id,
            category: "",
            description: "",
            amount: "0",
            incurredDate: "",
            reason: "",
          },
        },
        c
      )
    )
      result.push("editCost")
    if (
      c.amount > netPaid(c.payments) &&
      allowed({ name: "payCost", input: { costId: c.id, payment: cash } }, c)
    )
      result.push("payCost")
    if (
      c.payments.some(
        (p) => !p.reversalOf && !c.payments.some((r) => r.reversalOf === p.id)
      ) &&
      allowed(
        {
          name: "reversePayment",
          input: {
            sourceType: "COST",
            sourceId: c.id,
            paymentId: "",
            reason: "",
          },
        },
        c
      )
    )
      result.push("reversePayment")
  }
  if (
    row.payments.some(
      (p) => !p.reversalOf && !row.payments.some((r) => r.reversalOf === p.id)
    ) &&
    allowed({
      name: "reversePayment",
      input: {
        sourceType: "PURCHASE",
        sourceId: row.id,
        paymentId: "",
        reason: "",
      },
    })
  )
    result.push("reversePayment")
  return [...new Set(result)]
}

/** Bounded cycle-owned costs/terms only. Each intent is one truthful commit. */
export async function executeCycleMoney(
  identity: Identity,
  name: CycleMoneyCommand,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  // Preserve the established overflow discriminator rather than accepting an
  // unsafe number or quietly reducing a monetary value in validation.
  const checkMoney = (value: unknown, key = "") => {
    if (
      ["amount", "purchasePrice"].includes(key) &&
      typeof value === "string" &&
      /^[1-9][0-9]{14,}$/.test(value)
    )
      fail("MONEY_OVERFLOW", 422)
    if (Array.isArray(value)) value.forEach((v) => checkMoney(v))
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value)) checkMoney(v, k)
  }
  checkMoney(raw)
  const parsed = cycleMoneyEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    intent = { name, input: envelope.input } as MoneyIntent,
    input = intent.input,
    config = runtimeConfig(),
    digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: name,
      idempotencyKey: envelope.idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    // Child and payment owners are resolved from persisted FKs, never expected[].
    let costId = "costId" in input ? input.costId : undefined
    let cycleId = "cycleId" in input ? input.cycleId : undefined
    if (intent.name === "reversePayment") {
      const p =
        intent.input.sourceType === "COST"
          ? await tx.costPayment.findUnique({
              where: { id: intent.input.paymentId },
            })
          : await tx.purchasePayment.findUnique({
              where: { id: intent.input.paymentId },
            })
      if (
        !p ||
        ("costId" in p ? p.costId : p.cycleId) !== intent.input.sourceId
      )
        fail("NOT_FOUND", 404)
      cycleId = p.cycleId
      if ("costId" in p && typeof p.costId === "string") costId = p.costId
    }
    if (costId) {
      const cost = await tx.vehicleCost.findUnique({ where: { id: costId } })
      if (!cost) fail("NOT_FOUND", 404)
      cycleId = cost.cycleId
    }
    if (!cycleId) fail("NOT_FOUND", 404)
    const planned = await load(tx, cycleId)
    if (!planned) fail("NOT_FOUND", 404)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`Vehicle:${planned.vehicleId}`},0))::text`
    await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${cycleId}::uuid FOR UPDATE`
    if (costId)
      await tx.$queryRaw`SELECT id FROM vamotors."VehicleCost" WHERE id=${costId}::uuid FOR UPDATE`
    const row = (await load(tx, cycleId))!,
      cost = row.costs.find((c) => c.id === costId)
    moneyAuthority(actor, row, intent, cost)
    if (intent.name === "editPurchase")
      requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
        "id",
        "identityRevision",
      ])
    const refs: Dependency[] = [
      { type: "PurchaseRecord", id: row.id, revision: row.revision },
      ...(cost
        ? [
            {
              type: "VehicleCost" as const,
              id: cost.id,
              revision: cost.revision,
            },
          ]
        : []),
      ...(intent.name === "editPurchase"
        ? [
            {
              type: "Vehicle" as const,
              id: row.vehicleId,
              revision: row.vehicle.revision,
            },
          ]
        : []),
    ]
    const affected = (): Dependency[] => [
      ...refs.filter((r) => r.type !== "Vehicle"),
      { type: "Vehicle", id: row.vehicleId, revision: row.vehicle.revision },
    ]
    const invalidate: Applied["invalidate"] = [
      "inventory",
      "purchases",
      "parties",
      "reports",
      "dashboard",
    ]
    if (prior) {
      const result = prior.result as Applied["result"]
      const expectedId =
        intent.name === "addCost"
          ? row.costs.find((c) => c.commandId === prior.id)?.id
          : (cost?.id ?? row.id)
      if (
        prior.inputHash !== digest ||
        result.id !== expectedId ||
        result.type !==
          (cost || intent.name === "addCost" ? "VehicleCost" : "PurchaseRecord")
      )
        fail("IDEMPOTENCY_MISMATCH")
      if (intent.name === "addCost") {
        const created = row.costs.find((c) => c.id === result.id)!
        requireFields(actor.ability, "VehicleCost", "read", costAuth(created), [
          "id",
          "revision",
        ])
        refs.push({
          type: "VehicleCost",
          id: created.id,
          revision: created.revision,
        })
      }
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected: affected(),
        invalidate,
      }
    }
    for (const ref of refs) requireRef(envelope.expected, ref)
    if (
      !row.acquisitionCommandId ||
      row.closedAt ||
      row.vehicle.activePurchaseId !== row.id ||
      row.acquisitionKind !== "SUPPLIER" ||
      !["CASH", "BRAND_NEW"].includes(row.purchaseType) ||
      !["PURCHASED", "IN_STOCK"].includes(row.status)
    )
      fail("INVALID_STATE")
    if (row.revision === 2147483647 || cost?.revision === 2147483647)
      fail("REVISION_EXHAUSTED")
    const today = colomboToday(),
      reason = "reason" in input ? input.reason : undefined
    const checkDate = (value: string, earliest: string) => {
      if (value < earliest || value > today) fail("INVALID_INPUT", 422)
    }
    const purchaseDate =
      intent.name === "editPurchase"
        ? (intent.input.patch.purchaseDate ?? date(row.purchaseDate))
        : date(row.purchaseDate)
    const checkCash = (
      cash: MoneyInput<"payCost">["payment"],
      earliest: string
    ) => checkDate(cash.date, earliest)
    if (intent.name === "addCost" || intent.name === "editCost") {
      checkDate(intent.input.incurredDate, purchaseDate)
      if (intent.name === "addCost" && intent.input.payment)
        checkCash(intent.input.payment, intent.input.incurredDate)
      if (
        intent.name === "editCost" &&
        cost!.payments.some(
          (p) =>
            !p.reversalOf &&
            !cost!.payments.some((r) => r.reversalOf === p.id) &&
            date(p.occurredDate) < intent.input.incurredDate
        )
      )
        fail("INVALID_INPUT", 422)
      if (
        intent.name === "editCost" &&
        BigInt(intent.input.amount) < netPaid(cost!.payments)
      )
        fail("BALANCE_MISMATCH", 422)
      if (
        intent.name === "addCost" &&
        intent.input.payment &&
        BigInt(intent.input.payment.amount) > BigInt(intent.input.amount)
      )
        fail("BALANCE_MISMATCH", 422)
      if (
        intent.name === "editCost" &&
        intent.input.category === cost!.category &&
        intent.input.description === cost!.description &&
        BigInt(intent.input.amount) === cost!.amount &&
        intent.input.incurredDate === date(cost!.incurredDate)
      )
        fail("INVALID_STATE")
    }
    if (intent.name === "payCost" || intent.name === "payPurchase")
      checkCash(
        intent.input.payment,
        cost ? date(cost.incurredDate) : purchaseDate
      )
    if (intent.name === "editPurchase") {
      checkDate(purchaseDate, "0001-01-01")
      if (
        row.mileage.some((m) => date(m.recordedDate) < purchaseDate) ||
        row.costs.some((c) => date(c.incurredDate) < purchaseDate) ||
        (row.receivedDate && date(row.receivedDate) < purchaseDate)
      )
        fail("INVALID_INPUT", 422)
      if (
        Object.keys(intent.input.patch).every((k) =>
          k === "purchaseDate"
            ? purchaseDate === date(row.purchaseDate)
            : k === "purchasePrice"
              ? BigInt(intent.input.patch.purchasePrice!) === row.purchasePrice
              : (intent.input.patch.notes ?? null) === row.notes
        ) &&
        !intent.input.cashCorrections.length
      )
        fail("INVALID_STATE")
    }
    const sequence = await nextBusinessSequence(tx),
      commandId = randomUUID(),
      newCostId = name === "addCost" ? randomUUID() : costId
    const result = {
      type: newCostId ? "VehicleCost" : "PurchaseRecord",
      id: newCostId ?? row.id,
      revision: name === "addCost" ? 1 : (cost?.revision ?? row.revision) + 1,
    }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    const basis = row.basisVersions.at(-1)!
    const appendPayment = async (
      cash: MoneyInput<"payCost">["payment"],
      lineKey: string,
      targetCostId?: string,
      correction?: { original: Payment; reason: string; reversal: boolean }
    ) => {
      const p = correction?.original
      const data = {
        cycleId: row.id,
        commandId,
        lineKey,
        amount: correction?.reversal ? p!.amount : BigInt(cash.amount),
        direction: correction?.reversal ? "IN" : "OUT",
        category: targetCostId ? "COST" : "SELLER",
        occurredDate: correction?.reversal
          ? p!.occurredDate
          : new Date(cash.date),
        method: correction?.reversal ? p!.method : cash.method,
        currency: basis.currency,
        scale: basis.scale,
        reference: correction?.reversal ? p!.reference : cash.reference,
        ...(correction ? { reason: correction.reason } : {}),
        ...(correction?.reversal ? { reversalOf: p!.id } : {}),
      }
      if (targetCostId)
        await tx.costPayment.create({
          data: { ...data, costId: targetCostId, createdBy: actor.userId },
        })
      else await tx.purchasePayment.create({ data })
    }
    const reverse = async (
      paymentId: string,
      replacement: MoneyInput<"reversePayment">["replacement"],
      why: string,
      target?: Cost
    ) => {
      const payments = target?.payments ?? row.payments,
        original = payments.find((p) => p.id === paymentId)
      if (!original) fail("NOT_FOUND", 404)
      if (
        original.reversalOf ||
        payments.some((p) => p.reversalOf === original.id)
      )
        fail("INVALID_STATE")
      const cash = {
        amount: original.amount.toString(),
        date: date(original.occurredDate),
        method: original.method as "CASH" | "BANK_TRANSFER",
      }
      if (replacement)
        checkCash(
          replacement,
          target ? date(target.incurredDate) : purchaseDate
        )
      await appendPayment(cash, `reverse:${paymentId}`, target?.id, {
        original,
        reason: why,
        reversal: true,
      })
      if (replacement)
        await appendPayment(replacement, `replace:${paymentId}`, target?.id, {
          original,
          reason: why,
          reversal: false,
        })
    }
    if (intent.name === "addCost") {
      const { payment, ...terms } = intent.input
      await tx.vehicleCost.create({
        data: {
          ...terms,
          id: newCostId,
          amount: BigInt(terms.amount),
          incurredDate: new Date(terms.incurredDate),
          createdBy: actor.userId,
          commandId,
        },
      })
      if (payment) await appendPayment(payment, "payment", newCostId)
    } else if (intent.name === "editCost") {
      const { costId: target, reason: unused, ...terms } = intent.input
      void unused
      await tx.vehicleCost.update({
        where: { id: target },
        data: {
          ...terms,
          amount: BigInt(terms.amount),
          incurredDate: new Date(terms.incurredDate),
          revision: { increment: 1 },
        },
      })
    } else if (intent.name === "payCost" || intent.name === "payPurchase")
      await appendPayment(intent.input.payment, "payment", costId)
    else if (intent.name === "reversePayment")
      await reverse(
        intent.input.paymentId,
        intent.input.replacement,
        intent.input.reason,
        cost
      )
    else
      for (const correction of intent.input.cashCorrections)
        await reverse(
          correction.paymentId,
          correction.replacement,
          correction.reason
        )
    if (cost && intent.name !== "editCost")
      await tx.vehicleCost.update({
        where: { id: cost.id },
        data: { revision: { increment: 1 } },
      })
    await tx.purchaseRecord.update({
      where: { id: row.id },
      data: {
        revision: { increment: 1 },
        ...(intent.name === "editPurchase"
          ? {
              ...(intent.input.patch.purchaseDate
                ? { purchaseDate: new Date(purchaseDate) }
                : {}),
              ...(intent.input.patch.purchasePrice
                ? { purchasePrice: BigInt(intent.input.patch.purchasePrice) }
                : {}),
              ...(intent.input.patch.notes !== undefined
                ? { notes: intent.input.patch.notes }
                : {}),
            }
          : {}),
      },
    })
    let after = (await load(tx, row.id))!
    const checkCap = (payments: Payment[], maximum: bigint) => {
      const paid = netPaid(payments),
        cash = cashTotals(
          payments.map((p) => ({
            direction: p.direction as "IN" | "OUT",
            amount: p.amount.toString(),
          }))
        )
      bounded(BigInt(cash.incoming), C)
      bounded(BigInt(cash.outgoing), C)
      if (paid < 0n || paid > maximum) fail("BALANCE_MISMATCH", 422)
    }
    checkCap(after.payments, after.purchasePrice)
    for (const c of after.costs) checkCap(c.payments, c.amount)
    if (
      after.payments.some(
        (p) =>
          !p.reversalOf &&
          !after.payments.some((r) => r.reversalOf === p.id) &&
          date(p.occurredDate) < purchaseDate
      )
    )
      fail("INVALID_INPUT", 422)
    if (
      intent.name === "addCost" ||
      intent.name === "editCost" ||
      after.purchasePrice !== row.purchasePrice
    ) {
      if (basis.version === 2147483647) fail("REVISION_EXHAUSTED")
      const total = sum(
        [after.purchasePrice, ...after.costs.map((c) => c.amount)],
        C
      )
      await tx.cycleBasisVersion.create({
        data: {
          cycleId: row.id,
          commandId,
          version: basis.version + 1,
          purchase: after.purchasePrice,
          total,
          currency: basis.currency,
          scale: basis.scale,
          reason: reason ?? "Additional incurred cost",
          supersedesId: basis.id,
          components: {
            purchase: after.purchasePrice.toString(),
            repairs: [],
            costs: after.costs.map((c) => ({
              id: c.id,
              amount: c.amount.toString(),
            })),
          },
        },
      })
      after = (await load(tx, row.id))!
    }
    for (const [entityType, entityId, before, payload, revision] of [
      [
        "PurchaseRecord",
        row.id,
        purchaseDTO(row),
        purchaseDTO(after),
        after.revision,
      ],
      [
        "Vehicle",
        row.vehicleId,
        vehicleDTO(row),
        vehicleDTO(after),
        row.vehicle.revision,
      ],
    ] as const) {
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType,
        entityId,
        action: name,
        reason,
        before,
        after: payload,
      })
      await writeReadVersion(tx, {
        commandId,
        sequence,
        entityType,
        entityId,
        revision,
        payload,
      })
    }
    const updatedCost = after.costs.find((c) => c.id === newCostId)
    if (updatedCost) {
      requireFields(
        actor.ability,
        "VehicleCost",
        "read",
        costAuth(updatedCost),
        ["id", "revision"]
      )
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType: "VehicleCost",
        entityId: updatedCost.id,
        action: name,
        reason,
        before: cost ? costDTO(cost) : null,
        after: costDTO(updatedCost),
      })
    }
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [
        { type: "PurchaseRecord", id: row.id, revision: after.revision },
        ...(updatedCost
          ? [
              {
                type: "VehicleCost" as const,
                id: updatedCost.id,
                revision: updatedCost.revision,
              },
            ]
          : []),
        { type: "Vehicle", id: row.vehicleId, revision: row.vehicle.revision },
      ],
      invalidate,
    }
  })
}

export async function purchaseQuery(
  tx: Tx,
  actor: Actor,
  name: string,
  args: Record<string, string>
) {
  if (name !== "audit") {
    if (name === "inventory" && !actor.ability.can("read", "PurchaseRecord"))
      fail("FORBIDDEN", 403)
    const type = ["purchases", "purchase"].includes(name)
      ? "PurchaseRecord"
      : "Vehicle"
    if (!actor.ability.can("read", type)) {
      const list = ["purchases", "inventory"].includes(name)
      fail(list ? "FORBIDDEN" : "NOT_FOUND", list ? 403 : 404)
    }
  }
  if (name === "audit") {
    const parsed = listParams
      .extend({
        type: z.enum(["Vehicle", "PurchaseRecord", "VehicleCost"]),
        id,
      })
      .strict()
      .safeParse(args)
    if (!parsed.success) fail("INVALID_INPUT", 422)
    const input = parsed.data
    const targetCost =
      input.type === "VehicleCost"
        ? await tx.vehicleCost.findUnique({ where: { id: input.id } })
        : null
    const row =
      input.type === "PurchaseRecord"
        ? await load(tx, input.id)
        : input.type === "VehicleCost"
          ? targetCost
            ? await load(tx, targetCost.cycleId)
            : null
          : await tx.purchaseRecord.findFirst({
              where: { vehicleId: input.id },
              include,
              orderBy: { cycleNumber: "desc" },
            })
    if (!row) fail("NOT_FOUND", 404)
    const cost = row.costs.find((c) => c.id === input.id)
    if (input.type === "VehicleCost")
      requireFields(actor.ability, "PurchaseRecord", "read", auth(row), ["id"])
    const visible =
      input.type === "PurchaseRecord"
        ? visiblePurchase(actor, row)
        : input.type === "VehicleCost"
          ? cost
            ? visibleCost(actor, row, cost)
            : null
          : visibleVehicle(actor, row)
    if (!visible) fail("NOT_FOUND", 404)
    if (!visible.id) fail("FIELD_FORBIDDEN", 403)
    // Historical hold values (including duplicated stock audit reasons) inherit
    // current source-field authority, not presence of an optional current value.
    const holdReasonReadable =
      actor.ability.can(
        "read",
        subject("PurchaseRecord", auth(row)),
        "holdReason"
      ) &&
      (input.type === "PurchaseRecord" ||
        actor.ability.can(
          "read",
          subject("Vehicle", vehicleAuth(row)),
          "holdReason"
        ))
    const where = {
      entityType: input.type,
      entityId: input.id,
      ...readScope(actor.grants, actor.userId, "AuditLog", ["id", "at"]),
    }
    const [entries, total] = await Promise.all([
      tx.auditEntry.findMany({
        where,
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      }),
      tx.auditEntry.count({ where }),
    ])
    const at = (value: unknown, path: string): unknown =>
      path
        .split(".")
        .reduce<unknown>(
          (v, k) =>
            v && typeof v === "object"
              ? (v as Record<string, unknown>)[k]
              : undefined,
          value
        )
    const mask = (value: unknown, witness: unknown): unknown => {
      if (value === null || typeof value !== "object") return value
      if (Array.isArray(value)) {
        if (!Array.isArray(witness)) return undefined
        return value.flatMap((v) => {
          const w =
            v && typeof v === "object" && "id" in v
              ? witness.find(
                  (candidate) =>
                    candidate &&
                    typeof candidate === "object" &&
                    candidate.id === v.id
                )
              : witness[0]
          if (w === undefined) return []
          return [mask(v, w)]
        })
      }
      if (!witness || typeof witness !== "object") return undefined
      return Object.fromEntries(
        Object.entries(value)
          .filter(([k]) => k in witness)
          .map(([k, v]) => [
            k,
            mask(v, (witness as Record<string, unknown>)[k]),
          ])
      )
    }
    const data = entries.map((entry) => {
      const redactedFields: string[] = []
      const fields = Object.entries(
        entry.fieldDiff as Record<string, { before: unknown; after: unknown }>
      ).flatMap(([path, delta]) => {
        const witness =
          path === "holdReason"
            ? holdReasonReadable
              ? row.holdReason
              : undefined
            : at(visible, path)
        if (witness === undefined) {
          redactedFields.push(`fields.${path}`)
          return []
        }
        return [
          {
            path,
            before: mask(delta.before, witness),
            after: mask(delta.after, witness),
          },
        ]
      })
      const result = project(actor.ability, "AuditLog", {
        id: entry.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actor: { kind: entry.actorKind },
        at: entry.recordedAt.toISOString(),
        reason: entry.reason,
        fields,
      })
      if (
        ["receiveStock", "holdStock", "releaseStock"].includes(entry.action) &&
        !holdReasonReadable &&
        "reason" in result
      ) {
        delete result.reason
        redactedFields.push("reason")
      }
      if (
        entry.action === "approvedWriteOff" &&
        (!row.disposal ||
          !actor.ability.can(
            "read",
            subject("PurchaseRecord", auth(row)),
            "disposal"
          ) ||
          !actor.ability.can(
            "read",
            subject("Disposal", disposalAuth(row.disposal)),
            "reason"
          )) &&
        "reason" in result
      ) {
        delete result.reason
        redactedFields.push("reason")
      }
      if (
        ["editCost", "editPurchase", "reversePayment"].includes(entry.action)
      ) {
        if (!correctionSourceReadable(actor, row) && "reason" in result) {
          delete result.reason
          redactedFields.push("reason")
        }
      }
      const physicalReasonReadable = physicalFields.every(
        (f) =>
          actor.ability.can(
            "read",
            subject("PurchaseRecord", auth(row)),
            `identity.${f}`
          ) &&
          actor.ability.can(
            "read",
            subject("Vehicle", vehicleAuth(row)),
            `identity.${f}`
          )
      )
      const mileageReasonReadable = [
        "reading",
        "date",
        "remark",
        "decreaseReason",
      ].every(
        (f) =>
          actor.ability.can(
            "read",
            subject("PurchaseRecord", auth(row)),
            `mileage.${f}`
          ) &&
          actor.ability.can(
            "read",
            subject("Vehicle", vehicleAuth(row)),
            `mileage.${f}`
          )
      )
      if (
        (entry.action === "editVehicle" && !physicalReasonReadable) ||
        (entry.action === "addMileage" && !mileageReasonReadable) ||
        (entry.action === "setListedPrice" &&
          (!actor.ability.can(
            "read",
            subject("PurchaseRecord", auth(row)),
            "listedPrice"
          ) ||
            (input.type === "Vehicle" &&
              !actor.ability.can(
                "read",
                subject("Vehicle", vehicleAuth(row)),
                "listedPrice"
              ))))
      ) {
        delete result.reason
        redactedFields.push("reason")
      }
      result.redactedFields.push(...redactedFields)
      return result
    })
    return {
      ok: true,
      data,
      total,
      page: input.page,
      pageSize: input.pageSize,
      asOf: new Date().toISOString(),
      redactedFields: [],
    }
  }
  if (name === "vehicleIdentity") {
    const input = vehicleInput
      .pick({ engineNumber: true, chassisNumber: true })
      .strict()
      .safeParse(args)
    if (!input.success) fail("INVALID_INPUT", 422)
    if (!actor.ability.can("read", "Vehicle")) fail("FORBIDDEN", 403)
    const row = await tx.vehicle.findFirst({
      where: {
        normalizedEngine: normalizeVehicleIdentity(input.data.engineNumber),
        normalizedChassis: normalizeVehicleIdentity(input.data.chassisNumber),
        ...physicalScope(actor, [
          "identity.engineNumber",
          "identity.chassisNumber",
        ]),
      },
      include: {
        purchases: { orderBy: [{ cycleNumber: "desc" }], take: 1, include },
      },
    })
    if (!row) return null
    requireFields(
      actor.ability,
      "Vehicle",
      "read",
      { ...row, status: row.purchases[0]?.status },
      ["id", "revision"]
    )
    const latest = row.purchases[0]
    if (!latest) fail("INVALID_STATE")
    const visible = project(actor.ability, "Vehicle", {
      id: row.id,
      revision: row.revision,
      identity: physical(row),
      createdBy: row.createdBy,
      status: latest.status,
      cycleId: row.activePurchaseId,
    })
    const cycle = subject("PurchaseRecord", auth(latest))
    const cycleVisible =
      actor.ability.can("read", cycle, "id") &&
      actor.ability.can(
        "read",
        subject("Vehicle", { ...row, status: latest.status }),
        "cycleId"
      )
    return {
      id: row.id,
      revision: row.revision,
      ...(visible.identity ? { identity: visible.identity } : {}),
      ...(cycleVisible
        ? { activeCycleId: row.activePurchaseId, latestCycleId: latest.id }
        : {}),
      ...(visible.status && actor.ability.can("read", cycle, "status")
        ? { latestStatus: latest.status }
        : {}),
      redactedFields: [
        ...visible.redactedFields.filter((field) =>
          field.startsWith("identity")
        ),
        ...(!cycleVisible ? ["activeCycleId", "latestCycleId"] : []),
        ...(!(visible.status && actor.ability.can("read", cycle, "status"))
          ? ["latestStatus"]
          : []),
      ],
    }
  }
  if (name === "purchase") {
    const input = z.object({ cycleId: id }).strict().safeParse(args)
    if (!input.success) fail("INVALID_INPUT", 422)
    const row = await load(tx, input.data.cycleId)
    if (!row) fail("NOT_FOUND", 404)
    return visiblePurchase(actor, row)
  }
  if (name === "vehicle") {
    const input = z
      .object({ id, cycleId: id.optional() })
      .strict()
      .safeParse(args)
    if (!input.success) fail("INVALID_INPUT", 422)
    const vehicle = await tx.vehicle.findUnique({
      where: { id: input.data.id },
    })
    if (!vehicle) fail("NOT_FOUND", 404)
    const cycles = await tx.purchaseRecord.findMany({
      where: {
        vehicleId: vehicle.id,
        ...readScope(actor.grants, actor.userId, "PurchaseRecord"),
      },
      include,
      orderBy: [{ cycleNumber: "desc" }],
    })
    const selected =
      cycles.find(
        (c) => c.id === (input.data.cycleId ?? vehicle.activePurchaseId)
      ) ?? (!input.data.cycleId ? cycles[0] : undefined)
    if (!selected) fail("NOT_FOUND", 404)
    return {
      ...visibleVehicle(actor, selected),
      cycles: cycles.map((c) => visiblePurchase(actor, c)),
      repairs: [],
    }
  }
  const parsed = listParams
    .extend({
      q: z.string().trim().max(200).optional(),
      sort: z.string().max(1000).optional(),
      from: dateOnly.optional(),
      through: dateOnly.optional(),
      supplierId: id.optional(),
      sellerCustomerId: id.optional(),
      vehicleId: id.optional(),
      purchaseType: z
        .enum(["CASH", "BRAND_NEW", "LEASE_SETTLEMENT"])
        .optional(),
      statuses: z.string().max(1000).optional(),
      available: z.enum(["true", "false"]).optional(),
      make: z.string().max(200).optional(),
      model: z.string().max(200).optional(),
    })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data,
    inventory = name === "inventory",
    type = inventory ? "Vehicle" : "PurchaseRecord"
  if (
    Object.keys(args).some((key) =>
      (inventory
        ? ["supplierId", "sellerCustomerId", "vehicleId", "purchaseType"]
        : ["available", "make", "model"]
      ).includes(key)
    )
  )
    fail("INVALID_INPUT", 422)
  if (input.from && input.through && input.from > input.through)
    fail("INVALID_INPUT", 422)
  if (!actor.ability.can("read", type)) fail("FORBIDDEN", 403)
  let sortRaw: unknown, statusesRaw: unknown
  try {
    sortRaw = input.sort
      ? JSON.parse(input.sort)
      : [{ field: "id", direction: "asc" }]
    statusesRaw = input.statuses ? JSON.parse(input.statuses) : []
  } catch {
    fail("INVALID_INPUT", 422)
  }
  const sorts = z
    .array(
      z
        .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
        .strict()
    )
    .max(3)
    .safeParse(sortRaw)
  const statuses = z
    .array(
      z.enum([
        "PURCHASED",
        "IN_STOCK",
        "IN_REPAIR",
        "ADVANCE_PLACED",
        "ADVANCE_EXPIRED",
        "FINANCE_PENDING",
        "DO_RECEIVED",
        "DELIVERED",
        "SOLD",
        "WRITTEN_OFF",
      ])
    )
    .max(10)
    .safeParse(statusesRaw)
  if (
    !sorts.success ||
    !statuses.success ||
    new Set(sorts.data.map((s) => s.field)).size !== sorts.data.length
  )
    fail("INVALID_INPUT", 422)
  const allowed = inventory
    ? ["id", "status", "available", "listedPrice"]
    : ["id", "purchaseDate", "purchasePrice", "listedPrice", "status"]
  if (sorts.data.some((s) => !allowed.includes(s.field)))
    fail("FIELD_FORBIDDEN", 403)
  const searchFields = ["make", "model", "engineNumber", "chassisNumber"]
  const identityFields = [
    ...(input.make ? ["identity.make"] : []),
    ...(input.model ? ["identity.model"] : []),
    ...(input.q ? searchFields.map((field) => `identity.${field}`) : []),
  ]
  const required = [
    "id",
    ...sorts.data.map((s) => s.field),
    ...(statuses.data.length ? ["status"] : []),
    ...(input.available ? ["available"] : []),
    ...identityFields,
    ...(input.from || input.through
      ? [inventory ? "cycleId" : "purchaseDate"]
      : []),
    ...(input.supplierId ? ["seller"] : []),
    ...(input.sellerCustomerId ? ["seller"] : []),
    ...(input.vehicleId ? ["vehicleId"] : []),
    ...(input.purchaseType ? ["purchaseType"] : []),
  ]
  const scope = inventory ? physicalScope(actor, [...new Set(required)]) : {}
  const cycleScope = inventory
    ? {}
    : readScope(actor.grants, actor.userId, "PurchaseRecord", [
        ...new Set(required),
      ])
  // Cross-root predicates must be authorized too, including counts/order.
  const purchaseFields = inventory
    ? sorts.data.map((s) => s.field).filter((s) => s !== "id")
    : []
  if (input.from || input.through) purchaseFields.push("purchaseDate")
  if (input.available) purchaseFields.push("available")
  if (statuses.data.length) purchaseFields.push("status")
  if (input.supplierId || input.sellerCustomerId) purchaseFields.push("seller")
  if (input.vehicleId) purchaseFields.push("vehicleId")
  if (input.purchaseType) purchaseFields.push("purchaseType")
  const purchaseScope = readScope(
    actor.grants,
    actor.userId,
    "PurchaseRecord",
    purchaseFields
  )
  const vehicleScope =
    inventory || input.q || input.make || input.model
      ? physicalScope(actor, identityFields)
      : {}
  const q = input.q?.replace(/[\\%_]/g, "\\$&")
  if (input.supplierId) {
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
    })
    if (!supplier) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "Supplier", "read", supplier, ["id"])
  }
  if (input.sellerCustomerId) {
    const customer = await tx.customer.findUnique({
      where: { id: input.sellerCustomerId },
    })
    if (!customer) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "Customer", "read", customer, ["id"])
  }
  const where: Prisma.PurchaseRecordWhereInput = {
    AND: [
      purchaseScope,
      cycleScope,
      {
        vehicle: {
          AND: [
            vehicleScope,
            ...(inventory ? [scope] : []),
            ...(input.make ? [{ make: input.make }] : []),
            ...(input.model ? [{ model: input.model }] : []),
            ...(q
              ? [
                  {
                    OR: searchFields.map((f) => ({
                      [f]: { contains: q, mode: "insensitive" },
                    })),
                  },
                ]
              : []),
          ],
        },
      },
      ...(inventory ? [{ closedAt: null }] : []),
      ...(input.supplierId ? [{ supplierId: input.supplierId }] : []),
      ...(input.sellerCustomerId
        ? [{ sellerCustomerId: input.sellerCustomerId }]
        : []),
      ...(input.vehicleId ? [{ vehicleId: input.vehicleId }] : []),
      ...(input.purchaseType ? [{ purchaseType: input.purchaseType }] : []),
      ...(statuses.data.length ? [{ status: { in: statuses.data } }] : []),
      ...(input.available ? [{ available: input.available === "true" }] : []),
      ...(input.from || input.through
        ? [
            {
              purchaseDate: {
                ...(input.from ? { gte: new Date(input.from) } : {}),
                ...(input.through ? { lte: new Date(input.through) } : {}),
              },
            },
          ]
        : []),
    ],
  }
  const [rows, total] = await Promise.all([
    tx.purchaseRecord.findMany({
      where,
      include,
      orderBy: [
        ...sorts.data.map((s) => ({
          [inventory && s.field === "id" ? "vehicleId" : s.field]: s.direction,
        })),
        ...(!sorts.data.some((s) => s.field === "id")
          ? [{ id: "asc" as const }]
          : []),
      ],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    tx.purchaseRecord.count({ where }),
  ])
  return {
    ok: true,
    data: rows.map((row) =>
      inventory ? visibleVehicle(actor, row) : visiblePurchase(actor, row)
    ),
    total,
    page: input.page,
    pageSize: input.pageSize,
    asOf: new Date().toISOString(),
    redactedFields: [],
  }
}
