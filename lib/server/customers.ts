import "server-only"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Customer, Prisma } from "@prisma/client"
import type {
  Applied,
  CustomerDTO,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { audit, writeReadVersion } from "./audit"
import { inputDigest, canonical } from "./idempotency"
import { runtimeConfig } from "./config"
import {
  customerCommands,
  customerEnvelope,
  customerInput,
  id,
  listParams,
  type CustomerCommandName,
} from "./validators"
import { project, readScope, requireFields, expanded } from "./permissions"
import { fail, CommandError } from "./errors"
import { subject } from "@casl/ability"

export const normalizeCustomerIdentity = (value: string) =>
  value.replace(/[\t\n\r\f\v ]/g, "").toUpperCase()
const inputFields = Object.keys(customerInput.shape)
export function customerDTO(row: Customer): CustomerDTO {
  return {
    id: row.id,
    revision: row.revision,
    fullName: row.fullName,
    callingName: row.callingName,
    nicOrPassport: row.nicOrPassport,
    address: row.address,
    phone: row.phone,
    ...(row.email !== null ? { email: row.email } : {}),
    ...(row.drivingLicence !== null
      ? { drivingLicence: row.drivingLicence }
      : {}),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    active: row.active,
    provenance: { imported: false },
    links: [],
  }
}
const authorizationRow = (row: Customer) => ({
  ...customerDTO(row),
  createdBy: row.createdBy,
})
async function visibleCustomer(tx: Tx, actor: Actor, row: Customer) {
  // Ownership is a trusted condition property, never a DTO field.
  const visible = project(actor.ability, "Customer", authorizationRow(row))
  visible.redactedFields = visible.redactedFields.filter(
    (f) => f !== "createdBy"
  )
  if ("links" in visible) {
    const purchases = await tx.purchaseRecord.findMany({
      where: {
        AND: [
          { sellerCustomerId: row.id },
          readScope(actor.grants, actor.userId, "PurchaseRecord"),
        ],
      },
      select: {
        id: true,
        createdBy: true,
        purchaseDate: true,
        status: true,
        purchasePrice: true,
      },
      orderBy: [{ purchaseDate: "asc" }, { id: "asc" }],
    })
    visible.links = purchases.flatMap((p) => {
      if (
        !["id", "purchaseDate", "status"].every((f) =>
          actor.ability.can("read", subject("PurchaseRecord", p), f)
        )
      ) {
        visible.redactedFields.push("links")
        return []
      }
      const amount = actor.ability.can(
        "read",
        subject("PurchaseRecord", p),
        "purchasePrice"
      )
      if (!amount) visible.redactedFields.push("links.amount")
      return [
        {
          type: "PURCHASE",
          id: p.id,
          date: p.purchaseDate.toISOString().slice(0, 10),
          status: p.status,
          ...(amount ? { amount: p.purchasePrice.toString() } : {}),
        },
      ]
    })
  }
  return visible
}
function values(input: z.infer<typeof customerInput>) {
  return {
    ...input,
    normalizedIdentity: normalizeCustomerIdentity(input.nicOrPassport),
    email: input.email ?? null,
    drivingLicence: input.drivingLicence ?? null,
    notes: input.notes ?? null,
  }
}
export async function executeCustomer(
  identity: Identity,
  name: CustomerCommandName,
  raw: unknown
): Promise<Applied> {
  // Authenticate before validation; neither this nor a client hint authorizes execution.
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const parsed = customerEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const action =
    name === "createCustomer"
      ? "create"
      : name === "archiveParty"
        ? "archive"
        : "update"
  const config = runtimeConfig()
  const digest = inputDigest(envelope, config.BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    // Lock order is BusinessSequence BEFORE AdminGuard, even on replay. Advance
    // through the shared primitive only for an actual reportable mutation.
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id = 1 FOR UPDATE`
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
    const create =
      name === "createCustomer"
        ? customerCommands.createCustomer.parse(envelope.input)
        : undefined
    const update =
      name === "updateCustomer"
        ? customerCommands.updateCustomer.parse(envelope.input)
        : undefined
    const archive =
      name === "archiveParty"
        ? customerCommands.archiveParty.parse(envelope.input)
        : undefined
    const target = update?.id ?? archive?.id
    const row = target
      ? await tx.customer.findUnique({ where: { id: target } })
      : null
    if (target && !row) fail("NOT_FOUND", 404)
    if (row)
      requireFields(actor.ability, "Customer", "read", authorizationRow(row), [
        "id",
        "revision",
      ])
    const changed = row
      ? archive
        ? row.active === archive.active
          ? []
          : ["active"]
        : inputFields.filter(
            (f) =>
              canonical(
                (customerDTO(row) as unknown as Record<string, unknown>)[f] ??
                  null
              ) !==
              canonical((update!.values as Record<string, unknown>)[f] ?? null)
          )
      : Object.keys(create ?? {})
    requireFields(
      actor.ability,
      "Customer",
      action,
      row ? authorizationRow(row) : { createdBy: actor.userId },
      prior ? [] : changed
    )
    if (prior) {
      const result = prior.result as {
        type: string
        id: string
        revision: number
      }
      if (
        result.type !== "Customer" ||
        !result.id ||
        !Number.isInteger(result.revision)
      )
        fail("INTERNAL_ERROR", 500)
      const current = await tx.customer.findUnique({ where: { id: result.id } })
      if (!current) fail("NOT_FOUND", 404)
      requireFields(
        actor.ability,
        "Customer",
        "read",
        authorizationRow(current),
        ["id", "revision"]
      )
      // Customer replay is NOT administrative REPLAY-REFERENCE. Reauthorize the
      // original changed fields using immutable audit, even after later edits.
      const original = await tx.auditEntry.findFirst({
        where: {
          commandId: prior.id,
          entityType: "Customer",
          entityId: result.id,
        },
      })
      if (!original) fail("INTERNAL_ERROR", 500)
      const written = Object.keys(original.fieldDiff as object).filter((f) =>
        action === "archive" ? f === "active" : inputFields.includes(f)
      )
      requireFields(
        actor.ability,
        "Customer",
        action,
        authorizationRow(current),
        written
      )
      if (prior.inputHash !== digest || (target && target !== result.id))
        fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result: { type: "Customer", id: result.id, revision: result.revision },
        affected: [
          { type: "Customer", id: current.id, revision: current.revision },
        ],
        invalidate: ["customers"],
      }
    }
    if (row) {
      const ref = envelope.expected.find(
        (r) => r.type === "Customer" && r.id === row.id
      )
      if (!ref) fail("REVISION_REQUIRED", 428)
      if (ref.revision !== row.revision)
        throw new CommandError("STALE_REVISION", 409, false, [
          { type: "Customer", id: row.id, revision: row.revision },
        ])
      if (row.revision === 2147483647) fail("REVISION_EXHAUSTED")
      if (
        update &&
        row.nicOrPassport !== update.values.nicOrPassport &&
        !update.reason
      )
        fail("INVALID_INPUT", 422)
    }
    const sequence = await nextBusinessSequence(tx)
    const saved = create
      ? await tx.customer.create({
          data: { ...values(create), createdBy: actor.userId },
        })
      : await tx.customer.update({
          where: { id: row!.id, revision: row!.revision },
          data: {
            ...(update ? values(update.values) : { active: archive!.active }),
            revision: { increment: 1 },
          },
        })
    requireFields(actor.ability, "Customer", "read", authorizationRow(saved), [
      "id",
      "revision",
    ])
    const commandId = randomUUID()
    const result = {
      type: "Customer" as const,
      id: saved.id,
      revision: saved.revision,
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
    const after = customerDTO(saved)
    await audit(tx, {
      commandId,
      userId: actor.userId,
      entityType: "Customer",
      entityId: saved.id,
      action,
      reason: update?.reason ?? archive?.reason,
      before: row ? customerDTO(row) : null,
      after,
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "Customer",
      entityId: saved.id,
      revision: saved.revision,
      payload: after,
    })
    return {
      ok: true,
      status: "APPLIED",
      commandId,
      replayed: false,
      result,
      affected: [result],
      invalidate: ["customers"],
    }
  })
}

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
  })
export async function customerQuery(
  tx: Tx,
  actor: Actor,
  name: string,
  args: Record<string, string>
) {
  if (name === "customer") {
    if (!actor.ability.can("read", "Customer")) fail("NOT_FOUND", 404)
    const parsed = z.object({ id }).strict().safeParse(args)
    if (!parsed.success) fail("INVALID_INPUT", 422)
    const row = await tx.customer.findFirst({
      where: {
        AND: [
          { id: parsed.data.id },
          readScope(actor.grants, actor.userId, "Customer"),
        ],
      },
    })
    if (!row) fail("NOT_FOUND", 404)
    return visibleCustomer(tx, actor, row)
  }
  if (!actor.ability.can("read", "Customer")) fail("FORBIDDEN", 403)
  const parsed = listParams
    .extend({
      q: z.string().trim().max(200).optional(),
      sort: z.string().max(1000).optional(),
      from: date.optional(),
      through: date.optional(),
    })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  let raw: unknown = [{ field: "id", direction: "asc" }]
  try {
    if (input.sort) raw = JSON.parse(input.sort)
  } catch {
    fail("INVALID_INPUT", 422)
  }
  const sorted = z
    .array(
      z
        .object({ field: z.string(), direction: z.enum(["asc", "desc"]) })
        .strict()
    )
    .max(3)
    .safeParse(raw)
  if (
    !sorted.success ||
    new Set(sorted.data.map((s) => s.field)).size !== sorted.data.length
  )
    fail("INVALID_INPUT", 422)
  const required = [...new Set([...sorted.data.map((s) => s.field), "id"])]
  if (
    required.some(
      (f) =>
        ![
          "id",
          "fullName",
          "callingName",
          "nicOrPassport",
          "phone",
          "email",
          "active",
        ].includes(f)
    )
  )
    fail("FIELD_FORBIDDEN", 403)
  if (input.q) required.push("fullName", "nicOrPassport", "phone")
  // ListParams dates filter persisted creation time, but CustomerDTO deliberately
  // does not expose it: reject rather than invent a readable field/date oracle.
  if (input.from || input.through) fail("FIELD_FORBIDDEN", 403)
  const rules = actor.grants.filter(
    (g) => g.subject === "Customer" && g.action === "read" && expanded(g).length
  )
  // Every conjunction contributing rows must be covered for every query input.
  // This permits own-only directories without allowing a partial field grant
  // to shrink an otherwise wider population (or leak through order/count).
  for (const field of required)
    if (
      !rules.every((population) =>
        rules.some(
          (g) =>
            expanded(g).includes(field) &&
            Object.entries(g.conditions ?? {}).every(
              ([k, v]) =>
                (
                  population.conditions as Record<string, unknown> | undefined
                )?.[k] === v
            )
        )
      )
    )
      fail("FIELD_FORBIDDEN", 403)
  const scope = readScope(actor.grants, actor.userId, "Customer")
  const q = input.q?.replace(/[\\%_]/g, "\\$&")
  const where: Prisma.CustomerWhereInput = {
    AND: [
      scope,
      ...(q
        ? [
            {
              OR: [
                ...["fullName", "nicOrPassport", "phone"].map((field) => ({
                  [field]: { contains: q, mode: "insensitive" },
                })),
                {
                  normalizedIdentity: {
                    contains: normalizeCustomerIdentity(input.q!).replace(
                      /[\\%_]/g,
                      "\\$&"
                    ),
                    mode: "insensitive",
                  },
                },
              ],
            },
          ]
        : []),
    ],
  }
  const [rows, total] = await Promise.all([
    tx.customer.findMany({
      where,
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      orderBy: [
        ...sorted.data.map((s) => ({ [s.field]: s.direction })),
        ...(!sorted.data.some((s) => s.field === "id")
          ? [{ id: "asc" as const }]
          : []),
      ],
    }),
    tx.customer.count({ where }),
  ])
  return {
    ok: true,
    data: await Promise.all(rows.map((row) => visibleCustomer(tx, actor, row))),
    total,
    page: input.page,
    pageSize: input.pageSize,
    asOf: new Date().toISOString(),
    redactedFields: [],
  }
}
