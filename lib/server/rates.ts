import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import { z } from "zod"
import type {
  Prisma,
  Quote,
  RateSheetVersion,
  RateCardEntry,
} from "@prisma/client"
import type {
  Applied,
  Dependency,
  QuoteDTO,
  CompareResult,
  LoanMaximumDTO,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { currentActor, type Actor, type Identity } from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { writeReadVersion, audit } from "./audit"
import { inputDigest } from "./idempotency"
import { runtimeConfig } from "./config"
import {
  rateCommands,
  rateEnvelope,
  maximaInput,
  compareInput,
  financePolicy,
  id,
  listParams,
  type RateCommandName,
} from "./validators"
import { project, readScope, requireFields } from "./permissions"
import { currentSettings } from "./settings"
import { fail, CommandError } from "./errors"
import { C, commission, minor, sum } from "../money"

type Sheet = RateSheetVersion & { cards: RateCardEntry[] }
const include = {
  cards: {
    orderBy: [{ principal: "asc" as const }, { months: "asc" as const }],
  },
}
const date = (d: Date) => d.toISOString().slice(0, 10)
export const today = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
const auth = <T extends { companyId: string }>(row: T) => ({
  ...row,
  financeCompanyId: row.companyId,
})
export function sheetDTO(row: Sheet) {
  return {
    id: row.id,
    revision: 1 as const,
    companyId: row.companyId,
    version: row.version,
    make: row.make,
    model: row.model,
    year: row.year,
    maximum: row.maximum.toString(),
    validFrom: date(row.validFrom),
    validThrough: date(row.validThrough),
    publishedAt: row.publishedAt.toISOString(),
    cards: row.cards.map((c) => ({
      id: c.id,
      principal: c.principal.toString(),
      months: c.months,
      installment: c.installment.toString(),
    })),
  }
}
const sheetAuth = (row: Sheet) =>
  auth({ ...sheetDTO(row), createdBy: row.createdBy })
const company = (tx: Tx, companyId: string) =>
  tx.financeCompany.findUnique({
    where: { id: companyId },
    include: {
      currentPolicy: true,
      contacts: { where: { active: true }, orderBy: { id: "asc" } },
    },
  })
const sourceFields = [
  "id",
  "revision",
  "companyId",
  "make",
  "model",
  "year",
  "maximum",
  "validFrom",
  "validThrough",
]

export function quoteDTO(row: Quote): Omit<QuoteDTO, "companyRevision"> {
  return {
    id: row.id,
    revision: 1,
    createdBy: row.createdBy,
    vehicle: row.vehicle as QuoteDTO["vehicle"],
    sheetId: row.sheetId,
    sheetRevision: 1,
    cardId: row.cardId,
    companyId: row.companyId,
    principal: row.principal.toString(),
    months: row.months,
    installment: row.installment.toString(),
    maximum: row.maximum.toString(),
    charges: row.charges as QuoteDTO["charges"],
    policy: financePolicy.parse(row.policySnapshot),
    expiresAt: row.expiresAt.toISOString(),
  }
}
const quoteAuth = (row: Quote) => auth(quoteDTO(row))

/** Downstream intake/reselection must call this inside its owning transaction.
 * Reading a quote is not permission to copy hidden policy/charges into a deal. */
export async function quoteForUse(tx: Tx, actor: Actor, quoteId: string) {
  const row = await tx.quote.findUnique({ where: { id: quoteId } })
  if (!row) fail("NOT_FOUND", 404)
  requireFields(actor.ability, "Quote", "read", quoteAuth(row), [
    "id",
    "revision",
    "vehicle",
    "sheetId",
    "cardId",
    "companyId",
    "principal",
    "months",
    "installment",
    "maximum",
    "charges",
    "policy",
    "expiresAt",
  ])
  if (row.expiresAt <= new Date()) fail("QUOTE_EXPIRED", 409)
  return row
}

export async function executeRates(
  identity: Identity,
  name: RateCommandName,
  raw: unknown
): Promise<Applied> {
  await database().$transaction(async (tx) => {
    await assertEnvironment(tx)
    await currentActor(tx, identity)
  })
  const parsed = rateEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data
  const publish =
    name === "publishRates"
      ? rateCommands.publishRates.parse(envelope.input)
      : null
  const select =
    name === "selectQuote"
      ? rateCommands.selectQuote.parse(envelope.input)
      : null
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
    const sheet = select
      ? await tx.rateSheetVersion.findUnique({
          where: { id: select.sheetId },
          include,
        })
      : null
    if (select && !sheet) fail("NOT_FOUND", 404)
    if (sheet)
      requireFields(actor.ability, "RateSheet", "read", sheetAuth(sheet), [
        ...sourceFields,
        "cards",
      ])
    const owner = await company(tx, publish?.companyId ?? sheet!.companyId)
    if (!owner) fail("NOT_FOUND", 404)
    await tx.$queryRaw`SELECT id FROM vamotors."FinanceCompany" WHERE id=${owner.id}::uuid FOR UPDATE`
    requireFields(actor.ability, "FinanceCompany", "read", owner, [
      "id",
      "revision",
    ])
    const candidate = auth({ companyId: owner.id, createdBy: actor.userId })
    const type = publish ? ("RateSheet" as const) : ("Quote" as const)
    requireFields(
      actor.ability,
      type,
      "create",
      candidate,
      Object.keys(publish ?? select!)
    )
    const settings = select ? await currentSettings(tx) : null
    if (settings)
      requireFields(actor.ability, "Settings", "read", settings, [
        "id",
        "revision",
      ])
    if (prior) {
      const result = prior.result as {
        type: typeof type
        id: string
        revision: number
      }
      if (result.type !== type || !result.id || result.revision !== 1)
        fail("IDEMPOTENCY_MISMATCH")
      const row = publish
        ? await tx.rateSheetVersion.findUnique({
            where: { id: result.id },
            include,
          })
        : await tx.quote.findUnique({ where: { id: result.id } })
      if (!row) fail("NOT_FOUND", 404)
      requireFields(
        actor.ability,
        type,
        "read",
        publish ? sheetAuth(row as Sheet) : quoteAuth(row as Quote),
        ["id", "revision"]
      )
      if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
      return {
        ok: true,
        status: "APPLIED",
        commandId: prior.id,
        replayed: true,
        result,
        affected: [result],
        invalidate: ["brokerage", "finance"],
      }
    }
    const dependencies: Dependency[] = [
      { type: "FinanceCompany", id: owner.id, revision: owner.revision },
      ...(sheet
        ? [{ type: "RateSheet" as const, id: sheet.id, revision: 1 }]
        : []),
      ...(settings
        ? [
            {
              type: "Settings" as const,
              id: settings.id,
              revision: settings.revision,
            },
          ]
        : []),
    ]
    for (const dep of dependencies) {
      const ref = envelope.expected.find(
        (r) => r.type === dep.type && r.id === dep.id
      )
      if (!ref) fail("REVISION_REQUIRED", 428)
      if (ref.revision !== dep.revision)
        throw new CommandError("STALE_REVISION", 409, false, [dep])
    }
    if (!owner.active) fail("INVALID_STATE", 409)
    const commandId = randomUUID(),
      entityId = randomUUID()
    const sequence = await nextBusinessSequence(tx)
    let payload: Record<string, unknown>
    if (publish) {
      const match = {
        companyId: owner.id,
        make: { equals: publish.make, mode: "insensitive" as const },
        model: { equals: publish.model, mode: "insensitive" as const },
        year: publish.year,
      }
      if (
        await tx.rateSheetVersion.findFirst({
          where: {
            ...match,
            validFrom: { lte: new Date(publish.validThrough) },
            validThrough: { gte: new Date(publish.validFrom) },
          },
        })
      )
        fail("IDENTITY_CONFLICT", 409)
      const last = await tx.rateSheetVersion.findFirst({
        where: match,
        orderBy: { version: "desc" },
      })
      if (last?.version === 2147483647) fail("REVISION_EXHAUSTED")
      const row = await tx.rateSheetVersion.create({
        data: {
          id: entityId,
          companyId: owner.id,
          version: (last?.version ?? 0) + 1,
          make: publish.make,
          model: publish.model,
          year: publish.year,
          maximum: minor(publish.maximum),
          validFrom: new Date(publish.validFrom),
          validThrough: new Date(publish.validThrough),
          createdBy: actor.userId,
          commandId,
          cards: {
            create: publish.cards.map((c) => ({
              ...c,
              principal: minor(c.principal),
              installment: minor(c.installment),
            })),
          },
        },
        include,
      })
      payload = sheetDTO(row)
    } else {
      const input = select!,
        source = sheet!
      const now = new Date(),
        currentDate = today(now)
      if (
        date(source.validFrom) > currentDate ||
        date(source.validThrough) < currentDate
      )
        fail("QUOTE_EXPIRED", 409)
      if (
        input.vehicle.make.toLowerCase() !== source.make.toLowerCase() ||
        input.vehicle.model.toLowerCase() !== source.model.toLowerCase() ||
        input.vehicle.year !== source.year
      )
        fail("UNSUPPORTED_RATE", 422)
      const card = source.cards.find((c) => c.id === input.cardId)
      if (!card || card.principal > source.maximum)
        fail("UNSUPPORTED_RATE", 422)
      sum(
        input.charges.map((c) => minor(c.amount)),
        C
      )
      const policy = financePolicy.parse(owner.currentPolicy.values)
      const settingsRow = await tx.settings.findUniqueOrThrow({
        where: { id: settings!.id },
        include: { currentVersion: true },
      })
      const end =
        new Date(`${date(source.validThrough)}T00:00:00+05:30`).valueOf() +
        86400000
      const row = await tx.quote.create({
        data: {
          id: entityId,
          sheetId: source.id,
          cardId: card.id,
          companyId: owner.id,
          vehicle: input.vehicle,
          principal: card.principal,
          months: card.months,
          installment: card.installment,
          maximum: source.maximum,
          charges: input.charges,
          policyVersionId: owner.currentPolicyId,
          policySnapshot: policy,
          companySnapshot: {
            name: owner.name,
            revision: owner.revision,
            contacts: owner.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              phone: c.phone,
              email: c.email,
              role: c.role,
              primary: c.isPrimary,
            })),
          },
          settingsVersionId: settingsRow.currentVersionId,
          settingsSnapshot: settingsRow.currentVersion
            .values as Prisma.InputJsonObject,
          commissionExpected:
            policy.commission.basis === "FIXED"
              ? minor(policy.commission.fixed)
              : commission(card.principal, policy.commission.rateBps),
          createdBy: actor.userId,
          createdAt: now,
          expiresAt: new Date(Math.min(end, now.valueOf() + 86400000)),
          commandId,
        },
      })
      payload = quoteDTO(row)
    }
    const result = { type, id: entityId, revision: 1 }
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
      entityType: type,
      entityId,
      action: "create",
      before: null,
      after: payload,
    })
    await writeReadVersion(tx, {
      commandId,
      sequence,
      entityType: type,
      entityId,
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
      invalidate: ["brokerage", "finance"],
    }
  })
}

export async function rateQuery(
  tx: Tx,
  actor: Actor,
  name: string,
  raw: unknown
) {
  if (name === "quote") {
    const input = z.object({ id }).strict().safeParse(raw)
    if (!input.success) fail("INVALID_INPUT", 422)
    const row = await tx.quote.findUnique({ where: { id: input.data.id } })
    if (!row) fail("NOT_FOUND", 404)
    const dto = quoteAuth(row)
    const owner = await company(tx, row.companyId)
    const visible = project(actor.ability, "Quote", dto)
    visible.redactedFields = visible.redactedFields.filter(
      (f) => f !== "financeCompanyId"
    )
    if (
      owner &&
      actor.ability.can("read", subject("FinanceCompany", owner), "id") &&
      actor.ability.can("read", subject("FinanceCompany", owner), "revision") &&
      actor.ability.can("read", subject("Quote", dto), "companyRevision")
    )
      visible.companyRevision = owner.revision
    else visible.redactedFields.push("companyRevision")
    return visible
  }
  if (name === "rateSheets") {
    const parsed = listParams
      .extend({ companyId: id.optional() })
      .strict()
      .safeParse(raw)
    if (!parsed.success) fail("INVALID_INPUT", 422)
    if (!actor.ability.can("read", "RateSheet")) fail("FORBIDDEN", 403)
    const { page, pageSize, companyId } = parsed.data
    const companies = await tx.financeCompany.findMany({
      where: {
        AND: [
          { active: true },
          readScope(actor.grants, actor.userId, "FinanceCompany", [
            "id",
            "active",
          ]),
        ],
      },
      select: { id: true },
    })
    const where = {
      AND: [
        readScope(actor.grants, actor.userId, "RateSheet", [
          "id",
          ...(companyId ? ["companyId"] : []),
        ]),
        {
          companyId: {
            in: companies.map((c) => c.id),
            ...(companyId ? { equals: companyId } : {}),
          },
        },
      ],
    }
    const [rows, total] = await Promise.all([
      tx.rateSheetVersion.findMany({
        where,
        include,
        orderBy: [{ id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      tx.rateSheetVersion.count({ where }),
    ])
    return {
      ok: true,
      data: rows.map((r) => {
        const visible = project(actor.ability, "RateSheet", sheetAuth(r))
        visible.redactedFields = visible.redactedFields.filter(
          (f) => !["createdBy", "financeCompanyId"].includes(f)
        )
        return visible
      }),
      total,
      page,
      pageSize,
      asOf: new Date().toISOString(),
      redactedFields: [],
    }
  }
  const parsed = (name === "compare" ? compareInput : maximaInput).safeParse(
    raw
  )
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data
  if (
    !actor.ability.can("read", "RateSheet") ||
    !actor.ability.can("read", "FinanceCompany")
  )
    fail("FORBIDDEN", 403)
  const owners = await tx.financeCompany.findMany({
    where: {
      AND: [
        { active: true },
        readScope(actor.grants, actor.userId, "FinanceCompany", [
          "id",
          "revision",
          "active",
          ...(name === "loanMaxima" ? ["name"] : []),
        ]),
      ],
    },
    orderBy: { id: "asc" },
  })
  const results: (LoanMaximumDTO | CompareResult)[] = []
  for (const owner of owners) {
    const rows = await tx.rateSheetVersion.findMany({
      where: {
        AND: [
          {
            companyId: owner.id,
            make: { equals: input.vehicle.make, mode: "insensitive" },
            model: { equals: input.vehicle.model, mode: "insensitive" },
            year: input.vehicle.year,
          },
          readScope(actor.grants, actor.userId, "RateSheet", sourceFields),
        ],
      },
      include,
      orderBy: { validFrom: "desc" },
    })
    // An actor with a company-specific RateSheet grant must not infer other
    // companies' sheet existence/absence. Use the same trusted ownership scope.
    const mayDiscoverAbsent = actor.grants.some(
      (g) =>
        g.subject === "RateSheet" &&
        g.action === "read" &&
        g.fields.length &&
        !g.conditions?.createdBy &&
        (!g.conditions?.financeCompanyId ||
          g.conditions.financeCompanyId === owner.id)
    )
    if (!rows.length && !mayDiscoverAbsent) continue
    const sheet = rows.find(
      (r) =>
        date(r.validFrom) <= input.asOf && date(r.validThrough) >= input.asOf
    )
    const ref = { companyId: owner.id, companyRevision: owner.revision }
    if (name === "loanMaxima") {
      results.push(
        sheet
          ? {
              ...ref,
              companyName: owner.name,
              asOf: input.asOf,
              status: "APPLICABLE",
              sheetId: sheet.id,
              sheetRevision: 1,
              maximum: sheet.maximum.toString(),
              validFrom: date(sheet.validFrom),
              validThrough: date(sheet.validThrough),
            }
          : {
              ...ref,
              companyName: owner.name,
              asOf: input.asOf,
              status: "UNAVAILABLE",
              reason: rows.some((r) => date(r.validThrough) < input.asOf)
                ? "EXPIRED"
                : "NO_SHEET",
              maximum: null,
              sheetId: null,
            }
      )
      continue
    }
    if (!sheet) {
      results.push({
        ...ref,
        status: "UNSUPPORTED",
        reason: rows.some((r) => date(r.validThrough) < input.asOf)
          ? "EXPIRED"
          : "NO_CARD",
        maximum: null,
        sheetId: null,
        sheetRevision: null,
        validThrough: null,
      })
      continue
    }
    const terms = compareInput.parse(input)
    requireFields(actor.ability, "RateSheet", "read", sheetAuth(sheet), [
      "cards",
    ])
    const common = {
      ...ref,
      sheetId: sheet.id,
      sheetRevision: 1 as const,
      maximum: sheet.maximum.toString(),
      validThrough: date(sheet.validThrough),
    }
    if (minor(terms.principal) > sheet.maximum) {
      results.push({ ...common, status: "UNSUPPORTED", reason: "OVER_LIMIT" })
      continue
    }
    const choices = sheet.cards.filter(
      (c) =>
        c.principal === minor(terms.principal) &&
        (terms.months !== undefined
          ? c.months === terms.months
          : c.installment === minor(terms.installment!))
    )
    if (choices.length !== 1) {
      results.push({
        ...common,
        status: "UNSUPPORTED",
        reason: choices.length ? "AMBIGUOUS" : "NO_CARD",
        ...(choices.length
          ? {
              choices: choices.map((c) => ({
                cardId: c.id,
                months: c.months,
                installment: c.installment.toString(),
              })),
            }
          : {}),
      })
      continue
    }
    const card = choices[0]
    results.push({
      ...common,
      status: "SUPPORTED",
      cardId: card.id,
      principal: card.principal.toString(),
      months: card.months,
      installment: card.installment.toString(),
    })
  }
  return results
}

export async function rateRead(
  identity: Identity,
  name: "compare" | "loanMaxima" | "quote" | "rateSheets",
  raw: unknown
) {
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      return rateQuery(tx, actor, name, raw)
    },
    { isolationLevel: "RepeatableRead", timeout: 5000 }
  )
}
