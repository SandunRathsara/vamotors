import "server-only"
import { randomUUID } from "node:crypto"
import type { CommandReceipt, InvoiceVersion } from "@prisma/client"
import { z } from "zod"
import type {
  Applied,
  InvoicePending,
} from "../../.planning/implementation/contracts/api"
import { currentActor, type Actor, type Identity } from "./actor"
import { fileIO, privateStorage } from "./attachments"
import { runtimeConfig } from "./config"
import { assertEnvironment, database, type Tx } from "./db"
import { fail } from "./errors"
import { inputDigest } from "./idempotency"
import {
  auditInvoice,
  authorizeInvoice,
  invoiceSummary,
  invoiceSupported,
  queueInvoice,
  snapshotOf,
} from "./invoice-data"
import { renderSaleInvoicePdf } from "./pdf"
import { requireRef } from "./purchases"
import { loadSale, type SaleRow } from "./sales"
import { currentSettings } from "./settings"
import { nextBusinessSequence, transaction } from "./transactions"
import { id, revision } from "./validators"

const command = "issueInvoice"
const mime = "application/pdf"
const invoiceEnvelope = z
  .object({
    schemaVersion: z.literal(1),
    idempotencyKey: id,
    expected: z
      .array(
        z
          .object({
            type: z.enum(["SaleCase", "PurchaseRecord", "InvoiceVersion"]),
            id,
            revision,
          })
          .strict()
      )
      .max(3),
    input: z
      .object({ saleId: id, saleRevision: revision, regenerate: z.boolean() })
      .strict(),
  })
  .strict()

function result(
  invoice: InvoiceVersion,
  commandId: string,
  replayed: boolean
): Applied | InvoicePending {
  if (invoice.state !== "READY")
    return {
      ok: true,
      status: "DOCUMENT_PENDING",
      invoiceId: invoice.id,
      version: invoice.version,
      state: invoice.state === "FAILED" ? "FAILED" : "PENDING",
      retryable: true,
    }
  const affected = {
    type: "InvoiceVersion" as const,
    id: invoice.id,
    revision: invoice.revision,
  }
  return {
    ok: true,
    status: "APPLIED",
    commandId,
    replayed,
    result: affected,
    affected: [affected],
    invalidate: ["sales", "documents"],
  }
}

async function completedSale(tx: Tx, saleId: string) {
  const sale = await loadSale(tx, saleId)
  if (!sale || !invoiceSupported(sale)) fail("NOT_FOUND", 404)
  return sale
}

function latestInvoice(tx: Tx, sale: SaleRow) {
  return tx.invoiceVersion.findFirst({
    where: { completionId: sale.completion!.id },
    orderBy: { version: "desc" },
  })
}

function checkSaleRevision(
  expected: z.infer<typeof invoiceEnvelope>["expected"],
  sale: SaleRow
) {
  requireRef(expected, {
    type: "SaleCase",
    id: sale.id,
    revision: sale.revision,
  })
  requireRef(expected, {
    type: "PurchaseRecord",
    id: sale.purchaseRecordId,
    revision: sale.purchaseRecord.revision,
  })
}

async function loadReceiptInvoice(tx: Tx, receipt: CommandReceipt) {
  const saved = receipt.result as { id: string; saleId: string }
  const invoice = await tx.invoiceVersion.findUnique({
    where: { id: saved.id },
  })
  if (!invoice) fail("NOT_FOUND", 404)
  return { invoice, saleId: saved.saleId }
}

/** Commit the request and deterministic render inputs before touching storage. */
export async function issueInvoice(identity: Identity, raw: unknown) {
  const parsed = invoiceEnvelope.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const { input, expected, idempotencyKey } = parsed.data
  if (new Set(expected.map((ref) => ref.type)).size !== expected.length)
    fail("INVALID_INPUT", 422)
  if (
    !expected.some(
      (ref) =>
        ref.type === "SaleCase" &&
        ref.id === input.saleId &&
        ref.revision === input.saleRevision
    )
  )
    fail("REVISION_REQUIRED", 428)
  const config = runtimeConfig()
  const hash = inputDigest(parsed.data, config.BETTER_AUTH_SECRET)
  const withSale = async (tx: Tx) => {
    // Same lock ordering as sale edits, settings writes and authority changes.
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    const actor = await currentActor(tx, identity)
    return { actor, sale: await completedSale(tx, input.saleId) }
  }
  const claimed = await transaction(async (tx) => {
    const { sale, actor } = await withSale(tx)
    await authorizeInvoice(tx, actor, sale, "create")
    const scope = {
      environmentId: config.ENVIRONMENT_ID,
      actorKey: `USER:${actor.userId}`,
      commandName: command,
      idempotencyKey,
    }
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      if (prior.inputHash !== hash) fail("IDEMPOTENCY_MISMATCH")
      const { invoice } = await loadReceiptInvoice(tx, prior)
      await authorizeInvoice(tx, actor, sale, "create", snapshotOf(invoice))
      if (invoice.state !== "READY") checkSaleRevision(expected, sale)
      return { invoice, commandId: prior.id, replayed: true }
    }
    checkSaleRevision(expected, sale)
    const latest = await latestInvoice(tx, sale)
    const sameRevision = latest?.saleRevision === sale.revision
    const resume = sameRevision && latest.state !== "READY"
    if (resume)
      requireRef(expected, {
        type: "InvoiceVersion",
        id: latest.id,
        revision: latest.revision,
      })
    const create = !sameRevision || (!resume && input.regenerate)
    const sequence = await nextBusinessSequence(tx)
    const commandId = randomUUID()
    // A legacy completion gets its first snapshot on demand. Newly completed
    // or corrected sales already carry the snapshot taken by the sale command.
    const invoiceId = create ? randomUUID() : latest!.id
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: hash,
        result: { type: "InvoiceVersion", id: invoiceId, saleId: sale.id },
        businessSequence: sequence,
      },
    })
    let invoice = create
      ? (await queueInvoice(
          tx,
          sale,
          await currentSettings(tx),
          actor.userId,
          commandId,
          sequence,
          latest,
          invoiceId
        ))!
      : latest!
    await authorizeInvoice(tx, actor, sale, "create", snapshotOf(invoice))
    if (!invoice.generationAt) {
      const before = invoice
      invoice = await tx.invoiceVersion.update({
        where: { id: before.id },
        data: {
          generationAt: new Date(),
          generatorId: actor.userId,
          generatorName: actor.user.name,
          revision: { increment: 1 },
        },
      })
      await auditInvoice(
        tx,
        actor.userId,
        commandId,
        "startInvoiceGeneration",
        before,
        invoice
      )
    }
    return { invoice, commandId, replayed: false }
  })

  const { invoice, commandId, replayed } = claimed
  if (invoice.state === "READY") return result(invoice, commandId, replayed)
  const snapshot = snapshotOf(invoice)
  const metadata = await fileIO(async () => {
    const store = await privateStorage()
    const bytes = renderSaleInvoicePdf({
      ...snapshot.pdf,
      invoiceNumber: invoice.number,
      version: invoice.version,
      issuedDate: invoice.generationAt!.toISOString(),
      issuedBy: invoice.generatorName!,
    })
    return store.writeGeneratedPdf(invoice.finalKey, bytes)
  }).catch(() => null)

  // Reauthorize and check the business revision after external IO. A staged
  // object is never downloadable unless the transaction marks it READY.
  const finalized = await transaction(async (tx) => {
    const { sale, actor } = await withSale(tx)
    await authorizeInvoice(tx, actor, sale, "create", snapshot)
    checkSaleRevision(expected, sale)
    const before = await tx.invoiceVersion.findUniqueOrThrow({
      where: { id: invoice.id },
    })
    if (before.state === "READY" || (!metadata && before.state === "FAILED"))
      return before
    const after = await tx.invoiceVersion.update({
      where: { id: before.id },
      data: {
        state: metadata ? "READY" : "FAILED",
        revision: { increment: 1 },
        ...(metadata ? { size: metadata.size, sha256: metadata.sha256 } : {}),
      },
    })
    await auditInvoice(
      tx,
      actor.userId,
      commandId,
      metadata ? "issueInvoice" : "invoiceGenerationFailed",
      before,
      after
    )
    return after
  })
  return result(finalized, commandId, replayed)
}

export async function invoiceReplay(
  tx: Tx,
  actor: Actor,
  receipt: CommandReceipt
) {
  const { invoice, saleId } = await loadReceiptInvoice(tx, receipt)
  const sale = await completedSale(tx, saleId)
  await authorizeInvoice(tx, actor, sale, "create", snapshotOf(invoice))
  return result(invoice, receipt.id, true)
}

const invoiceLookup = z
  .object({
    saleId: id,
    version: z
      .string()
      .regex(/^[1-9]\d{0,9}$/)
      .transform(Number)
      .pipe(revision)
      .optional(),
  })
  .strict()

async function findInvoice(tx: Tx, actor: Actor, args: Record<string, string>) {
  const parsed = invoiceLookup.safeParse(args)
  if (!parsed.success) fail("NOT_FOUND", 404)
  const { saleId, version } = parsed.data
  const sale = await completedSale(tx, saleId)
  const completionId = sale.completion!.id
  const invoice =
    version === undefined
      ? ((await tx.invoiceVersion.findFirst({
          where: { completionId, saleRevision: sale.revision, state: "READY" },
          orderBy: { version: "desc" },
        })) ?? (await latestInvoice(tx, sale)))
      : await tx.invoiceVersion.findUnique({
          where: { completionId_version: { completionId, version } },
        })
  if (!invoice) fail("NOT_FOUND", 404)
  await authorizeInvoice(tx, actor, sale, "read", snapshotOf(invoice))
  if (version === undefined && invoice.saleRevision !== sale.revision)
    fail("DOCUMENT_NOT_READY")
  return invoice
}

export async function invoiceQuery(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  return invoiceSummary(await findInvoice(tx, actor, args))
}

export async function downloadInvoice(
  identity: Identity,
  saleId: string,
  version: string
) {
  const authorize = () =>
    database().$transaction(
      async (tx) => {
        await assertEnvironment(tx)
        return findInvoice(tx, await currentActor(tx, identity), {
          saleId,
          version,
        })
      },
      { isolationLevel: "RepeatableRead" }
    )
  const invoice = await authorize()
  if (invoice.state !== "READY" || invoice.size === null || !invoice.sha256)
    fail("DOCUMENT_NOT_READY")
  const { size, sha256 } = invoice
  const bytes = await fileIO(async () => {
    const store = await privateStorage()
    return store.readGeneratedPdf(invoice.finalKey, { size, sha256 })
  })
  await authorize()
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "private,no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Type": mime,
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${invoice.number}.pdf"`,
    },
  })
}
