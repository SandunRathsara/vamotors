import "server-only"
import { createHash, randomUUID, timingSafeEqual } from "node:crypto"
import { lstat, readFile } from "node:fs/promises"
import { isAbsolute } from "node:path"
import { subject } from "@casl/ability"
import type { Prisma } from "@prisma/client"
import { currentActor, userAuthority, type Identity } from "./actor"
import { notify } from "./audit"
import { runtimeConfig } from "./config"
import { database, type Tx } from "./db"
import { inputDigest } from "./idempotency"
import { CommandError, fail } from "./errors"
import { project, requireFields } from "./permissions"
import {
  lockCommitment,
  publishCommitment,
  transitionCommitment,
} from "./reservation-sales"
import { loadSale, saleAuth } from "./sales"
import { nextBusinessSequence, transaction } from "./transactions"
import { expiryEnvelope, id } from "./validators"

const systemKey = "SYSTEM:RESERVATION_EXPIRY"
const abandonedAfterMs = 120000
const due = (cutoff: Date): Prisma.ReservationWhereInput => ({
  state: "ACTIVE",
  OR: [
    { expiresAt: { lte: cutoff } },
    { warningAt: { lte: cutoff }, warnedAt: null },
  ],
})

export async function authenticateScheduler(request: Request) {
  if (runtimeConfig().APP_ENV !== "local") fail("NOT_FOUND", 404)
  const path = process.env.EXPIRY_SECRET_FILE
  if (!path || !isAbsolute(path)) fail("NOT_FOUND", 404)
  const info = await lstat(path)
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== 0o600 ||
    info.size > 256
  )
    fail("FORBIDDEN", 403)
  const token = (await readFile(path, "utf8")).trim()
  const presented = request.headers.get("authorization") ?? ""
  const digest = (value: string) => createHash("sha256").update(value).digest()
  if (
    token.length < 32 ||
    !timingSafeEqual(digest(presented), digest(`Bearer ${token}`))
  )
    fail("UNAUTHENTICATED", 401)
}

async function runner(tx: Tx, identity: Identity | null) {
  await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
  if (!identity) return null
  const actor = await currentActor(tx, identity)
  requireFields(actor.ability, "ReservationExpiryJob", "run", {}, [
    "through",
    "cursor",
    "limit",
  ])
  return actor.userId
}

function parseCursor(cursor?: string) {
  if (!cursor) return null
  const [date, identifier, extra] = cursor.split("/")
  const expiresAt = new Date(date)
  if (
    extra ||
    !id.safeParse(identifier).success ||
    !Number.isFinite(+expiresAt) ||
    expiresAt.toISOString() !== date
  )
    fail("INVALID_INPUT", 422)
  return { expiresAt, id: identifier }
}

export async function processReservation(
  identity: Identity | null,
  saleId: string,
  cycleId: string,
  cutoff: Date,
  existingTx?: Tx
) {
  return transaction(async (tx) => {
    const sequence = await nextBusinessSequence(tx)
    const userId = await runner(tx, identity)
    await lockCommitment(tx, cycleId, saleId)
    const sale = await loadSale(tx, saleId)
    const row = sale?.reservation
    if (!sale || !row || sale.state !== "RESERVED" || row.state !== "ACTIVE")
      return "skipped"
    const expired = row.expiresAt <= cutoff
    if (!expired && (row.warnedAt || row.warningAt > cutoff)) return "skipped"
    const kind = expired ? "ADVANCE_EXPIRED" : "ADVANCE_EXPIRING"
    const commandId = randomUUID()
    const eventKey = `reservation:${row.id}:${kind}`
    const action = "runExpiry"
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        environmentId: runtimeConfig().ENVIRONMENT_ID,
        actorKey: userId ? `USER:${userId}` : systemKey,
        commandName: action,
        idempotencyKey: commandId,
        inputHash: createHash("sha256").update(eventKey).digest("hex"),
        businessSequence: sequence,
        result: { type: "Reservation", id: row.id, revision: row.revision + 1 },
      },
    })
    await tx.reservation.update({
      where: { id: row.id },
      data: {
        revision: { increment: 1 },
        ...(expired
          ? { state: "EXPIRED", expiredAt: row.expiresAt }
          : { warnedAt: cutoff }),
      },
    })
    if (expired) {
      await tx.saleCase.update({
        where: { id: sale.id },
        data: { state: "EXPIRED", revision: { increment: 1 } },
      })
      await transitionCommitment(
        tx,
        { commandId, sequence, userId, action },
        sale.purchaseRecord,
        "ADVANCE_EXPIRED",
        row.expiresAt
      )
    }
    const recipients = await tx.user.findMany({
      where: { active: true },
      select: { id: true },
    })
    for (const recipient of existingTx ? [] : recipients) {
      const authority = await userAuthority(tx, recipient.id)
      const saleSubject = subject("SaleCase", saleAuth(sale))
      if (
        !authority?.ability.can(
          "read",
          subject("Reservation", { id: row.id }),
          "id"
        ) ||
        !authority.ability.can("read", saleSubject, "id") ||
        ![
          "convertReservation",
          "cancelRetained",
          "startFinance",
          "refund",
        ].some((action) =>
          authority.ability.can("update", saleSubject, action)
        ) ||
        !authority.ability.can(
          "read",
          subject("Notification", { recipientUserId: recipient.id }),
          "target"
        )
      )
        continue
      await notify(
        tx,
        { commandId, userId },
        {
          recipientUserId: recipient.id,
          eventKey,
          kind,
          targetType: "SaleCase",
          targetId: sale.id,
        }
      )
    }
    await publishCommitment(
      tx,
      { commandId, sequence, userId, action },
      sale.purchaseRecord,
      sale.id,
      sale
    )
    return expired ? "expired" : "warned"
  }, existingTx)
}

export async function executeExpiry(identity: Identity | null, raw: unknown) {
  const parsed = expiryEnvelope.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const { idempotencyKey: runKey, input } = parsed.data
  const now = new Date()
  const requested = input.through && new Date(input.through)
  if (requested && requested > now) fail("INVALID_INPUT", 422)
  const position = parseCursor(input.cursor)
  const inputHash = inputDigest(parsed.data, runtimeConfig().BETTER_AUTH_SECRET)
  const run = await transaction(async (tx) => {
    const actor = await runner(tx, identity)
    const actorKey = actor ? `USER:${actor}` : systemKey
    const where = { actorKey_runKey: { actorKey, runKey } }
    const previous = await tx.jobRun.findUnique({ where })
    if (previous) {
      if (previous.inputHash !== inputHash) fail("IDEMPOTENCY_MISMATCH")
      if (previous.status === "SUCCESS") return previous
      if (
        previous.status === "RUNNING" &&
        Date.now() - +previous.startedAt < abandonedAfterMs
      )
        throw new CommandError("COMMAND_IN_PROGRESS", 409, true)
      return tx.jobRun.update({
        where,
        data: { status: "RUNNING", startedAt: now, finishedAt: null },
      })
    }
    const through = requested || now
    if (
      input.cursor &&
      !(await tx.jobRun.findFirst({
        where: {
          actorKey,
          through,
          nextCursor: input.cursor,
          status: "SUCCESS",
        },
      }))
    )
      fail("INVALID_INPUT", 422)
    return tx.jobRun.create({
      data: {
        actorKey,
        runKey,
        inputHash,
        through,
        cursor: input.cursor,
        status: "RUNNING",
        startedAt: now,
      },
    })
  })
  if (run.status === "SUCCESS")
    return { ...(run.outcome as object), replayed: true }
  const outcome = {
    ok: true,
    runId: run.id,
    cutoff: run.through.toISOString(),
    processed: 0,
    expired: 0,
    warned: 0,
    skipped: 0,
    failures: [] as { id?: string; code: string }[],
    nextCursor: null as string | null,
  }
  try {
    const rows = await database().reservation.findMany({
      where: {
        AND: [
          due(run.through),
          ...(position
            ? [
                {
                  OR: [
                    { expiresAt: { gt: position.expiresAt } },
                    { expiresAt: position.expiresAt, id: { gt: position.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      include: { saleCase: { select: { purchaseRecordId: true } } },
      orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
    })
    for (const record of rows.slice(0, input.limit)) {
      outcome.processed++
      try {
        const result = await processReservation(
          identity,
          record.saleCaseId,
          record.saleCase.purchaseRecordId,
          run.through
        )
        outcome[result]++
      } catch (error) {
        outcome.failures.push({
          id: record.id,
          code: error instanceof CommandError ? error.code : "INTERNAL_ERROR",
        })
      }
    }
    if (rows.length > input.limit && !outcome.failures.length) {
      const last = rows[input.limit - 1]
      outcome.nextCursor = `${last.expiresAt.toISOString()}/${last.id}`
    }
  } catch {
    outcome.failures.push({ code: "INTERNAL_ERROR" })
  }
  const status = outcome.failures.length
    ? outcome.failures.length >= outcome.processed
      ? "FAILED"
      : "PARTIAL"
    : "SUCCESS"
  await database().jobRun.updateMany({
    where: { id: run.id, startedAt: run.startedAt, status: "RUNNING" },
    data: {
      status,
      finishedAt: new Date(),
      nextCursor: outcome.nextCursor,
      outcome,
    },
  })
  return outcome
}

export async function expiryHealth(
  tx: Tx,
  actor: NonNullable<Awaited<ReturnType<typeof userAuthority>>>
) {
  requireFields(actor.ability, "ReservationExpiryJob", "read", {}, [
    "id",
    "status",
    "through",
    "finishedAt",
  ])
  const [latest, successful, failed] = await Promise.all([
    tx.jobRun.findFirst({ orderBy: { startedAt: "desc" } }),
    tx.jobRun.findFirst({
      where: { status: "SUCCESS", nextCursor: null },
      orderBy: { finishedAt: "desc" },
    }),
    tx.jobRun.findFirst({
      where: { status: { in: ["PARTIAL", "FAILED"] } },
      orderBy: { finishedAt: "desc" },
    }),
  ])
  const view = (row: typeof latest) =>
    row &&
    project(actor.ability, "ReservationExpiryJob", {
      id: row.id,
      status: row.status,
      through: row.through.toISOString(),
      finishedAt: row.finishedAt?.toISOString(),
    })
  return {
    ok: true,
    latest: view(latest),
    lastSuccess: view(successful),
    lastFailure: view(failed),
    stale:
      !successful?.finishedAt ||
      Date.now() - +successful.finishedAt > 26 * 3600000,
  }
}
