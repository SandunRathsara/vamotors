import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import {
  Prisma,
  type CommandReceipt,
  type FinanceCompany,
  type RemittancePayment,
} from "@prisma/client"
import type {
  Applied,
  Dependency,
} from "../../.planning/implementation/contracts/api"
import type { Actor, Identity } from "./actor"
import { audit, writeReadVersion } from "./audit"
import { runtimeConfig } from "./config"
import type { Tx } from "./db"
import {
  computeNextWatermark,
  isEntitlementOverdue,
  type ReconciliationEntitlementState,
} from "./domain-math"
import { fail } from "./errors"
import { inputDigest } from "./idempotency"
import { importProvenance } from "./import-provenance"
import {
  bump,
  checkRefs,
  documentSubject,
  lockImportActor,
  receiptScope,
} from "./import-staging"
import { fieldsFor, readScope, requireFields } from "./permissions"
import { currentSettings } from "./settings"
import { nextBusinessSequence, transaction } from "./transactions"
import {
  dateOnly,
  id,
  listParams,
  financePolicy,
  reconciliationEnvelope,
  reconciliationInputs,
  type ReconciliationCommand,
} from "./validators"
import { z } from "zod"

type Action = "read" | "create" | "receive" | "reconcile" | "pay"
type Owner = { id: string; revision: number }
type Scoped = { companyId: string }
const scopeRow = (row: Scoped) => ({ ...row, financeCompanyId: row.companyId })
const companyScope = (row: FinanceCompany) => ({
  companyId: row.id,
  financeCompanyId: row.id,
})
const ref = (
  type: Dependency["type"],
  { id, revision }: Owner
): Dependency => ({ type, id, revision })
const date = (value: Date) => value.toISOString().slice(0, 10)
const nullableDate = (value: Date | null) => value && date(value)
export const reconciliationToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format()
const sum = <T>(rows: readonly T[], amount: (row: T) => bigint) =>
  rows.reduce((total, row) => total + amount(row), 0n)
const signed = (row: { amount: bigint; reversalOf: string | null }) =>
  row.reversalOf ? -row.amount : row.amount
const maxZero = (value: bigint) => (value > 0n ? value : 0n)
const lookup = <T>(value: T | undefined | null): T =>
  value ?? fail("NOT_FOUND", 404)
const parse = <T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  input: unknown
) => {
  const result = schema.safeParse(input)
  if (!result.success) fail("INVALID_INPUT", 422)
  return result.data
}

const entitlementRead = [
  "id",
  "revision",
  "companyId",
  "sourceType",
  "brokerageDealId",
  "saleCaseId",
  "expectedAmount",
  "sentDate",
  "sentDateSource",
  "state",
  "balance",
]
const allocationRead = ["id", "revision", "allocations", "discrepancies"]
const remittanceRead = fieldsFor("Remittance", "read")
const runRead = fieldsFor("ReconciliationRun", "read")

function authorize(
  actor: Actor,
  type: "Remittance" | "CommissionEntitlement" | "ReconciliationRun",
  action: Action,
  row: Scoped,
  fields: readonly string[] = fieldsFor(type, action)
) {
  requireFields(actor.ability, type, action, scopeRow(row), [...fields])
}

export function authorizeRemittanceDocument(
  actor: Actor,
  row: Scoped,
  write: boolean
) {
  authorize(actor, "Remittance", "read", row, ["id", "revision", "documents"])
  if (write) authorize(actor, "Remittance", "receive", row, ["documents"])
}

const entitlementInclude = {
  saleCase: {
    select: {
      id: true,
      customerId: true,
      createdBy: true,
      state: true,
      inventoryLease: { select: { principal: true } },
      receipts: {
        where: { category: "LENDER" },
        select: { amount: true, direction: true },
      },
    },
  },
  brokerageDeal: {
    select: { id: true, customerId: true, createdBy: true, companyId: true },
  },
  allocations: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] },
  discrepancies: { orderBy: [{ recordedAt: "desc" }, { id: "desc" }] },
} satisfies Prisma.CommissionEntitlementInclude
type Entitlement = Prisma.CommissionEntitlementGetPayload<{
  include: typeof entitlementInclude
}>

const remittanceInclude = {
  payments: {
    orderBy: [{ occurredDate: "asc" }, { recordedAt: "asc" }, { id: "asc" }],
  },
  lines: { orderBy: { key: "asc" } },
  allocations: { orderBy: [{ recordedAt: "asc" }, { id: "asc" }] },
  discrepancies: true,
  documents: { orderBy: [{ verifiedAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.RemittanceInclude
type Remittance = Prisma.RemittanceGetPayload<{
  include: typeof remittanceInclude
}>

const originalReceipt = (row: Remittance) =>
  row.payments.find((p) => p.category === "REMITTANCE_RECEIPT") ?? null
const isReversed = (row: Remittance, paymentId: string) =>
  row.payments.some((p) => p.reversalOf === paymentId)
/** Carried excess is reusable bank credit. Its original allocation and decision stay in history. */
type AllocationLedger = {
  allocations: Pick<
    Remittance["allocations"][number],
    "amount" | "reversalOf"
  >[]
  discrepancies: Pick<
    Remittance["discrepancies"][number],
    "allocationId" | "expectedMinusAllocated" | "resolution"
  >[]
}
function carriedCredit(row: AllocationLedger) {
  const reversed = new Set(row.allocations.map((line) => line.reversalOf))
  return sum(row.discrepancies, (item) =>
    item.resolution === "CARRY_CREDIT" && !reversed.has(item.allocationId)
      ? -item.expectedMinusAllocated
      : 0n
  )
}
export function appliedAllocations(row: AllocationLedger) {
  const carried = carriedCredit(row)
  return { carried, applied: sum(row.allocations, signed) - carried }
}
const available = (row: Remittance) => {
  const receipt = originalReceipt(row)
  return receipt && !isReversed(row, receipt.id)
    ? receipt.amount - appliedAllocations(row).applied
    : 0n
}

function balance(row: Entitlement) {
  const principal = row.saleCase?.inventoryLease?.principal ?? 0n
  const direct = sum(row.saleCase?.receipts ?? [], (p) =>
    p.direction === "IN" ? p.amount : -p.amount
  )
  const expected = principal + row.expectedAmount
  const { applied, carried } = appliedAllocations(row)
  const remaining = expected - direct - applied
  // A reversal reopens a written-down balance. Older decisions remain in the history.
  const latestShortfall = row.discrepancies.find(
    (d) => d.classification === "SHORTFALL"
  )
  const resolved =
    remaining > 0n &&
    latestShortfall?.resolution === "ACCEPT_SHORTFALL" &&
    latestShortfall.expectedMinusAllocated === remaining &&
    !row.allocations.some(
      (a) => a.reversalOf && a.recordedAt > latestShortfall.recordedAt
    )
  const state: ReconciliationEntitlementState = resolved
    ? "RESOLVED"
    : remaining < 0n || (remaining === 0n && carried > 0n)
      ? "RESOLVED"
      : remaining === 0n
        ? "SETTLED"
        : direct + applied > 0n
          ? "PARTIAL"
          : "OPEN"
  return {
    principal,
    direct,
    applied,
    expected,
    remaining,
    carried,
    state,
    outstanding: resolved ? 0n : maxZero(remaining),
    lenderOutstanding: maxZero(principal - direct - applied),
  }
}

function entitlementDTO(
  row: Entitlement,
  cutoffDate: string,
  watermarkDate: string | null
) {
  const current = balance(row)
  const sentDate = date(row.sentDate)
  return {
    entitlementId: row.id,
    revision: row.revision,
    companyId: row.companyId,
    source: row.sourceType,
    sourceId: (row.saleCaseId ?? row.brokerageDealId)!,
    sentDate,
    sentDateSource: row.sentDateSource,
    expected: current.expected.toString(),
    commission: row.expectedAmount.toString(),
    principal: current.principal.toString(),
    directReceipts: current.direct.toString(),
    lenderOutstanding: current.lenderOutstanding.toString(),
    received: (current.direct + current.applied).toString(),
    discrepancy: (current.remaining - current.carried).toString(),
    outstanding: current.outstanding.toString(),
    state: current.state,
    cutoffDate,
    watermarkDate,
    overdue: isEntitlementOverdue({
      sentOrEligibleDate: sentDate,
      asOfDate: cutoffDate,
      lastReconciledSentDate: watermarkDate,
      state: current.state,
      outstanding: current.outstanding,
    }),
  }
}

function sourceLink(actor: Actor, row: Entitlement) {
  if (
    row.saleCase &&
    actor.ability.can("read", subject("SaleCase", row.saleCase), "id")
  )
    return `/sales/${row.saleCase.id}`
  if (
    row.brokerageDeal &&
    actor.ability.can(
      "read",
      subject("BrokerageDeal", scopeRow(row.brokerageDeal)),
      "id"
    )
  )
    return `/lease-deals/${row.brokerageDeal.id}`
  return null
}

const paymentDTO = (row: RemittancePayment) => ({
  id: row.id,
  date: date(row.occurredDate),
  amount: row.amount.toString(),
  direction: row.direction,
  category: row.category,
  reference: row.reference,
  method: row.method,
  reversalOf: row.reversalOf,
})

async function companyOf(tx: Tx, actor: Actor, companyId: string) {
  const company = lookup(
    await tx.financeCompany.findUnique({
      where: { id: companyId },
      include: { currentPolicy: true },
    })
  )
  authorize(actor, "ReconciliationRun", "read", companyScope(company), [
    "id",
    "company",
  ])
  return company
}

async function getRemittance(
  tx: Tx,
  actor: Actor,
  remittanceId: string,
  fields = remittanceRead
) {
  const row = lookup(
    await tx.remittance.findUnique({
      where: { id: remittanceId },
      include: remittanceInclude,
    })
  )
  authorize(actor, "Remittance", "read", row, fields)
  return row
}

async function getEntitlement(
  tx: Tx,
  actor: Actor,
  entitlementId: string,
  fields = entitlementRead
) {
  const row = lookup(
    await tx.commissionEntitlement.findUnique({
      where: { id: entitlementId },
      include: entitlementInclude,
    })
  )
  authorize(actor, "CommissionEntitlement", "read", row, fields)
  return row
}

async function histories(
  tx: Tx,
  actor: Actor,
  owner: { remittanceId: string } | { entitlementId: string }
) {
  const allocations = await tx.commissionAllocation.findMany({
    where: owner,
    include: {
      entitlement: true,
      remittance: true,
      reversal: { select: { id: true } },
    },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
  })
  const discrepancies = await tx.commissionDiscrepancy.findMany({
    where: owner,
    include: {
      entitlement: true,
      remittance: true,
      allocation: { include: { reversal: true } },
      returns: true,
    },
    orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
  })
  const canRead = (row: Scoped, type: "Remittance" | "CommissionEntitlement") =>
    ["id", "revision", "allocations", "discrepancies"].every((f) =>
      actor.ability.can("read", subject(type, scopeRow(row)), f)
    )
  return {
    allocations: allocations
      .filter(
        (a) =>
          canRead(a.entitlement, "CommissionEntitlement") &&
          canRead(a.remittance, "Remittance")
      )
      .map((a) => ({
        id: a.id,
        runId: a.runId,
        remittance: ref("Remittance", a.remittance),
        entitlement: ref("CommissionEntitlement", a.entitlement),
        amount: a.amount.toString(),
        noticeLineId: a.noticeLineId,
        reversalOf: a.reversalOf,
        reversedById: a.reversal?.id ?? null,
      })),
    discrepancies: discrepancies
      .filter(
        (d) =>
          canRead(d.entitlement, "CommissionEntitlement") &&
          (!d.remittance || canRead(d.remittance, "Remittance"))
      )
      .map((d) => ({
        id: d.id,
        entitlement: ref("CommissionEntitlement", d.entitlement),
        remittanceId: d.remittanceId,
        allocationId: d.allocationId,
        classification: d.classification,
        expectedMinusAllocated: d.expectedMinusAllocated.toString(),
        resolution: d.resolution,
        reason: d.reason,
        returnOutstanding: returnable(d).toString(),
        returns:
          d.remittance &&
          [
            "id",
            "date",
            "amount",
            "reference",
            "direction",
            "method",
            "category",
            "reversalOf",
          ].every((f) =>
            actor.ability.can(
              "read",
              subject("Remittance", scopeRow(d.remittance!)),
              `payments.${f}`
            )
          )
            ? d.returns.map(paymentDTO)
            : [],
      })),
  }
}

function returnable(row: {
  resolution: string
  expectedMinusAllocated: bigint
  allocation: { reversal: unknown } | null
  returns: RemittancePayment[]
}) {
  return row.resolution === "RETURN_OVERPAYMENT" &&
    row.allocation &&
    !row.allocation.reversal
    ? maxZero(-row.expectedMinusAllocated - sum(row.returns, signed))
    : 0n
}

async function totalReturned(tx: Tx, entitlementId: string) {
  const payments = await tx.remittancePayment.findMany({
    where: { discrepancy: { entitlementId } },
    select: { amount: true, reversalOf: true },
  })
  return sum(payments, signed)
}

function remittanceSummary(row: Remittance, actor?: Actor) {
  const receipt = originalReceipt(row)
  const unallocated = available(row).toString()
  return {
    id: row.id,
    revision: row.revision,
    companyId: row.companyId,
    state: row.state,
    reference: row.reference,
    currency: row.currency,
    scale: row.scale,
    method: row.method,
    policyVersion: row.policyVersion,
    receipt: receipt && paymentDTO(receipt),
    payments: row.payments.map(paymentDTO),
    unallocated,
    carriedCredit: carriedCredit(row).toString(),
    noticeAttachmentId: row.noticeAttachmentId,
    documents: row.documents
      .filter(
        (d) =>
          !actor ||
          actor.ability.can(
            "read",
            subject("Document", documentSubject(d)),
            "attachmentId"
          )
      )
      .map((d) => ({
        id: d.id,
        purpose: d.purpose,
      })),
    lines: row.lines.map((line) => ({
      id: line.id,
      key: line.key,
      description: line.description,
      source: line.sourceType && { type: line.sourceType, id: line.sourceId },
      amount: line.amount.toString(),
      unallocated: (
        line.amount -
        sum(
          row.allocations.filter((a) => a.noticeLineId === line.id),
          signed
        )
      ).toString(),
    })),
  }
}

const runDTO = (run: {
  id: string
  companyId: string
  method: string
  policyVersion: number
  asOfDate: Date
  previousWatermarkDate: Date | null
  newWatermarkDate: Date | null
}) => ({
  id: run.id,
  companyId: run.companyId,
  method: run.method,
  policyVersion: run.policyVersion,
  asOfDate: date(run.asOfDate),
  previousWatermarkDate: nullableDate(run.previousWatermarkDate),
  newWatermarkDate: nullableDate(run.newWatermarkDate),
})

const companyQuery = z
  .object({
    companyId: id,
    asOfDate: dateOnly.optional(),
    runId: id.optional(),
  })
  .strict()
const byId = z.object({ id }).strict()

export async function reconciliationCompanies(tx: Tx, actor: Actor) {
  const scoped = readScope(actor.grants, actor.userId, "ReconciliationRun", [
    "id",
    "company",
    "method",
    "policyVersion",
  ])
  const rows = await tx.financeCompany.findMany({
    where: {
      id: scoped.id,
      OR: scoped.OR?.map((rule) => ({ id: rule.companyId })),
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    include: { currentPolicy: true },
  })
  return rows.map((row) => ({
    ...ref("FinanceCompany", row),
    name: row.name,
    active: row.active,
    method: parse(financePolicy, row.currentPolicy.values).reconciliationMethod,
    policyVersion: row.currentPolicy.version,
  }))
}

export async function reconciliationView(
  tx: Tx,
  actor: Actor,
  args: Record<string, string>
) {
  const input = parse(companyQuery, args)
  const company = await companyOf(tx, actor, input.companyId)
  authorize(actor, "ReconciliationRun", "read", companyScope(company), runRead)
  authorize(
    actor,
    "CommissionEntitlement",
    "read",
    companyScope(company),
    entitlementRead
  )
  const asOfDate = input.asOfDate ?? reconciliationToday()
  checkCutoff(asOfDate)
  const watermark = nullableDate(company.reconciliationWatermark)
  const run = input.runId
    ? lookup(
        await tx.reconciliationRun.findFirst({
          where: { id: input.runId, companyId: company.id },
        })
      )
    : null
  const entitlements = await tx.commissionEntitlement.findMany({
    where: {
      companyId: company.id,
      sentDate: { lte: run?.asOfDate ?? new Date(asOfDate) },
    },
    include: entitlementInclude,
    orderBy: [{ sentDate: "asc" }, { id: "asc" }],
  })
  const sources = new Map(
    entitlements.map((row) => [row.id, sourceLink(actor, row)])
  )
  const runs = await tx.reconciliationRun.findMany({
    where: { companyId: company.id },
    orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      companyId: true,
      method: true,
      policyVersion: true,
      asOfDate: true,
      previousWatermarkDate: true,
      newWatermarkDate: true,
    },
  })
  const snapshot = run
    ? (run.snapshot as unknown as ReturnType<typeof entitlementDTO>[])
    : entitlements.map((row) => entitlementDTO(row, asOfDate, watermark))
  const data = snapshot.map((row) => ({
    ...row,
    href: sources.get(row.entitlementId) ?? null,
  }))
  const listRemittances = remittanceRead.every((field) =>
    actor.ability.can(
      "read",
      subject("Remittance", companyScope(company)),
      field
    )
  )
  const remittances =
    !run && listRemittances
      ? await tx.remittance.findMany({
          where: { companyId: company.id },
          include: remittanceInclude,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        })
      : []
  return {
    view: run ? ("RUN_SNAPSHOT" as const) : ("LIVE" as const),
    company: ref("FinanceCompany", company),
    method:
      run?.method ??
      parse(financePolicy, company.currentPolicy.values).reconciliationMethod,
    policyVersion: run?.policyVersion ?? company.currentPolicy.version,
    asOfDate: run ? date(run.asOfDate) : asOfDate,
    watermarkDate: run ? nullableDate(run.newWatermarkDate) : watermark,
    runs: runs.map(runDTO),
    data,
    total: data.length,
    canReconcile: actor.ability.can(
      "reconcile",
      subject("ReconciliationRun", companyScope(company)),
      "asOfDate"
    ),
    canStage: actor.ability.can(
      "create",
      subject("Remittance", companyScope(company)),
      "reference"
    ),
    remittances: remittances.map((row) => remittanceSummary(row, actor)),
    unallocatedRemittances: remittances
      .filter((row) => available(row) > 0n)
      .map((row) => ({
        id: row.id,
        revision: row.revision,
        amount: originalReceipt(row)!.amount.toString(),
        unallocated: available(row).toString(),
      })),
  }
}

export async function reconciliationRead(
  tx: Tx,
  actor: Actor,
  name: string,
  args: Record<string, string>
) {
  if (name === "reconciliationCompanies") {
    parse(z.object({}).strict(), args)
    return reconciliationCompanies(tx, actor)
  }
  if (name === "reconciliation") return reconciliationView(tx, actor, args)
  if (name === "remittances") {
    const input = parse(
      listParams
        .extend({
          companyId: id,
          state: z.enum(["STAGED", "RECEIVED", "REVERSED"]).optional(),
        })
        .strict(),
      args
    )
    const company = await companyOf(tx, actor, input.companyId)
    authorize(
      actor,
      "Remittance",
      "read",
      companyScope(company),
      remittanceRead
    )
    const where = { companyId: company.id, state: input.state }
    const rows = await tx.remittance.findMany({
      where,
      include: remittanceInclude,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    })
    return {
      data: rows.map((row) => remittanceSummary(row, actor)),
      total: await tx.remittance.count({ where }),
      page: input.page,
      pageSize: input.pageSize,
    }
  }
  const input = parse(byId, args)
  if (name === "remittance") {
    const row = await getRemittance(tx, actor, input.id)
    const company = await companyOf(tx, actor, row.companyId)
    return {
      ...remittanceSummary(row, actor),
      provenance: await importProvenance(tx, actor, "Remittance", row.id),
      company: ref("FinanceCompany", company),
      ...(await histories(tx, actor, { remittanceId: row.id })),
      canReceive: actor.ability.can(
        "receive",
        subject("Remittance", scopeRow(row)),
        "payment"
      ),
      canPay: actor.ability.can(
        "pay",
        subject("Remittance", scopeRow(row)),
        "payment"
      ),
      canUpload:
        actor.ability.can(
          "receive",
          subject("Remittance", scopeRow(row)),
          "documents"
        ) && actor.ability.can("create", "Document"),
    }
  }
  const row = await getEntitlement(tx, actor, input.id, [
    ...entitlementRead,
    ...allocationRead,
  ])
  const company = await companyOf(tx, actor, row.companyId)
  return {
    ...entitlementDTO(
      row,
      reconciliationToday(),
      nullableDate(company.reconciliationWatermark)
    ),
    company: ref("FinanceCompany", company),
    href: sourceLink(actor, row),
    ...(await histories(tx, actor, { entitlementId: row.id })),
  }
}

export const reconciliationQueries = new Set([
  "reconciliationCompanies",
  "reconciliation",
  "remittances",
  "remittance",
  "reconciliationEntitlement",
])

type Context = {
  actor: Actor
  tx: Tx
  commandId: string
  name: ReconciliationCommand
  expected: Dependency[]
  now: Date
}
type Company = Awaited<ReturnType<typeof companyOf>>
type ReconcileInput = z.infer<typeof reconciliationInputs.reconcile>
type AllocationData = Prisma.CommissionAllocationUncheckedCreateInput
type DiscrepancyData = Prisma.CommissionDiscrepancyUncheckedCreateInput

function companyMatch(company: Company, row: Scoped) {
  if (company.id !== row.companyId) fail("NOT_FOUND", 404)
}

function reconcileEntitlement(ctx: Context, row: Entitlement) {
  authorize(ctx.actor, "CommissionEntitlement", "reconcile", row)
}
function reconcileRemittance(ctx: Context, row: Remittance) {
  authorize(ctx.actor, "Remittance", "reconcile", row)
}
function checkCutoff(value: string) {
  if (value > reconciliationToday()) fail("INVALID_DATE", 422)
}
function checkOwners(
  ctx: Context,
  company: Company,
  remittances: Remittance[],
  entitlements: Entitlement[] = []
) {
  for (const row of [...remittances, ...entitlements])
    companyMatch(company, row)
  checkRefs(ctx.expected, [
    ref("FinanceCompany", company),
    ...remittances.map((row) => ref("Remittance", row)),
    ...entitlements.map((row) => ref("CommissionEntitlement", row)),
  ])
}

function recordAudit(
  ctx: Context,
  type:
    | "ReconciliationRun"
    | "Remittance"
    | "CommissionEntitlement"
    | "FinanceCompany",
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason?: string
) {
  return audit(ctx.tx, {
    commandId: ctx.commandId,
    userId: ctx.actor.userId,
    entityType: type,
    entityId,
    action: ctx.name,
    before,
    after,
    reason,
  })
}

function ledgerAudit(row: Pick<Remittance, "allocations" | "discrepancies">) {
  return {
    allocations: row.allocations.map((item) => ({
      ...item,
      amount: item.amount.toString(),
      recordedAt: item.recordedAt.toISOString(),
    })),
    discrepancies: row.discrepancies.map((item) => ({
      ...item,
      expectedMinusAllocated: item.expectedMinusAllocated.toString(),
      recordedAt: item.recordedAt.toISOString(),
    })),
  }
}

function remittanceAudit(row: Remittance) {
  const { payments, ...rest } = remittanceSummary(row)
  return {
    ...rest,
    ...ledgerAudit(row),
    payments: Object.fromEntries(
      [
        "id",
        "date",
        "amount",
        "direction",
        "method",
        "category",
        "reference",
        "reversalOf",
      ].map((key) => [key, payments.map((p) => p[key as keyof typeof p])])
    ),
  }
}

function entitlementAudit(row: Entitlement, company: Company) {
  const details = entitlementDTO(
    row,
    reconciliationToday(),
    nullableDate(company.reconciliationWatermark)
  )
  return {
    id: row.id,
    revision: row.revision,
    state: details.state,
    balance: details,
    ...ledgerAudit(row),
  }
}

async function publish(
  ctx: Context,
  company: Company,
  remit: Remittance[],
  entitle: Entitlement[],
  watermark?: string | null,
  reason?: string
) {
  const { tx } = ctx
  const updatedCompany = await tx.financeCompany.update({
    where: { id: company.id },
    data: {
      revision: bump(company.revision),
      ...(watermark !== undefined
        ? { reconciliationWatermark: watermark && new Date(watermark) }
        : {}),
    },
  })
  await recordAudit(
    ctx,
    "FinanceCompany",
    company.id,
    {
      revision: company.revision,
      reconciliationWatermark: nullableDate(company.reconciliationWatermark),
    },
    {
      revision: updatedCompany.revision,
      reconciliationWatermark: nullableDate(
        updatedCompany.reconciliationWatermark
      ),
    },
    reason
  )
  const affected = [ref("FinanceCompany", updatedCompany)]
  for (const old of entitle) {
    const current = await tx.commissionEntitlement.findUniqueOrThrow({
      where: { id: old.id },
      include: entitlementInclude,
    })
    const updated = await tx.commissionEntitlement.update({
      where: { id: old.id },
      data: { revision: bump(old.revision), state: balance(current).state },
    })
    await recordAudit(
      ctx,
      "CommissionEntitlement",
      old.id,
      entitlementAudit(old, company),
      entitlementAudit({ ...current, ...updated }, company),
      reason
    )
    affected.push(ref("CommissionEntitlement", updated))
  }
  for (const old of remit) {
    const updated = await tx.remittance.update({
      where: { id: old.id },
      data: { revision: bump(old.revision) },
      include: remittanceInclude,
    })
    await recordAudit(
      ctx,
      "Remittance",
      old.id,
      remittanceAudit(old),
      remittanceAudit(updated),
      reason
    )
    affected.push(ref("Remittance", updated))
  }
  return affected
}

async function reconcile(
  ctx: Context,
  company: Company,
  input: ReconcileInput,
  runId: string
) {
  const { tx, actor, commandId, now } = ctx
  authorize(actor, "ReconciliationRun", "reconcile", companyScope(company))
  authorize(actor, "ReconciliationRun", "read", companyScope(company), runRead)
  checkCutoff(input.asOfDate)
  const entitlements = await tx.commissionEntitlement.findMany({
    where: {
      companyId: company.id,
      sentDate: { lte: new Date(input.asOfDate) },
    },
    include: entitlementInclude,
    orderBy: [{ sentDate: "asc" }, { id: "asc" }],
  })
  authorize(
    actor,
    "CommissionEntitlement",
    "read",
    companyScope(company),
    entitlementRead
  )
  const eligible = new Map(entitlements.map((row) => [row.id, row]))
  const entitlementIds = [
    ...new Set(
      [...input.allocations, ...input.resolutions].map(
        (row) => row.entitlementId
      )
    ),
  ].sort()
  const changed = entitlementIds.map((key) => lookup(eligible.get(key)))
  const before = changed.map((row) => ({
    ...row,
    allocations: [...row.allocations],
    discrepancies: [...row.discrepancies],
  }))
  const remittanceIds = new Set(
    input.allocations.map((row) => row.remittanceId)
  )
  for (const resolution of input.resolutions) {
    const row = lookup(eligible.get(resolution.entitlementId))
    const previous = row.discrepancies[0]
    if (previous?.remittanceId) remittanceIds.add(previous.remittanceId)
    for (const allocation of row.allocations)
      if (
        !allocation.reversalOf &&
        !row.allocations.some((a) => a.reversalOf === allocation.id)
      )
        remittanceIds.add(allocation.remittanceId)
  }
  const remittances = await Promise.all(
    [...remittanceIds].sort().map((key) => getRemittance(tx, actor, key))
  )
  const receipts = new Map(
    remittances.map((row) => [
      row.id,
      {
        ...row,
        allocations: [...row.allocations],
        discrepancies: [...row.discrepancies],
      },
    ])
  )
  changed.forEach((row) => reconcileEntitlement(ctx, row))
  remittances.forEach((row) => reconcileRemittance(ctx, row))
  checkOwners(ctx, company, remittances, changed)
  const resolutions = new Map(
    input.resolutions.map((row) => [row.entitlementId, row])
  )
  const consumed = new Set<string>()
  const allocations: AllocationData[] = []
  const discrepancies: DiscrepancyData[] = []
  const allocationKeys = new Set<string>()

  function discrepancy(
    row: Entitlement,
    amount: bigint,
    resolution: string,
    reason: string,
    allocation?: { id: string; remittanceId: string }
  ) {
    const record = {
      id: randomUUID(),
      companyId: company.id,
      runId,
      entitlementId: row.id,
      remittanceId: allocation?.remittanceId ?? null,
      allocationId: allocation?.id ?? null,
      classification: amount < 0n ? "OVERPAYMENT" : "SHORTFALL",
      expectedMinusAllocated: amount,
      resolution,
      reason,
      recordedAt: now,
    }
    discrepancies.push(record)
    row.discrepancies.unshift(record)
    if (allocation && resolution === "CARRY_CREDIT")
      receipts.get(allocation.remittanceId)?.discrepancies.push(record)
  }

  for (const inputLine of input.allocations) {
    const receipt = lookup(receipts.get(inputLine.remittanceId))
    const row = lookup(eligible.get(inputLine.entitlementId))
    const payment = originalReceipt(receipt)
    const amount = BigInt(inputLine.amount)
    const current = balance(row)
    if (
      receipt.state !== "RECEIVED" ||
      !payment ||
      date(payment.occurredDate) > input.asOfDate
    )
      fail("INVALID_STATE")
    if (date(payment.occurredDate) < date(row.sentDate))
      fail("INVALID_DATE", 422)
    if (current.outstanding === 0n && current.remaining > 0n)
      fail("OBLIGATION_OPEN", 422)
    if (available(receipt) < amount) fail("BALANCE_MISMATCH", 422)
    const line = inputLine.noticeLineId
      ? lookup(receipt.lines.find((l) => l.id === inputLine.noticeLineId))
      : null
    if (receipt.method === "PERIOD_NOTICE" && !line)
      fail("DOCUMENT_REQUIRED", 422)
    if (line) {
      if (
        line.sourceType &&
        (line.sourceType !== row.sourceType ||
          line.sourceId !== (row.saleCaseId ?? row.brokerageDealId))
      )
        fail("BALANCE_MISMATCH", 422)
      if (
        line.amount -
          sum(
            receipt.allocations.filter((a) => a.noticeLineId === line.id),
            signed
          ) <
        amount
      )
        fail("BALANCE_MISMATCH", 422)
    }
    const key = [receipt.id, line?.id, row.id].join(":")
    if (allocationKeys.has(key)) fail("INVALID_INPUT", 422)
    allocationKeys.add(key)
    const allocation = {
      id: randomUUID(),
      companyId: company.id,
      runId,
      remittanceId: receipt.id,
      entitlementId: row.id,
      noticeLineId: line?.id ?? null,
      amount,
      reversalOf: null,
      reason: null,
      recordedAt: now,
      commandId,
    }
    const excess = amount - maxZero(current.remaining)
    if (excess > 0n) {
      const resolution = resolutions.get(row.id)
      if (
        !resolution ||
        !["CARRY_CREDIT", "RETURN_OVERPAYMENT"].includes(resolution.kind)
      )
        fail("DISCREPANCY_REQUIRED", 422)
      discrepancy(row, -excess, resolution.kind, resolution.reason, allocation)
      consumed.add(row.id)
    }
    allocations.push(allocation)
    receipt.allocations.push(allocation)
    row.allocations.push(allocation)
  }

  for (const row of changed) {
    const remaining = balance(row).remaining
    const resolution = resolutions.get(row.id)
    if (consumed.has(row.id)) continue
    if (remaining <= 0n) {
      if (resolution) fail("INVALID_INPUT", 422)
      continue
    }
    if (
      resolution &&
      !["KEEP_OPEN", "ACCEPT_SHORTFALL"].includes(resolution.kind)
    )
      fail("INVALID_INPUT", 422)
    const recent = [...row.allocations]
      .reverse()
      .find(
        (a) =>
          !a.reversalOf && !row.allocations.some((b) => b.reversalOf === a.id)
      )
    discrepancy(
      row,
      remaining,
      resolution?.kind ?? "KEEP_OPEN",
      resolution?.reason ?? "Partial allocation",
      recent
    )
  }
  const previous = nullableDate(company.reconciliationWatermark)
  const next = computeNextWatermark(
    previous,
    changed.map((row) => ({
      sentDate: date(row.sentDate),
      state: balance(row).state,
    }))
  )
  const snapshot = entitlements.map((row) =>
    entitlementDTO(
      {
        ...row,
        revision: entitlementIds.includes(row.id)
          ? bump(row.revision)
          : row.revision,
      },
      input.asOfDate,
      next
    )
  )
  const run = await tx.reconciliationRun.create({
    data: {
      id: runId,
      companyId: company.id,
      policyId: company.currentPolicy.id,
      policyVersion: company.currentPolicy.version,
      method: parse(financePolicy, company.currentPolicy.values)
        .reconciliationMethod,
      asOfDate: new Date(input.asOfDate),
      previousWatermarkDate: company.reconciliationWatermark,
      newWatermarkDate: next && new Date(next),
      snapshot,
      completedBy: actor.userId,
      completedAt: now,
      commandId,
    },
  })
  if (allocations.length)
    await tx.commissionAllocation.createMany({ data: allocations })
  if (discrepancies.length)
    await tx.commissionDiscrepancy.createMany({ data: discrepancies })
  await recordAudit(ctx, "ReconciliationRun", runId, null, {
    ...runDTO(run),
    snapshot,
  })
  return publish(ctx, company, remittances, before, next)
}

async function writeCommand(
  ctx: Context,
  raw: unknown,
  result: (type: string, id: string, revision: number) => Promise<void>
) {
  const { tx, actor, name } = ctx
  switch (name) {
    case "stageRemittance": {
      const input = parse(reconciliationInputs[name], raw)
      const company = await companyOf(tx, actor, input.companyId)
      authorize(actor, "Remittance", "create", companyScope(company))
      authorize(actor, "Remittance", "read", companyScope(company), [
        "id",
        "revision",
      ])
      checkOwners(ctx, company, [])
      const settings = await currentSettings(tx)
      const remittanceId = randomUUID()
      await result("Remittance", remittanceId, 1)
      const row = await tx.remittance.create({
        data: {
          id: remittanceId,
          companyId: company.id,
          reference: input.reference,
          createdBy: actor.userId,
          commandId: ctx.commandId,
          currency: settings.currency,
          scale: settings.scale,
          method: parse(financePolicy, company.currentPolicy.values)
            .reconciliationMethod,
          policyVersion: company.currentPolicy.version,
        },
        include: remittanceInclude,
      })
      await recordAudit(ctx, "Remittance", row.id, null, remittanceAudit(row))
      return [...(await publish(ctx, company, [], [])), ref("Remittance", row)]
    }
    case "recordRemittance": {
      const input = parse(reconciliationInputs[name], raw)
      const company = await companyOf(tx, actor, input.companyId)
      const row = await getRemittance(tx, actor, input.draftId)
      authorize(actor, "Remittance", "receive", row, [
        "payment",
        "lines",
        ...(input.noticeAttachmentId ? ["noticeAttachmentId"] : []),
      ])
      checkOwners(ctx, company, [row])
      if (row.state !== "STAGED") fail("INVALID_STATE")
      if (input.payment.reference !== row.reference) fail("INVALID_INPUT", 422)
      checkCutoff(input.payment.date)
      const directReceipt = await tx.saleReceipt.findFirst({
        where: {
          ...transferIdentity(input.payment),
          category: "LENDER",
          direction: "IN",
          reversalOf: null,
          reversal: null,
          saleCase: { inventoryLease: { companyId: company.id } },
        },
        select: { id: true },
      })
      if (directReceipt) fail("INVALID_STATE")
      if (row.method === "PERIOD_NOTICE" && !input.noticeAttachmentId)
        fail("DOCUMENT_REQUIRED", 422)
      if (input.noticeAttachmentId) {
        const notice = row.documents.find(
          (d) =>
            d.id === input.noticeAttachmentId &&
            d.purpose === "RECONCILIATION_NOTICE"
        )
        if (!notice) fail("DOCUMENT_NOT_READY", 409)
        requireFields(
          actor.ability,
          "Document",
          "read",
          documentSubject(notice),
          ["attachmentId"]
        )
      }
      await result("Remittance", row.id, bump(row.revision))
      await tx.remittance.update({
        where: { id: row.id },
        data: {
          state: "RECEIVED",
          noticeAttachmentId: input.noticeAttachmentId,
        },
      })
      await tx.remittancePayment.create({
        data: {
          remittanceId: row.id,
          amount: BigInt(input.payment.amount),
          occurredDate: new Date(input.payment.date),
          method: input.payment.method,
          reference: input.payment.reference,
          commandId: ctx.commandId,
          direction: "IN",
          category: "REMITTANCE_RECEIPT",
        },
      })
      if (input.lines.length)
        await tx.noticeLine.createMany({
          data: input.lines.map((line) => ({
            remittanceId: row.id,
            key: line.key,
            description: line.description,
            amount: BigInt(line.amount),
            sourceType: line.source?.type,
            sourceId: line.source?.id,
          })),
        })
      return publish(ctx, company, [row], [])
    }
    case "reconcile": {
      const input = parse(reconciliationInputs[name], raw)
      const company = await companyOf(tx, actor, input.companyId)
      const runId = randomUUID()
      await result("ReconciliationRun", runId, 1)
      return reconcile(ctx, company, input, runId)
    }
    case "reverseAllocation": {
      const input = parse(reconciliationInputs[name], raw)
      const allocation = lookup(
        await tx.commissionAllocation.findUnique({
          where: { id: input.allocationId },
          include: {
            reversal: true,
            discrepancies: { include: { returns: true } },
          },
        })
      )
      const row = await getRemittance(tx, actor, allocation.remittanceId)
      const entitlement = await getEntitlement(
        tx,
        actor,
        allocation.entitlementId
      )
      const company = await companyOf(tx, actor, row.companyId)
      reconcileRemittance(ctx, row)
      reconcileEntitlement(ctx, entitlement)
      checkOwners(ctx, company, [row], [entitlement])
      if (allocation.reversal || allocation.reversalOf) fail("INVALID_STATE")
      if (
        allocation.discrepancies.some((d) => sum(d.returns, signed) > 0n) ||
        (await totalReturned(tx, entitlement.id)) >
          maxZero(
            -balance(entitlement).remaining -
              allocation.amount +
              carriedCredit({
                allocations: [allocation],
                discrepancies: allocation.discrepancies,
              })
          )
      )
        fail("OBLIGATION_OPEN", 422)
      const {
        runId,
        companyId,
        remittanceId,
        entitlementId,
        noticeLineId,
        amount,
      } = allocation
      await result("Remittance", row.id, bump(row.revision))
      await tx.commissionAllocation.create({
        data: {
          runId,
          companyId,
          remittanceId,
          entitlementId,
          noticeLineId,
          amount,
          reversalOf: allocation.id,
          reason: input.reason,
          commandId: ctx.commandId,
        },
      })
      return publish(
        ctx,
        company,
        [row],
        [entitlement],
        undefined,
        input.reason
      )
    }
    case "returnRemittanceOverpayment": {
      const input = parse(reconciliationInputs[name], raw)
      const row = await getRemittance(tx, actor, input.remittanceId)
      const company = await companyOf(tx, actor, row.companyId)
      const discrepancy = lookup(
        await tx.commissionDiscrepancy.findFirst({
          where: { id: input.discrepancyId, remittanceId: row.id },
          include: {
            allocation: { include: { reversal: true } },
            returns: true,
          },
        })
      )
      const entitlement = await getEntitlement(
        tx,
        actor,
        discrepancy.entitlementId
      )
      authorize(actor, "Remittance", "pay", row)
      reconcileEntitlement(ctx, entitlement)
      checkOwners(ctx, company, [row], [entitlement])
      const receipt = originalReceipt(row)
      checkCutoff(input.payment.date)
      if (
        !receipt ||
        row.state !== "RECEIVED" ||
        input.payment.date < date(receipt.occurredDate)
      )
        fail("INVALID_DATE", 422)
      const amount = BigInt(input.payment.amount)
      if (
        amount > returnable(discrepancy) ||
        amount + (await totalReturned(tx, entitlement.id)) >
          maxZero(-balance(entitlement).remaining)
      )
        fail("BALANCE_MISMATCH", 422)
      await result("Remittance", row.id, bump(row.revision))
      await tx.remittancePayment.create({
        data: {
          remittanceId: row.id,
          discrepancyId: discrepancy.id,
          amount,
          occurredDate: new Date(input.payment.date),
          method: input.payment.method,
          reference: input.payment.reference,
          direction: "OUT",
          category: "REMITTANCE_RETURN",
          reason: input.reason,
          commandId: ctx.commandId,
        },
      })
      return publish(
        ctx,
        company,
        [row],
        [entitlement],
        undefined,
        input.reason
      )
    }
    case "reversePayment": {
      const input = parse(reconciliationInputs[name], raw)
      const row = await getRemittance(tx, actor, input.sourceId)
      const company = await companyOf(tx, actor, row.companyId)
      const payment = lookup(row.payments.find((p) => p.id === input.paymentId))
      authorize(actor, "Remittance", "pay", row)
      const owner =
        payment.discrepancyId &&
        (await tx.commissionDiscrepancy.findUniqueOrThrow({
          where: { id: payment.discrepancyId },
        }))
      const entitlements = owner
        ? [await getEntitlement(tx, actor, owner.entitlementId)]
        : []
      entitlements.forEach((e) => reconcileEntitlement(ctx, e))
      checkOwners(ctx, company, [row], entitlements)
      if (payment.reversalOf || isReversed(row, payment.id))
        fail("INVALID_STATE")
      if (
        payment.category === "REMITTANCE_RECEIPT" &&
        sum(row.allocations, signed) !== 0n
      )
        fail("OBLIGATION_OPEN", 422)
      const occurred = input.date ?? reconciliationToday()
      checkCutoff(occurred)
      if (occurred < date(payment.occurredDate)) fail("INVALID_DATE", 422)
      await result("Remittance", row.id, bump(row.revision))
      await tx.remittancePayment.create({
        data: {
          remittanceId: row.id,
          discrepancyId: payment.discrepancyId,
          amount: payment.amount,
          occurredDate: new Date(occurred),
          direction: payment.direction === "IN" ? "OUT" : "IN",
          category: "REMITTANCE_REVERSAL",
          method: payment.method,
          reference: payment.reference,
          reversalOf: payment.id,
          reason: input.reason,
          commandId: ctx.commandId,
        },
      })
      if (payment.category === "REMITTANCE_RECEIPT")
        await tx.remittance.update({
          where: { id: row.id },
          data: { state: "REVERSED" },
        })
      return publish(ctx, company, [row], entitlements, undefined, input.reason)
    }
  }
}

export async function reconciliationReplay(
  tx: Tx,
  actor: Actor,
  receipt: CommandReceipt
): Promise<Applied> {
  const result = receipt.result as Applied["result"]
  const affected: Dependency[] = []
  const keys = await tx.auditEntry.findMany({
    where: { commandId: receipt.id },
    select: { entityId: true, entityType: true },
  })
  for (const entry of keys) {
    if (entry.entityType === "FinanceCompany")
      affected.push(
        ref("FinanceCompany", await companyOf(tx, actor, entry.entityId))
      )
    if (entry.entityType === "ReconciliationRun") {
      const run = lookup(
        await tx.reconciliationRun.findUnique({ where: { id: entry.entityId } })
      )
      authorize(actor, "ReconciliationRun", "read", run)
      authorize(actor, "ReconciliationRun", "reconcile", run)
    }
    if (entry.entityType === "Remittance") {
      const row = await getRemittance(tx, actor, entry.entityId, [
        "id",
        "revision",
      ])
      const action =
        receipt.commandName === "stageRemittance"
          ? "create"
          : receipt.commandName === "recordRemittance"
            ? "receive"
            : ["reverseAllocation", "reconcile"].includes(receipt.commandName)
              ? "reconcile"
              : "pay"
      authorize(
        actor,
        "Remittance",
        action,
        row,
        action === "receive"
          ? [
              "payment",
              "lines",
              ...(row.noticeAttachmentId ? ["noticeAttachmentId"] : []),
            ]
          : undefined
      )
      affected.push(ref("Remittance", row))
    }
    if (entry.entityType === "CommissionEntitlement") {
      const row = await getEntitlement(tx, actor, entry.entityId)
      authorize(actor, "CommissionEntitlement", "reconcile", row)
      affected.push(ref("CommissionEntitlement", row))
    }
  }
  return {
    ok: true,
    status: "APPLIED",
    replayed: true,
    commandId: receipt.id,
    result,
    affected,
    invalidate: ["finance", "reports", "sales"],
  }
}

export async function executeReconciliation(
  identity: Identity,
  name: ReconciliationCommand,
  raw: unknown,
  existingTx?: Tx
): Promise<Applied> {
  const envelope = reconciliationEnvelope(name).safeParse(raw)
  if (!envelope.success) fail("INVALID_INPUT", 422)
  const payload = envelope.data
  const inputHash = inputDigest(payload, runtimeConfig().BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    const actor = await lockImportActor(tx, identity)
    const scope = receiptScope(actor.userId, name, payload.idempotencyKey)
    const prior = await tx.commandReceipt.findUnique({
      where: { environmentId_actorKey_commandName_idempotencyKey: scope },
    })
    if (prior) {
      if (prior.inputHash !== inputHash) fail("IDEMPOTENCY_MISMATCH")
      return reconciliationReplay(tx, actor, prior)
    }
    const commandId = randomUUID()
    const ctx = {
      tx,
      actor,
      commandId,
      name,
      expected: payload.expected,
      now: new Date(),
    }
    let result!: Applied["result"]
    let sequence: bigint
    const affected = await writeCommand(
      ctx,
      payload.input,
      async (type, id, revision) => {
        result = { type, id, revision }
        await tx.commandReceipt.create({
          data: {
            ...scope,
            id: commandId,
            inputHash,
            businessSequence: (sequence = await nextBusinessSequence(tx)),
            result,
          },
        })
      }
    )
    if (
      existingTx &&
      (result.type === "Remittance" || result.type === "ReconciliationRun")
    ) {
      await writeReadVersion(tx, {
        commandId,
        sequence: sequence!,
        entityType: result.type,
        entityId: result.id,
        revision: result.revision,
        payload: {
          id: result.id,
          ...(result.type === "Remittance"
            ? { revision: result.revision }
            : {}),
        },
      })
    }
    return {
      ok: true,
      status: "APPLIED",
      replayed: false,
      commandId,
      result,
      affected,
      invalidate: ["finance", "reports", "sales"],
    }
  }, existingTx)
}

type CashTransfer = { date: string; method: string; reference?: string }
const transferIdentity = (payment: CashTransfer) => ({
  occurredDate: new Date(payment.date),
  method: payment.method,
  reference: payment.reference,
})

export async function checkIndependentLenderReceipt(
  tx: Tx,
  companyId: string,
  payment: CashTransfer
) {
  if (!payment.reference) return
  const remittance = await tx.remittancePayment.findFirst({
    where: {
      ...transferIdentity(payment),
      category: "REMITTANCE_RECEIPT",
      remittance: { companyId, state: "RECEIVED" },
    },
    select: { id: true },
  })
  if (remittance) fail("INVALID_STATE")
}

/** Direct lender payments and finance allocations share the same principal balance. */
export async function refreshLenderEntitlement(
  tx: Tx,
  saleCaseId: string,
  context: Pick<
    Parameters<typeof audit>[1],
    "commandId" | "userId" | "action" | "reason" | "initiatedBy" | "approverId"
  >
) {
  const row = await tx.commissionEntitlement.findUnique({
    where: { saleCaseId },
    include: entitlementInclude,
  })
  if (!row) return
  const state = balance(row).state
  const revision = bump(row.revision)
  await tx.commissionEntitlement.update({
    where: { id: row.id },
    data: { revision, state },
  })
  await audit(tx, {
    ...context,
    entityType: "CommissionEntitlement",
    entityId: row.id,
    before: { revision: row.revision, state: row.state },
    after: { revision, state },
  })
}
