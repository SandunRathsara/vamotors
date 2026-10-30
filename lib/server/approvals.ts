import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import type { ApprovalRequest, CommandReceipt, Prisma } from "@prisma/client"
import type {
  Applied,
  ApprovalDTO,
  Dependency,
  Pending,
  WriteOff,
  Visible,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import {
  currentActor,
  authenticate,
  userAuthority,
  type Authority,
  type Identity,
} from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import {
  approvalEnvelope,
  approvalInputs,
  id,
  listParams,
  dateOnly,
  type ApprovalCommand,
} from "./validators"
import {
  auth,
  vehicleAuth,
  purchaseDTO,
  vehicleDTO,
  visiblePurchase,
  loadPurchase,
  colomboToday,
} from "./purchases"
import {
  applyApprovedWriteOff,
  disposalDTO,
  writeOffFields as inputFields,
  requireWriteOffAuthority,
  requireWriteOffRead,
} from "./disposals"
import { audit, writeReadVersion, notify } from "./audit"
import { canonical, inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import { project, readScope, requireFields } from "./permissions"
import { fail, CommandError } from "./errors"
import { z } from "zod"

type Cycle = NonNullable<Awaited<ReturnType<typeof loadPurchase>>>
const rowSubject = (a: ApprovalRequest) => ({
  ...approvalDTO(a),
  createdBy: a.requestedBy,
})
const at = (value: unknown, path: string) =>
  path
    .split(".")
    .reduce<unknown>(
      (v, k) =>
        v && typeof v === "object"
          ? (v as Record<string, unknown>)[k]
          : undefined,
      value
    )
function saved(a: ApprovalRequest) {
  const proposal = approvalInputs.requestApproval.shape.proposal.safeParse(
    a.proposal
  )
  const expected = approvalEnvelope("requestApproval").shape.expected.safeParse(
    a.expected
  )
  if (
    !proposal.success ||
    !expected.success ||
    a.schemaVersion !== 1 ||
    a.kind !== "WRITE_OFF" ||
    proposal.data.input.cycleId !== a.cycleId
  )
    fail("INTERNAL_ERROR", 500)
  return { proposal: proposal.data, expected: expected.data }
}
export function approvalDTO(a: ApprovalRequest): ApprovalDTO {
  const { proposal, expected } = saved(a)
  return {
    id: a.id,
    revision: a.revision,
    proposal,
    expected,
    payloadHash: a.payloadHash,
    reason: a.reason,
    requestedBy: a.requestedBy,
    requestedAt: a.requestedAt.toISOString(),
    state: a.state as ApprovalDTO["state"],
    ...(a.reviewedBy ? { reviewedBy: a.reviewedBy } : {}),
    ...(a.reviewedAt ? { reviewedAt: a.reviewedAt.toISOString() } : {}),
    ...(a.reviewNote !== null ? { reviewNote: a.reviewNote } : {}),
    ...(a.appliedCommandId ? { appliedCommandId: a.appliedCommandId } : {}),
  }
}
export const proposalHash = (
  proposal: unknown,
  expected: unknown,
  snapshot: unknown,
  reason: string
) =>
  createHash("sha256")
    .update(
      canonical({ schemaVersion: 1, proposal, expected, snapshot, reason })
    )
    .digest("hex")
const refs = (row: Cycle): Dependency[] => [
  { type: "PurchaseRecord", id: row.id, revision: row.revision },
  { type: "Vehicle", id: row.vehicleId, revision: row.vehicle.revision },
]
function readableRefs(actor: Authority, row: Cycle) {
  requireFields(actor.ability, "PurchaseRecord", "read", auth(row), [
    "id",
    "revision",
    "vehicleId",
    "identityRevision",
  ])
  requireFields(actor.ability, "Vehicle", "read", vehicleAuth(row), [
    "id",
    "identityRevision",
  ])
  return refs(row)
}
/** Originating fields, not state/CAS: also safe for successful receipt replay. */
function domainAuthority(actor: Authority, row: Cycle, input: WriteOff) {
  requireWriteOffAuthority(
    actor,
    auth(row),
    vehicleAuth(row),
    visiblePurchase(actor, row),
    input
  )
}
function requestAuthority(actor: Authority, row: Cycle, input: WriteOff) {
  requireWriteOffAuthority(
    actor,
    auth(row),
    vehicleAuth(row),
    visiblePurchase(actor, row),
    input,
    true
  )
}
function reviewAuthority(
  actor: Authority,
  row: Cycle,
  a: ApprovalRequest,
  note: boolean
) {
  requireFields(actor.ability, "ApprovalRequest", "read", rowSubject(a), [
    "id",
    "revision",
  ])
  requireFields(actor.ability, "ApprovalRequest", "approve", rowSubject(a), [
    "approvalId",
    "decision",
    ...(note ? ["note"] : []),
  ])
  domainAuthority(actor, row, saved(a).proposal.input)
  const input = saved(a).proposal.input
  requireFields(actor.ability, "ApprovalRequest", "read", rowSubject(a), [
    "proposal.kind",
    ...inputFields(input).map((f) => `proposal.input.${f}`),
    "expected",
    "payloadHash",
    "reason",
  ])
  const candidate = { ...input, createdBy: a.requestedBy }
  requireFields(
    actor.ability,
    "Disposal",
    "read",
    candidate,
    inputFields(input)
      .filter((f) => f !== "cycleId")
      .map((f) => f.replace("receipt.", "payments."))
  )
}
function validInput(row: Cycle, input: WriteOff) {
  if (
    input.date < row.purchaseDate.toISOString().slice(0, 10) ||
    input.date > colomboToday() ||
    (input.receipt && input.receipt.date > colomboToday())
  )
    fail("INVALID_INPUT", 422)
  if (
    input.proceeds === "0"
      ? !!input.receipt
      : !input.receipt || input.receipt.amount !== input.proceeds
  )
    fail("BALANCE_MISMATCH", 422)
}
function eligible(row: Cycle) {
  if (
    !row.acquisitionCommandId ||
    row.acquisitionKind !== "SUPPLIER" ||
    !["CASH", "BRAND_NEW", "LEASE_SETTLEMENT"].includes(row.purchaseType) ||
    row.closedAt ||
    row.vehicle.activePurchaseId !== row.id ||
    !["PURCHASED", "IN_STOCK"].includes(row.status) ||
    row.disposal
  )
    fail("INVALID_STATE")
}
function checkRefs(expected: Dependency[], current: Dependency[]) {
  for (const ref of current) {
    const supplied = expected.find(
      (r) => r.type === ref.type && r.id === ref.id
    )
    if (!supplied) fail("REVISION_REQUIRED", 428)
    if (supplied.revision !== ref.revision)
      throw new CommandError("STALE_REVISION", 409, false, current)
  }
}
async function lockedCycle(tx: Tx, cycleId: string) {
  const plan = await tx.purchaseRecord.findUnique({
    where: { id: cycleId },
    select: { vehicleId: true },
  })
  if (!plan) fail("NOT_FOUND", 404)
  await tx.$queryRaw`SELECT id FROM vamotors."Vehicle" WHERE id=${plan.vehicleId}::uuid FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM vamotors."PurchaseRecord" WHERE id=${cycleId}::uuid FOR UPDATE`
  const row = await loadPurchase(tx, cycleId)
  if (!row || row.vehicleId !== plan.vehicleId) fail("NOT_FOUND", 404)
  return row
}
async function eligibleReviewers(tx: Tx, row: Cycle, a: ApprovalRequest) {
  const users = await tx.user.findMany({
    where: { active: true, id: { not: a.requestedBy } },
    select: { id: true },
    orderBy: { id: "asc" },
  })
  const recipients: string[] = []
  for (const user of users) {
    const authority = await userAuthority(tx, user.id)
    if (!authority?.user.active) continue
    try {
      reviewAuthority(authority, row, a, false)
      const visible = visibleApproval(authority, a, row)
      if (!visible.id) continue
      recipients.push(user.id)
    } catch (e) {
      if (!(e instanceof CommandError)) throw e
    }
  }
  if (!recipients.length)
    throw new CommandError(
      "OBLIGATION_OPEN",
      409,
      false,
      undefined,
      "Configure a separate reviewer"
    )
  return recipients
}

export function visibleApproval(
  actor: Authority,
  a: ApprovalRequest,
  row: Cycle
) {
  const value = project(actor.ability, "ApprovalRequest", rowSubject(a))
  readableRefs(actor, row)
  const input = saved(a).proposal.input
  const candidate = subject("Disposal", { ...input, createdBy: a.requestedBy })
  let full = true
  const projectedInput = (
    value.proposal as { input?: Record<string, unknown> } | undefined
  )?.input
  for (const field of inputFields(input)) {
    if (at(projectedInput, field) !== at(input, field)) full = false
    const allowed =
      field === "cycleId" ||
      actor.ability.can(
        "read",
        candidate,
        field.startsWith("receipt.")
          ? field.replace("receipt.", "payments.")
          : field
      )
    if (allowed) continue
    full = false
    if (projectedInput) {
      if (field.startsWith("receipt."))
        delete (
          projectedInput.receipt as Record<string, unknown> | undefined
        )?.[field.slice(8)]
      else delete projectedInput[field]
    }
    value.redactedFields.push(`proposal.input.${field}`)
  }
  if (!actor.ability.can("read", candidate, "reason")) {
    for (const f of ["reason", "reviewNote"]) {
      delete value[f]
      value.redactedFields.push(f)
    }
  }
  try {
    requireWriteOffRead(auth(row), visiblePurchase(actor, row))
  } catch (e) {
    if (!(e instanceof CommandError)) throw e
    full = false
  }
  if (!full) {
    delete value.payloadHash
    value.redactedFields.push("payloadHash")
  }
  value.redactedFields = [
    ...new Set(value.redactedFields.filter((f) => f !== "createdBy")),
  ]
  return value
}
/** Shared exact authorized page lookup; no DTO cache or page-scanned inbox. */
export async function authenticatedApprovalDetail(
  headers: Headers,
  approvalId: string
) {
  const identity = await authenticate(headers)
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      return approvalDetail(tx, await currentActor(tx, identity), approvalId)
    },
    { isolationLevel: "RepeatableRead" }
  )
}
export async function approvalDetail(
  tx: Tx,
  actor: Authority,
  approvalId: string
) {
  if (!id.safeParse(approvalId).success) fail("NOT_FOUND", 404)
  const a = await tx.approvalRequest.findUnique({ where: { id: approvalId } })
  if (!a) fail("NOT_FOUND", 404)
  const row = await loadPurchase(tx, a.cycleId)
  if (!row) fail("NOT_FOUND", 404)
  const approval = visibleApproval(actor, a, row),
    cycle = visiblePurchase(actor, row)
  let canReview = false
  try {
    reviewAuthority(actor, row, a, false)
    const requester = await userAuthority(tx, a.requestedBy)
    if (requester?.user.active)
      domainAuthority(requester, row, saved(a).proposal.input)
    canReview =
      !!requester?.user.active &&
      a.requestedBy !== actor.userId &&
      a.state === "PENDING" &&
      canonical(refs(row)) === canonical(saved(a).expected)
  } catch (e) {
    if (!(e instanceof CommandError)) throw e
  }
  return {
    approval: approval as Visible<ApprovalDTO>,
    cycle: cycle as Visible<PurchaseCycleDTO>,
    canReview,
  }
}
export async function approvalQuery(
  tx: Tx,
  actor: Authority,
  args: Record<string, string>
) {
  const parsed = listParams
    .extend({
      status: z.enum(["PENDING", "APPROVED", "REJECTED", "STALE"]).optional(),
      q: z.string().max(200).optional(),
      sort: z.string().max(1000).optional(),
      from: dateOnly.optional(),
      through: dateOnly.optional(),
    })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  if (input.q) fail("FIELD_FORBIDDEN", 403)
  let sorts: { field: string; direction: "asc" | "desc" }[] = [
    { field: "requestedAt", direction: "desc" },
  ]
  if (input.sort) {
    try {
      sorts = z
        .array(
          z
            .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
            .strict()
        )
        .max(3)
        .parse(JSON.parse(input.sort))
    } catch {
      fail("INVALID_INPUT", 422)
    }
  }
  if (new Set(sorts.map((s) => s.field)).size !== sorts.length)
    fail("INVALID_INPUT", 422)
  if (sorts.some((s) => !["id", "requestedAt", "state"].includes(s.field)))
    fail("FIELD_FORBIDDEN", 403)
  const scope = readScope(actor.grants, actor.userId, "ApprovalRequest", [
    "id",
    ...sorts.map((s) => s.field),
    ...(input.status ? ["state"] : []),
    ...(input.from || input.through ? ["requestedAt"] : []),
  ])
  const vehicleRules = actor.grants.filter(
    (g) => g.subject === "Vehicle" && g.action === "read" && g.fields.length
  )
  const vehicleScope: Prisma.PurchaseRecordWhereInput = vehicleRules.length
    ? {
        OR: vehicleRules.map((g) => {
          const { status, ...conditions } = g.conditions ?? {}
          return {
            ...(status ? { status: status as Cycle["status"] } : {}),
            vehicle: Object.fromEntries(
              Object.entries(conditions).map(([k, v]) => [
                k,
                v === "$actor.id" ? actor.userId : v,
              ])
            ),
          }
        }),
      }
    : { id: { in: [] as string[] } }
  const where = {
    AND: [
      scope,
      {
        cycle: {
          AND: [
            readScope(actor.grants, actor.userId, "PurchaseRecord", [
              "id",
              "revision",
              "vehicleId",
              "identityRevision",
            ]),
            vehicleScope,
          ],
        },
      },
      ...(input.status ? [{ state: input.status }] : []),
      ...(input.from || input.through
        ? [
            {
              requestedAt: {
                ...(input.from
                  ? { gte: new Date(`${input.from}T00:00:00+05:30`) }
                  : {}),
                ...(input.through
                  ? {
                      lt: new Date(
                        new Date(`${input.through}T00:00:00+05:30`).valueOf() +
                          86400000
                      ),
                    }
                  : {}),
              },
            },
          ]
        : []),
    ],
  }
  const [rows, total] = await Promise.all([
    tx.approvalRequest.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [
        ...sorts.map((s) => ({ [s.field]: s.direction })),
        { id: "asc" },
      ],
    }),
    tx.approvalRequest.count({ where }),
  ])
  const data = []
  for (const a of rows) {
    const row = await loadPurchase(tx, a.cycleId)
    if (!row) fail("INTERNAL_ERROR", 500)
    data.push(visibleApproval(actor, a, row))
  }
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

export async function approvalReplay(
  tx: Tx,
  actor: Authority,
  prior: CommandReceipt
): Promise<Applied | Pending> {
  const result = prior.result as Applied["result"]
  if (result.type !== "ApprovalRequest") fail("INTERNAL_ERROR", 500)
  const a = await tx.approvalRequest.findUnique({ where: { id: result.id } })
  if (!a) fail("NOT_FOUND", 404)
  const row = await loadPurchase(tx, a.cycleId)
  if (!row) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "ApprovalRequest", "read", rowSubject(a), [
    "id",
    "revision",
  ])
  if (prior.commandName === "requestApproval") {
    if (a.requestCommandId !== prior.id || a.requestedBy !== actor.userId)
      fail("INTERNAL_ERROR", 500)
    requestAuthority(actor, row, saved(a).proposal.input)
    return {
      ok: true,
      status: "PENDING_APPROVAL",
      commandId: prior.id,
      approvalId: a.id,
      revision: result.revision,
      replayed: true,
      businessEffect: false,
    }
  }
  if (a.reviewCommandId !== prior.id || a.reviewedBy !== actor.userId)
    fail("INTERNAL_ERROR", 500)
  reviewAuthority(actor, row, a, a.reviewNote !== null)
  return {
    ok: true,
    status: "APPLIED",
    commandId: prior.id,
    replayed: true,
    result,
    affected: [
      { type: "ApprovalRequest", id: a.id, revision: a.revision },
      ...readableRefs(actor, row),
    ],
    invalidate: [
      "approvals",
      "notifications",
      "purchases",
      "inventory",
      "parties",
      "reports",
      "dashboard",
    ],
  }
}
/** Audit uses current owner projections, never raw stored proposal/payment JSON. */
export async function approvalAudit(
  tx: Tx,
  actor: Authority,
  args: Record<string, string>
) {
  const parsed = listParams
    .extend({ type: z.enum(["ApprovalRequest", "Disposal"]), id })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  let visible: Record<string, unknown>
  if (input.type === "ApprovalRequest")
    visible = (await approvalDetail(tx, actor, input.id)).approval
  else {
    const target = await tx.disposal.findUnique({
      where: { id: input.id },
      select: { cycleId: true },
    })
    if (!target) fail("NOT_FOUND", 404)
    const cycle = await loadPurchase(tx, target.cycleId)
    if (!cycle) fail("NOT_FOUND", 404)
    visible = visiblePurchase(actor, cycle).disposal as Record<string, unknown>
    if (!visible?.id) fail("NOT_FOUND", 404)
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
  const mask = (value: unknown, witness: unknown): unknown => {
    if (value === null || typeof value !== "object") return value
    if (Array.isArray(value)) {
      if (!Array.isArray(witness)) return undefined
      return value.flatMap((v) => {
        const w = witness.find((c) => c?.id === v?.id) ?? witness[0]
        return w === undefined ? [] : [mask(v, w)]
      })
    }
    if (!witness || typeof witness !== "object") return undefined
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k in witness)
        .map(([k, v]) => [k, mask(v, (witness as Record<string, unknown>)[k])])
    )
  }
  const data = []
  for (const entry of rows) {
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
    const ids = [
      ...new Set(
        [entry.userId, entry.initiatedBy, entry.approverId].filter(
          (v): v is string => !!v
        )
      ),
    ]
    const users = await tx.user.findMany({ where: { id: { in: ids } } })
    const readable = (uid: string | null) =>
      !!uid &&
      users.some(
        (u) =>
          u.id === uid && actor.ability.can("read", subject("User", u), "id")
      )
    const projected = project(actor.ability, "AuditLog", {
      id: entry.id,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      at: entry.recordedAt.toISOString(),
      actor: {
        kind: entry.actorKind,
        ...(readable(entry.userId) ? { userId: entry.userId } : {}),
        ...(readable(entry.initiatedBy)
          ? { initiatedBy: entry.initiatedBy }
          : {}),
      },
      ...(readable(entry.approverId) ? { approverId: entry.approverId } : {}),
      ...(visible.reason !== undefined ? { reason: entry.reason } : {}),
      fields,
    })
    projected.redactedFields.push(...redactedFields)
    data.push(projected)
  }
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
export async function executeApproval(
  identity: Identity,
  name: ApprovalCommand,
  raw: unknown
): Promise<Applied | Pending> {
  await database().$transaction((tx) => currentActor(tx, identity))
  // Preserve MONEY_OVERFLOW rather than silently recategorizing canonical A+1 as schema failure.
  const proposed = (
    raw as { input?: { proposal?: { input?: WriteOff } } } | null
  )?.input?.proposal?.input
  for (const amount of [proposed?.proceeds, proposed?.receipt?.amount])
    if (typeof amount === "string" && /^[1-9][0-9]{14,}$/.test(amount))
      fail("MONEY_OVERFLOW", 422)
  const parsed = approvalEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    config = runtimeConfig(),
    digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction<Applied | Pending>(async (tx) => {
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
      const replay = await approvalReplay(tx, actor, prior)
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return replay
    }
    const commandId = randomUUID()
    if (name === "requestApproval") {
      const input = approvalInputs.requestApproval.parse(envelope.input),
        writeOff = input.proposal.input
      const row = await lockedCycle(tx, writeOff.cycleId)
      requestAuthority(actor, row, writeOff)
      checkRefs(envelope.expected, readableRefs(actor, row))
      if (envelope.expected.length !== refs(row).length)
        fail("INVALID_INPUT", 422)
      eligible(row)
      validInput(row, writeOff)
      const expected = refs(row),
        basis = row.basisVersions.at(-1)!
      const snapshot = {
        cycleId: row.id,
        vehicleId: row.vehicleId,
        basisVersionId: basis.id,
        basis: basis.total.toString(),
        currency: basis.currency,
        scale: basis.scale,
        purchasePrice: row.purchasePrice.toString(),
        purchaseType: row.purchaseType,
        ...(row.purchaseType === "LEASE_SETTLEMENT"
          ? { settlement: purchaseDTO(row).settlement }
          : {}),
        ...(row.listedPrice !== null
          ? { listedPrice: row.listedPrice.toString() }
          : {}),
      }
      const approvalId = randomUUID(),
        requestedAt = new Date(),
        result = { type: "ApprovalRequest", id: approvalId, revision: 1 }
      const data = {
        id: approvalId,
        cycleId: row.id,
        kind: "WRITE_OFF",
        schemaVersion: 1,
        proposal: input.proposal,
        expected,
        snapshot,
        payloadHash: proposalHash(
          input.proposal,
          expected,
          snapshot,
          input.reason
        ),
        reason: input.reason,
        requestedBy: actor.userId,
        requestedAt,
        state: "PENDING",
        revision: 1,
        requestCommandId: commandId,
        requiredRecipientIds: [] as string[],
      }
      const candidate = {
        ...data,
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
        reviewerName: null,
        reviewCommandId: null,
        appliedCommandId: null,
      } as ApprovalRequest
      const recipients = await eligibleReviewers(tx, row, candidate)
      data.requiredRecipientIds = recipients
      const sequence = await nextBusinessSequence(tx)
      await tx.commandReceipt.create({
        data: {
          id: commandId,
          ...scope,
          inputHash: digest,
          result,
          businessSequence: sequence,
        },
      })
      const a = await tx.approvalRequest.create({
        data: data as Prisma.ApprovalRequestUncheckedCreateInput,
      })
      await audit(tx, {
        commandId,
        userId: actor.userId,
        initiatedBy: actor.userId,
        entityType: "ApprovalRequest",
        entityId: a.id,
        action: name,
        reason: a.reason,
        before: null,
        after: approvalDTO(a),
      })
      await writeReadVersion(tx, {
        commandId,
        sequence,
        entityType: "ApprovalRequest",
        entityId: a.id,
        revision: a.revision,
        payload: approvalDTO(a),
      })
      for (const recipientUserId of recipients)
        await notify(tx, {
          recipientUserId,
          eventKey: `approval:required:${a.id}:1`,
          kind: "APPROVAL_REQUIRED",
          targetType: "ApprovalRequest",
          targetId: a.id,
        })
      return {
        ok: true,
        status: "PENDING_APPROVAL",
        commandId,
        approvalId: a.id,
        revision: 1,
        replayed: false,
        businessEffect: false,
      }
    }
    const input = approvalInputs.reviewApproval.parse(envelope.input)
    const plan = await tx.approvalRequest.findUnique({
      where: { id: input.approvalId },
    })
    if (!plan) fail("NOT_FOUND", 404)
    const row = await lockedCycle(tx, plan.cycleId)
    await tx.$queryRaw`SELECT id FROM vamotors."ApprovalRequest" WHERE id=${plan.id}::uuid FOR UPDATE`
    const a = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: plan.id },
    })
    reviewAuthority(actor, row, a, input.note !== undefined)
    if (a.requestedBy === actor.userId) fail("SELF_REVIEW", 403)
    if (a.state !== "PENDING") fail("ALREADY_REVIEWED")
    checkRefs(envelope.expected, [
      { type: "ApprovalRequest", id: a.id, revision: a.revision },
    ])
    const savedValue = saved(a),
      current = readableRefs(actor, row)
    for (const ref of savedValue.expected)
      if (
        !envelope.expected.some((r) => r.type === ref.type && r.id === ref.id)
      )
        fail("REVISION_REQUIRED", 428)
    if (envelope.expected.length !== savedValue.expected.length + 1)
      fail("INVALID_INPUT", 422)
    const requester = await userAuthority(tx, a.requestedBy)
    if (!requester?.user.active) fail("APPROVAL_STALE")
    try {
      domainAuthority(requester, row, savedValue.proposal.input)
    } catch (e) {
      if (e instanceof CommandError) fail("APPROVAL_STALE")
      throw e
    }
    if (
      a.payloadHash !==
        proposalHash(a.proposal, a.expected, a.snapshot, a.reason) ||
      canonical(current) !== canonical(savedValue.expected) ||
      savedValue.expected.some(
        (ref) =>
          !envelope.expected.some(
            (r) =>
              r.type === ref.type &&
              r.id === ref.id &&
              r.revision === ref.revision
          )
      )
    )
      throw new CommandError("APPROVAL_STALE", 409, false, current)
    eligible(row)
    validInput(row, savedValue.proposal.input)
    const sequence = await nextBusinessSequence(tx),
      reviewedAt = new Date(),
      result = { type: "ApprovalRequest", id: a.id, revision: a.revision + 1 }
    if (
      a.revision === 2147483647 ||
      (input.decision === "APPROVE" &&
        (row.revision === 2147483647 || row.vehicle.revision === 2147483647))
    )
      fail("REVISION_EXHAUSTED")
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    const updated = await tx.approvalRequest.update({
      where: { id: a.id },
      data: {
        state: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        reviewedBy: actor.userId,
        reviewedAt,
        reviewNote: input.note,
        reviewerName: actor.user.name,
        reviewCommandId: commandId,
        appliedCommandId: input.decision === "APPROVE" ? commandId : null,
        revision: { increment: 1 },
      },
    })
    if (input.decision === "APPROVE") {
      const basis = row.basisVersions.at(-1)!
      const financial = purchaseDTO(row).financial!
      await applyApprovedWriteOff(tx, {
        cycleId: row.id,
        vehicleId: row.vehicleId,
        approvalId: a.id,
        commandId,
        reviewerId: actor.userId,
        reviewedAt,
        input: savedValue.proposal.input,
        basisVersionId: basis.id,
        basis: basis.total,
        cashIn: BigInt(financial.cashIn),
        cashOut: BigInt(financial.cashOut),
        currency: basis.currency,
        scale: basis.scale,
      })
      await tx.statusEvent.create({
        data: {
          cycleId: row.id,
          from: row.status,
          to: "WRITTEN_OFF",
          action: "approvedWriteOff",
          commandId,
          userId: actor.userId,
          occurredAt: new Date(savedValue.proposal.input.date),
        },
      })
      const after = (await loadPurchase(tx, row.id))!
      for (const [entityType, entityId, revision, before, payload] of [
        [
          "PurchaseRecord",
          row.id,
          after.revision,
          purchaseDTO(row),
          purchaseDTO(after),
        ],
        [
          "Vehicle",
          row.vehicleId,
          after.vehicle.revision,
          vehicleDTO(row),
          vehicleDTO(after),
        ],
      ] as const) {
        await audit(tx, {
          commandId,
          userId: actor.userId,
          initiatedBy: a.requestedBy,
          approverId: actor.userId,
          entityType,
          entityId,
          action: "approvedWriteOff",
          reason: savedValue.proposal.input.reason,
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
      await audit(tx, {
        commandId,
        userId: actor.userId,
        initiatedBy: a.requestedBy,
        approverId: actor.userId,
        entityType: "Disposal",
        entityId: after.disposal!.id,
        action: "approvedWriteOff",
        reason: savedValue.proposal.input.reason,
        before: null,
        after: disposalDTO(after.disposal!),
      })
    }
    await audit(tx, {
      commandId,
      userId: actor.userId,
      initiatedBy: a.requestedBy,
      approverId: actor.userId,
      entityType: "ApprovalRequest",
      entityId: a.id,
      action: name,
      reason: input.note ?? a.reason,
      before: approvalDTO(a),
      after: approvalDTO(updated),
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "ApprovalRequest",
      entityId: a.id,
      revision: updated.revision,
      payload: approvalDTO(updated),
    })
    await notify(tx, {
      recipientUserId: a.requestedBy,
      eventKey: `approval:outcome:${a.id}:${updated.revision}`,
      kind: "APPROVAL_OUTCOME",
      targetType: "ApprovalRequest",
      targetId: a.id,
    })
    const after = (await loadPurchase(tx, row.id))!
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [
        { type: "ApprovalRequest", id: a.id, revision: updated.revision },
        ...(input.decision === "APPROVE" ? refs(after) : []),
      ],
      invalidate: [
        "approvals",
        "notifications",
        "purchases",
        "inventory",
        "parties",
        "reports",
        "dashboard",
      ],
    }
  }).catch((error) => {
    if (error instanceof RangeError && error.message === "MONEY_OVERFLOW")
      fail("MONEY_OVERFLOW", 422)
    throw error
  })
}
