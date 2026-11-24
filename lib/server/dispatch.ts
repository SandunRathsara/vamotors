import "server-only"
import { randomUUID } from "node:crypto"
import type { Prisma } from "@prisma/client"
import type { Applied, Dependency } from "../../.planning/implementation/contracts/api"
import { assertEnvironment, database, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { audit, writeReadVersion } from "./audit"
import { inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import { dispatchEnvelope, dispatchPreviewInput } from "./validators"
import { readScope, requireFields } from "./permissions"
import { fail, CommandError } from "./errors"
import { commission } from "../money"
import {
  commonEligible,
  dealChecklistHash,
  dealDTO,
  dealInclude,
  effectiveVerification,
  missingChecklist,
  ref,
  type DealRow,
} from "./brokerage"

const colomboDate = (value: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value)
const payment = (policy: Record<string, unknown>, principal: bigint) => {
  const value = policy.commission as
    | { basis: "FIXED"; fixed: string; rateBps: number }
    | { basis: "FINANCED_PRINCIPAL"; rateBps: number }
  return value.basis === "FIXED"
    ? BigInt(value.fixed)
    : commission(principal, value.rateBps)
}
const batchDTO = (row: {
  id: string
  revision: number
  handedOverAt: Date
  courier: string
  tracking: string | null
  items: {
    id: string
    sourceType: string
    brokerageDealId: string | null
    sourceRevision: number
    checklistHash: string
    sentAt: Date
  }[]
}) => ({
  id: row.id,
  revision: row.revision,
  handedOverAt: row.handedOverAt.toISOString(),
  courier: row.courier,
  tracking: row.tracking,
  items: row.items.map((item) => ({
    id: item.id,
    sourceType: item.sourceType,
    brokerageDealId: item.brokerageDealId,
    sourceRevision: item.sourceRevision,
    checklistHash: item.checklistHash,
    sentAt: item.sentAt.toISOString(),
  })),
})
const batchSubject = (row: {
  id: string
  revision: number
  handedOverAt: Date
  courier: string
  tracking: string | null
}) => ({
  ...row,
  items: [],
})
const entitlementPayload = (row: {
  id: string
  revision: number
  companyId: string
  sourceType: string
  brokerageDealId: string | null
  expectedAmount: bigint
  policySnapshot: Prisma.JsonValue
  eligibleAt: Date
  sentDate: Date
  sentDateSource: string
  state: string
}) => ({
  id: row.id,
  revision: row.revision,
  companyId: row.companyId,
  sourceType: row.sourceType,
  brokerageDealId: row.brokerageDealId,
  expectedAmount: row.expectedAmount.toString(),
  policySnapshot: row.policySnapshot,
  eligibleAt: row.eligibleAt.toISOString(),
  sentDate: row.sentDate.toISOString().slice(0, 10),
  sentDateSource: row.sentDateSource,
  state: row.state,
})

function readiness(row: DealRow) {
  const blockers: { code: string; field: string; message: string }[] = []
  const hash = dealChecklistHash(row)
  const missing = missingChecklist(row)
  if (row.path !== "APPLICATION") {
    blockers.push({
      code: "PATH_MISMATCH",
      field: "path",
      message: "Referral deals are not dispatched",
    })
  }
  if (row.state !== "DOCUMENTS_READY") {
    blockers.push({
      code: "INVALID_STATE",
      field: "state",
      message: `Deal is ${row.state}`,
    })
  }
  if (row.path === "APPLICATION" && (!commonEligible(row) || row.photos.length !== 9)) {
    blockers.push({
      code: "CHECKLIST_INCOMPLETE",
      field: "photos",
      message: "Eligibility and all nine inspection photos are required",
    })
  }
  if (row.quoteStatus !== "SUPPORTED") {
    blockers.push({
      code: "UNSUPPORTED_RATE",
      field: "quoteStatus",
      message: "Quote reselection required",
    })
  }
  if (!row.fileReference) {
    blockers.push({
      code: "DOCUMENT_NOT_READY",
      field: "fileReference",
      message: "File reference missing",
    })
  }
  if (missing.length) {
    blockers.push({
      code: "CHECKLIST_INCOMPLETE",
      field: missing[0],
      message: `${missing.length} checklist item(s) incomplete`,
    })
  }
  if (!effectiveVerification(row)) {
    blockers.push({
      code: "VERIFICATION_STALE",
      field: "verification",
      message: "Current checklist verification required",
    })
  }
  for (const issue of row.issues) {
    if (
      issue.kind === "BLOCKER" &&
      issue.blocksStep === "DISPATCH" &&
      issue.resolvedAt === null
    ) {
      blockers.push({
        code: "OBLIGATION_OPEN",
        field: "issues",
        message: "An unresolved processing issue blocks dispatch",
      })
    }
  }
  if (row.entitlement) {
    blockers.push({
      code: "INVALID_STATE",
      field: "entitlement",
      message: "Commission entitlement already exists",
    })
  }
  return { blockers, checklistHash: hash, ready: blockers.length === 0 }
}

export async function executeDispatch(
  identity: Identity,
  raw: unknown
): Promise<Applied> {
  const parsed = dispatchEnvelope.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const digest = inputDigest(envelope, runtimeConfig().BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    await tx.$queryRaw`SELECT id FROM vamotors.session WHERE id=${identity.sessionId}::uuid FOR SHARE`
    const actor = await currentActor(tx, identity)
    for (let attempt = 0; attempt < 1; attempt++) {
      const scope = {
        environmentId: runtimeConfig().ENVIRONMENT_ID,
        actorKey: `USER:${actor.userId}`,
        commandName: "dispatchBatch",
        idempotencyKey: envelope.idempotencyKey,
      }
      const prior = await tx.commandReceipt.findUnique({
        where: { environmentId_actorKey_commandName_idempotencyKey: scope },
      })
      if (prior) {
        const result = prior.result as Applied["result"]
        if (result.type !== "DispatchBatch") fail("IDEMPOTENCY_MISMATCH")
        const batch = await loadBatch(tx, actor, result.id)
        if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
        return dispatchApplied(prior.id, true, batch, [])
      }
      if (
        envelope.input.sourceIds.some((row) => row.type !== "BROKERAGE")
      )
        fail("INVALID_INPUT", 422)
      requireFields(actor.ability, "DispatchBatch", "create", {
        ...envelope.input,
        createdBy: actor.userId,
      }, Object.keys(envelope.input))
      const ids = [...new Set(envelope.input.sourceIds.map((s) => s.id))].sort()
      const deals: DealRow[] = []
      for (const id of ids) {
        await tx.$queryRaw`SELECT id FROM vamotors."BrokerageDeal" WHERE id=${id}::uuid FOR UPDATE`
        const row = await tx.brokerageDeal.findUnique({
          where: { id },
          include: dealInclude,
        })
        if (!row) fail("NOT_FOUND", 404)
        requireFields(
          actor.ability,
          "BrokerageDeal",
          "read",
          { ...dealDTO(row), createdBy: row.createdBy },
          ["id", "revision", "state", "path", "photos", "eligibility", "checklist", "verification", "fileReference", "quoteStatus", "issues"]
        )
        requireFields(
          actor.ability,
          "BrokerageDeal",
          "dispatch",
          { ...dealDTO(row), createdBy: row.createdBy },
          ["dealId", "sourceIds", "handedOverAt", "courier", "tracking"]
        )
        deals.push(row)
      }
      const required: Dependency[] = deals.map((row) => ref(row))
      for (const dep of required) {
        const match = envelope.expected.find(
          (r) => r.type === dep.type && r.id === dep.id
        )
        if (!match) fail("REVISION_REQUIRED", 428)
        if (match.revision !== dep.revision)
          throw new CommandError("STALE_REVISION", 409, false, required)
      }
      if (deals.some((row) => row.path !== "APPLICATION"))
        fail("PATH_MISMATCH")
      for (const member of envelope.input.sourceIds) {
        const row = deals.find((d) => d.id === member.id)!
        if (
          member.revision !== row.revision ||
          member.checklistHash !== dealChecklistHash(row)
        )
          throw new CommandError("STALE_REVISION", 409, false, [ref(row)])
      }
      const failures = deals.flatMap((row) =>
        readiness(row).blockers.map((blocker) => ({
          ...blocker,
          id: row.id,
        }))
      )
      if (failures.length)
        throw new CommandError(
          "CHECKLIST_INCOMPLETE",
          422,
          false,
          undefined,
          failures.map((f) => `${f.id}:${f.field}:${f.message}`).join("; ")
        )
      const commandId = randomUUID(),
        sequence = await nextBusinessSequence(tx),
        now = new Date(),
        batchId = randomUUID(),
        handedOverAt = new Date(envelope.input.handedOverAt)
      await tx.dispatchBatch.create({
        data: {
          id: batchId,
          handedOverAt,
          courier: envelope.input.courier,
          tracking: envelope.input.tracking ?? null,
          createdBy: actor.userId,
          createdAt: now,
          commandId,
          revision: 1,
        },
      })
      const entitlements: {
        id: string
        revision: number
        companyId: string
        sourceType: string
        brokerageDealId: string | null
        expectedAmount: bigint
        policySnapshot: Prisma.JsonValue
        eligibleAt: Date
        sentDate: Date
        sentDateSource: string
        state: string
      }[] = []
      const afterDeals: DealRow[] = []
      for (const row of deals) {
        const member = envelope.input.sourceIds.find((m) => m.id === row.id)!
        await tx.dispatchItem.create({
          data: {
            batchId,
            sourceType: "BROKERAGE",
            brokerageDealId: row.id,
            sourceRevision: member.revision,
            checklistHash: member.checklistHash,
            sentAt: handedOverAt,
          },
        })
        await tx.brokerageDeal.update({
          where: { id: row.id },
          data: {
            state: "DISPATCHED",
            revision: row.revision + 1,
            updatedAt: now,
          },
        })
        const policy = row.effectivePolicySnapshot as Record<string, unknown>
        const entitlement = await tx.commissionEntitlement.create({
          data: {
            companyId: row.companyId,
            sourceType: "BROKERAGE",
            brokerageDealId: row.id,
            expectedAmount: payment(policy, row.approvedLoan),
            policySnapshot: policy as Prisma.InputJsonObject,
            eligibleAt: handedOverAt,
            sentDate: new Date(`${colomboDate(handedOverAt)}T00:00:00.000Z`),
            sentDateSource: "DISPATCH",
            state: "OPEN",
            revision: 1,
            createdBy: actor.userId,
            commandId,
          },
        })
        entitlements.push(entitlement)
        afterDeals.push(await loadDeal(tx, actor, row.id))
      }
      const batchAfter = await loadBatch(tx, actor, batchId)
      await tx.commandReceipt.create({
        data: {
          id: commandId,
          ...scope,
          inputHash: digest,
          result: { type: "DispatchBatch", id: batchId, revision: 1 },
          businessSequence: sequence,
        },
      })
      await audit(tx, {
        commandId,
        userId: actor.userId,
        entityType: "DispatchBatch",
        entityId: batchId,
        action: "dispatchBatch",
        before: null,
        after: batchDTO(batchAfter) as unknown as Record<string, unknown>,
      })
      await writeReadVersion(tx, {
        commandId,
        sequence,
        entityType: "DispatchBatch",
        entityId: batchId,
        revision: 1,
        payload: batchDTO(batchAfter) as unknown as Record<string, unknown>,
      })
      for (const row of deals) {
        const after = afterDeals.find((d) => d.id === row.id)!
        await audit(tx, {
          commandId,
          userId: actor.userId,
          entityType: "BrokerageDeal",
          entityId: row.id,
          action: "dispatchBatch",
          before: { ...dealDTO(row), createdBy: row.createdBy },
          after: { ...dealDTO(after), createdBy: after.createdBy },
        })
        await writeReadVersion(tx, {
          commandId,
          sequence,
          entityType: "BrokerageDeal",
          entityId: row.id,
          revision: after.revision,
          payload: dealDTO(after),
        })
      }
      for (const entitlement of entitlements) {
        await writeReadVersion(tx, {
          commandId,
          sequence,
          entityType: "CommissionEntitlement",
          entityId: entitlement.id,
          revision: entitlement.revision,
          payload: entitlementPayload(entitlement),
        })
      }
      return dispatchApplied(
        commandId,
        false,
        batchAfter,
        afterDeals.map((row) => ref(row))
      )
    }
    throw new CommandError("RETRYABLE_TRANSACTION", 503, true)
  })
}

async function loadBatch(tx: Tx, actor: Actor, batchId: string) {
  const row = await tx.dispatchBatch.findUnique({
    where: { id: batchId },
    include: { items: { orderBy: { id: "asc" } } },
  })
  if (!row) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "DispatchBatch", "read", batchSubject(row), [
    "id",
    "revision",
    "items",
  ])
  return row
}
function dispatchApplied(
  commandId: string,
  replayed: boolean,
  row: Awaited<ReturnType<typeof loadBatch>>,
  affected: Dependency[]
): Applied {
  return {
    ok: true,
    status: "APPLIED",
    commandId,
    replayed,
    result: { type: "DispatchBatch", id: row.id, revision: row.revision },
    affected,
    invalidate: [
      "brokerage",
      "finance",
      "reports",
      "dashboard",
      "notifications",
    ],
  }
}
async function loadDeal(tx: Tx, actor: Actor, dealId: string) {
  const row = await tx.brokerageDeal.findUnique({
    where: { id: dealId },
    include: dealInclude,
  })
  if (!row) fail("NOT_FOUND", 404)
  requireFields(
    actor.ability,
    "BrokerageDeal",
    "read",
    { ...dealDTO(row), createdBy: row.createdBy },
    ["id", "revision"]
  )
  return row
}

export async function dispatchReplay(
  tx: Tx,
  actor: Actor,
  receipt: import("@prisma/client").CommandReceipt
): Promise<Applied> {
  const result = receipt.result as Applied["result"]
  if (result.type !== "DispatchBatch") fail("IDEMPOTENCY_MISMATCH")
  const batch = await loadBatch(tx, actor, result.id)
  const deals = []
  for (const item of batch.items)
    if (item.brokerageDealId) deals.push(await loadDeal(tx, actor, item.brokerageDealId))
  return dispatchApplied(receipt.id, true, batch, deals.map((row) => ref(row)))
}

export async function dispatchPreviewQuery(
  tx: Tx,
  actor: Actor,
  raw: unknown
) {
  const parsed = dispatchPreviewInput.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const unique = [
    ...new Map(parsed.data.sourceIds.map((row) => [row.id, row])).values(),
  ]
  const result = []
  for (const source of unique) {
    if (source.type !== "BROKERAGE") {
      result.push({
        source: source.type,
        id: source.id,
        revision: 0,
        checklistHash: "",
        ready: false,
        blockers: [
          {
            code: "DOCUMENT_NOT_READY",
            field: "sourceType",
            message: "Vehicle sale dispatch is not implemented yet",
          },
        ],
      })
      continue
    }
    const row = await tx.brokerageDeal.findFirst({
      where: {
        AND: [
          { id: source.id },
          readScope(actor.grants, actor.userId, "BrokerageDeal"),
        ],
      },
      include: dealInclude,
    })
    if (!row) fail("NOT_FOUND", 404)
    requireFields(
      actor.ability,
      "BrokerageDeal",
      "read",
      { ...dealDTO(row), createdBy: row.createdBy },
      ["id", "revision", "state", "path", "photos", "eligibility", "checklist", "verification", "fileReference", "quoteStatus", "issues"]
    )
    const state = readiness(row)
    result.push({
      source: "BROKERAGE" as const,
      id: row.id,
      revision: row.revision,
      checklistHash: state.checklistHash,
      ready: state.ready,
      blockers: state.blockers as {
        code: never
        field: string
        message: string
      }[],
    })
  }
  return result
}

export async function dispatchRead(
  identity: Identity,
  raw: unknown
) {
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      return dispatchPreviewQuery(tx, actor, raw)
    },
    { isolationLevel: "RepeatableRead", timeout: 5000 }
  )
}
