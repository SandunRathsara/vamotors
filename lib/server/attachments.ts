import "server-only"
import { constants } from "node:fs"
import { open, statfs } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { randomUUID } from "node:crypto"
import type { ImportBatch } from "@prisma/client"
import type {
  Applied,
  Dependency,
  DownloadDTO,
  UploadReady,
} from "../../.planning/implementation/contracts/api"
import { runtimeConfig } from "./config"
import { type Identity, type Actor, currentActor } from "./actor"
import { database, assertEnvironment, type Tx } from "./db"
import { transaction, nextBusinessSequence } from "./transactions"
import { requireFields } from "./permissions"
import { audit, writeReadVersion } from "./audit"
import { inputDigest } from "./idempotency"
import { attachmentCommands, attachmentEnvelope, id } from "./validators"
import { CommandError, fail } from "./errors"
import {
  openPrivateFiles,
  PrivateFileError,
  type PrivateFiles,
  type Declaration,
} from "./private-files"
import { checkDeclaration } from "./private-files/validation"
import {
  batchDTO,
  batchSubject,
  bump,
  checkRefs,
  documentSubject,
  intentInclude,
  loadBatch,
  lockImportActor,
  receiptScope,
  uploadDTO,
  type Intent,
} from "./import-staging"

const fiveMinutes = 300000
const reserve = 3 * 5 * 1024 * 1024
const stores = globalThis as unknown as {
  importPrivateStore?: Promise<PrivateFiles>
  importFileIO?: number
}

/** Operator-maintained, current policy. Missing/expired/unsafe/unknown means STOP.
 * Inventory is deliberately conservative about hardlink aliases and in-flight bytes. */
async function capacity(
  store: PrivateFiles,
  root: string,
  policyPath: string,
  environmentId: string
) {
  try {
    if (!isAbsolute(policyPath)) return false
    const file = await open(
      policyPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    let policy: {
      environmentId?: string
      allowWrites?: boolean
      reviewedThrough?: string
      maxBytes?: number
      minFreeBytes?: number
      maxEntries?: number
    }
    try {
      const stat = await file.stat()
      if (
        !stat.isFile() ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== 0o600 ||
        stat.size > 4096
      )
        return false
      policy = JSON.parse(await file.readFile("utf8"))
    } finally {
      await file.close()
    }
    if (
      policy.environmentId !== environmentId ||
      policy.allowWrites !== true ||
      !policy.reviewedThrough ||
      !(new Date(policy.reviewedThrough).valueOf() > Date.now()) ||
      !Number.isSafeInteger(policy.maxBytes) ||
      policy.maxBytes! < reserve ||
      !Number.isSafeInteger(policy.minFreeBytes) ||
      policy.minFreeBytes! < reserve ||
      !Number.isSafeInteger(policy.maxEntries) ||
      policy.maxEntries! < 10 ||
      policy.maxEntries! > 10000
    )
      return false
    const inventory = await store.inventory(10000),
      disk = await statfs(root)
    return (
      !inventory.truncated &&
      inventory.entries.length + 4 < policy.maxEntries! &&
      inventory.entries.reduce((n, e) => n + e.size, 0) +
        reserve * ((stores.importFileIO ?? 0) + 1) <=
        Math.floor(policy.maxBytes! * 0.85) &&
      disk.bavail * disk.bsize >=
        policy.minFreeBytes! + reserve * ((stores.importFileIO ?? 0) + 1)
    )
  } catch {
    return false
  }
}

export async function privateStorage(): Promise<PrivateFiles> {
  const config = runtimeConfig()
  if (
    config.APP_ENV !== "local" ||
    !config.PRIVATE_FILES_ROOT ||
    !config.PRIVATE_FILES_POLICY
  )
    fail("STORAGE_UNAVAILABLE", 503)
  if (!stores.importPrivateStore) {
    const root = config.PRIVATE_FILES_ROOT,
      policy = config.PRIVATE_FILES_POLICY
    stores.importPrivateStore = openPrivateFiles({
      root,
      environmentId: config.ENVIRONMENT_ID,
      forbiddenRoots: [
        process.cwd(),
        join(process.cwd(), "public"),
        join(process.cwd(), ".next"),
      ],
      mayWrite: async () =>
        capacity(
          await stores.importPrivateStore!,
          root,
          policy,
          config.ENVIRONMENT_ID
        ),
    }).catch((error) => {
      stores.importPrivateStore = undefined
      throw fileError(error)
    })
  }
  return stores.importPrivateStore
}
export async function closeImportStorage() {
  if (stores.importPrivateStore) await (await stores.importPrivateStore).close()
  stores.importPrivateStore = undefined
}
export async function writableStorage() {
  const store = await privateStorage(),
    config = runtimeConfig()
  if (
    !(await capacity(
      store,
      config.PRIVATE_FILES_ROOT!,
      config.PRIVATE_FILES_POLICY!,
      config.ENVIRONMENT_ID
    ))
  )
    throw new CommandError("QUOTA_STOP", 429, true)
  return store
}
async function fileIO<T>(run: () => Promise<T>) {
  if ((stores.importFileIO ?? 0) >= 2)
    throw new CommandError("STORAGE_UNAVAILABLE", 503, true)
  stores.importFileIO = (stores.importFileIO ?? 0) + 1
  try {
    return await run()
  } catch (error) {
    throw fileError(error)
  } finally {
    stores.importFileIO--
  }
}
function fileError(error: unknown): CommandError {
  if (error instanceof CommandError) return error
  if (error instanceof PrivateFileError) {
    if (error.code === "QUOTA_STOP")
      return new CommandError("QUOTA_STOP", 429, true)
    if (error.code === "DOCUMENT_NOT_READY")
      return new CommandError("DOCUMENT_NOT_READY", 409)
    if (
      ["UPLOAD_MISMATCH", "FINAL_CONFLICT", "UNSUPPORTED_VALIDATION"].includes(
        error.code
      )
    )
      return new CommandError("UPLOAD_MISMATCH", 422)
  }
  return new CommandError("STORAGE_UNAVAILABLE", 503, true)
}
export function sanitizeFilename(filename: string) {
  return filename
    .split(/[\\/]/)
    .at(-1)!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 200)
}
const declaration = (u: Intent): Declaration => ({
  size: u.size,
  sha256: u.sha256,
  mime: u.contentType,
  filename: u.filename,
})
const batchRef = (b: ImportBatch): Dependency => ({
  type: "ImportBatch",
  id: b.id,
  revision: b.revision,
})
const uploadRef = (u: Intent): Dependency => ({
  type: "UploadIntent",
  id: u.id,
  revision: u.revision,
})

function authorizeDocument(
  actor: Actor,
  u: Intent,
  action: "put" | "complete"
) {
  const record = documentSubject(u)
  requireFields(actor.ability, "Document", "read", record, [
    "uploadId",
    "revision",
    ...(action === "complete" ? ["attachmentId"] : []),
  ])
  if (u.createdBy === actor.userId)
    requireFields(actor.ability, "Document", "create", record, [
      "target",
      "purpose",
      "filename",
      "contentType",
      "size",
      "sha256",
    ])
  else {
    if (action === "put") fail("FORBIDDEN", 403)
    requireFields(actor.ability, "Document", "update", record, ["uploadId"])
  }
}
async function loadIntent(tx: Tx, actor: Actor, uploadId: string) {
  const source = await tx.uploadIntent.findUnique({ where: { id: uploadId } })
  if (!source) fail("NOT_FOUND", 404)
  const batch = await loadBatch(tx, actor, source.batchId, true)
  await tx.$queryRaw`SELECT id FROM vamotors."UploadIntent" WHERE id=${uploadId}::uuid FOR UPDATE`
  const upload = await tx.uploadIntent.findUniqueOrThrow({
    where: { id: uploadId },
    include: intentInclude,
  })
  if (
    upload.environmentId !== runtimeConfig().ENVIRONMENT_ID ||
    upload.purpose !== "IMPORT_SOURCE"
  )
    fail("NOT_FOUND", 404)
  return { batch, upload }
}
function capturedTarget(batch: ImportBatch, upload: Intent) {
  if (batch.revision !== upload.capturedTargetRevision)
    throw new CommandError("STALE_REVISION", 409, false, [
      batchRef(batch),
      uploadRef(upload),
    ])
  if (batch.state !== "STAGED") fail("INVALID_STATE")
}
const uploadReady = (u: Intent): UploadReady => ({
  ok: true,
  status: "UPLOAD_READY",
  uploadId: u.id,
  revision: u.revision,
  putUrl: `/api/v1/uploads/${u.id}`,
  requiredHeaders: {
    "Content-Type": u.contentType,
    "X-Content-SHA256": u.sha256,
  },
  expiresAt: u.expiresAt.toISOString(),
})

/** Every metadata transition has atomic append-only receipt, audit and read history. */
async function protocolEvidence(
  tx: Tx,
  actor: Actor,
  before: Intent | null,
  upload: Intent,
  commandId: string,
  scope: ReturnType<typeof receiptScope>,
  digest: string,
  errorCode?: string
) {
  const sequence = await nextBusinessSequence(tx),
    payload = uploadDTO(upload)
  await tx.commandReceipt.create({
    data: {
      id: commandId,
      ...scope,
      inputHash: digest,
      result: {
        type: "UploadIntent",
        id: upload.id,
        revision: upload.revision,
      },
      businessSequence: sequence,
    },
  })
  await tx.uploadEvent.create({
    data: {
      uploadId: upload.id,
      revision: upload.revision,
      state: upload.state,
      attemptId: upload.currentAttemptId,
      commandId,
      errorCode,
    },
  })
  await audit(tx, {
    commandId,
    userId: actor.userId,
    entityType: "Document",
    entityId: upload.id,
    action: scope.commandName,
    before: before ? uploadDTO(before) : null,
    after: payload,
  })
  await writeReadVersion(tx, {
    commandId,
    sequence,
    entityType: "Document",
    entityId: upload.id,
    revision: upload.revision,
    payload,
  })
}

export async function initUpload(
  identity: Identity,
  raw: unknown
): Promise<UploadReady> {
  const parsed = attachmentEnvelope("initUpload").safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    input = attachmentCommands.initUpload.parse(envelope.input)
  const filename = sanitizeFilename(input.filename)
  try {
    checkDeclaration({
      filename,
      size: input.size,
      sha256: input.sha256,
      mime: input.contentType,
    })
  } catch (error) {
    throw fileError(error)
  }
  const store = await writableStorage(),
    config = runtimeConfig(),
    uploadId = randomUUID(),
    stagingKey = store.newStageKey(uploadId)
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity),
      batch = await loadBatch(tx, actor, input.target.id, true)
    requireFields(
      actor.ability,
      "Document",
      "create",
      { ...input, createdBy: actor.userId },
      Object.keys(input)
    )
    const scope = receiptScope(
      actor.userId,
      "initUpload",
      envelope.idempotencyKey
    )
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      const result = prior.result as Applied["result"]
      if (result.type !== "UploadIntent") fail("IDEMPOTENCY_MISMATCH")
      const existing = await tx.uploadIntent.findUnique({
        where: { id: result.id },
        include: intentInclude,
      })
      if (!existing || existing.batchId !== batch.id)
        fail("IDEMPOTENCY_MISMATCH")
      authorizeDocument(actor, existing, "put")
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      if (existing.expiresAt <= new Date()) fail("UPLOAD_EXPIRED")
      if (existing.state !== "INIT") fail("INVALID_STATE")
      capturedTarget(batch, existing)
      return uploadReady(existing)
    }
    checkRefs(envelope.expected, [batchRef(batch)])
    if (batch.state !== "STAGED") fail("INVALID_STATE")
    const now = new Date(),
      commandId = randomUUID()
    const upload = await tx.uploadIntent.create({
      data: {
        id: uploadId,
        batchId: batch.id,
        environmentId: config.ENVIRONMENT_ID,
        createdBy: actor.userId,
        createdAt: now,
        purpose: input.purpose,
        filename,
        contentType: input.contentType,
        size: input.size,
        sha256: input.sha256,
        stagingKey,
        capturedTargetRevision: batch.revision,
        expiresAt: new Date(now.valueOf() + fiveMinutes),
        initCommandId: commandId,
      },
      include: intentInclude,
    })
    await protocolEvidence(tx, actor, null, upload, commandId, scope, digest)
    return uploadReady(upload)
  })
}

/** Bounded transport, no JSON/base64 expansion and no storage IO in a transaction. */
export async function putUpload(
  identity: Identity,
  uploadId: string,
  request: Request
) {
  if (!id.safeParse(uploadId).success) fail("INVALID_INPUT", 422)
  const snapshot = await transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity),
      { batch, upload } = await loadIntent(tx, actor, uploadId)
    authorizeDocument(actor, upload, "put")
    capturedTarget(batch, upload)
    if (upload.state !== "INIT") fail("INVALID_STATE")
    if (upload.expiresAt <= new Date()) fail("UPLOAD_EXPIRED")
    return upload
  })
  if (
    request.headers.get("content-type") !== snapshot.contentType ||
    request.headers.get("x-content-sha256") !== snapshot.sha256
  )
    fail("UPLOAD_MISMATCH", 422)
  const length = request.headers.get("content-length")
  if (length && (!/^\d+$/.test(length) || Number(length) !== snapshot.size))
    fail("UPLOAD_MISMATCH", Number(length) > 5242880 ? 413 : 422)
  const reader = request.body?.getReader()
  if (!reader) fail("UPLOAD_MISMATCH", 422)
  const deadline = Math.min(Date.now() + 15000, snapshot.expiresAt.valueOf())
  let transportError: CommandError | undefined
  async function* source() {
    let size = 0
    try {
      while (true) {
        let timer: NodeJS.Timeout | undefined
        const part = await Promise.race([
          reader!.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new CommandError("UPLOAD_EXPIRED", 409)),
              Math.max(0, deadline - Date.now())
            )
          }),
        ]).finally(() => clearTimeout(timer))
        if (part.done) break
        size += part.value.byteLength
        if (size > snapshot.size || size > 5242880) fail("UPLOAD_MISMATCH", 413)
        if (Date.now() >= deadline) fail("UPLOAD_EXPIRED")
        yield part.value
      }
    } catch (error) {
      if (error instanceof CommandError) transportError = error
      throw error
    } finally {
      await reader!.cancel().catch(() => {})
      reader!.releaseLock()
    }
  }
  const store = await writableStorage()
  try {
    await fileIO(() =>
      store.writeStage(snapshot.stagingKey, source(), declaration(snapshot))
    )
  } catch (error) {
    throw transportError ?? error
  }
  await transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity),
      { batch, upload } = await loadIntent(tx, actor, uploadId)
    authorizeDocument(actor, upload, "put")
    capturedTarget(batch, upload)
    if (upload.state !== "INIT" || upload.revision !== snapshot.revision)
      fail("INVALID_STATE")
    if (upload.expiresAt <= new Date()) fail("UPLOAD_EXPIRED")
  })
}

export async function completeUpload(
  identity: Identity,
  raw: unknown
): Promise<Applied> {
  const parsed = attachmentEnvelope("completeUpload").safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data,
    input = attachmentCommands.completeUpload.parse(envelope.input)
  const config = runtimeConfig(),
    digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  // Opening the adapter/capacity policy is external IO, never a transaction retry side effect.
  const store = await privateStorage(),
    attemptId = randomUUID(),
    finalKey = store.newFinalKey(input.uploadId.toLowerCase(), attemptId)
  const claim = await transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity),
      { batch, upload } = await loadIntent(tx, actor, input.uploadId)
    authorizeDocument(actor, upload, "complete")
    const scope = receiptScope(
      actor.userId,
      "completeUpload",
      envelope.idempotencyKey
    )
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      const result = prior.result as Applied["result"]
      if (
        !upload.attachment ||
        result.type !== "Document" ||
        result.id !== upload.attachment.id
      )
        fail("IDEMPOTENCY_MISMATCH")
      requireFields(
        actor.ability,
        "Document",
        "read",
        documentSubject(upload.attachment),
        ["attachmentId", "revision"]
      )
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return {
        replay: {
          ok: true,
          status: "APPLIED",
          commandId: prior.id,
          replayed: true,
          result,
          affected: [uploadRef(upload), batchRef(batch)],
          invalidate: ["documents"],
        } as Applied,
      }
    }
    if (upload.state === "FINAL") {
      checkRefs(envelope.expected, [uploadRef(upload), batchRef(batch)])
      requireFields(
        actor.ability,
        "Document",
        "read",
        documentSubject(upload.attachment!),
        ["attachmentId", "revision"]
      )
      // Explicit fresh-ref reconfirmation is a new no-op receipt, not historical
      // replay and never another attachment, parent bump or protocol transition.
      const commandId = randomUUID(),
        result = { type: "Document", id: upload.attachment!.id, revision: 1 }
      await tx.commandReceipt.create({
        data: { id: commandId, ...scope, inputHash: digest, result },
      })
      return {
        replay: {
          ok: true,
          status: "APPLIED",
          commandId,
          replayed: false,
          result,
          affected: [uploadRef(upload), batchRef(batch)],
          invalidate: ["documents"],
        } as Applied,
      }
    }
    capturedTarget(batch, upload)
    const existingKey = await tx.uploadAttempt.findUnique({
      where: {
        environmentId_createdBy_idempotencyKey: {
          environmentId: config.ENVIRONMENT_ID,
          createdBy: actor.userId,
          idempotencyKey: envelope.idempotencyKey,
        },
      },
    })
    if (
      existingKey &&
      (existingKey.uploadId !== upload.id || existingKey.inputHash !== digest)
    )
      fail("IDEMPOTENCY_MISMATCH")
    const original =
      upload.currentAttempt &&
      upload.currentAttempt.createdBy === actor.userId &&
      upload.currentAttempt.idempotencyKey === envelope.idempotencyKey
    if (original && upload.currentAttempt!.inputHash !== digest)
      fail("IDEMPOTENCY_MISMATCH")
    if (upload.state === "FINALIZING" && upload.claimExpiresAt! > new Date())
      throw new CommandError("COMMAND_IN_PROGRESS", 409, true)
    if (upload.state === "FAILED") fail("INVALID_STATE")
    checkRefs(
      envelope.expected,
      original
        ? [
            {
              type: "UploadIntent",
              id: upload.id,
              revision: upload.currentAttempt!.uploadRevision,
            },
            {
              type: "ImportBatch",
              id: batch.id,
              revision: upload.currentAttempt!.targetRevision,
            },
          ]
        : [uploadRef(upload), batchRef(batch)]
    )
    const now = new Date(),
      recovery = upload.state === "FINALIZING"
    if (!recovery && upload.expiresAt <= now) fail("UPLOAD_EXPIRED")
    const attempt = recovery
      ? upload.currentAttempt!
      : await tx.uploadAttempt.create({
          data: {
            id: attemptId,
            environmentId: config.ENVIRONMENT_ID,
            uploadId: upload.id,
            createdBy: actor.userId,
            claimedAt: now,
            claimExpiresAt: new Date(now.valueOf() + fiveMinutes),
            commandId: randomUUID(),
            idempotencyKey: envelope.idempotencyKey,
            inputHash: digest,
            uploadRevision: upload.revision,
            targetRevision: batch.revision,
            finalKey,
            size: upload.size,
            sha256: upload.sha256,
            contentType: upload.contentType,
          },
        })
    const claimed = await tx.uploadIntent.update({
      where: { id: upload.id },
      data: {
        state: "FINALIZING",
        revision: bump(upload.revision),
        currentAttemptId: attempt.id,
        claimExpiresAt: new Date(now.valueOf() + fiveMinutes),
      },
      include: intentInclude,
    })
    const eventId = randomUUID()
    await protocolEvidence(
      tx,
      actor,
      upload,
      claimed,
      eventId,
      receiptScope(
        actor.userId,
        recovery ? "recoverUpload" : "claimUpload",
        eventId
      ),
      digest
    )
    return { upload: claimed, batch, attempt, recovery, scope }
  })
  if (claim.replay) return claim.replay
  const { upload: claimed, attempt } = claim
  try {
    await fileIO(async () => {
      if (!claim.recovery) {
        const token = await store.validateStage(
          claimed.stagingKey,
          declaration(claimed)
        )
        // The opaque same-instance snapshot is used ONCE; staging is never reread for copy.
        await store.finalize(attempt.finalKey, token)
      }
      // Restart recovery is authoritative readFinal + parser/hash validation, not WeakMap state.
      await store.readFinal(attempt.finalKey, {
        size: attempt.size,
        sha256: attempt.sha256,
        mime: attempt.contentType,
      })
    })
  } catch (error) {
    const safe = fileError(error)
    if (["UPLOAD_MISMATCH", "DOCUMENT_NOT_READY"].includes(safe.code)) {
      // Failure evidence is best effort only; a lost authority leaves a durable claim/orphan.
      await transaction(async (tx) => {
        const actor = await lockImportActor(tx, identity),
          { batch, upload } = await loadIntent(tx, actor, claimed.id)
        authorizeDocument(actor, upload, "complete")
        capturedTarget(batch, upload)
        if (
          upload.revision !== claimed.revision ||
          upload.currentAttemptId !== attempt.id ||
          upload.state !== "FINALIZING"
        )
          return
        const failed = await tx.uploadIntent.update({
          where: { id: upload.id },
          data: {
            revision: bump(upload.revision),
            state: "FAILED",
            claimExpiresAt: null,
          },
          include: intentInclude,
        })
        const eventId = randomUUID()
        await protocolEvidence(
          tx,
          actor,
          upload,
          failed,
          eventId,
          receiptScope(actor.userId, "failUpload", eventId),
          digest,
          safe.code
        )
      }).catch(() => {})
    }
    throw safe
  }
  return transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity),
      { batch, upload } = await loadIntent(tx, actor, claimed.id)
    authorizeDocument(actor, upload, "complete")
    capturedTarget(batch, upload)
    if (
      upload.state !== "FINALIZING" ||
      upload.currentAttemptId !== attempt.id ||
      upload.revision !== claimed.revision ||
      upload.claimExpiresAt! <= new Date()
    )
      fail("STALE_REVISION")
    const sequence = await nextBusinessSequence(tx),
      attachmentId = randomUUID(),
      now = new Date()
    const attachment = await tx.attachment.create({
      data: {
        id: attachmentId,
        batchId: batch.id,
        uploadIntentId: upload.id,
        attemptId: attempt.id,
        environmentId: upload.environmentId,
        createdBy: upload.createdBy,
        purpose: upload.purpose,
        filename: upload.filename,
        contentType: attempt.contentType,
        size: attempt.size,
        sha256: attempt.sha256,
        finalKey: attempt.finalKey,
        verifiedAt: now,
        commandId: attempt.commandId,
      },
    })
    const final = await tx.uploadIntent.update({
      where: { id: upload.id },
      data: {
        state: "FINAL",
        revision: bump(upload.revision),
        claimExpiresAt: null,
      },
      include: intentInclude,
    })
    const owner = await tx.importBatch.update({
      where: { id: batch.id },
      data: { revision: bump(batch.revision) },
    })
    const result = { type: "Document", id: attachmentId, revision: 1 }
    await tx.commandReceipt.create({
      data: {
        id: attempt.commandId,
        ...receiptScope(
          attempt.createdBy,
          "completeUpload",
          attempt.idempotencyKey
        ),
        inputHash: attempt.inputHash,
        result,
        businessSequence: sequence,
      },
    })
    let commandId = attempt.commandId
    if (
      claim.scope.actorKey !== `USER:${attempt.createdBy}` ||
      claim.scope.idempotencyKey !== attempt.idempotencyKey
    ) {
      commandId = randomUUID()
      await tx.commandReceipt.create({
        data: { id: commandId, ...claim.scope, inputHash: digest, result },
      })
    }
    await tx.uploadEvent.create({
      data: {
        uploadId: upload.id,
        revision: final.revision,
        state: "FINAL",
        attemptId: attempt.id,
        commandId: attempt.commandId,
      },
    })
    for (const change of [
      {
        entityType: "Document" as const,
        entityId: upload.id,
        revision: final.revision,
        before: uploadDTO(upload),
        after: uploadDTO(final),
      },
      {
        entityType: "ImportBatch" as const,
        entityId: batch.id,
        revision: owner.revision,
        before: batchDTO(batch),
        after: batchDTO(owner),
      },
    ]) {
      await audit(tx, {
        ...change,
        commandId: attempt.commandId,
        userId: actor.userId,
        action: "completeUpload",
      })
      await writeReadVersion(tx, {
        commandId: attempt.commandId,
        sequence,
        entityType: change.entityType,
        entityId: change.entityId,
        revision: change.revision,
        payload: change.after,
      })
    }
    await audit(tx, {
      commandId: attempt.commandId,
      userId: actor.userId,
      entityType: "Document",
      entityId: attachment.id,
      action: "completeUpload",
      before: null,
      after: {
        attachmentId: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        size: attachment.size,
      },
    })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [uploadRef(final), batchRef(owner)],
      invalidate: ["documents"],
    }
  })
}

export async function authorizedAttachment(
  tx: Tx,
  actor: Actor,
  attachmentId: string
) {
  const row = await tx.attachment.findUnique({ where: { id: attachmentId } })
  if (!row) fail("NOT_FOUND", 404)
  const target = await tx.importBatch.findUnique({ where: { id: row.batchId } })
  if (!target) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "ImportBatch", "read", batchSubject(target), [
    "id",
    "uploads.attachmentId",
  ])
  requireFields(actor.ability, "Document", "read", documentSubject(row), [
    "attachmentId",
    "filename",
    "contentType",
    "size",
    "sha256",
    "bytes",
  ])
  return row
}
export async function downloadQuery(
  tx: Tx,
  actor: Actor,
  attachmentId: string
): Promise<DownloadDTO> {
  if (!id.safeParse(attachmentId).success) fail("INVALID_INPUT", 422)
  const row = await authorizedAttachment(tx, actor, attachmentId),
    expires = Date.now() + 60000
  return {
    ok: true,
    attachmentId: row.id,
    url: `/api/v1/attachments/${row.id}?expires=${expires}`,
    expiresAt: new Date(expires).toISOString(),
    filename: row.filename,
    contentType: row.contentType,
    size: row.size,
    sha256: row.sha256,
  }
}
export async function downloadAttachment(
  identity: Identity,
  attachmentId: string,
  params: URLSearchParams
) {
  if (
    !id.safeParse(attachmentId).success ||
    params.size !== 1 ||
    !/^\d{13}$/.test(params.get("expires") ?? "")
  )
    fail("INVALID_INPUT", 422)
  const expires = Number(params.get("expires"))
  if (expires <= Date.now() || expires > Date.now() + 60000)
    fail("DOCUMENT_NOT_READY")
  const authorize = () =>
    database().$transaction(
      async (tx) => {
        await assertEnvironment(tx)
        return authorizedAttachment(
          tx,
          await currentActor(tx, identity),
          attachmentId
        )
      },
      { isolationLevel: "RepeatableRead" }
    )
  const row = await authorize(),
    store = await privateStorage()
  const bytes = await fileIO(() =>
    store.readFinal(row.finalKey, {
      size: row.size,
      sha256: row.sha256,
      mime: row.contentType,
    })
  )
  await authorize() // Revocation during filesystem IO wins before sending any bytes.
  if (expires <= Date.now()) fail("DOCUMENT_NOT_READY")
  const fallback = row.filename
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/["\\]/g, "_")
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "private,no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": row.contentType,
      "Content-Length": String(row.size),
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`,
    },
  })
}
