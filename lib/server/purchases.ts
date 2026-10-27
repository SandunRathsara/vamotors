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
import { currentActor, type Actor, type Identity } from "./actor"
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
} from "./validators"
import { project, readScope, requireFields } from "./permissions"
import { fail, CommandError } from "./errors"
import { currentSettings } from "./settings"
import { cashTotals, bounded } from "../money"

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
  mileage: {
    orderBy: [{ recordedDate: "asc" as const }, { id: "asc" as const }],
  },
  basisVersions: { orderBy: { version: "asc" as const } },
  settingsVersion: true,
} satisfies Prisma.PurchaseRecordInclude
type Row = Prisma.PurchaseRecordGetPayload<{ include: typeof include }>
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
    row.payments.map((p) => ({
      direction: p.direction as "IN" | "OUT",
      amount: p.amount.toString(),
    }))
  )
  const paid = bounded(BigInt(cash.outgoing) - BigInt(cash.incoming))
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
    ...(row.listedPrice !== null
      ? { listedPrice: row.listedPrice.toString() }
      : {}),
    status: row.status,
    available: row.available,
    ...(row.holdReason !== null ? { holdReason: row.holdReason } : {}),
    ...(row.receivedDate ? { receivedDate: date(row.receivedDate) } : {}),
    closedAt: row.closedAt?.toISOString() ?? null,
    payments: row.payments.map((p) => ({
      id: p.id,
      owner: { type: "PURCHASE", id: p.cycleId },
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
    })),
    outstanding: {
      seller: (row.purchasePrice - paid).toString(),
      settlement: "0",
    },
    costs: [],
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
            additionalCosts: "0",
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
    disposal: null,
    provenance: { imported: false },
    nextActions: [],
  }
}
function vehicleDTO(row: Row): VehicleDTO {
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
const auth = (row: Row) => ({ ...purchaseDTO(row), createdBy: row.createdBy })
const vehicleAuth = (row: Row) => ({
  ...vehicleDTO(row),
  createdBy: row.vehicle.createdBy,
})

/** Independently authorize both roots and linked seller, then project every read.
 * A broad Vehicle/party grant never launders a hidden purchase or its money. */
export function visiblePurchase(actor: Actor, row: Row) {
  const result = project(actor.ability, "PurchaseRecord", auth(row))
  const v = subject("Vehicle", vehicleAuth(row))
  for (const field of [
    "identity",
    "identityRevision",
    "vehicleId",
    "mileage",
  ] as const) {
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
  result.redactedFields = [
    ...new Set(result.redactedFields.filter((f) => f !== "createdBy")),
  ]
  return result
}
function visibleVehicle(actor: Actor, row: Row) {
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
  result.redactedFields = result.redactedFields.filter((f) => f !== "createdBy")
  return result
}
const load = (tx: Tx, cycleId: string) =>
  tx.purchaseRecord.findUnique({ where: { id: cycleId }, include })
function physicalScope(
  actor: Actor,
  fields: string[] = []
): Prisma.VehicleWhereInput {
  const scope = readScope(actor.grants, actor.userId, "Vehicle", fields)
  if (!scope.OR) return {}
  return {
    OR: scope.OR.map(({ status, ...condition }) => ({
      ...condition,
      ...(status ? { activePurchase: { status } } : {}),
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

export async function purchaseQuery(
  tx: Tx,
  actor: Actor,
  name: string,
  args: Record<string, string>
) {
  if (name === "audit") {
    const parsed = listParams
      .extend({ type: z.enum(["Vehicle", "PurchaseRecord"]), id })
      .strict()
      .safeParse(args)
    if (!parsed.success) fail("INVALID_INPUT", 422)
    const input = parsed.data
    const row =
      input.type === "PurchaseRecord"
        ? await load(tx, input.id)
        : await tx.purchaseRecord.findFirst({
            where: { vehicleId: input.id },
            include,
            orderBy: { cycleNumber: "desc" },
          })
    if (!row) fail("NOT_FOUND", 404)
    const visible =
      input.type === "PurchaseRecord"
        ? visiblePurchase(actor, row)
        : visibleVehicle(actor, row)
    if (!visible.id) fail("FIELD_FORBIDDEN", 403)
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
      if (Array.isArray(value))
        return value.map((v) =>
          mask(v, Array.isArray(witness) ? witness[0] : undefined)
        )
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
        const witness = at(visible, path)
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
        ...physicalScope(actor),
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
      ["id", "revision", "identity"]
    )
    const latest = row.purchases[0]
    if (!latest) fail("INVALID_STATE")
    requireFields(actor.ability, "PurchaseRecord", "read", auth(latest), [
      "id",
      "status",
    ])
    return {
      id: row.id,
      revision: row.revision,
      identity: physical(row),
      activeCycleId: row.activePurchaseId,
      latestCycleId: latest.id,
      latestStatus: latest.status,
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
  const required = [
    "id",
    ...sorts.data.map((s) => s.field),
    ...(statuses.data.length ? ["status"] : []),
    ...(input.available ? ["available"] : []),
    ...(input.q || input.make || input.model ? ["identity"] : []),
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
  const vehicleScope = physicalScope(
    actor,
    input.q || input.make || input.model ? ["identity"] : []
  )
  const q = input.q?.replace(/[\\%_]/g, "\\$&")
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
                    OR: ["make", "model", "engineNumber", "chassisNumber"].map(
                      (f) => ({ [f]: { contains: q, mode: "insensitive" } })
                    ),
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
        ...sorts.data.map((s) => ({ [s.field]: s.direction })),
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
