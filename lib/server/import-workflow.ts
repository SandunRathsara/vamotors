import "server-only"
import { createHash, randomUUID } from "node:crypto"
import { z } from "zod"
import type { ImportBatch } from "@prisma/client"
import type {
  Applied,
  ImportRowInput,
  LegacyRef,
} from "../../.planning/implementation/contracts/api"
import { currentActor, type Actor, type Identity } from "./actor"
import { assertEnvironment, database, type Tx } from "./db"
import { authorizedAttachment, privateStorage } from "./attachments"
import { audit, writeReadVersion } from "./audit"
import { CommandError, fail } from "./errors"
import { canonical } from "./idempotency"
import {
  batchDTO,
  batchSubject,
  checkRefs,
  loadBatch,
  lockImportActor,
  receiptScope,
} from "./import-staging"
import {
  adapterFor,
  ImportRowError,
  need,
  type ImportContext,
} from "./import-adapters"
import {
  computeControlTotals,
  computeImportDigest,
  normalizeVehicleIdentity,
  parseImportBuffer,
  type ImportParseError,
} from "./import-parsers"
import { requireFields } from "./permissions"
import {
  isDbConstraintError,
  nextBusinessSequence,
  transaction,
} from "./transactions"
import { customerEnvelope, id, importTypes } from "./validators"

const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex")
const envelope = customerEnvelope("createCustomer")
const source = z
  .object({
    attachmentId: id,
    type: z.enum(importTypes),
    sheetName: z.string().min(1).max(31).optional(),
  })
  .strict()
const digest = z.string().regex(/^[0-9a-f]{64}$/)
const sources = z.array(source).min(1).max(importTypes.length)
const previewInput = envelope.extend({
  input: z
    .object({
      batchId: id,
      sources,
      templateVersion: z.literal(1),
      namespace: z.string().min(1).max(200),
      mappings: z.tuple([]).optional(),
    })
    .strict(),
})
const confirmInput = envelope.extend({
  input: z
    .object({
      batchId: id,
      previewHash: digest,
      controlTotals: z.record(z.unknown()),
    })
    .strict(),
})
const validationSchema = z.object({
  previewHash: digest,
  sources,
  sequence: z.string(),
  revision: z.number().int(),
})

type Source = z.infer<typeof source>
type Issue = ImportParseError & { attachmentId?: string }
type Row = { source: Source; rowNumber: number; data: ImportRowInput }
type Prepared = {
  files: { source: Source; sha256: string }[]
  rows: Row[]
  errors: Issue[]
}
const maxRows = 24
const maxWork = 40
const maxSourceBytes = 1024 * 1024

function authority(actor: Actor, batch: ImportBatch) {
  if (!actor.administrator) fail("FORBIDDEN", 403)
  requireFields(actor.ability, "ImportBatch", "read", batchSubject(batch), [
    "state",
    "types",
    "namespace",
    "uploads.attachmentId",
  ])
}

async function prepare(
  identity: Identity,
  batchId: string,
  selected: Source[]
): Promise<Prepared> {
  const files = await database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      const batch = await loadBatch(tx, actor, batchId)
      authority(actor, batch)
      requireFields(
        actor.ability,
        "ImportBatch",
        "update",
        batchSubject(batch),
        ["uploads"]
      )
      if (batch.state === "COMMITTED") fail("IMPORT_DUPLICATE")
      if (
        new Set(selected.map((s) => s.type)).size !== batch.types.length ||
        new Set(selected.map((s) => s.attachmentId)).size !== selected.length ||
        selected.length !== batch.types.length ||
        selected.some(
          (s) => !batch.types.includes(s.type) || !adapterFor(s.type)
        )
      )
        fail("IMPORT_INVALID", 422)
      const rows = []
      for (const source of selected) {
        const row = await authorizedAttachment(tx, actor, source.attachmentId)
        if (row.batchId !== batch.id || row.purpose !== "IMPORT_SOURCE")
          fail("NOT_FOUND", 404)
        rows.push({ source, row, namespace: batch.namespace })
      }
      return rows
    },
    { isolationLevel: "RepeatableRead" }
  )
  if (files.reduce((total, f) => total + f.row.size, 0) > maxSourceBytes)
    throw new CommandError(
      "IMPORT_INVALID",
      422,
      false,
      undefined,
      "Selected sources may total at most 1 MiB."
    )
  if (new Set(files.map((f) => f.row.sha256)).size !== files.length)
    fail("IMPORT_DUPLICATE", 409)
  const store = await privateStorage()
  const prepared: Prepared = { files: [], rows: [], errors: [] }
  for (const { source, row, namespace } of files) {
    let bytes: Uint8Array
    try {
      bytes = await store.readImportSource(row.finalKey, {
        size: row.size,
        sha256: row.sha256,
        mime: row.contentType,
      })
    } catch {
      fail("STORAGE_UNAVAILABLE", 503)
    }
    const parsed = await parseImportBuffer(
      source.type,
      row.contentType === "text/csv" ? "CSV" : "XLSX",
      bytes,
      {
        namespace,
        sheetName: source.sheetName,
        maxRows,
      }
    )
    prepared.files.push({ source, sha256: row.sha256 })
    prepared.errors.push(
      ...parsed.errors.map((e) => ({ ...e, attachmentId: row.id }))
    )
    if (!parsed.rows.length && !parsed.errors.length)
      prepared.errors.push({
        rowNumber: 1,
        field: "file",
        code: "EMPTY_SOURCE",
        message: "Include at least one data row",
        attachmentId: row.id,
      })
    for (const entry of parsed.rows)
      if (entry.normalized)
        prepared.rows.push({
          source,
          rowNumber: entry.rowNumber,
          data: entry.normalized,
        })
  }
  if (
    prepared.rows.length > maxRows ||
    prepared.rows.reduce(
      (n, r) => n + (adapterFor(r.data.type)?.work?.(r.data) ?? 1),
      0
    ) > maxWork
  )
    prepared.errors.push({
      rowNumber: 1,
      field: "batch",
      code: "BATCH_LIMIT",
      message:
        "Use at most 24 rows and 40 operations per batch. Import prerequisite records first.",
    })
  return prepared
}

const rowIssue = (
  row: Row,
  field: string,
  code: string,
  message: string
): Issue => ({
  field,
  code,
  message,
  rowNumber: row.rowNumber,
  sourceKey: row.data.sourceKey,
  attachmentId: row.source.attachmentId,
})
const getKey = (type: string, sourceKey: string) =>
  JSON.stringify([type, sourceKey])
const keysOf = (row: Row) => [
  ...new Set([
    row.data.sourceKey,
    ...(adapterFor(row.data.type)?.keys?.(row.data) ?? []),
  ]),
]
const referenceKey = (ref: LegacyRef) =>
  "existingId" in ref ? ref.existingId : getKey(ref.type, ref.sourceKey)
const vehicleIdentity = (row: Extract<ImportRowInput, { type: "VEHICLES" }>) =>
  JSON.stringify([
    normalizeVehicleIdentity(row.payload.vehicle.engineNumber),
    normalizeVehicleIdentity(row.payload.vehicle.chassisNumber),
  ])

function order(rows: Row[], namespace: string, errors: Issue[]) {
  const sources = new Map<string, Row>()
  for (const row of rows) {
    for (const key of keysOf(row)) {
      const qualified = getKey(row.data.type, key)
      if (sources.has(qualified))
        errors.push(
          rowIssue(
            row,
            "sourceKey",
            "IMPORT_DUPLICATE",
            "Source or cycle key is repeated"
          )
        )
      sources.set(qualified, row)
    }
  }
  const prerequisites = (row: Row) => {
    const data = row.data
    const deps = new Set<Row>()
    for (const ref of adapterFor(data.type)?.dependencies?.(data) ?? []) {
      if (ref && !("existingId" in ref) && ref.namespace === namespace) {
        const dependency = sources.get(referenceKey(ref))
        if (dependency) deps.add(dependency)
      }
    }
    if (data.type === "SALES" || data.type === "REPAIRS") {
      for (const repair of rows) {
        if (
          repair.data.type !== "REPAIRS" ||
          repair === row ||
          referenceKey(repair.data.payload.cycle) !==
            referenceKey(data.payload.cycle)
        )
          continue
        if (
          data.type === "SALES" ||
          repair.data.payload.sentDate < data.payload.sentDate
        )
          deps.add(repair)
      }
    }
    if (data.type === "VEHICLES" && data.payload.cycleNumber > 1) {
      const earlier = rows.find(
        (r) =>
          r.data.type === "VEHICLES" &&
          vehicleIdentity(r.data) === vehicleIdentity(data) &&
          r.data.payload.cycleNumber === data.payload.cycleNumber - 1
      )
      if (earlier) {
        deps.add(earlier)
        for (const sale of rows)
          if (
            sale.data.type === "SALES" &&
            sources.get(referenceKey(sale.data.payload.cycle)) === earlier
          )
            deps.add(sale)
      }
    }
    return deps
  }
  const pending = rows.map((row) => ({ row, deps: prerequisites(row) }))
  const result: Row[] = []
  while (pending.length) {
    const next = pending.findIndex(({ deps }) =>
      [...deps].every((dep) => result.includes(dep))
    )
    if (next === -1) {
      for (const { row } of pending)
        errors.push(
          rowIssue(
            row,
            "references",
            "DEPENDENCY_CYCLE",
            "Source references contain a dependency cycle"
          )
        )
      break
    }
    result.push(pending.splice(next, 1)[0].row)
  }
  return result
}

async function runGraph(
  tx: Tx,
  identity: Identity,
  batch: ImportBatch,
  prepared: Prepared,
  preview: boolean
) {
  const errors = [...prepared.errors]
  const rows = order(prepared.rows, batch.namespace, errors)
  const priorFiles = await tx.importedFile.findMany({
    where: { sha256: { in: prepared.files.map((f) => f.sha256) } },
    select: { sha256: true },
  })
  for (const file of prepared.files.filter((f) =>
    priorFiles.some((p) => p.sha256 === f.sha256)
  ))
    errors.push({
      attachmentId: file.source.attachmentId,
      rowNumber: 1,
      field: "file",
      code: "IMPORT_DUPLICATE",
      message: "This exact file has already been committed",
    })
  if (errors.length) return errors

  const results = new Map<string, string>()
  const costIds = new Map<string, string>()
  const ctx: ImportContext = {
    tx,
    identity,
    key: getKey,
    costIds,
    cycleCloseDates: new Map(),
    releaseAfterRepair: new Set(),
    async resolve(ref, field) {
      if ("existingId" in ref) return ref.existingId
      const namespace = ref.namespace || batch.namespace
      const local =
        namespace === batch.namespace && results.get(referenceKey(ref))
      if (local) return local
      const committed = await tx.importSourceRow.findFirst({
        where: {
          namespace,
          sourceType: ref.type,
          OR: [
            { sourceKey: ref.sourceKey },
            { aliases: { has: ref.sourceKey } },
          ],
        },
        include: { targetVersion: true },
      })
      need(
        committed,
        field,
        "Reference does not match a valid source row or an existing ID"
      )
      return committed.targetVersion.entityId
    },
  }
  const imported = []
  for (const row of rows) {
    const keys = keysOf(row)
    const priorCosts = preview ? new Map(costIds) : null
    if (preview) await tx.$executeRawUnsafe("SAVEPOINT import_row")
    try {
      const prior = await tx.importSourceRow.findFirst({
        where: {
          namespace: batch.namespace,
          sourceType: row.data.type,
          OR: [{ sourceKey: { in: keys } }, { aliases: { hasSome: keys } }],
        },
      })
      if (prior)
        throw new ImportRowError(
          "sourceKey",
          "This source key was already committed in this namespace",
          "IMPORT_DUPLICATE"
        )
      const applied = await adapterFor(row.data.type)!.apply(ctx, row.data)
      const version = await tx.entityReadVersion.findFirstOrThrow({
        where: {
          entityType: applied.result.type,
          entityId: applied.result.id,
          commandId: applied.commandId,
        },
      })
      for (const key of keys)
        results.set(getKey(row.data.type, key), applied.result.id)
      imported.push({
        row,
        keys,
        versionId: version.id,
        targetId: applied.result.id,
        sequence: version.sequence,
      })
      if (preview) await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_row")
    } catch (error) {
      const domain = error instanceof CommandError
      const validation = error instanceof z.ZodError
      const constraint = isDbConstraintError(error)
      if (!domain && !constraint && !validation) throw error
      const code = domain
        ? error.code
        : validation
          ? "INVALID_INPUT"
          : "IMPORT_CONSTRAINT"
      const field =
        error instanceof ImportRowError
          ? error.field
          : validation
            ? error.issues[0]?.path.join(".") || "row"
            : "row"
      const message = domain
        ? (error.safeMessage ?? `Domain validation rejected this row (${code})`)
        : validation
          ? (error.issues[0]?.message ?? "Invalid value")
          : "A database constraint rejected this row"
      if (!preview)
        throw new CommandError(
          code,
          domain ? error.status : 422,
          false,
          undefined,
          `Row ${row.rowNumber} (${row.data.type}), ${field}: ${message}`
        )
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_row")
      await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_row")
      costIds.clear()
      for (const [key, id] of priorCosts!) costIds.set(key, id)
      errors.push(rowIssue(row, field, code, message))
    }
  }
  if (errors.length) return errors
  for (const { row, targetId } of imported) {
    if (row.data.type === "VEHICLES") {
      const expected = row.data.payload
      const cycle = await tx.purchaseRecord.findUniqueOrThrow({
        where: { id: targetId },
      })
      if (
        cycle.status !== expected.status ||
        cycle.available !== expected.available
      )
        errors.push(
          rowIssue(
            row,
            "status",
            "INVALID_STATE",
            "Companion repair or sale rows do not produce the declared cycle state"
          )
        )
    } else if (
      row.data.type === "SALES" &&
      row.data.payload.tradeIn?.acquiredCycle
    ) {
      let expected: string
      try {
        expected = await ctx.resolve(
          row.data.payload.tradeIn.acquiredCycle,
          "tradeInAcquiredCycle"
        )
      } catch (error) {
        if (!(error instanceof ImportRowError)) throw error
        errors.push(rowIssue(row, error.field, error.code, error.safeMessage!))
        continue
      }
      const actual = await tx.tradeInConsideration.findUnique({
        where: { saleCaseId: targetId },
      })
      if (actual?.acquiredPurchaseId !== expected)
        errors.push(
          rowIssue(
            row,
            "tradeInAcquiredCycle",
            "INVALID_STATE",
            "Trade-in intake does not match the declared acquisition cycle"
          )
        )
    }
  }
  if (preview || errors.length) return errors

  await tx.importedFile.createMany({
    data: prepared.files.map((f) => ({
      sha256: f.sha256,
      attachmentId: f.source.attachmentId,
      batchId: batch.id,
    })),
  })
  for (const { row, keys, versionId, targetId, sequence } of imported) {
    const file = prepared.files.find(
      (f) => f.source.attachmentId === row.source.attachmentId
    )!
    await tx.importSourceRow.create({
      data: {
        batchId: batch.id,
        fileHash: file.sha256,
        namespace: batch.namespace,
        sourceType: row.data.type,
        sourceKey: keys[0],
        aliases: keys.slice(1),
        rowNumber: row.rowNumber,
        metadata: row.data.legacy ?? undefined,
        targetVersionId: versionId,
      },
    })
    if (row.data.type === "VEHICLES") {
      const cycle = await tx.purchaseRecord.findUniqueOrThrow({
        where: { id: targetId },
        select: { vehicleId: true },
      })
      const version = await tx.entityReadVersion.findUniqueOrThrow({
        where: {
          entityType_entityId_sequence: {
            entityType: "Vehicle",
            entityId: cycle.vehicleId,
            sequence,
          },
        },
      })
      await tx.importSourceRow.create({
        data: {
          batchId: batch.id,
          fileHash: file.sha256,
          namespace: batch.namespace,
          sourceType: "VEHICLE_IDENTITY",
          sourceKey: keys[0],
          rowNumber: row.rowNumber,
          targetVersionId: version.id,
        },
      })
    }
  }
  return errors
}

async function transition(
  tx: Tx,
  actor: Actor,
  batch: ImportBatch,
  commandName: "previewImport" | "confirmImport",
  key: string,
  inputHash: string,
  value: z.infer<typeof validationSchema>,
  sequence: bigint
) {
  const commandId = randomUUID()
  const result = {
    type: "ImportBatch" as const,
    id: batch.id,
    revision: batch.revision + 1,
  }
  await tx.commandReceipt.create({
    data: {
      id: commandId,
      ...receiptScope(actor.userId, commandName, key),
      inputHash,
      result,
      businessSequence: sequence,
    },
  })
  const after = await tx.importBatch.update({
    where: { id: batch.id },
    data: {
      revision: result.revision,
      state: commandName === "previewImport" ? "VALIDATED" : "COMMITTED",
      workflowCommandId: commandId,
      validation: value,
    },
  })
  await audit(tx, {
    commandId,
    userId: actor.userId,
    entityType: "ImportBatch",
    entityId: batch.id,
    action: commandName,
    before: batchDTO(batch),
    after: batchDTO(after),
  })
  await writeReadVersion(tx, {
    commandId,
    sequence,
    entityType: "ImportBatch",
    entityId: batch.id,
    revision: after.revision,
    payload: batchDTO(after),
  })
  return { commandId, result }
}

function previewDigest(
  batchId: string,
  revision: number,
  prepared: Prepared,
  controlTotals: unknown
) {
  return hash({
    batchId,
    revision,
    files: prepared.files,
    controlTotals,
    normalizedHash: computeImportDigest(prepared.rows.map((row) => row.data)),
  })
}

export async function previewImport(identity: Identity, raw: unknown) {
  const parsed = previewInput.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const { input, expected, idempotencyKey } = parsed.data
  const prepared = await prepare(identity, input.batchId, input.sources)
  const inputHash = hash(parsed.data)
  const controlTotals = computeControlTotals(prepared.rows.map((r) => r.data))
  return transaction(
    async (tx) => {
      const actor = await lockImportActor(tx, identity)
      const batch = await loadBatch(tx, actor, input.batchId, true)
      authority(actor, batch)
      if (batch.state === "COMMITTED") fail("IMPORT_DUPLICATE")
      if (input.namespace !== batch.namespace) fail("IMPORT_STALE")
      for (const file of prepared.files)
        await authorizedAttachment(tx, actor, file.source.attachmentId)
      const scope = receiptScope(actor.userId, "previewImport", idempotencyKey)
      const prior = await tx.commandReceipt.findUnique({
        where: { environmentId_actorKey_commandName_idempotencyKey: scope },
      })
      let errors: Issue[] = []
      if (prior) {
        if (prior.inputHash !== inputHash) fail("IDEMPOTENCY_MISMATCH")
        const saved = validationSchema.safeParse(batch.validation)
        const before = await tx.businessSequence.findUniqueOrThrow({
          where: { id: 1 },
        })
        if (
          !saved.success ||
          batch.workflowCommandId !== prior.id ||
          saved.data.revision !== batch.revision ||
          saved.data.previewHash !==
            previewDigest(batch.id, batch.revision, prepared, controlTotals) ||
          saved.data.sequence !== before.value.toString()
        )
          fail("IMPORT_STALE")
      } else {
        checkRefs(expected, [
          { type: "ImportBatch", id: batch.id, revision: batch.revision },
        ])
        await tx.$executeRawUnsafe("SAVEPOINT import_preview")
        errors = await runGraph(tx, identity, batch, prepared, true)
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT import_preview")
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT import_preview")
      }
      const revision = batch.revision + (!errors.length && !prior ? 1 : 0)
      const previewHash = previewDigest(
        batch.id,
        revision,
        prepared,
        controlTotals
      )
      if (!errors.length && !prior) {
        const sequence = await nextBusinessSequence(tx)
        await transition(
          tx,
          actor,
          batch,
          "previewImport",
          idempotencyKey,
          inputHash,
          {
            previewHash,
            sources: input.sources,
            sequence: sequence.toString(),
            revision,
          },
          sequence
        )
      }
      return {
        ok: true as const,
        status: "IMPORT_PREVIEW" as const,
        batchId: batch.id,
        revision,
        previewHash,
        valid: !errors.length,
        errors,
        controlTotals,
        rows: prepared.rows.map((r) => ({
          attachmentId: r.source.attachmentId,
          row: r.rowNumber,
          type: r.data.type,
          sourceKey: r.data.sourceKey,
          normalized: r.data,
        })),
      }
    },
    undefined,
    1
  )
}

export async function confirmImport(
  identity: Identity,
  raw: unknown
): Promise<Applied> {
  const parsed = confirmInput.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const { input, expected, idempotencyKey } = parsed.data
  const snapshot = await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    const actor = await currentActor(tx, identity)
    const batch = await loadBatch(tx, actor, input.batchId)
    authority(actor, batch)
    return batch
  })
  const validation = validationSchema.safeParse(snapshot.validation)
  if (!validation.success || validation.data.previewHash !== input.previewHash)
    fail("IMPORT_STALE")
  const prepared =
    snapshot.state === "COMMITTED"
      ? null
      : await prepare(identity, input.batchId, validation.data.sources)
  return transaction(
    async (tx) => {
      const actor = await lockImportActor(tx, identity)
      const batch = await loadBatch(tx, actor, input.batchId, true)
      authority(actor, batch)
      const inputHash = hash(parsed.data)
      const scope = receiptScope(actor.userId, "confirmImport", idempotencyKey)
      const prior = await tx.commandReceipt.findUnique({
        where: { environmentId_actorKey_commandName_idempotencyKey: scope },
      })
      const invalidate: Applied["invalidate"] = [
        "documents",
        "customers",
        "parties",
        "inventory",
        "purchases",
        "repairs",
        "sales",
        "finance",
        "reports",
        "dashboard",
      ]
      if (prior) {
        if (
          prior.inputHash !== inputHash ||
          prior.id !== batch.workflowCommandId
        )
          fail("IDEMPOTENCY_MISMATCH")
        const result = prior.result as Applied["result"]
        return {
          ok: true,
          status: "APPLIED",
          commandId: prior.id,
          result,
          replayed: true,
          affected: [
            { type: "ImportBatch", id: batch.id, revision: batch.revision },
          ],
          invalidate,
        }
      }
      if (batch.state === "COMMITTED") fail("IMPORT_DUPLICATE")
      checkRefs(expected, [
        { type: "ImportBatch", id: batch.id, revision: batch.revision },
      ])
      if (
        !prepared ||
        batch.state !== "VALIDATED" ||
        batch.workflowCommandId !== snapshot.workflowCommandId ||
        batch.revision !== validation.data.revision
      )
        fail("IMPORT_STALE")
      for (const file of prepared.files)
        await authorizedAttachment(tx, actor, file.source.attachmentId)
      const controlTotals = computeControlTotals(
        prepared.rows.map((r) => r.data)
      )
      if (
        prepared.errors.length ||
        hash(input.controlTotals) !== hash(controlTotals) ||
        input.previewHash !==
          previewDigest(batch.id, batch.revision, prepared, controlTotals)
      )
        fail("IMPORT_STALE")
      const current = await tx.businessSequence.findUniqueOrThrow({
        where: { id: 1 },
      })
      if (current.value.toString() !== validation.data.sequence)
        fail("IMPORT_STALE")

      const errors = await runGraph(tx, identity, batch, prepared, false)
      if (errors.length)
        throw new CommandError(
          errors[0].code,
          422,
          false,
          undefined,
          `Row ${errors[0].rowNumber}: ${errors[0].message}`
        )
      const transitionResult = await transition(
        tx,
        actor,
        batch,
        "confirmImport",
        idempotencyKey,
        inputHash,
        validation.data,
        await nextBusinessSequence(tx)
      )
      return {
        ok: true,
        status: "APPLIED",
        ...transitionResult,
        replayed: false,
        affected: [
          {
            type: "ImportBatch",
            id: batch.id,
            revision: transitionResult.result.revision,
          },
        ],
        invalidate,
      }
    },
    undefined,
    1
  )
}
