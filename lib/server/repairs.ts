import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import { z } from "zod"
import type { Applied, Dependency, Grant } from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { audit, notify, writeReadVersion } from "./audit"
import { abilityFor, grantSchema, requireFields } from "./permissions"
import { repairEnvelope, repairInputs, repairReversalInput, customerEnvelope, type RepairCommand } from "./validators"
import { loadPurchase, purchaseAuth, purchaseDTO, vehicleAuth, vehicleDTO, repairAuth, repairDTO, requireRef, colomboToday } from "./purchases"
import { inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import { cashTotals, C } from "../money"
import { fail } from "./errors"

type Name = RepairCommand | "reversePayment"
type Intent = { [N in RepairCommand]: { name: N; input: z.infer<(typeof repairInputs)[N]> } }[RepairCommand] | { name: "reversePayment"; input: z.infer<typeof repairReversalInput> }
type Row = NonNullable<Awaited<ReturnType<typeof loadPurchase>>>
type Repair = Row["repairs"][number]
const date = (d: Date) => d.toISOString().slice(0, 10)
const cashFields = (value: object, prefix = "payment") => Object.keys(value).map((f) => `${prefix}.${f}`)
const netPaid = (r: Repair) => r.payments.reduce((n, p) => n + (p.direction === "OUT" ? p.amount : -p.amount), 0n)
const invalidate: Applied["invalidate"] = ["inventory", "purchases", "repairs", "parties", "reports", "dashboard", "notifications"]

function authority(actor: Actor, row: Row, repair: Repair | undefined, intent: Intent) {
  const parent = purchaseAuth(row), child = repair ? repairAuth(repair) : { createdBy: actor.userId }
  requireFields(actor.ability, "PurchaseRecord", "read", parent, ["id", "revision", "vehicleId", "status", "closedAt", "purchaseDate", "repairs"])
  requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), ["id", "identityRevision", "cycleId"])
  requireFields(actor.ability, "RepairRecord", "read", child, ["id", "revision"])
  if (intent.name === "sendRepair") {
    requireFields(actor.ability, "PurchaseRecord", "update", parent, ["cycleId"])
    requireFields(actor.ability, "RepairRecord", "create", child, Object.keys(intent.input))
    for (const r of row.repairs) requireFields(actor.ability, "RepairRecord", "read", repairAuth(r), ["returnedDate"])
  } else {
    requireFields(actor.ability, "RepairRecord", "read", child, ["sentDate", "returnedDate", "invoiceAmount", "payments.amount", "payments.direction"])
    if (intent.name === "returnRepair") {
      requireFields(actor.ability, "PurchaseRecord", "update", parent, ["cycleId"])
      requireFields(actor.ability, "RepairRecord", "update", child, Object.keys(intent.input).filter((f) => f !== "payment"))
    }
    const payment = intent.name !== "reversePayment" ? intent.input.payment : undefined
    if (payment || intent.name === "reversePayment") {
      requireFields(actor.ability, "PurchaseRecord", "pay", parent, ["cycleId"])
      requireFields(actor.ability, "RepairRecord", "pay", child, intent.name === "reversePayment" ? ["sourceType", "sourceId", "paymentId", "reason", ...(intent.input.replacement ? cashFields(intent.input.replacement, "replacement") : [])] : ["repairId", ...cashFields(payment!)])
    }
    // Gross cumulative cash/basis are consumed; never reconstruct hidden child facts.
    requireFields(actor.ability, "PurchaseRecord", "read", parent, ["financial.currency", "financial.scale", "financial.cashIn", "financial.cashOut", "financial.basis", "purchasePrice", "payments.amount", "payments.direction"])
    for (const c of row.costs) {
      requireFields(actor.ability, "VehicleCost", "read", { ...c, createdBy: c.createdBy }, ["amount", "payments.amount", "payments.direction"])
      requireFields(actor.ability, "PurchaseRecord", "read", parent, ["costs.amount", "costs.payments.amount", "costs.payments.direction"])
    }
    for (const r of row.repairs) requireFields(actor.ability, "RepairRecord", "read", repairAuth(r), ["invoiceAmount", "returnedDate", "payments.amount", "payments.direction"])
    if (intent.name === "reversePayment")
      requireFields(actor.ability, "RepairRecord", "read", child, ["payments.id", "payments.owner.type", "payments.owner.id", "payments.amount", "payments.direction", "payments.date", "payments.method", "payments.reference", "payments.reversalOf"])
  }
}

/** Existing transactional notify seam only. The final accepted-base notification
 * reader/target owner is integrated at reconciliation, never copied from92. */
async function returnedNotifications(tx: Tx, row: Row, repair: Repair) {
  const users = await tx.user.findMany({ where: { active: true }, include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } } })
  for (const user of users) {
    const grants = user.roles.filter((m) => m.role.active).flatMap((m) => m.role.permissions.map((p) => grantSchema.parse(p.permission.rule) as Grant))
    const ability = abilityFor(grants, user.id), parent = subject("PurchaseRecord", purchaseAuth(row)), child = subject("RepairRecord", repairAuth(repair))
    if (!["id", "repairs"].every((f) => ability.can("read", parent, f)) || !ability.can("read", child, "id")) continue
    if (!ability.can("release", parent, "cycleId") && !ability.can("update", child, "repairId") && !ability.can("pay", child, "repairId")) continue
    await notify(tx, { recipientUserId: user.id, kind: "REPAIR_RETURNED", eventKey: `repair:returned:${repair.id}:2`, targetType: "REPAIR", targetId: repair.id })
  }
}

export async function executeRepair(identity: Identity, name: Name, raw: unknown): Promise<Applied> {
  await database().$transaction(async (tx) => { await assertEnvironment(tx); await currentActor(tx, identity) })
  const overflow = (v: unknown, key = "") => {
    if (["amount", "invoiceAmount"].includes(key) && typeof v === "string" && /^[1-9][0-9]{14,}$/.test(v)) fail("MONEY_OVERFLOW", 422)
    if (v && typeof v === "object") for (const [k, value] of Object.entries(v)) overflow(value, k)
  }
  overflow(raw)
  const parsed = (name === "reversePayment" ? customerEnvelope("createCustomer").extend({ input: repairReversalInput }) : repairEnvelope(name)).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data, intent = { name, input: envelope.input } as Intent, config = runtimeConfig(), digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    const scope = { environmentId: config.ENVIRONMENT_ID, actorKey: `USER:${actor.userId}`, commandName: name, idempotencyKey: envelope.idempotencyKey }
    const prior = await tx.commandReceipt.findUnique({ where: { environmentId_actorKey_commandName_idempotencyKey: scope } })
    let cycleId: string | undefined = intent.name === "sendRepair" ? intent.input.cycleId : undefined
    let repairId = intent.name === "sendRepair" ? prior ? (prior.result as Applied["result"]).id : undefined : intent.name === "reversePayment" ? undefined : intent.input.repairId
    if (intent.name === "reversePayment") {
      const p = await tx.repairPayment.findUnique({ where: { id: intent.input.paymentId } })
      if (!p || p.repairId !== intent.input.sourceId) fail("NOT_FOUND", 404)
      repairId = p.repairId
    }
    if (repairId) {
      const r = await tx.repairRecord.findUnique({ where: { id: repairId } })
      if (!r) fail("NOT_FOUND", 404)
      cycleId = r.cycleId
    }
    if (!cycleId) fail("NOT_FOUND", 404)
    const planned = await loadPurchase(tx, cycleId)
    if (!planned) fail("NOT_FOUND", 404)
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`Vehicle:${planned.vehicleId}`},0))::text`
    await tx.$queryRaw`SELECT id FROM vamotors."Vehicle" WHERE id=${planned.vehicleId}::uuid FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${cycleId}::uuid FOR UPDATE`
    if (repairId) await tx.$queryRaw`SELECT id FROM vamotors."RepairRecord" WHERE id=${repairId}::uuid FOR UPDATE`
    const row = (await loadPurchase(tx, cycleId))!, repair = row.repairs.find((r) => r.id === repairId)
    authority(actor, row, repair, intent)
    let vendor
    if (intent.name === "sendRepair") {
      await tx.$queryRaw`SELECT id FROM vamotors."RepairVendor" WHERE id=${intent.input.vendorId}::uuid FOR UPDATE`
      vendor = await tx.repairVendor.findUnique({ where: { id: intent.input.vendorId } })
      if (!vendor) fail("NOT_FOUND", 404)
      requireFields(actor.ability, "RepairVendor", "read", vendor, ["id", "revision", "active"])
    }
    const refs: Dependency[] = [{ type: "PurchaseRecord", id: row.id, revision: row.revision }, ...(repair ? [{ type: "RepairRecord" as const, id: repair.id, revision: repair.revision }] : []), ...(vendor ? [{ type: "RepairVendor" as const, id: vendor.id, revision: vendor.revision }] : [])]
    if (prior) {
      const result = prior.result as Applied["result"]
      if (prior.inputHash !== digest || result.type !== "RepairRecord" || result.id !== repair?.id || (intent.name === "sendRepair" && (repair.commandId !== prior.id || row.id !== intent.input.cycleId))) fail("IDEMPOTENCY_MISMATCH")
      return { ok: true, status: "APPLIED", commandId: prior.id, replayed: true, result, affected: refs.filter((r) => r.type !== "RepairVendor"), invalidate }
    }
    for (const ref of refs) requireRef(envelope.expected, ref)
    if (!row.acquisitionCommandId) fail("INVALID_STATE")
    if (row.revision === 2147483647 || repair?.revision === 2147483647) fail("REVISION_EXHAUSTED")
    const today = colomboToday()
    if (intent.name === "sendRepair") {
      if (row.closedAt || row.status !== "IN_STOCK" || row.vehicle.activePurchaseId !== row.id) fail("INVALID_STATE")
      if (row.repairs.some((r) => !r.returnedDate)) fail("OBLIGATION_OPEN")
      if (!vendor!.active) fail("INVALID_STATE")
      if (intent.input.sentDate < date(row.purchaseDate) || intent.input.sentDate > today) fail("INVALID_INPUT", 422)
    } else if (intent.name === "returnRepair") {
      if (!repair || repair.returnedDate || row.closedAt || row.status !== "IN_REPAIR" || row.vehicle.activePurchaseId !== row.id) fail("INVALID_STATE")
      if (intent.input.returnedDate < date(repair.sentDate) || intent.input.returnedDate > today || intent.input.invoiceDate > intent.input.returnedDate) fail("INVALID_INPUT", 422)
      if (intent.input.payment && BigInt(intent.input.payment.amount) > BigInt(intent.input.invoiceAmount)) fail("BALANCE_MISMATCH", 422)
    } else if (!repair?.returnedDate || repair.invoiceAmount === null) fail("INVALID_STATE")
    const payment = intent.name === "sendRepair" ? undefined : intent.name === "reversePayment" ? intent.input.replacement : intent.input.payment
    if (payment && payment.date > today) fail("INVALID_INPUT", 422)
    const sequence = await nextBusinessSequence(tx), commandId = randomUUID(), id = repair?.id ?? randomUUID()
    const result = { type: "RepairRecord" as const, id, revision: (repair?.revision ?? 0) + 1 }
    await tx.commandReceipt.create({ data: { id: commandId, ...scope, inputHash: digest, result, businessSequence: sequence } })
    if (intent.name === "sendRepair") await tx.repairRecord.create({ data: { id, ...intent.input, sentDate: new Date(intent.input.sentDate), createdBy: actor.userId, commandId } })
    else await tx.repairRecord.update({ where: { id }, data: { revision: { increment: 1 }, ...(intent.name === "returnRepair" ? { returnedDate: new Date(intent.input.returnedDate), invoiceDate: new Date(intent.input.invoiceDate), invoiceAmount: BigInt(intent.input.invoiceAmount), summary: intent.input.summary, returnCommandId: commandId } : {}) } })
    const basis = row.basisVersions.at(-1)!
    if (intent.name === "reversePayment") {
      const original = repair!.payments.find((p) => p.id === intent.input.paymentId)
      if (!original) fail("NOT_FOUND", 404)
      if (original.reversalOf || original.direction !== "OUT" || repair!.payments.some((p) => p.reversalOf === original.id)) fail("INVALID_STATE")
      await tx.repairPayment.create({ data: { repairId: id, cycleId: row.id, amount: original.amount, direction: "IN", category: "REPAIR", occurredDate: original.occurredDate, method: original.method, currency: original.currency, scale: original.scale, reference: original.reference, reversalOf: original.id, reason: intent.input.reason, createdBy: actor.userId, commandId, lineKey: `reverse:${original.id}` } })
    }
    if (payment) await tx.repairPayment.create({ data: { repairId: id, cycleId: row.id, amount: BigInt(payment.amount), direction: "OUT", category: "REPAIR", occurredDate: new Date(payment.date), method: payment.method, currency: basis.currency, scale: basis.scale, reference: payment.reference, createdBy: actor.userId, commandId, lineKey: intent.name === "reversePayment" ? `replace:${intent.input.paymentId}` : "payment", ...(intent.name === "reversePayment" ? { reason: intent.input.reason } : {}) } })
    await tx.purchaseRecord.update({ where: { id: row.id }, data: { revision: { increment: 1 }, ...(intent.name === "sendRepair" ? { status: "IN_REPAIR", available: false, holdReason: null } : intent.name === "returnRepair" ? { status: "IN_STOCK", available: false, holdReason: "RETURNED_AWAITING_RELEASE" } : {}) } })
    let after = (await loadPurchase(tx, row.id))!, updated = after.repairs.find((r) => r.id === id)!
    if (updated.invoiceAmount !== null && (netPaid(updated) < 0n || netPaid(updated) > updated.invoiceAmount)) fail("BALANCE_MISMATCH", 422)
    const cash = cashTotals([...after.payments, ...after.costs.flatMap((c) => c.payments), ...after.repairs.flatMap((r) => r.payments)].map((p) => ({ direction: p.direction as "IN" | "OUT", amount: p.amount.toString() })))
    if (BigInt(cash.incoming) > C || BigInt(cash.outgoing) > C) fail("MONEY_OVERFLOW", 422)
    if (intent.name === "returnRepair") {
      if (basis.version === 2147483647) fail("REVISION_EXHAUSTED")
      const returned = after.repairs.filter((r) => r.returnedDate).sort((a, b) => a.id.localeCompare(b.id))
      const total = [after.purchasePrice, ...after.costs.map((c) => c.amount), ...returned.map((r) => r.invoiceAmount!)].reduce((n, v) => n + v, 0n)
      if (total > C) fail("MONEY_OVERFLOW", 422)
      await tx.cycleBasisVersion.create({ data: { cycleId: row.id, commandId, version: basis.version + 1, purchase: after.purchasePrice, total, currency: basis.currency, scale: basis.scale, reason: "Actual repair invoice", supersedesId: basis.id, components: { purchase: after.purchasePrice.toString(), repairs: returned.map((r) => ({ id: r.id, amount: r.invoiceAmount!.toString() })), costs: after.costs.map((c) => ({ id: c.id, amount: c.amount.toString() })) } } })
      after = (await loadPurchase(tx, row.id))!; updated = after.repairs.find((r) => r.id === id)!
      await returnedNotifications(tx, after, updated)
    }
    if (intent.name === "sendRepair" || intent.name === "returnRepair") await tx.statusEvent.create({ data: { cycleId: row.id, from: row.status, to: after.status, action: name, commandId, userId: actor.userId, occurredAt: new Date(intent.name === "sendRepair" ? intent.input.sentDate : intent.input.returnedDate) } })
    for (const [entityType, entityId, before, payload, revision] of [
      ["PurchaseRecord", row.id, purchaseDTO(row), purchaseDTO(after), after.revision],
      ["Vehicle", row.vehicleId, vehicleDTO(row), vehicleDTO(after), row.vehicle.revision],
      ["RepairRecord", id, repair ? repairDTO(repair) : null, repairDTO(updated), updated.revision],
    ] as const) {
      await audit(tx, { commandId, userId: actor.userId, entityType, entityId, action: name, before, after: payload, ...(intent.name === "reversePayment" ? { reason: intent.input.reason } : {}) })
      await writeReadVersion(tx, { commandId, sequence, entityType, entityId, revision, payload })
    }
    return { ok: true, status: "APPLIED", commandId, replayed: false, result, affected: [{ type: "PurchaseRecord", id: row.id, revision: after.revision }, result], invalidate }
  })
}
