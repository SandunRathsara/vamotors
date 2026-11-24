import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import type {
  Applied,
  Dependency,
  SaleDTO,
  SaleEdit,
  ImmediateSale,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import {
  authenticate,
  currentActor,
  type Authority as Actor,
  type Identity,
} from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { audit, writeReadVersion } from "./audit"
import { inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import {
  saleEnvelope,
  saleInputs,
  id,
  listParams,
  type SaleCommand,
} from "./validators"
import { project, readScope, requireFields } from "./permissions"
import { fail, CommandError } from "./errors"
import { currentSettings } from "./settings"
import { A, C, tradeInResidual } from "../money"
import {
  acquireVehicleCycle,
  checkMoneyInput,
  colomboToday,
  formatDate,
  loadPurchase,
  normalizeVehicleIdentity,
  purchaseAuth,
  purchaseDTO,
  purchaseInclude,
  purchaseVehicleAuth,
  requireRef,
  vehicleDTO,
} from "./purchases"

export const saleInclude = {
  customer: true,
  purchaseRecord: { include: purchaseInclude },
  receipts: {
    orderBy: [
      { occurredDate: "asc" as const },
      { recordedAt: "asc" as const },
      { id: "asc" as const },
    ],
  },
  completion: true,
  corrections: { orderBy: { version: "asc" as const } },
  tradeIn: {
    include: {
      acquiredPurchase: {
        select: { id: true, revision: true, status: true, closedAt: true },
      },
      acquiredVehicle: { select: { id: true, revision: true } },
    },
  },
} satisfies Prisma.SaleCaseInclude

export type SaleRow = Prisma.SaleCaseGetPayload<{ include: typeof saleInclude }>

export function loadSale(tx: Tx, saleId: string) {
  return tx.saleCase.findUnique({ where: { id: saleId }, include: saleInclude })
}

async function resolveActorNames(
  tx: Tx,
  rows: readonly {
    createdBy: string
    completion?: { createdBy: string } | null
    corrections: { createdBy: string }[]
    receipts?: { createdBy: string }[]
  }[]
) {
  const ids = [
    ...new Set(
      rows.flatMap((r) => [
        r.createdBy,
        ...(r.completion ? [r.completion.createdBy] : []),
        ...r.corrections.map((c) => c.createdBy),
        ...(r.receipts ?? []).map((p) => p.createdBy),
      ])
    ),
  ]
  if (!ids.length) return new Map<string, string>()
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  })
  return new Map(users.map((u) => [u.id, u.name]))
}

export function saleDTO(
  row: SaleRow,
  actorNames: ReadonlyMap<string, string> = new Map()
): SaleDTO {
  const timeline: SaleDTO["timeline"] = [
    {
      at: row.openedAt.toISOString(),
      action: row.approvalId ? "DISCOUNT_APPROVED_SALE" : "COMPLETED",
      actorName:
        actorNames.get(row.completion?.createdBy ?? row.createdBy) ?? "System",
    },
    ...row.receipts.map((r) => ({
      at: r.recordedAt.toISOString(),
      action: `SALE_RECEIPT_${r.direction}${r.reversalOf ? "_REVERSAL" : ""}`,
      actorName: actorNames.get(r.createdBy) ?? "System",
    })),
    ...row.corrections.map((c) => ({
      at: c.recordedAt.toISOString(),
      action: `SALE_EDIT_V${c.version}`,
      actorName: actorNames.get(c.createdBy) ?? "System",
    })),
  ].sort(
    (a, b) => a.at.localeCompare(b.at) || a.action.localeCompare(b.action)
  )
  const latestCorrection = row.corrections.at(-1)
  const correctedSnap = latestCorrection?.correctedSnapshot as
    | { saleDate?: string; handoverMileage?: number }
    | undefined
  return {
    id: row.id,
    cycleId: row.purchaseRecordId,
    customerId: row.customerId,
    revision: row.revision,
    kind: row.kind as SaleDTO["kind"],
    state: row.state,
    price: row.agreedPrice.toString(),
    ...(row.reference !== null ? { reference: row.reference } : {}),
    ...(row.tradeIn
      ? {
          tradeIn: {
            description: row.tradeIn.description,
            value: row.tradeIn.value.toString(),
            ...(row.tradeIn.acquiredPurchaseId
              ? { acquiredCycleId: row.tradeIn.acquiredPurchaseId }
              : {}),
          },
        }
      : {}),
    ...(row.completion
      ? {
          completion: {
            id: row.completion.id,
            date: correctedSnap?.saleDate ?? formatDate(row.completion.saleDate),
            mileage:
              correctedSnap?.handoverMileage ?? row.completion.handoverMileage,
            basisVersionId:
              latestCorrection?.basisVersionId ?? row.completion.basisVersionId,
          },
        }
      : {}),
    payments: row.receipts.map((r) => ({
      id: r.id,
      amount: r.amount.toString(),
      direction: r.direction as "IN" | "OUT",
      category: r.category,
      date: formatDate(r.occurredDate),
      method: r.method as "CASH" | "BANK_TRANSFER",
      ...(r.reference !== null ? { reference: r.reference } : {}),
      recordedAt: r.recordedAt.toISOString(),
      ...(r.reversalOf !== null ? { reversalOf: r.reversalOf } : {}),
    })),
    timeline,
    nextActions: [],
    invoices: [],
    provenance: { imported: false },
  }
}

export const saleAuth = (
  row: SaleRow,
  actorNames: ReadonlyMap<string, string> = new Map()
) => ({
  ...saleDTO(row, actorNames),
  createdBy: row.createdBy,
  customerId: row.customerId,
})

export function visibleSale(
  actor: Actor,
  row: SaleRow,
  actorNames: ReadonlyMap<string, string> = new Map()
) {
  const result = project(actor.ability, "SaleCase", saleAuth(row, actorNames))
  const nextActions: string[] = []
  if (
    "nextActions" in result &&
    row.state === "COMPLETED" &&
    row.tradeIn &&
    !row.tradeIn.acquiredPurchaseId &&
    ["saleId", "vehicle", "mileage"].every((f) =>
      actor.ability.can(
        "update",
        subject("SaleCase", saleAuth(row, actorNames)),
        f
      )
    ) &&
    ["vehicle", "purchaseDate", "purchasePrice", "mileage"].every((f) =>
      actor.ability.can(
        "create",
        subject("PurchaseRecord", { createdBy: actor.userId, status: "PURCHASED" }),
        f
      )
    )
  ) {
    nextActions.push("intakeTradeIn")
  }
  if (
    "nextActions" in result &&
    row.state === "COMPLETED" &&
    actor.ability.can(
      "create",
      subject("ApprovalRequest", { createdBy: actor.userId }),
      "proposal.kind"
    ) &&
    actor.ability.can(
      "update",
      subject("SaleCase", saleAuth(row, actorNames)),
      "saleId"
    )
  ) {
    nextActions.push("requestApproval")
  }
  if ("nextActions" in result) result.nextActions = nextActions
  result.redactedFields = [
    ...new Set(result.redactedFields.filter((f) => f !== "createdBy")),
  ]
  return result
}

async function lockEntities(
  tx: Tx,
  locks: {
    vehicles?: string[]
    purchases?: string[]
    sales?: string[]
    approvals?: string[]
    customers?: string[]
  }
) {
  for (const vid of [...new Set(locks.vehicles ?? [])].sort())
    await tx.$queryRaw`SELECT id FROM vamotors."Vehicle" WHERE id=${vid}::uuid FOR UPDATE`
  for (const pid of [...new Set(locks.purchases ?? [])].sort())
    await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${pid}::uuid FOR UPDATE`
  for (const sid of [...new Set(locks.sales ?? [])].sort())
    await tx.$queryRaw`SELECT id FROM vamotors."SaleCase" WHERE id=${sid}::uuid FOR UPDATE`
  for (const aid of [...new Set(locks.approvals ?? [])].sort())
    await tx.$queryRaw`SELECT id FROM vamotors."ApprovalRequest" WHERE id=${aid}::uuid FOR UPDATE`
  for (const cid of [...new Set(locks.customers ?? [])].sort())
    await tx.$queryRaw`SELECT id FROM vamotors."Customer" WHERE id=${cid}::uuid FOR UPDATE`
}

async function assertTradeInEligibility(
  tx: Tx,
  actor: Actor,
  params: {
    intake: NonNullable<
      Extract<ImmediateSale, { kind: "TRADE_IN" }>["tradeIn"]["intake"]
    >
    expected: Dependency[]
    saleDate: string
    sourceVehicleId: string
  }
) {
  const { intake, expected, saleDate, sourceVehicleId } = params
  const engine = normalizeVehicleIdentity(intake.vehicle.engineNumber)
  const chassis = normalizeVehicleIdentity(intake.vehicle.chassisNumber)
  const existing = await tx.vehicle.findUnique({
    where: {
      normalizedEngine_normalizedChassis: {
        normalizedEngine: engine,
        normalizedChassis: chassis,
      },
    },
  })
  if (intake.mileage.date > colomboToday() || intake.mileage.date < saleDate)
    fail("INVALID_INPUT", 422)
  if (!existing) {
    requireFields(
      actor.ability,
      "Vehicle",
      "create",
      { createdBy: actor.userId, status: "PURCHASED" },
      Object.keys(intake.vehicle)
    )
    return { existingVehicle: null as null | typeof existing }
  }
  const cycles = await tx.purchaseRecord.findMany({
    where: { vehicleId: existing.id },
    include: { saleCompletion: true, mileage: true },
    orderBy: { cycleNumber: "asc" },
  })
  requireFields(
    actor.ability,
    "Vehicle",
    "read",
    {
      id: existing.id,
      revision: existing.revision,
      createdBy: existing.createdBy,
      status: cycles.at(-1)?.status,
    },
    ["id", "revision"]
  )
  requireRef(expected, {
    type: "Vehicle",
    id: existing.id,
    revision: existing.revision,
  })
  const conflict = () => {
    throw new CommandError("IDENTITY_CONFLICT", 409, false, [
      { type: "Vehicle", id: existing.id, revision: existing.revision },
    ])
  }
  if (existing.id === sourceVehicleId) conflict()
  if (cycles.some((c) => c.status === "WRITTEN_OFF"))
    throw new CommandError("IDENTITY_WRITTEN_OFF", 409, false, [
      { type: "Vehicle", id: existing.id, revision: existing.revision },
    ])
  if (
    existing.activePurchaseId !== null ||
    cycles.length === 0 ||
    cycles.some((c) => !c.closedAt || c.status !== "SOLD")
  )
    conflict()
  const matchesPhysical =
    existing.engineNumber === intake.vehicle.engineNumber &&
    existing.chassisNumber === intake.vehicle.chassisNumber &&
    existing.make === intake.vehicle.make &&
    existing.model === intake.vehicle.model &&
    existing.year === intake.vehicle.year &&
    existing.colour === intake.vehicle.colour &&
    existing.fuelType === intake.vehicle.fuelType &&
    existing.transmission === intake.vehicle.transmission &&
    existing.vin === (intake.vehicle.vin ?? null) &&
    existing.crNumber === (intake.vehicle.crNumber ?? null) &&
    existing.notes === (intake.vehicle.notes ?? null)
  if (!matchesPhysical) conflict()
  const maxSaleDate = cycles
    .map((c) => (c.saleCompletion ? formatDate(c.saleCompletion.saleDate) : ""))
    .filter(Boolean)
    .sort()
    .at(-1)
  if (!maxSaleDate || saleDate < maxSaleDate) fail("INVALID_INPUT", 422)
  return { existingVehicle: existing }
}

export function immediateCreateFields(input: ImmediateSale) {
  return [
    "cycleId",
    "customerId",
    "kind",
    "price",
    "date",
    "mileage",
    "method",
    ...(input.reference !== undefined ? ["reference"] : []),
    ...(input.reason !== undefined ? ["reason"] : []),
    ...(input.kind === "TRADE_IN"
      ? [
          "tradeIn.description",
          "tradeIn.value",
          ...(input.tradeIn.intake
            ? [
                "tradeIn.intake.vehicle",
                "tradeIn.intake.mileage",
                ...(input.tradeIn.intake.listedPrice !== undefined
                  ? ["tradeIn.intake.listedPrice"]
                  : []),
              ]
            : []),
        ]
      : []),
  ]
}

export async function completeImmediateInTx(
  tx: Tx,
  actor: Actor,
  params: {
    input: ImmediateSale
    expected: Dependency[]
    commandId: string
    sequence: bigint
    approvalId?: string
    reviewedAt?: Date
    initiatedBy?: string
    approverId?: string
    dryRunOnly?: boolean
    saleCaseId?: string
  }
) {
  const {
    input,
    expected,
    commandId,
    sequence,
    approvalId,
    reviewedAt,
    initiatedBy = actor.userId,
    approverId,
    dryRunOnly = false,
  } = params

  if (input.kind === "TRADE_IN" && input.tradeIn.intake) {
    const engine = normalizeVehicleIdentity(
      input.tradeIn.intake.vehicle.engineNumber
    )
    const chassis = normalizeVehicleIdentity(
      input.tradeIn.intake.vehicle.chassisNumber
    )
    for (const key of [`engine:${engine}`, `chassis:${chassis}`].sort())
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`
  }

  const planCycle = await tx.purchaseRecord.findUnique({
    where: { id: input.cycleId },
    select: { id: true, vehicleId: true },
  })
  if (!planCycle) fail("NOT_FOUND", 404)
  let preIntakeVehicleId: string | undefined
  if (input.kind === "TRADE_IN" && input.tradeIn.intake) {
    const pre = await tx.vehicle.findUnique({
      where: {
        normalizedEngine_normalizedChassis: {
          normalizedEngine: normalizeVehicleIdentity(
            input.tradeIn.intake.vehicle.engineNumber
          ),
          normalizedChassis: normalizeVehicleIdentity(
            input.tradeIn.intake.vehicle.chassisNumber
          ),
        },
      },
      select: { id: true },
    })
    preIntakeVehicleId = pre?.id
  }

  await lockEntities(tx, {
    vehicles: [planCycle.vehicleId, ...(preIntakeVehicleId ? [preIntakeVehicleId] : [])],
    purchases: [planCycle.id],
    customers: [input.customerId],
  })

  const row = await loadPurchase(tx, input.cycleId)
  if (!row) fail("NOT_FOUND", 404)
  const customer = await tx.customer.findUnique({
    where: { id: input.customerId },
  })
  if (!customer) fail("NOT_FOUND", 404)

  requireFields(actor.ability, "PurchaseRecord", "read", purchaseAuth(row), [
    "id",
    "revision",
    "vehicleId",
    "status",
    "available",
    "closedAt",
    "listedPrice",
    "purchasePrice",
    "financial.basis",
  ])
  requireFields(actor.ability, "Vehicle", "read", purchaseVehicleAuth(row), [
    "id",
    "identityRevision",
  ])
  requireFields(
    actor.ability,
    "Customer",
    "read",
    { ...customer, createdBy: customer.createdBy },
    ["id", "revision", "active"]
  )
  requireFields(
    actor.ability,
    "SaleCase",
    "create",
    { createdBy: initiatedBy, customerId: customer.id },
    immediateCreateFields(input)
  )
  if (input.kind === "TRADE_IN" && input.tradeIn.intake) {
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "create",
      { createdBy: actor.userId, status: "PURCHASED" },
      [
        "vehicle",
        "purchaseDate",
        "purchasePrice",
        "mileage",
        ...(input.tradeIn.intake.listedPrice !== undefined
          ? ["listedPrice"]
          : []),
      ]
    )
  }

  let intakeVehicleRef: Dependency | null = null
  if (input.kind === "TRADE_IN" && input.tradeIn.intake) {
    const check = await assertTradeInEligibility(tx, actor, {
      intake: input.tradeIn.intake,
      expected,
      saleDate: input.date,
      sourceVehicleId: row.vehicleId,
    })
    if (check.existingVehicle)
      intakeVehicleRef = {
        type: "Vehicle",
        id: check.existingVehicle.id,
        revision: check.existingVehicle.revision,
      }
  }

  requireRef(expected, {
    type: "PurchaseRecord",
    id: row.id,
    revision: row.revision,
  })
  requireRef(expected, {
    type: "Customer",
    id: customer.id,
    revision: customer.revision,
  })

  if (!customer.active) fail("INVALID_STATE")
  if (row.repairs.some((r) => !r.returnedDate)) fail("OBLIGATION_OPEN")
  if (
    !row.acquisitionCommandId ||
    row.closedAt ||
    row.vehicle.activePurchaseId !== row.id ||
    row.status !== "IN_STOCK" ||
    !row.available ||
    row.disposal ||
    row.sales.some((s) => s.state !== "CANCELLED")
  )
    fail("INVALID_STATE")
  const today = colomboToday()
  if (
    input.date > today ||
    input.date < formatDate(row.purchaseDate) ||
    (row.receivedDate && input.date < formatDate(row.receivedDate)) ||
    row.repairs.some(
      (r) => r.returnedDate && formatDate(r.returnedDate) > input.date
    )
  )
    fail("INVALID_INPUT", 422)

  const priorMileages = [...row.mileage].sort(
    (a, b) =>
      formatDate(a.recordedDate).localeCompare(formatDate(b.recordedDate)) ||
      a.id.localeCompare(b.id)
  )
  const beforeMileage = priorMileages
    .filter((m) => formatDate(m.recordedDate) <= input.date)
    .at(-1)
  const afterMileage = priorMileages.find(
    (m) => formatDate(m.recordedDate) > input.date
  )
  const mileageDecrease =
    Boolean(beforeMileage) && input.mileage < beforeMileage!.reading
  if (
    (mileageDecrease && !input.reason) ||
    (afterMileage && afterMileage.reading < input.mileage)
  )
    fail("INVALID_INPUT", 422)

  const agreedPrice = BigInt(input.price)
  if (agreedPrice <= 0n || agreedPrice > A) fail("INVALID_INPUT", 422)

  if (
    row.listedPrice !== null &&
    agreedPrice < row.listedPrice &&
    !approvalId &&
    !dryRunOnly
  )
    fail("APPROVAL_REQUIRED")

  let tradeInValue = 0n
  if (input.kind === "TRADE_IN") {
    tradeInValue = BigInt(input.tradeIn.value)
    if (tradeInValue <= 0n) fail("INVALID_INPUT", 422)
    if (tradeInValue > agreedPrice) fail("OVERALLOWANCE", 422)
  }
  const netCash = tradeInResidual(agreedPrice, tradeInValue)
  if (netCash > 0n)
    requireFields(
      actor.ability,
      "SaleCase",
      "pay",
      { createdBy: initiatedBy, customerId: customer.id },
      [
        "amount",
        "date",
        "method",
        ...(input.reference !== undefined ? ["reference"] : []),
      ]
    )

  const requiredDeps: Dependency[] = [
    { type: "PurchaseRecord", id: row.id, revision: row.revision },
    { type: "Customer", id: customer.id, revision: customer.revision },
    ...(intakeVehicleRef ? [intakeVehicleRef] : []),
  ]
  if (dryRunOnly) {
    const latestBasis = row.basisVersions.at(-1)!
    return {
      row,
      customer,
      requiredDeps,
      snapshot: {
        cycleId: row.id,
        vehicleId: row.vehicleId,
        customerId: customer.id,
        kind: input.kind,
        agreedPrice: agreedPrice.toString(),
        listedPrice: row.listedPrice?.toString() ?? null,
        basisVersionId: latestBasis.id,
        basis: latestBasis.total.toString(),
        currency: latestBasis.currency,
        scale: latestBasis.scale,
        ...(input.kind === "TRADE_IN"
          ? { tradeInValue: tradeInValue.toString() }
          : {}),
      },
    }
  }

  if (row.revision === 2147483647 || row.vehicle.revision === 2147483647)
    fail("REVISION_EXHAUSTED")

  const now = reviewedAt ?? new Date()
  const settings = await currentSettings(tx)
  const latestBasis = row.basisVersions.at(-1)!
  const originalProfit = agreedPrice - latestBasis.total
  const saleCaseId = params.saleCaseId ?? randomUUID()
  const completionId = randomUUID()
  const actionName = approvalId ? "approvedDiscount" : "completeImmediate"

  await tx.saleCase.create({
    data: {
      id: saleCaseId,
      purchaseRecordId: row.id,
      customerId: customer.id,
      kind: input.kind,
      agreedPrice,
      listedSnapshot: row.listedPrice,
      reference: input.reference ?? null,
      state: "COMPLETED",
      revision: 1,
      openedAt: now,
      createdBy: initiatedBy,
      commandId,
      approvalId: approvalId ?? null,
    },
  })
  await tx.saleCompletion.create({
    data: {
      id: completionId,
      saleCaseId,
      purchaseRecordId: row.id,
      saleDate: new Date(input.date),
      handoverMileage: input.mileage,
      agreedPrice,
      basisVersionId: latestBasis.id,
      originalProfit,
      snapshot: {
        kind: input.kind,
        agreedPrice: agreedPrice.toString(),
        listedPrice: row.listedPrice?.toString() ?? null,
        basis: latestBasis.total.toString(),
        customerId: customer.id,
        customerName: customer.fullName,
        vehicleId: row.vehicleId,
        ...(input.kind === "TRADE_IN"
          ? {
              tradeInDescription: input.tradeIn.description,
              tradeInValue: tradeInValue.toString(),
            }
          : {}),
      },
      approvalId: approvalId ?? null,
      createdBy: actor.userId,
      commandId,
    },
  })
  await tx.purchaseRecord.update({
    where: { id: row.id },
    data: {
      status: "SOLD",
      available: false,
      holdReason: null,
      closedAt: now,
      revision: { increment: 1 },
    },
  })
  await tx.vehicle.update({
    where: { id: row.vehicleId },
    data: { activePurchaseId: null, revision: { increment: 1 } },
  })
  await tx.statusEvent.create({
    data: {
      cycleId: row.id,
      from: "IN_STOCK",
      to: "SOLD",
      action: actionName,
      commandId,
      userId: actor.userId,
      occurredAt: new Date(input.date),
    },
  })
  await tx.mileageReading.create({
    data: {
      vehicleId: row.vehicleId,
      cycleId: row.id,
      reading: input.mileage,
      recordedDate: new Date(input.date),
      remark: "Handover odometer reading",
      ...(mileageDecrease ? { decreaseReason: input.reason } : {}),
      sourceSaleCompletionId: completionId,
      commandId,
    },
  })
  if (netCash > 0n) {
    await tx.saleReceipt.create({
      data: {
        saleCaseId,
        purchaseRecordId: row.id,
        amount: netCash,
        direction: "IN",
        category: "SALE",
        occurredDate: new Date(input.date),
        method: input.method,
        currency: settings.currency,
        scale: settings.scale,
        reference: input.reference ?? null,
        createdBy: actor.userId,
        commandId,
        lineKey: "sale",
      },
    })
  }
  let acquiredCycle: {
    cycleId: string
    vehicleId: string
    vehicleRevision: number
  } | null = null
  if (input.kind === "TRADE_IN") {
    const tradeInRow = await tx.tradeInConsideration.create({
      data: {
        id: randomUUID(),
        saleCaseId,
        purchaseRecordId: row.id,
        customerId: customer.id,
        description: input.tradeIn.description,
        value: tradeInValue,
      },
    })
    if (input.tradeIn.intake) {
      const settingsRow = await tx.settings.findUniqueOrThrow({
        where: { id: settings.id },
      })
      const acquiredId = randomUUID()
      const intakeResult = await acquireVehicleCycle(tx, actor, {
        cycleId: acquiredId,
        vehicle: input.tradeIn.intake.vehicle,
        expected,
        acquisitionKind: "TRADE_IN",
        purchaseType: "CASH",
        supplierId: null,
        sellerCustomerId: customer.id,
        tradeInSourceSaleId: saleCaseId,
        sourceVehicleIdToExclude: row.vehicleId,
        purchaseDate: input.date,
        purchasePrice: tradeInValue,
        listedPrice: input.tradeIn.intake.listedPrice,
        mileage: input.tradeIn.intake.mileage,
        commandId,
        sequence,
        action: approvalId ? "reviewApproval" : "completeImmediate",
        initiatedBy,
        approverId,
        settings: {
          currentVersionId: settingsRow.currentVersionId,
          currency: settings.currency,
          scale: settings.scale,
        },
        skipIdentityLock: true,
      })
      await tx.tradeInConsideration.update({
        where: { id: tradeInRow.id },
        data: {
          acquiredVehicleId: intakeResult.vehicleId,
          acquiredPurchaseId: intakeResult.cycleId,
          intakeCommandId: commandId,
        },
      })
      acquiredCycle = {
        cycleId: intakeResult.cycleId,
        vehicleId: intakeResult.vehicleId,
        vehicleRevision: intakeResult.vehicleRevision,
      }
    }
  }

  const afterPurchase = (await loadPurchase(tx, row.id))!
  const afterSale = (await loadSale(tx, saleCaseId))!
  const actorNames = await resolveActorNames(tx, [afterSale])
  const afterSaleDto = saleDTO(afterSale, actorNames)

  for (const [entityType, entityId, rev, before, after] of [
    ["PurchaseRecord", row.id, afterPurchase.revision, purchaseDTO(row), purchaseDTO(afterPurchase)],
    ["Vehicle", row.vehicleId, afterPurchase.vehicle.revision, vehicleDTO(row), vehicleDTO(afterPurchase)],
    ["SaleCase", saleCaseId, 1, null, afterSaleDto],
  ] as const) {
    await audit(tx, {
      commandId,
      userId: actor.userId,
      initiatedBy,
      ...(approverId ? { approverId } : {}),
      entityType,
      entityId,
      action: actionName,
      ...(input.reason ? { reason: input.reason } : {}),
      before,
      after,
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType,
      entityId,
      revision: rev,
      payload: after,
    })
  }
  const completionAfter = {
    id: completionId,
    saleCaseId,
    purchaseRecordId: row.id,
    date: input.date,
    handoverMileage: input.mileage,
    agreedPrice: agreedPrice.toString(),
    basisVersionId: latestBasis.id,
    originalProfit: originalProfit.toString(),
  }
  await audit(tx, {
    commandId,
    userId: actor.userId,
    initiatedBy,
    ...(approverId ? { approverId } : {}),
    entityType: "SaleCompletion",
    entityId: completionId,
    action: actionName,
    ...(input.reason ? { reason: input.reason } : {}),
    before: null,
    after: completionAfter,
  })
  await writeReadVersion(tx, {
    commandId,
    sequence,
    entityType: "SaleCompletion",
    entityId: completionId,
    revision: 1,
    payload: completionAfter,
  })

  return {
    saleId: saleCaseId,
    saleRevision: 1,
    affected: [
      { type: "SaleCase" as const, id: saleCaseId, revision: 1 },
      { type: "PurchaseRecord" as const, id: row.id, revision: afterPurchase.revision },
      { type: "Vehicle" as const, id: row.vehicleId, revision: afterPurchase.vehicle.revision },
      ...(acquiredCycle
        ? [
            { type: "PurchaseRecord" as const, id: acquiredCycle.cycleId, revision: 1 },
            { type: "Vehicle" as const, id: acquiredCycle.vehicleId, revision: acquiredCycle.vehicleRevision },
          ]
        : []),
    ] as Dependency[],
  }
}

export async function saleReplay(
  tx: Tx,
  actor: Actor,
  receipt: { id: string; commandName: string; result: Prisma.JsonValue }
): Promise<Applied> {
  const result = receipt.result as Applied["result"]
  if (result.type !== "SaleCase") fail("INTERNAL_ERROR", 500)
  const sale = await loadSale(tx, result.id)
  if (!sale) fail("NOT_FOUND", 404)
  const names = await resolveActorNames(tx, [sale])
  const cycle = sale.purchaseRecord
  requireFields(actor.ability, "SaleCase", "read", saleAuth(sale, names), [
    "id",
    "revision",
  ])
  requireFields(actor.ability, "PurchaseRecord", "read", purchaseAuth(cycle), [
    "id",
    "revision",
  ])
  requireFields(actor.ability, "Vehicle", "read", purchaseVehicleAuth(cycle), [
    "id",
    "identityRevision",
  ])
  if (receipt.commandName === "completeImmediate") {
    requireFields(
      actor.ability,
      "SaleCase",
      "create",
      saleAuth(sale, names),
      ["cycleId", "customerId", "kind", "price", "date", "mileage", "method"]
    )
  } else if (receipt.commandName === "intakeTradeIn") {
    requireFields(
      actor.ability,
      "SaleCase",
      "update",
      saleAuth(sale, names),
      ["vehicle", "mileage"]
    )
    const seller = await tx.customer.findUnique({
      where: { id: sale.customerId },
      select: { id: true, active: true, createdBy: true },
    })
    if (!seller) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "Customer", "read", seller, ["id", "active"])
  }
  const acq =
    sale.tradeIn?.intakeCommandId === receipt.id && sale.tradeIn.acquiredPurchaseId
      ? await loadPurchase(tx, sale.tradeIn.acquiredPurchaseId)
      : null
  if (acq) {
    requireFields(actor.ability, "PurchaseRecord", "read", purchaseAuth(acq), [
      "id",
      "revision",
    ])
    requireFields(actor.ability, "Vehicle", "read", purchaseVehicleAuth(acq), [
      "id",
      "identityRevision",
    ])
  }
  return {
    ok: true,
    status: "APPLIED",
    commandId: receipt.id,
    replayed: true,
    result,
    affected: [
      { type: "SaleCase", id: sale.id, revision: sale.revision },
      { type: "PurchaseRecord", id: cycle.id, revision: cycle.revision },
      { type: "Vehicle", id: cycle.vehicleId, revision: cycle.vehicle.revision },
      ...(acq
        ? [
            { type: "PurchaseRecord" as const, id: acq.id, revision: acq.revision },
            { type: "Vehicle" as const, id: acq.vehicleId, revision: acq.vehicle.revision },
          ]
        : []),
    ],
    invalidate: ["sales", "purchases", "inventory", "customers", "reports", "dashboard"],
  }
}

export async function executeSale(
  identity: Identity,
  name: SaleCommand,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  checkMoneyInput(raw)
  const parsed = saleEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)

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
    if (prior) {
      const replay = await saleReplay(tx, actor, prior)
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return replay
    }

    if (name === "completeImmediate") {
      const input = saleInputs.completeImmediate.parse(envelope.input)
      const commandId = randomUUID()
      const sequence = await nextBusinessSequence(tx)
      const saleId = randomUUID()
      await tx.commandReceipt.create({
        data: {
          id: commandId,
          ...scope,
          inputHash: digest,
          result: { type: "SaleCase", id: saleId, revision: 1 },
          businessSequence: sequence,
        },
      })
      const done = await completeImmediateInTx(tx, actor, {
        input,
        expected: envelope.expected,
        commandId,
        sequence,
        saleCaseId: saleId,
      })
      return {
        ok: true as const,
        status: "APPLIED" as const,
        commandId,
        replayed: false,
        result: { type: "SaleCase" as const, id: saleId, revision: 1 },
        affected: done.affected ?? [],
        invalidate: ["sales", "purchases", "inventory", "customers", "reports", "dashboard"],
      }
    }

    // intakeTradeIn
    const input = saleInputs.intakeTradeIn.parse(envelope.input)
    const engine = normalizeVehicleIdentity(input.vehicle.engineNumber)
    const chassis = normalizeVehicleIdentity(input.vehicle.chassisNumber)
    for (const key of [`engine:${engine}`, `chassis:${chassis}`].sort())
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`

    const planSale = await tx.saleCase.findUnique({
      where: { id: input.saleId },
      select: { id: true, purchaseRecordId: true, purchaseRecord: { select: { vehicleId: true } } },
    })
    if (!planSale) fail("NOT_FOUND", 404)
    const preIntakeVehicle = await tx.vehicle.findUnique({
      where: { normalizedEngine_normalizedChassis: { normalizedEngine: engine, normalizedChassis: chassis } },
      select: { id: true },
    })
    await lockEntities(tx, {
      vehicles: [planSale.purchaseRecord.vehicleId, ...(preIntakeVehicle ? [preIntakeVehicle.id] : [])],
      purchases: [planSale.purchaseRecordId],
      sales: [planSale.id],
    })
    const sale = await loadSale(tx, input.saleId)
    if (!sale) fail("NOT_FOUND", 404)
    const cycle = sale.purchaseRecord
    const seller = await tx.customer.findUnique({
      where: { id: sale.customerId },
    })
    if (!seller) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "Customer", "read", seller, ["id", "active"])
    const names = await resolveActorNames(tx, [sale])
    requireFields(actor.ability, "SaleCase", "read", saleAuth(sale, names), [
      "id",
      "revision",
      "kind",
      "state",
      "tradeIn.value",
      "completion.date",
    ])
    requireFields(actor.ability, "SaleCase", "update", saleAuth(sale, names), [
      "vehicle",
      "mileage",
      ...(input.listedPrice !== undefined ? ["listedPrice"] : []),
    ])
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "read",
      purchaseAuth(cycle),
      ["id", "revision", "vehicleId"]
    )
    requireFields(
      actor.ability,
      "Vehicle",
      "read",
      purchaseVehicleAuth(cycle),
      ["id", "identityRevision"]
    )
    requireFields(
      actor.ability,
      "PurchaseRecord",
      "create",
      { createdBy: actor.userId, status: "PURCHASED" },
      [
        "vehicle",
        "purchaseDate",
        "purchasePrice",
        "mileage",
        ...(input.listedPrice !== undefined ? ["listedPrice"] : []),
      ]
    )

    if (
      sale.kind !== "TRADE_IN" ||
      sale.state !== "COMPLETED" ||
      !sale.tradeIn ||
      !sale.completion ||
      sale.tradeIn.acquiredPurchaseId !== null
    )
      fail("INVALID_STATE")
    const saleDate = formatDate(sale.completion.saleDate)
    const check = await assertTradeInEligibility(tx, actor, {
      intake: {
        vehicle: input.vehicle,
        mileage: input.mileage,
        ...(input.listedPrice !== undefined ? { listedPrice: input.listedPrice } : {}),
      },
      expected: envelope.expected,
      saleDate,
      sourceVehicleId: cycle.vehicleId,
    })
    requireRef(envelope.expected, {
      type: "SaleCase",
      id: sale.id,
      revision: sale.revision,
    })
    requireRef(envelope.expected, {
      type: "PurchaseRecord",
      id: cycle.id,
      revision: cycle.revision,
    })
    void check
    if (sale.revision === 2147483647 || cycle.revision === 2147483647)
      fail("REVISION_EXHAUSTED")

    const settings = await currentSettings(tx)
    const settingsRow = await tx.settings.findUniqueOrThrow({
      where: { id: settings.id },
    })
    const commandId = randomUUID()
    const sequence = await nextBusinessSequence(tx)
    const acquiredId = randomUUID()
    const nextSaleRevision = sale.revision + 1
    const result = {
      type: "SaleCase" as const,
      id: sale.id,
      revision: nextSaleRevision,
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
    const intakeResult = await acquireVehicleCycle(tx, actor, {
      cycleId: acquiredId,
      vehicle: input.vehicle,
      expected: envelope.expected,
      acquisitionKind: "TRADE_IN",
      purchaseType: "CASH",
      supplierId: null,
      sellerCustomerId: sale.customerId,
      tradeInSourceSaleId: sale.id,
      sourceVehicleIdToExclude: cycle.vehicleId,
      purchaseDate: saleDate,
      purchasePrice: sale.tradeIn.value,
      listedPrice: input.listedPrice,
      mileage: input.mileage,
      commandId,
      sequence,
      action: "intakeTradeIn",
      settings: {
        currentVersionId: settingsRow.currentVersionId,
        currency: settings.currency,
        scale: settings.scale,
      },
      skipIdentityLock: true,
    })
    await tx.tradeInConsideration.update({
      where: { id: sale.tradeIn.id },
      data: {
        acquiredVehicleId: intakeResult.vehicleId,
        acquiredPurchaseId: intakeResult.cycleId,
        intakeCommandId: commandId,
      },
    })
    const beforeCycle = purchaseDTO(cycle)
    await tx.purchaseRecord.update({
      where: { id: cycle.id },
      data: { revision: { increment: 1 } },
    })
    await tx.saleCase.update({
      where: { id: sale.id },
      data: { revision: { increment: 1 } },
    })
    const afterCycle = (await loadPurchase(tx, cycle.id))!
    await audit(tx, {
      commandId,
      userId: actor.userId,
      entityType: "PurchaseRecord",
      entityId: cycle.id,
      action: "intakeTradeIn",
      before: beforeCycle,
      after: purchaseDTO(afterCycle),
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "PurchaseRecord",
      entityId: cycle.id,
      revision: afterCycle.revision,
      payload: purchaseDTO(afterCycle),
    })
    const afterSale = (await loadSale(tx, sale.id))!
    const afterNames = await resolveActorNames(tx, [afterSale])
    const beforeDto = saleDTO(sale, names)
    const afterDto = saleDTO(afterSale, afterNames)
    await audit(tx, {
      commandId,
      userId: actor.userId,
      entityType: "SaleCase",
      entityId: sale.id,
      action: "intakeTradeIn",
      before: beforeDto,
      after: afterDto,
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "SaleCase",
      entityId: sale.id,
      revision: nextSaleRevision,
      payload: afterDto,
    })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [
        result,
        {
          type: "PurchaseRecord",
          id: cycle.id,
          revision: afterCycle.revision,
        },
        { type: "PurchaseRecord", id: intakeResult.cycleId, revision: 1 },
        {
          type: "Vehicle",
          id: intakeResult.vehicleId,
          revision: intakeResult.vehicleRevision,
        },
      ],
      invalidate: ["sales", "purchases", "inventory", "customers", "reports", "dashboard"],
    }
  })
}

export async function prepareDiscountApproval(
  tx: Tx,
  actor: Actor,
  commandInput: ImmediateSale,
  expected: Dependency[]
) {
  const dry = await completeImmediateInTx(tx, actor, {
    input: commandInput,
    expected,
    commandId: randomUUID(),
    sequence: 0n,
    dryRunOnly: true,
  })
  if (!dry.row || !dry.requiredDeps) fail("INTERNAL_ERROR", 500)
  if (dry.row.listedPrice === null) fail("INVALID_STATE")
  if (BigInt(commandInput.price) >= dry.row.listedPrice)
    fail("INVALID_INPUT", 422)
  return {
    cycle: dry.row,
    saleCaseId: null as string | null,
    expectedDeps: dry.requiredDeps,
    snapshot: dry.snapshot!,
  }
}

export async function prepareSaleEditApproval(
  tx: Tx,
  actor: Actor,
  input: SaleEdit,
  expected: Dependency[],
  lock = true
) {
  const plan = await tx.saleCase.findUnique({
    where: { id: input.saleId },
    select: {
      id: true,
      purchaseRecordId: true,
      customerId: true,
      purchaseRecord: { select: { vehicleId: true } },
      tradeIn: {
        select: {
          acquiredPurchaseId: true,
          acquiredVehicleId: true,
          value: true,
        },
      },
    },
  })
  if (!plan) fail("NOT_FOUND", 404)
  if (lock) {
    await lockEntities(tx, {
      vehicles: [
        plan.purchaseRecord.vehicleId,
        ...(plan.tradeIn?.acquiredVehicleId ? [plan.tradeIn.acquiredVehicleId] : []),
      ],
      purchases: [
        plan.purchaseRecordId,
        ...(plan.tradeIn?.acquiredPurchaseId ? [plan.tradeIn.acquiredPurchaseId] : []),
      ],
      sales: [plan.id],
      customers: [
        plan.customerId,
        ...(input.patch.customerId ? [input.patch.customerId] : []),
      ],
    })
  }
  const sale = await loadSale(tx, input.saleId)
  if (!sale || !sale.completion) fail("NOT_FOUND", 404)
  const names = await resolveActorNames(tx, [sale])
  const cycle = sale.purchaseRecord
  requireFields(actor.ability, "SaleCase", "read", saleAuth(sale, names), [
    "id",
    "revision",
    "cycleId",
    "customerId",
    "kind",
    "state",
    "price",
    "payments.id",
    "payments.amount",
    "payments.direction",
  ])
  requireFields(actor.ability, "PurchaseRecord", "read", purchaseAuth(cycle), [
    "id",
    "revision",
    "vehicleId",
    "status",
    "closedAt",
  ])
  requireFields(actor.ability, "Vehicle", "read", purchaseVehicleAuth(cycle), [
    "id",
    "identityRevision",
  ])

  const patchKeys = Object.entries(input.patch)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => (k === "tradeIn" ? "patch.tradeIn" : `patch.${k}`))
  requireFields(actor.ability, "SaleCase", "update", saleAuth(sale, names), [
    "saleId",
    "reason",
    ...patchKeys,
    ...(input.cashCorrections.length ? ["cashCorrections"] : []),
  ])

  if (sale.state !== "COMPLETED" || cycle.status !== "SOLD") fail("INVALID_STATE")
  if (input.patch.tradeIn && sale.kind !== "TRADE_IN") fail("INVALID_INPUT", 422)

  let nextCustomer: { id: string; revision: number; active: boolean; fullName: string } | null = null
  if (input.patch.customerId) {
    const cu = await tx.customer.findUnique({ where: { id: input.patch.customerId } })
    if (!cu) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "Customer", "read", cu, ["id", "revision", "active"])
    if (!cu.active) fail("INVALID_STATE")
    nextCustomer = cu
  }

  const nextPrice = input.patch.price ? BigInt(input.patch.price) : sale.agreedPrice
  if (nextPrice <= 0n || nextPrice > A) fail("INVALID_INPUT", 422)
  const nextTradeInVal = input.patch.tradeIn
    ? BigInt(input.patch.tradeIn.value)
    : sale.tradeIn?.value ?? 0n
  if (sale.kind === "TRADE_IN" && (nextTradeInVal <= 0n || nextTradeInVal > nextPrice))
    fail("OVERALLOWANCE", 422)

  const tradeInValueChanged =
    Boolean(input.patch.tradeIn) && nextTradeInVal !== sale.tradeIn?.value
  const customerChanged =
    Boolean(input.patch.customerId) && input.patch.customerId !== sale.customerId

  if (
    tradeInValueChanged &&
    sale.tradeIn?.acquiredPurchase &&
    sale.tradeIn.acquiredPurchase.closedAt !== null
  )
    fail("OBLIGATION_OPEN")

  const saleDateStr = input.patch.saleDate ?? formatDate(sale.completion.saleDate)
  const today = colomboToday()
  if (saleDateStr > today || saleDateStr < formatDate(cycle.purchaseDate))
    fail("INVALID_INPUT", 422)
  const nextCycle = await tx.purchaseRecord.findFirst({
    where: { vehicleId: cycle.vehicleId, cycleNumber: { gt: cycle.cycleNumber } },
    orderBy: { cycleNumber: "asc" },
    select: { purchaseDate: true },
  })
  if (nextCycle && saleDateStr > formatDate(nextCycle.purchaseDate))
    fail("INVALID_INPUT", 422)

  if (input.patch.handoverMileage !== undefined) {
    const prior = cycle.mileage
      .filter((m) => m.sourceSaleCompletionId !== sale.completion!.id)
      .sort(
        (a, b) =>
          formatDate(a.recordedDate).localeCompare(formatDate(b.recordedDate)) ||
          a.id.localeCompare(b.id)
      )
    const before = prior.filter((m) => formatDate(m.recordedDate) <= saleDateStr).at(-1)
    if (before && input.patch.handoverMileage < before.reading)
      fail("INVALID_INPUT", 422)
  }

  // Validate cashCorrections against unreversed sale receipts
  const seenPaymentIds = new Set<string>()
  let cashDelta = 0n
  for (const corr of input.cashCorrections) {
    if (seenPaymentIds.has(corr.paymentId)) fail("INVALID_INPUT", 422)
    seenPaymentIds.add(corr.paymentId)
    const target = sale.receipts.find((r) => r.id === corr.paymentId)
    if (!target) fail("NOT_FOUND", 404)
    if (
      target.reversalOf !== null ||
      sale.receipts.some((r) => r.reversalOf === target.id)
    )
      fail("INVALID_STATE")
    if (corr.replacement) {
      if (
        corr.replacement.date > today ||
        corr.replacement.date < formatDate(cycle.purchaseDate)
      )
        fail("INVALID_INPUT", 422)
      const repAmt = BigInt(corr.replacement.amount)
      cashDelta +=
        target.direction === "IN"
          ? repAmt - target.amount
          : -(repAmt - target.amount)
    } else {
      cashDelta += target.direction === "IN" ? -target.amount : target.amount
    }
  }
  const currentNet = sale.receipts.reduce(
    (acc, r) => acc + (r.direction === "IN" ? r.amount : -r.amount),
    0n
  )
  const projectedNet = currentNet + cashDelta
  if (
    projectedNet < 0n ||
    projectedNet !== nextPrice - nextTradeInVal
  )
    fail("BALANCE_MISMATCH", 422)

  const acquiredRef =
    sale.tradeIn?.acquiredPurchase && (tradeInValueChanged || customerChanged)
      ? [
          {
            type: "PurchaseRecord" as const,
            id: sale.tradeIn.acquiredPurchase.id,
            revision: sale.tradeIn.acquiredPurchase.revision,
          },
          ...(sale.tradeIn.acquiredVehicle
            ? [
                {
                  type: "Vehicle" as const,
                  id: sale.tradeIn.acquiredVehicle.id,
                  revision: sale.tradeIn.acquiredVehicle.revision,
                },
              ]
            : []),
        ]
      : []
  const deps: Dependency[] = [
    { type: "SaleCase", id: sale.id, revision: sale.revision },
    { type: "PurchaseRecord", id: cycle.id, revision: cycle.revision },
    ...(nextCustomer
      ? [{ type: "Customer" as const, id: nextCustomer.id, revision: nextCustomer.revision }]
      : []),
    ...acquiredRef,
  ]
  for (const ref of deps) requireRef(expected, ref)
  if (expected.length !== deps.length) fail("INVALID_INPUT", 422)

  const basis = cycle.basisVersions.at(-1)!
  return {
    sale,
    cycle,
    deps,
    snapshot: {
      saleId: sale.id,
      cycleId: cycle.id,
      vehicleId: cycle.vehicleId,
      agreedPrice: sale.agreedPrice.toString(),
      customerId: sale.customerId,
      saleDate: formatDate(sale.completion.saleDate),
      handoverMileage: sale.completion.handoverMileage,
      basisVersionId: basis.id,
      basis: basis.total.toString(),
      ...(sale.tradeIn
        ? {
            tradeInDescription: sale.tradeIn.description,
            tradeInValue: sale.tradeIn.value.toString(),
            ...(sale.tradeIn.acquiredPurchaseId
              ? { acquiredCycleId: sale.tradeIn.acquiredPurchaseId }
              : {}),
          }
        : {}),
    },
  }
}

export async function applySaleEditApproval(
  tx: Tx,
  actor: Actor,
  params: {
    saleId: string
    input: SaleEdit
    commandId: string
    sequence: bigint
    approvalId: string
    initiatedBy: string
  }
) {
  const { saleId, input, commandId, sequence, approvalId, initiatedBy } = params
  const sale = (await loadSale(tx, saleId))!
  const cycle = sale.purchaseRecord
  const names = await resolveActorNames(tx, [sale])
  const beforeSale = saleDTO(sale, names)
  const beforePurchase = purchaseDTO(cycle)
  const beforeVehicle = vehicleDTO(cycle)

  if (sale.revision === 2147483647 || cycle.revision === 2147483647)
    fail("REVISION_EXHAUSTED")

  const nextCustomerId = input.patch.customerId ?? sale.customerId
  const nextPrice = input.patch.price ? BigInt(input.patch.price) : sale.agreedPrice
  const nextReference =
    input.patch.reference !== undefined ? input.patch.reference : sale.reference
  const nextNotes =
    input.patch.notes !== undefined ? input.patch.notes : sale.notes

  await tx.saleCase.update({
    where: { id: sale.id },
    data: {
      customerId: nextCustomerId,
      agreedPrice: nextPrice,
      reference: nextReference,
      notes: nextNotes,
      revision: { increment: 1 },
    },
  })

  const latestBasis = cycle.basisVersions.at(-1)!
  const priorVersionId = sale.corrections.at(-1)?.id ?? null

  await tx.saleCorrection.create({
    data: {
      completionId: sale.completion!.id,
      saleCaseId: sale.id,
      purchaseRecordId: cycle.id,
      version: sale.corrections.length + 1,
      patch: input.patch,
      reason: input.reason,
      approvalId,
      correctedSnapshot: {
        customerId: nextCustomerId,
        agreedPrice: nextPrice.toString(),
        reference: nextReference,
        notes: nextNotes,
        saleDate: input.patch.saleDate ?? formatDate(sale.completion!.saleDate),
        handoverMileage:
          input.patch.handoverMileage ?? sale.completion!.handoverMileage,
        ...(sale.tradeIn
          ? {
              tradeInDescription:
                input.patch.tradeIn?.description ?? sale.tradeIn.description,
              tradeInValue: (
                input.patch.tradeIn
                  ? BigInt(input.patch.tradeIn.value)
                  : sale.tradeIn.value
              ).toString(),
            }
          : {}),
      },
      basisVersionId: latestBasis.id,
      priorVersionId,
      restatedProfit: nextPrice - latestBasis.total,
      createdBy: actor.userId,
      commandId,
    },
  })

  let acquiredRowBefore: Awaited<ReturnType<typeof loadPurchase>> = null
  if (sale.tradeIn && (input.patch.tradeIn || input.patch.customerId)) {
    const nextDesc = input.patch.tradeIn?.description ?? sale.tradeIn.description
    const nextVal = input.patch.tradeIn
      ? BigInt(input.patch.tradeIn.value)
      : sale.tradeIn.value
    const valueChanged = nextVal !== sale.tradeIn.value
    await tx.tradeInConsideration.update({
      where: { id: sale.tradeIn.id },
      data: {
        customerId: nextCustomerId,
        description: nextDesc,
        value: nextVal,
      },
    })
    if (
      sale.tradeIn.acquiredPurchaseId &&
      (valueChanged || nextCustomerId !== sale.customerId)
    ) {
      acquiredRowBefore = await loadPurchase(tx, sale.tradeIn.acquiredPurchaseId)
      if (!acquiredRowBefore) fail("NOT_FOUND", 404)
      if (valueChanged && acquiredRowBefore.closedAt !== null)
        fail("OBLIGATION_OPEN")
      if (acquiredRowBefore.revision === 2147483647) fail("REVISION_EXHAUSTED")
      await tx.purchaseRecord.update({
        where: { id: acquiredRowBefore.id },
        data: {
          sellerCustomerId: nextCustomerId,
          ...(valueChanged ? { purchasePrice: nextVal } : {}),
          revision: { increment: 1 },
        },
      })
      if (valueChanged) {
        const acqBasis = acquiredRowBefore.basisVersions.at(-1)!
        const repairs = acquiredRowBefore.repairs.reduce(
          (acc, r) => acc + (r.invoiceAmount ?? 0n),
          0n
        )
        const costs = acquiredRowBefore.costs.reduce((acc, c) => acc + c.amount, 0n)
        const nextTotal = nextVal + repairs + costs
        if (nextTotal > C) fail("MONEY_OVERFLOW", 422)
        await tx.cycleBasisVersion.create({
          data: {
            cycleId: acquiredRowBefore.id,
            commandId,
            version: acqBasis.version + 1,
            purchase: nextVal,
            total: nextTotal,
            currency: acqBasis.currency,
            scale: acqBasis.scale,
            reason: input.reason,
            supersedesId: acqBasis.id,
            components: {
              purchase: nextVal.toString(),
              repairs: acquiredRowBefore.repairs
                .filter((r) => r.returnedDate)
                .map((r) => ({ id: r.id, amount: r.invoiceAmount!.toString() }))
                .sort((a, b) => a.id.localeCompare(b.id)),
              costs: acquiredRowBefore.costs.map((c) => ({
                id: c.id,
                amount: c.amount.toString(),
              })),
            },
          },
        })
      }
    }
  }

  for (let i = 0; i < input.cashCorrections.length; i++) {
    const corr = input.cashCorrections[i]
    const orig = sale.receipts.find((r) => r.id === corr.paymentId)!
    await tx.saleReceipt.create({
      data: {
        saleCaseId: sale.id,
        purchaseRecordId: cycle.id,
        amount: orig.amount,
        direction: orig.direction === "IN" ? "OUT" : "IN",
        category: "SALE",
        occurredDate: orig.occurredDate,
        method: orig.method,
        currency: orig.currency,
        scale: orig.scale,
        reference: orig.reference,
        reversalOf: orig.id,
        reason: corr.reason,
        createdBy: actor.userId,
        commandId,
        lineKey: `rev:${i}`,
      },
    })
    if (corr.replacement) {
      await tx.saleReceipt.create({
        data: {
          saleCaseId: sale.id,
          purchaseRecordId: cycle.id,
          amount: BigInt(corr.replacement.amount),
          direction: orig.direction,
          category: "SALE",
          occurredDate: new Date(corr.replacement.date),
          method: corr.replacement.method,
          currency: orig.currency,
          scale: orig.scale,
          reference: corr.replacement.reference ?? null,
          createdBy: actor.userId,
          commandId,
          lineKey: `rep:${i}`,
        },
      })
    }
  }

  await tx.purchaseRecord.update({
    where: { id: cycle.id },
    data: { revision: { increment: 1 } },
  })

  const afterSale = (await loadSale(tx, sale.id))!
  const afterCycle = afterSale.purchaseRecord
  const afterNames = await resolveActorNames(tx, [afterSale])
  const afterSaleDto = saleDTO(afterSale, afterNames)

  for (const [entityType, entityId, rev, before, after] of [
    ["SaleCase", sale.id, afterSale.revision, beforeSale, afterSaleDto],
    ["PurchaseRecord", cycle.id, afterCycle.revision, beforePurchase, purchaseDTO(afterCycle)],
    ["Vehicle", cycle.vehicleId, afterCycle.vehicle.revision, beforeVehicle, vehicleDTO(afterCycle)],
  ] as const) {
    await audit(tx, {
      commandId,
      userId: actor.userId,
      initiatedBy,
      approverId: actor.userId,
      entityType,
      entityId,
      action: "approvedSaleEdit",
      reason: input.reason,
      before,
      after,
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType,
      entityId,
      revision: rev,
      payload: after,
    })
  }

  const affected: Dependency[] = [
    { type: "SaleCase", id: sale.id, revision: afterSale.revision },
    { type: "PurchaseRecord", id: cycle.id, revision: afterCycle.revision },
  ]
  if (acquiredRowBefore) {
    const acqAfter = (await loadPurchase(tx, acquiredRowBefore.id))!
    await audit(tx, {
      commandId,
      userId: actor.userId,
      initiatedBy,
      approverId: actor.userId,
      entityType: "PurchaseRecord",
      entityId: acqAfter.id,
      action: "approvedSaleEdit",
      reason: input.reason,
      before: purchaseDTO(acquiredRowBefore),
      after: purchaseDTO(acqAfter),
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "PurchaseRecord",
      entityId: acqAfter.id,
      revision: acqAfter.revision,
      payload: purchaseDTO(acqAfter),
    })
    await audit(tx, {
      commandId,
      userId: actor.userId,
      initiatedBy,
      approverId: actor.userId,
      entityType: "Vehicle",
      entityId: acqAfter.vehicleId,
      action: "approvedSaleEdit",
      reason: input.reason,
      before: vehicleDTO(acquiredRowBefore),
      after: vehicleDTO(acqAfter),
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "Vehicle",
      entityId: acqAfter.vehicleId,
      revision: acqAfter.vehicle.revision,
      payload: vehicleDTO(acqAfter),
    })
    affected.push({
      type: "PurchaseRecord",
      id: acqAfter.id,
      revision: acqAfter.revision,
    })
  }

  return { affected }
}

export async function authenticatedSaleDetail(headers: Headers, saleId: string) {
  const identity = await authenticate(headers)
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      if (!id.safeParse(saleId).success) fail("NOT_FOUND", 404)
      const sale = await loadSale(tx, saleId)
      if (!sale) fail("NOT_FOUND", 404)
      const names = await resolveActorNames(tx, [sale])
      return visibleSale(actor, sale, names)
    },
    { isolationLevel: "RepeatableRead" }
  )
}

export async function saleQuery(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  const parsed = z.object({ id }).strict().safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const sale = await loadSale(tx, parsed.data.id)
  if (!sale) fail("NOT_FOUND", 404)
  const names = await resolveActorNames(tx, [sale])
  return visibleSale(actor, sale, names)
}

export async function saleAudit(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  const parsed = listParams
    .extend({ type: z.enum(["SaleCase", "SaleCompletion"]), id })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  let sale: SaleRow | null = null
  if (input.type === "SaleCase") sale = await loadSale(tx, input.id)
  else {
    const comp = await tx.saleCompletion.findUnique({
      where: { id: input.id },
      select: { saleCaseId: true },
    })
    if (comp) sale = await loadSale(tx, comp.saleCaseId)
  }
  if (!sale) fail("NOT_FOUND", 404)
  const names = await resolveActorNames(tx, [sale])
  const auth = saleAuth(sale, names)
  requireFields(actor.ability, "SaleCase", "read", auth, [
    input.type === "SaleCompletion" ? "completion.id" : "id",
  ])
  const saleSubject = subject("SaleCase", auth)
  const completionPaths: Record<string, string> = {
    id: "completion.id",
    saleCaseId: "id",
    purchaseRecordId: "cycleId",
    date: "completion.date",
    handoverMileage: "completion.mileage",
    agreedPrice: "price",
    basisVersionId: "completion.basisVersionId",
  }
  const canReadDiff = (path: string) => {
    if (input.type === "SaleCase")
      return actor.ability.can("read", saleSubject, path)
    if (path === "originalProfit")
      return actor.ability.can(
        "read",
        subject("PurchaseRecord", purchaseAuth(sale.purchaseRecord)),
        "financial.originalProfit"
      ) && actor.ability.can("read", saleSubject, "price")
    const field = completionPaths[path]
    return !!field && actor.ability.can("read", saleSubject, field)
  }
  const where = {
    AND: [
      { entityType: input.type, entityId: input.id },
      readScope(actor.grants, actor.userId, "AuditLog", ["id", "at"]),
    ],
  }
  const [rows, total] = await Promise.all([
    tx.auditEntry.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    }),
    tx.auditEntry.count({ where }),
  ])
  const actorUsers = await tx.user.findMany({
    where: { id: { in: rows.map((r) => r.userId).filter((u): u is string => !!u) } },
    select: { id: true, name: true },
  })
  const userMap = new Map(actorUsers.map((u) => [u.id, u.name]))
  const data = rows.map((entry) => {
    const fields = Object.entries(
      (entry.fieldDiff ?? {}) as Record<string, { before: unknown; after: unknown }>
    )
      .filter(([path]) => canReadDiff(path))
      .map(([path, change]) => ({
        path,
        before: change.before,
        after: change.after,
      }))
    return project(actor.ability, "AuditLog", {
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      at: entry.recordedAt.toISOString(),
      actor: {
        kind: entry.actorKind,
        ...(entry.userId ? { userId: entry.userId, name: userMap.get(entry.userId) } : {}),
      },
      ...(entry.reason ? { reason: entry.reason } : {}),
      fields,
    })
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
