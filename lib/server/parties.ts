import "server-only"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { Supplier, RepairVendor, SupplierContact } from "@prisma/client"
import type {
  Applied,
  DirectoryInput,
  PartyDTO,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { writeReadVersion } from "./audit"
import { inputDigest, canonical } from "./idempotency"
import { runtimeConfig } from "./config"
import {
  directoryInput,
  partyCommands,
  partyEnvelope,
  listParams,
  type PartyCommandName,
} from "./validators"
import { project, readScope, requireFields, expanded } from "./permissions"
import { fail, CommandError } from "./errors"

type Kind = "SUPPLIER" | "REPAIR_VENDOR"
type Type = "Supplier" | "RepairVendor"
type ContactRow = Pick<
  SupplierContact,
  "id" | "name" | "phone" | "email" | "role" | "isPrimary" | "active"
>
type Row = (Supplier | RepairVendor) & { contacts: ContactRow[] }
const include = { contacts: { orderBy: { id: "asc" as const } } }
export const partySubject = (kind: Kind): Type =>
  kind === "SUPPLIER" ? "Supplier" : "RepairVendor"
const contactDTO = (row: ContactRow) => ({
  name: row.name,
  phone: row.phone,
  ...(row.email !== null ? { email: row.email } : {}),
  role: row.role,
  primary: row.isPrimary,
})
export function partyDTO(kind: Kind, row: Row): PartyDTO {
  const contacts = row.contacts.filter((c) => c.active)
  const directory: DirectoryInput = {
    name: row.name,
    category: row.category as DirectoryInput["category"],
    recurring: row.recurring,
    ...Object.fromEntries(
      [
        "nicOrRegNumber",
        "address",
        "phone",
        "hotline",
        "notes",
        ...(kind === "REPAIR_VENDOR" ? ["specialisation"] : []),
      ].flatMap((key) => {
        const value = (row as unknown as Record<string, unknown>)[key]
        return value !== null && value !== undefined ? [[key, value]] : []
      })
    ),
    contacts: contacts.map(contactDTO),
  }
  return {
    id: row.id,
    revision: row.revision,
    type: kind,
    name: row.name,
    active: row.active,
    directory,
    contacts: contacts.map((c) => ({ id: c.id, ...contactDTO(c) })),
    provenance: { imported: false },
  }
}
const authRow = (kind: Kind, row: Row) => ({
  ...partyDTO(kind, row),
  createdBy: row.createdBy,
})
const load = (tx: Tx, kind: Kind, id: string): Promise<Row | null> =>
  kind === "SUPPLIER"
    ? tx.supplier.findUnique({ where: { id }, include })
    : tx.repairVendor.findUnique({ where: { id }, include })
const comparison = (key: string, value: unknown) =>
  key === "contacts" && Array.isArray(value)
    ? canonical(value.map((c) => canonical(c)).sort())
    : canonical(value ?? null)

/** Contact input intentionally has no IDs in the accepted contract. Reuse exact
 * matching identities, archive removed values, append replacements. Historical
 * IDs/content never change or disappear; no guessed index-based identity edits. */
async function replaceContacts(
  tx: Tx,
  kind: Kind,
  parentId: string,
  before: ContactRow[],
  contacts: DirectoryInput["contacts"]
) {
  const retained = new Set<string>()
  const additions = contacts.flatMap((contact) => {
    const match = before.find(
      (c) =>
        !retained.has(c.id) &&
        c.active &&
        canonical(contactDTO(c)) === canonical(contact)
    )
    if (match) {
      retained.add(match.id)
      return []
    }
    return [{ id: randomUUID(), ...contact, email: contact.email ?? null }]
  })
  const removed = before
    .filter((c) => c.active && !retained.has(c.id))
    .map((c) => c.id)
  if (kind === "SUPPLIER") {
    await tx.supplierContact.updateMany({
      where: { supplierId: parentId, id: { in: removed } },
      data: { active: false },
    })
    if (additions.length)
      await tx.supplierContact.createMany({
        data: additions.map(({ primary, ...c }) => ({
          ...c,
          supplierId: parentId,
          isPrimary: primary,
        })),
      })
  } else {
    await tx.vendorContact.updateMany({
      where: { vendorId: parentId, id: { in: removed } },
      data: { active: false },
    })
    if (additions.length)
      await tx.vendorContact.createMany({
        data: additions.map(({ primary, ...c }) => ({
          ...c,
          vendorId: parentId,
          isPrimary: primary,
        })),
      })
  }
}
function values(input: DirectoryInput) {
  return {
    name: input.name,
    category: input.category,
    recurring: input.recurring ?? false,
    nicOrRegNumber: input.nicOrRegNumber ?? null,
    address: input.address ?? null,
    phone: input.phone ?? null,
    hotline: input.hotline ?? null,
    notes: input.notes ?? null,
  }
}
export async function executeParty(
  identity: Identity,
  name: PartyCommandName,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const parsed = partyEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const create =
    name === "createDirectoryParty"
      ? partyCommands.createDirectoryParty.parse(envelope.input)
      : undefined
  const update =
    name === "updateDirectoryParty"
      ? partyCommands.updateDirectoryParty.parse(envelope.input)
      : undefined
  const archive =
    name === "archiveParty"
      ? partyCommands.archiveParty.parse(envelope.input)
      : undefined
  const input = create ?? update ?? archive!
  const kind = input.type
  const type = partySubject(kind)
  const fields = Object.keys(directoryInput.shape).filter(
    (f) => kind !== "SUPPLIER" || f !== "specialisation"
  )
  const supplied = create?.values ?? update?.values
  if (kind === "SUPPLIER" && supplied?.specialisation !== undefined)
    fail("INVALID_INPUT", 422)
  const action = create ? "create" : archive ? "archive" : "update"
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
    const target = update?.id ?? archive?.id
    const row = target ? await load(tx, kind, target) : null
    if (target && !row) fail("NOT_FOUND", 404)
    if (row)
      requireFields(actor.ability, type, "read", authRow(kind, row), [
        "id",
        "revision",
      ])
    const before = row ? partyDTO(kind, row) : null
    const changed = create
      ? Object.keys(create.values)
      : archive
        ? row!.active === archive.active
          ? []
          : ["active"]
        : fields.filter(
            (f) =>
              comparison(
                f,
                (
                  before?.directory as unknown as
                    | Record<string, unknown>
                    | undefined
                )?.[f] ?? (f === "recurring" ? false : null)
              ) !==
              comparison(
                f,
                (supplied as unknown as Record<string, unknown>)[f] ??
                  (f === "recurring" ? false : null)
              )
          )
    requireFields(
      actor.ability,
      type,
      action,
      row ? authRow(kind, row) : { createdBy: actor.userId },
      prior ? [] : changed
    )
    if (prior) {
      const result = prior.result as {
        type: string
        id: string
        revision: number
      }
      if (
        result.type !== type ||
        !result.id ||
        !Number.isInteger(result.revision)
      )
        fail("IDEMPOTENCY_MISMATCH")
      const current = await load(tx, kind, result.id)
      if (!current) fail("NOT_FOUND", 404)
      requireFields(actor.ability, type, "read", authRow(kind, current), [
        "id",
        "revision",
      ])
      const original = await tx.auditEntry.findFirst({
        where: { commandId: prior.id, entityType: type, entityId: result.id },
      })
      if (!original) fail("INTERNAL_ERROR", 500)
      const diff = original.fieldDiff as Record<string, unknown>
      const written = Object.keys(diff)
        .map((f) => (f.startsWith("directory.") ? f.slice(10) : f))
        .filter((f) => (archive ? f === "active" : fields.includes(f)))
      requireFields(
        actor.ability,
        type,
        action,
        authRow(kind, current),
        written
      )
      if (prior.inputHash !== digest || (target && target !== result.id))
        fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result: { ...result, type },
        affected: [{ type, id: current.id, revision: current.revision }],
        invalidate: ["parties"],
      }
    }
    if (row) {
      const ref = envelope.expected.find(
        (r) => r.type === type && r.id === row.id
      )
      if (!ref) fail("REVISION_REQUIRED", 428)
      if (ref.revision !== row.revision)
        throw new CommandError("STALE_REVISION", 409, false, [
          { type, id: row.id, revision: row.revision },
        ])
      if (row.revision === 2147483647) fail("REVISION_EXHAUSTED")
    }
    const sequence = await nextBusinessSequence(tx)
    const data = supplied ? values(supplied) : { active: archive!.active }
    const vendorData = {
      ...data,
      ...(supplied ? { specialisation: supplied.specialisation ?? null } : {}),
    }
    const saved =
      kind === "SUPPLIER"
        ? create
          ? await tx.supplier.create({
              data: { ...values(create.values), createdBy: actor.userId },
            })
          : await tx.supplier.update({
              where: { id: row!.id, revision: row!.revision },
              data: { ...data, revision: { increment: 1 } },
            })
        : create
          ? await tx.repairVendor.create({
              data: {
                ...values(create.values),
                specialisation: create.values.specialisation ?? null,
                createdBy: actor.userId,
              },
            })
          : await tx.repairVendor.update({
              where: { id: row!.id, revision: row!.revision },
              data: { ...vendorData, revision: { increment: 1 } },
            })
    if (supplied)
      await replaceContacts(
        tx,
        kind,
        saved.id,
        row?.contacts ?? [],
        supplied.contacts
      )
    const afterRow = (await load(tx, kind, saved.id))!
    requireFields(actor.ability, type, "read", authRow(kind, afterRow), [
      "id",
      "revision",
    ])
    const after = partyDTO(kind, afterRow)
    const commandId = randomUUID()
    const result = { type, id: saved.id, revision: saved.revision }
    await tx.commandReceipt.create({
      data: {
        id: commandId,
        ...scope,
        inputHash: digest,
        result,
        businessSequence: sequence,
      },
    })
    // Audit wire/business input paths, including exact changed-field witnesses
    // for currently reauthorized retries. No ownership or hidden raw DB fields.
    const diff = Object.fromEntries(
      changed.map((field) => [
        archive ? field : `directory.${field}`,
        {
          before: archive
            ? before!.active
            : ((
                before?.directory as unknown as
                  | Record<string, unknown>
                  | undefined
              )?.[field] ?? null),
          after: archive
            ? after.active
            : ((after.directory as unknown as Record<string, unknown>)[field] ??
              null),
        },
      ])
    )
    await tx.auditEntry.create({
      data: {
        commandId,
        userId: actor.userId,
        entityType: type,
        entityId: saved.id,
        actorKind: "USER",
        action,
        reason: update?.reason ?? archive?.reason,
        fieldDiff: diff,
      },
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: type,
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
      invalidate: ["parties"],
    }
  })
}

/** The accepted contract only supplies a typed paginated list, never an ID
 * predicate. Detail UI uses these same projected rows, not a new endpoint. */
export async function partiesQuery(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  const parsed = listParams
    .extend({
      type: z.enum(["SUPPLIER", "REPAIR_VENDOR", "FINANCE_COMPANY"]),
      active: z.enum(["true", "false"]).optional(),
      q: z.string().trim().max(200).optional(),
      sort: z.string().max(1000).optional(),
      from: z.string().optional(),
      through: z.string().optional(),
    })
    .strict()
    .safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  if (input.type === "FINANCE_COMPANY") fail("ENVIRONMENT_UNAVAILABLE", 503)
  const type = partySubject(input.type)
  if (!actor.ability.can("read", type)) fail("FORBIDDEN", 403)
  if (input.from || input.through) fail("FIELD_FORBIDDEN", 403)
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
  if (sorted.data.some((s) => !["id", "name", "active"].includes(s.field)))
    fail("FIELD_FORBIDDEN", 403)
  const required = [
    ...new Set([
      "id",
      ...sorted.data.map((s) => s.field),
      ...(input.q ? ["name"] : []),
      ...(input.active ? ["active"] : []),
    ]),
  ]
  const rules = actor.grants.filter(
    (g) => g.subject === type && g.action === "read" && expanded(g).length
  )
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
  const q = input.q?.replace(/[\\%_]/g, "\\$&")
  const where = {
    AND: [
      readScope(actor.grants, actor.userId, type),
      ...(input.active ? [{ active: input.active === "true" }] : []),
      ...(q ? [{ name: { contains: q, mode: "insensitive" as const } }] : []),
    ],
  }
  const paging = {
    skip: (input.page - 1) * input.pageSize,
    take: input.pageSize,
    orderBy: [
      ...sorted.data.map((s) => ({ [s.field]: s.direction })),
      ...(!sorted.data.some((s) => s.field === "id")
        ? [{ id: "asc" as const }]
        : []),
    ],
    include,
  }
  const [rows, total] =
    input.type === "SUPPLIER"
      ? await Promise.all([
          tx.supplier.findMany({ where, ...paging }),
          tx.supplier.count({ where }),
        ])
      : await Promise.all([
          tx.repairVendor.findMany({ where, ...paging }),
          tx.repairVendor.count({ where }),
        ])
  return {
    ok: true,
    data: rows.map((row) => {
      const visible = project(
        actor.ability,
        type,
        authRow(input.type as Kind, row)
      )
      visible.redactedFields = visible.redactedFields.filter(
        (f) => f !== "createdBy"
      )
      return visible
    }),
    total,
    page: input.page,
    pageSize: input.pageSize,
    asOf: new Date().toISOString(),
    redactedFields: [],
  }
}
