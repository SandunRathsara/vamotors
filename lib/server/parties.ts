import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
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
  partySelector,
  financePolicy,
  type PartyCommandName,
} from "./validators"
import { project, readScope, requireFields, expanded } from "./permissions"
import { fail, CommandError } from "./errors"
import { currentSettings } from "./settings"

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
  raw: unknown,
  existingTx?: Tx
): Promise<Applied> {
  if (
    name === "createFinanceCompany" ||
    name === "updateFinanceCompany" ||
    (name === "archiveParty" &&
      (raw as { input?: { type?: string } })?.input?.type === "FINANCE_COMPANY")
  )
    return executeFinance(identity, name, raw, existingTx)
  if (!existingTx) await database().$transaction(async (tx) => {
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
  if (kind === "FINANCE_COMPANY") fail("INVALID_INPUT", 422)
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
  }, existingTx)
}

const financeInclude = { ...include, currentPolicy: true }
type FinanceRow = NonNullable<Awaited<ReturnType<typeof loadFinance>>>
const loadFinance = (tx: Tx, id: string) =>
  tx.financeCompany.findUnique({ where: { id }, include: financeInclude })
function financeDTO(row: FinanceRow): PartyDTO {
  const parsed = financePolicy.safeParse(row.currentPolicy.values)
  if (!parsed.success) fail("INTERNAL_ERROR", 500)
  return {
    id: row.id,
    revision: row.revision,
    type: "FINANCE_COMPANY",
    name: row.name,
    active: row.active,
    contacts: row.contacts
      .filter((c) => c.active)
      .map((c) => ({ id: c.id, ...contactDTO(c) })),
    policy: parsed.data,
    provenance: { imported: false },
  }
}
const financeAuth = (row: FinanceRow) => ({
  ...financeDTO(row),
  createdBy: row.createdBy,
})
const contactValues = (contact: PartyDTO["contacts"][number]) => {
  const { id, ...values } = contact
  void id
  return values
}
const policyPaths = [
  "policy.path",
  "policy.commission.basis",
  "policy.commission.rateBps",
  "policy.commission.fixed",
  "policy.processingFee",
  "policy.reconciliationMethod",
]
const atPath = (row: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[key]
          : undefined,
      row
    )
async function executeFinance(
  identity: Identity,
  name: PartyCommandName,
  raw: unknown,
  existingTx?: Tx
): Promise<Applied> {
  if (!existingTx) await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const parsed = partyEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const create =
    name === "createFinanceCompany"
      ? partyCommands.createFinanceCompany.parse(envelope.input)
      : undefined
  const update =
    name === "updateFinanceCompany"
      ? partyCommands.updateFinanceCompany.parse(envelope.input)
      : undefined
  const archive =
    name === "archiveParty"
      ? partyCommands.archiveParty.parse(envelope.input)
      : undefined
  if (archive && archive.type !== "FINANCE_COMPANY") fail("INVALID_INPUT", 422)
  const supplied = create ?? update
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
    const row = target ? await loadFinance(tx, target) : null
    if (target && !row) fail("NOT_FOUND", 404)
    if (row)
      requireFields(actor.ability, "FinanceCompany", "read", financeAuth(row), [
        "id",
        "revision",
      ])
    // Dependency authority precedes CAS errors, including the immutable retry.
    const settings = supplied ? await currentSettings(tx) : null
    if (settings)
      requireFields(actor.ability, "Settings", "read", settings, [
        "id",
        "revision",
      ])
    const before = row ? financeDTO(row) : null
    const candidate = supplied
      ? {
          name: supplied.name,
          contacts: supplied.contacts,
          policy: supplied.policy,
        }
      : { active: archive!.active }
    const paths = archive ? ["active"] : ["name", "contacts", ...policyPaths]
    const oldValues = before
      ? { ...before, contacts: before.contacts.map(contactValues) }
      : null
    const changed = paths.filter(
      (path) =>
        comparison(path, atPath(oldValues, path)) !==
        comparison(path, atPath(candidate, path))
    )
    const auth = row ? financeAuth(row) : { createdBy: actor.userId }
    requireFields(
      actor.ability,
      "FinanceCompany",
      action,
      auth,
      prior ? [] : changed
    )
    if (prior) {
      const result = prior.result as {
        type: string
        id: string
        revision: number
      }
      if (
        result.type !== "FinanceCompany" ||
        !result.id ||
        !Number.isInteger(result.revision)
      )
        fail("IDEMPOTENCY_MISMATCH")
      const current = await loadFinance(tx, result.id)
      if (!current) fail("NOT_FOUND", 404)
      requireFields(
        actor.ability,
        "FinanceCompany",
        "read",
        financeAuth(current),
        ["id", "revision"]
      )
      const original = await tx.auditEntry.findFirst({
        where: {
          commandId: prior.id,
          entityType: "FinanceCompany",
          entityId: result.id,
        },
      })
      if (!original) fail("INTERNAL_ERROR", 500)
      requireFields(
        actor.ability,
        "FinanceCompany",
        action,
        financeAuth(current),
        Object.keys(original.fieldDiff as object)
      )
      if (prior.inputHash !== digest || (target && target !== result.id))
        fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected: [
          {
            type: "FinanceCompany",
            id: current.id,
            revision: current.revision,
          },
        ],
        invalidate: ["parties"],
      }
    }
    for (const dependency of [
      settings && { type: "Settings" as const, ...settings },
      row && {
        type: "FinanceCompany" as const,
        id: row.id,
        revision: row.revision,
      },
    ]) {
      if (!dependency) continue
      const ref = envelope.expected.find(
        (r) => r.type === dependency.type && r.id === dependency.id
      )
      if (!ref) fail("REVISION_REQUIRED", 428)
      if (ref.revision !== dependency.revision)
        throw new CommandError("STALE_REVISION", 409, false, [
          {
            type: dependency.type,
            id: dependency.id,
            revision: dependency.revision,
          },
        ])
    }
    if (row?.revision === 2147483647) fail("REVISION_EXHAUSTED")
    const sequence = await nextBusinessSequence(tx)
    const id = row?.id ?? randomUUID()
    const policyChanged =
      supplied &&
      (!row || canonical(before!.policy) !== canonical(supplied.policy))
    const policyId = policyChanged ? randomUUID() : row!.currentPolicyId
    if (policyChanged) {
      if (row?.currentPolicy.version === 2147483647) fail("REVISION_EXHAUSTED")
      await tx.financePolicyVersion.create({
        data: {
          id: policyId,
          companyId: id,
          version: (row?.currentPolicy.version ?? 0) + 1,
          values: supplied!.policy,
        },
      })
    }
    if (create)
      await tx.financeCompany.create({
        data: {
          id,
          name: create.name,
          currentPolicyId: policyId,
          createdBy: actor.userId,
        },
      })
    else
      await tx.financeCompany.update({
        where: { id, revision: row!.revision },
        data: {
          ...(update
            ? { name: update.name, currentPolicyId: policyId }
            : { active: archive!.active }),
          revision: { increment: 1 },
        },
      })
    if (supplied) {
      const retained = new Set<string>()
      const additions = supplied.contacts.flatMap((c) => {
        const match = row?.contacts.find(
          (old) =>
            old.active &&
            !retained.has(old.id) &&
            canonical(contactDTO(old)) === canonical(c)
        )
        if (match) {
          retained.add(match.id)
          return []
        }
        return [
          {
            id: randomUUID(),
            companyId: id,
            name: c.name,
            phone: c.phone,
            email: c.email ?? null,
            role: c.role,
            isPrimary: c.primary,
          },
        ]
      })
      await tx.financeContact.updateMany({
        where: { companyId: id, active: true, id: { notIn: [...retained] } },
        data: { active: false },
      })
      if (additions.length)
        await tx.financeContact.createMany({ data: additions })
    }
    const saved = (await loadFinance(tx, id))!
    requireFields(actor.ability, "FinanceCompany", "read", financeAuth(saved), [
      "id",
      "revision",
    ])
    const after = financeDTO(saved)
    const afterValues = {
      ...after,
      contacts: after.contacts.map(contactValues),
    }
    const commandId = randomUUID()
    const result = {
      type: "FinanceCompany" as const,
      id,
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
    await tx.auditEntry.create({
      data: {
        commandId,
        userId: actor.userId,
        actorKind: "USER",
        entityType: "FinanceCompany",
        entityId: id,
        action,
        reason: update?.reason ?? archive?.reason,
        fieldDiff: Object.fromEntries(
          changed.map((path) => [
            path,
            {
              before: atPath(oldValues, path) ?? null,
              after: atPath(afterValues, path) ?? null,
            },
          ])
        ),
      },
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: "FinanceCompany",
      entityId: id,
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
  }, existingTx)
}

/** Singular typed identity: never scan a list, guess a table, or use a receipt. */
export async function partyQuery(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  const parsed = partySelector.safeParse(args)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const { type: kind, id } = parsed.data
  const type =
    kind === "FINANCE_COMPANY" ? "FinanceCompany" : partySubject(kind)
  const row =
    kind === "FINANCE_COMPANY"
      ? await loadFinance(tx, id)
      : await load(tx, kind, id)
  if (!row) fail("NOT_FOUND", 404)
  const auth =
    kind === "FINANCE_COMPANY"
      ? financeAuth(row as FinanceRow)
      : authRow(kind, row as Row)
  const visible = project(actor.ability, type, auth)
  visible.redactedFields = visible.redactedFields.filter(
    (f) => f !== "createdBy"
  )
  const domains =
    kind === "SUPPLIER"
      ? ["purchases"]
      : kind === "REPAIR_VENDOR"
        ? ["repairs"]
        : [
            "settlementPurchases",
            "leaseSales",
            "brokerage",
            "entitlements",
            "remittances",
          ]
  const contributions: Record<string, unknown> = {}
  for (const domain of domains) {
    const path = `contributions.${domain}`
    if (!actor.ability.can("read", subject(type, auth), path)) {
      visible.redactedFields.push(path)
      continue
    }
    const links: Record<string, unknown>[] = []
    if (domain === "purchases") {
      // Scope in SQL before materialization. No page cap or hidden-row metadata.
      const rows = await tx.purchaseRecord.findMany({
        where: {
          AND: [
            { supplierId: id },
            readScope(actor.grants, actor.userId, "PurchaseRecord"),
          ],
        },
        select: { id: true, purchaseDate: true, status: true, createdBy: true },
        orderBy: [{ purchaseDate: "asc" }, { id: "asc" }],
      })
      for (const purchase of rows) {
        const record = subject("PurchaseRecord", purchase)
        const link: Record<string, unknown> = { type: "PURCHASE" }
        for (const [wire, source, value] of [
          ["id", "id", purchase.id],
          [
            "date",
            "purchaseDate",
            purchase.purchaseDate.toISOString().slice(0, 10),
          ],
          ["status", "status", purchase.status],
        ] as const) {
          if (actor.ability.can("read", record, source)) link[wire] = value
          else visible.redactedFields.push(`${path}.links.${wire}`)
        }
        links.push(link)
      }
    }
    if (domain === "settlementPurchases") {
      // Immutable command versions preserve past assignments after correction
      // or leaving lease. Current detail alone is not a historical link source.
      if (!actor.ability.can("read", subject(type, auth), "id")) {
        visible.redactedFields.push(path)
        continue
      }
      const rows = await tx.purchaseRecord.findMany({
        where: readScope(actor.grants, actor.userId, "PurchaseRecord"),
        select: { id: true, purchaseDate: true, status: true, createdBy: true },
        orderBy: [{ purchaseDate: "asc" }, { id: "asc" }],
      })
      const versions = await tx.entityReadVersion.findMany({
        where: {
          entityType: "PurchaseRecord",
          entityId: { in: rows.map((p) => p.id) },
          payload: { path: ["settlement", "companyId"], equals: id },
        },
        select: { entityId: true },
        distinct: ["entityId"],
      })
      const linked = new Set(versions.map((v) => v.entityId))
      for (const purchase of rows) {
        if (!linked.has(purchase.id)) continue
        const source = subject("PurchaseRecord", purchase)
        if (
          !["settlement.companyId", "settlement.institutionType"].every((f) =>
            actor.ability.can("read", source, f)
          )
        )
          continue
        const link: Record<string, unknown> = { type: "PURCHASE" }
        for (const [wire, field, value] of [
          ["id", "id", purchase.id],
          [
            "date",
            "purchaseDate",
            purchase.purchaseDate.toISOString().slice(0, 10),
          ],
          ["status", "status", purchase.status],
        ] as const) {
          if (actor.ability.can("read", source, field)) link[wire] = value
          else visible.redactedFields.push(`${path}.links.${wire}`)
        }
        links.push(link)
      }
    }
    if (domain === "repairs") {
      // Complete authorized current+returned links. Static READY promotion still
      // belongs to the parent after independent acceptance, not table existence.
      if (!actor.ability.can("read", subject(type, auth), "id")) {
        visible.redactedFields.push(path)
        continue
      }
      const rows = await tx.repairRecord.findMany({
        where: {
          AND: [
            { vendorId: id },
            readScope(actor.grants, actor.userId, "RepairRecord"),
          ],
          cycle: readScope(actor.grants, actor.userId, "PurchaseRecord"),
        },
        include: { cycle: true },
        orderBy: [{ sentDate: "asc" }, { id: "asc" }],
      })
      for (const repair of rows) {
        const parent = subject("PurchaseRecord", repair.cycle),
          record = subject("RepairRecord", repair)
        if (
          !actor.ability.can("read", parent, "id") ||
          !actor.ability.can("read", parent, "repairs") ||
          !actor.ability.can("read", record, "id") ||
          !actor.ability.can("read", record, "vendorId")
        )
          continue
        const link: Record<string, unknown> = { type: "REPAIR", id: repair.id }
        if (actor.ability.can("read", record, "sentDate"))
          link.date = repair.sentDate.toISOString().slice(0, 10)
        else visible.redactedFields.push(`${path}.links.date`)
        if (actor.ability.can("read", record, "returnedDate"))
          link.status = repair.returnedDate ? "RETURNED" : "OPEN"
        else visible.redactedFields.push(`${path}.links.status`)
        links.push(link)
      }
    }
    if (domain === "brokerage") {
      if (!actor.ability.can("read", subject(type, auth), "id")) {
        visible.redactedFields.push(path)
        continue
      }
      const rows = await tx.brokerageDeal.findMany({
        where: {
          AND: [
            { companyId: id },
            readScope(actor.grants, actor.userId, "BrokerageDeal"),
          ],
        },
        select: {
          id: true,
          createdAt: true,
          state: true,
          approvedLoan: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
      for (const deal of rows) {
        const record = subject("BrokerageDeal", deal)
        if (
          !["id", "createdAt", "state"].every((f) =>
            actor.ability.can("read", record, f)
          )
        )
          continue
        const link: Record<string, unknown> = {
          type: "BROKERAGE",
          id: deal.id,
          date: deal.createdAt.toISOString().slice(0, 10),
          status: deal.state,
        }
        if (actor.ability.can("read", record, "approvedLoan"))
          link.amount = deal.approvedLoan.toString()
        else visible.redactedFields.push(`${path}.links.amount`)
        links.push(link)
      }
    }
    // Static pending capability: absent downstream implementations are NOT
    // authoritative empty histories. Read failures above propagate normally.
    contributions[domain] = {
      state:
        domain === "settlementPurchases" || domain === "brokerage"
          ? "READY"
          : "PENDING_DOMAIN",
      links,
    }
  }
  visible.contributions = contributions
  visible.redactedFields = [...new Set(visible.redactedFields)]
  return visible
}

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
  const type =
    input.type === "FINANCE_COMPANY"
      ? "FinanceCompany"
      : partySubject(input.type)
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
      : input.type === "FINANCE_COMPANY"
        ? await Promise.all([
            tx.financeCompany.findMany({
              where,
              ...paging,
              include: financeInclude,
            }),
            tx.financeCompany.count({ where }),
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
        input.type === "FINANCE_COMPANY"
          ? financeAuth(row as FinanceRow)
          : authRow(input.type as Kind, row as Row)
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
