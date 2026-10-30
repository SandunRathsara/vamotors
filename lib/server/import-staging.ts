import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import { z } from "zod"
import type {
  ImportBatch,
  Prisma,
  UploadIntent,
  UploadAttempt,
  Attachment,
} from "@prisma/client"
import type {
  Applied,
  Dependency,
} from "../../.planning/implementation/contracts/api"
import { type Actor, type Identity, currentActor } from "./actor"
import { type Tx } from "./db"
import { transaction, nextBusinessSequence } from "./transactions"
import { audit, writeReadVersion } from "./audit"
import { inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import { requireFields, project, readScope, fieldsFor } from "./permissions"
import {
  attachmentEnvelope,
  attachmentCommands,
  id,
  listParams,
  dateOnly,
} from "./validators"
import { fail, CommandError } from "./errors"

export const batchDTO = (row: ImportBatch) => ({
  id: row.id,
  revision: row.revision,
  state: row.state,
  types: row.types,
  namespace: row.namespace,
  createdAt: row.createdAt.toISOString(),
})
export const batchSubject = (row: ImportBatch) => ({
  ...batchDTO(row),
  createdBy: row.createdBy,
})
export type Intent = UploadIntent & {
  currentAttempt: UploadAttempt | null
  attachment: Attachment | null
}
export const intentInclude = { currentAttempt: true, attachment: true } as const
export const uploadDTO = (row: Intent) => ({
  uploadId: row.id,
  revision: row.revision,
  filename: row.filename,
  expiresAt: row.expiresAt.toISOString(),
  state: row.state,
  attachmentId: row.state === "FINAL" ? row.attachment!.id : null,
  claimExpiresAt:
    row.state === "FINALIZING" ? row.claimExpiresAt!.toISOString() : null,
})
export const documentSubject = (row: UploadIntent | Attachment) => ({
  ...row,
  uploadId: "uploadIntentId" in row ? row.uploadIntentId : row.id,
  attachmentId: "uploadIntentId" in row ? row.id : null,
  revision: "revision" in row ? row.revision : 1,
})

/** All mutation phases use the same lock order and fresh session/role authority.
 * The session row lock also serializes logout with each short linearization. */
export async function lockImportActor(tx: Tx, identity: Identity) {
  await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
  await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
  await tx.$queryRaw`SELECT id FROM vamotors.session WHERE id=${identity.sessionId}::uuid FOR SHARE`
  return currentActor(tx, identity)
}
export async function loadBatch(
  tx: Tx,
  actor: Actor,
  batchId: string,
  write = false
) {
  if (write)
    await tx.$queryRaw`SELECT id FROM vamotors."ImportBatch" WHERE id=${batchId}::uuid FOR UPDATE`
  const row = await tx.importBatch.findUnique({ where: { id: batchId } })
  if (!row) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "ImportBatch", "read", batchSubject(row), [
    "id",
    "revision",
    ...(write ? ["uploads"] : []),
  ])
  if (write)
    requireFields(actor.ability, "ImportBatch", "update", batchSubject(row), [
      "uploads",
    ])
  return row
}
export function checkRefs(
  expected: readonly Dependency[],
  required: Dependency[]
) {
  for (const dep of required) {
    const ref = expected.find((r) => r.type === dep.type && r.id === dep.id)
    if (!ref) fail("REVISION_REQUIRED", 428)
    if (ref.revision !== dep.revision)
      throw new CommandError("STALE_REVISION", 409, false, required)
  }
}
export function bump(revision: number) {
  if (revision === 2147483647) fail("REVISION_EXHAUSTED")
  return revision + 1
}
export const receiptScope = (
  actorId: string,
  commandName: string,
  idempotencyKey: string
) => ({
  environmentId: runtimeConfig().ENVIRONMENT_ID,
  actorKey: `USER:${actorId}`,
  commandName,
  idempotencyKey,
})

export async function executeStageImport(
  identity: Identity,
  raw: unknown
): Promise<Applied> {
  const parsed = attachmentEnvelope("stageImport").safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    input = attachmentCommands.stageImport.parse(envelope.input)
  const config = runtimeConfig(),
    digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity)
    const candidate = { ...input, createdBy: actor.userId }
    requireFields(actor.ability, "ImportBatch", "create", candidate, [
      "types",
      "namespace",
    ])
    const scope = receiptScope(
      actor.userId,
      "stageImport",
      envelope.idempotencyKey
    )
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      const result = prior.result as Applied["result"]
      if (result.type !== "ImportBatch") fail("IDEMPOTENCY_MISMATCH")
      const row = await loadBatch(tx, actor, result.id)
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected: [{ type: "ImportBatch", id: row.id, revision: row.revision }],
        invalidate: ["documents"],
      }
    }
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    const row = await tx.importBatch.create({
      data: {
        ...input,
        environmentId: config.ENVIRONMENT_ID,
        createdBy: actor.userId,
        commandId,
      },
    })
    const result = { type: "ImportBatch" as const, id: row.id, revision: 1 },
      payload = batchDTO(row)
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    await audit(tx, {
      commandId,
      userId: actor.userId,
      entityType: "ImportBatch",
      entityId: row.id,
      action: "stageImport",
      before: null,
      after: payload,
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "ImportBatch",
      entityId: row.id,
      revision: 1,
      payload,
    })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [result],
      invalidate: ["documents"],
    }
  })
}

const sortInput = z
  .array(
    z
      .object({
        field: z.enum(["id", "createdAt", "state", "namespace"]),
        direction: z.enum(["asc", "desc"]),
      })
      .strict()
  )
  .min(1)
  .max(4)
export function importList(
  actor: Pick<Actor, "grants" | "userId">,
  raw: unknown
) {
  const parsed = listParams
    .extend({
      state: z.enum(["STAGED", "VALIDATED", "COMMITTED", "FAILED"]).optional(),
      namespace: z.string().min(1).max(200).optional(),
      q: z.string().max(200).optional(),
      from: dateOnly.optional(),
      through: dateOnly.optional(),
      sort: z.string().max(1000).optional(),
    })
    .strict()
    .safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  let sort: z.infer<typeof sortInput>
  try {
    sort = sortInput.parse(
      input.sort
        ? JSON.parse(input.sort)
        : [{ field: "createdAt", direction: "desc" }]
    )
  } catch {
    fail("INVALID_INPUT", 422)
  }
  if (
    new Set(sort.map((s) => s.field)).size !== sort.length ||
    (input.from && input.through && input.from > input.through)
  )
    fail("INVALID_INPUT", 422)
  if (!sort.some((s) => s.field === "id"))
    sort.push({ field: "id", direction: "asc" })
  const required = [
    ...sort.map((s) => s.field),
    ...(input.state ? ["state"] : []),
    ...(input.namespace !== undefined || input.q !== undefined
      ? ["namespace"]
      : []),
    ...(input.from || input.through ? ["createdAt"] : []),
  ]
  const scope = readScope(actor.grants, actor.userId, "ImportBatch", required)
  const where: Prisma.ImportBatchWhereInput = {
    AND: [
      scope,
      {
        ...(input.state ? { state: input.state } : {}),
        ...(input.namespace !== undefined
          ? { namespace: input.namespace }
          : {}),
        ...(input.q !== undefined
          ? {
              AND: [
                {
                  namespace: {
                    contains: input.q.replace(/[\\%_]/g, "\\$&"),
                    mode: "insensitive",
                  },
                },
              ],
            }
          : {}),
        ...(input.from || input.through
          ? {
              createdAt: {
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
            }
          : {}),
      },
    ],
  }
  return {
    where,
    page: input.page,
    pageSize: input.pageSize,
    paging: {
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: sort.map((s) => ({ [s.field]: s.direction })),
    },
  }
}

// Trusted createdBy is used for conditions but never becomes an undeclared DTO key.
function visibleBatch(actor: Actor, row: ImportBatch) {
  const visible = project(actor.ability, "ImportBatch", batchSubject(row))
  visible.redactedFields = visible.redactedFields.filter(
    (f) => f !== "createdBy"
  )
  return visible
}
export async function importQuery(
  tx: Tx,
  actor: Actor,
  name: string,
  raw: unknown
) {
  if (name === "importBatches") {
    const { where, paging, page, pageSize } = importList(actor, raw)
    const [rows, total] = await Promise.all([
      tx.importBatch.findMany({ where, ...paging }),
      tx.importBatch.count({ where }),
    ])
    return {
      ok: true,
      data: rows.map((r) => visibleBatch(actor, r)),
      total,
      page,
      pageSize,
      asOf: new Date().toISOString(),
      redactedFields: [],
    }
  }
  const parsed = z.object({ id }).strict().safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const row = await tx.importBatch.findFirst({
    where: {
      AND: [
        { id: parsed.data.id },
        readScope(actor.grants, actor.userId, "ImportBatch"),
      ],
    },
  })
  if (!row) fail("NOT_FOUND", 404)
  const visible = visibleBatch(actor, row),
    record = subject("ImportBatch", batchSubject(row))
  const leaves = fieldsFor("Document", "read").filter((f) =>
    fieldsFor("ImportBatch", "read").includes(`uploads.${f}`)
  )
  if (!leaves.some((f) => actor.ability.can("read", record, `uploads.${f}`))) {
    visible.redactedFields.push("uploads")
    return visible
  }
  const uploads = await tx.uploadIntent.findMany({
    where: {
      AND: [
        { batchId: row.id, purpose: "IMPORT_SOURCE" },
        readScope(actor.grants, actor.userId, "Document"),
      ],
    },
    orderBy: { id: "asc" },
    include: intentInclude,
  })
  visible.uploads = uploads.map((u) => {
    const data = uploadDTO(u),
      document = subject("Document", documentSubject(u))
    return Object.fromEntries(
      Object.entries(data).filter(([key]) => {
        const allowed =
          actor.ability.can("read", record, `uploads.${key}`) &&
          actor.ability.can("read", document, key) &&
          (key !== "attachmentId" ||
            !u.attachment ||
            actor.ability.can(
              "read",
              subject("Document", documentSubject(u.attachment)),
              "attachmentId"
            ))
        if (!allowed) visible.redactedFields.push(`uploads.${key}`)
        return allowed
      })
    )
  })
  visible.redactedFields = [...new Set(visible.redactedFields)]
  return visible
}
