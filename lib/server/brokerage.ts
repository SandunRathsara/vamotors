import "server-only"
import { randomUUID } from "node:crypto"
import { subject } from "@casl/ability"
import { z } from "zod"
import type {
  Attachment,
  BrokerageDeal,
  CashFacility,
  ChecklistItem,
  CommissionEntitlement,
  DealQuoteSelection,
  EligibilityCheck,
  FacilityPayment,
  GuarantorParticipation,
  InspectionPhoto,
  Prisma,
  ProcessingIssue,
  ProcessingIssueFeedback,
  VerificationEvent,
} from "@prisma/client"
import type {
  Applied,
  Dependency,
  BrokerageDTO,
  Commands,
  DealQuoteDTO,
  FacilityTerms,
  PaymentDTO,
} from "../../.planning/implementation/contracts/api"
import { database, assertEnvironment, type Tx } from "./db"
import { authenticate, currentActor, type Actor, type Identity } from "./actor"
import { transaction, nextBusinessSequence } from "./transactions"
import { writeReadVersion, fieldDiff, auditFilterInputs, auditScope } from "./audit"
import { inputDigest, canonical } from "./idempotency"
import { runtimeConfig } from "./config"
import {
  brokerageEnvelope,
  brokerageInputs,
  brokerageQueryParams,
  brokerageReversalEnvelope,
  id,
  listParams,
  type BrokerageCommandName,
} from "./validators"
import { project, readScope, requireFields } from "./permissions"
import { quoteForUse } from "./rates"
import { currentSettings } from "./settings"
import { fail, CommandError } from "./errors"
import { commission, minor } from "../money"
import {
  calculateFacilityDisbursement,
  calculateFacilityRecovery,
  type FacilityObligationBuckets,
} from "./domain-math"
import { executeDispatch, dispatchPreviewQuery, dispatchReplay } from "./dispatch"
import { checklistItemKey } from "../brokerage-checklist"
import { checklistHashFor } from "./brokerage-math"

type Name = BrokerageCommandName | "dispatchBatch" | "reversePayment"
const money = (value: string) => minor(value)
const date = (value: Date) => value.toISOString().slice(0, 10)
const colomboDate = (value: Date | string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value instanceof Date ? value : new Date(value))
const normalizeIdentity = (value: string) =>
  value.replace(/[\t\n\r\f\v ]/g, "").toUpperCase()
const PHOTO_CATEGORIES = [
  "FRONT",
  "BACK",
  "LEFT",
  "RIGHT",
  "CHASSIS",
  "ENGINE",
  "METER",
  "DEALER_WITH_VEHICLE",
  "CUSTOMER_WITH_VEHICLE",
] as const
const MANDATORY_BASE = [
  "CUSTOMER_ID",
  "GUARANTOR_ID",
  "PASSPORT_PHOTOS",
  "BANK_PASSBOOK",
  "ADDRESS_PROOF",
  "REGISTRATION_BOOK",
  "REVENUE_LICENSE",
  "TRANSFER_PAPER",
  "PREVIOUS_OWNER_ID",
  "EXTRA_KEY",
]
const PARTICIPANT_KINDS = [
  "CUSTOMER_ID",
  "GUARANTOR_ID",
  "PASSPORT_PHOTOS",
  "BANK_PASSBOOK",
  "ADDRESS_PROOF",
  "RELATIONSHIP_PROOF",
  "AFFIDAVIT",
]
const VEHICLE_KINDS = [
  "REGISTRATION_BOOK",
  "DELETION_LETTER",
  "REVENUE_LICENSE",
  "TRANSFER_PAPER",
  "PREVIOUS_OWNER_ID",
]
const resetFileReference = {
  fileReference: null,
  informedContactId: null,
  informedAt: null,
} as const
const invalidate: Applied["invalidate"] = [
  "brokerage",
  "parties",
  "customers",
  "documents",
  "finance",
  "reports",
  "dashboard",
  "notifications",
]

export const dealInclude = {
  selections: { orderBy: { version: "asc" as const } },
  guarantors: { orderBy: { createdAt: "asc" as const } },
  eligibility: { orderBy: { createdAt: "asc" as const } },
  photos: {
    where: { isCurrent: true },
    orderBy: { category: "asc" as const },
  },
  checklist: {
    include: { documents: true },
    orderBy: { uniqueKey: "asc" as const },
  },
  verification: { orderBy: { createdAt: "asc" as const } },
  issues: {
    include: { feedback: { orderBy: { createdAt: "asc" as const } } },
    orderBy: { createdAt: "asc" as const },
  },
  facility: { include: { payments: { orderBy: { recordedAt: "asc" as const } } } },
  events: { orderBy: { createdAt: "asc" as const } },
  entitlement: true,
} as const
export type DealRow = BrokerageDeal & {
  selections: DealQuoteSelection[]
  guarantors: GuarantorParticipation[]
  eligibility: EligibilityCheck[]
  photos: InspectionPhoto[]
  checklist: (ChecklistItem & { documents: { attachmentId: string }[] })[]
  verification: VerificationEvent[]
  issues: (ProcessingIssue & { feedback: ProcessingIssueFeedback[] })[]
  facility:
    | (CashFacility & { payments: FacilityPayment[] })
    | null
  events: import("@prisma/client").DealEvent[]
  entitlement: CommissionEntitlement | null
}
export const ref = (row: { id: string; revision: number }): Dependency => ({
  type: "BrokerageDeal",
  id: row.id,
  revision: row.revision,
})
const companyRef = (row: { id: string; revision: number }): Dependency => ({
  type: "FinanceCompany",
  id: row.id,
  revision: row.revision,
})
const quoteRef = (row: { id: string }): Dependency => ({
  type: "Quote",
  id: row.id,
  revision: 1,
})

function selectionDTO(row: DealQuoteSelection): DealQuoteDTO {
  const rate = row.rateSnapshot as Record<string, unknown>
  return {
    id: row.quoteId,
    revision: 1,
    selectionId: row.id,
    version: row.version,
    sheetId: String(rate.sheetId),
    cardId: String(rate.cardId),
    companyId: String(rate.companyId),
    principal: String(rate.principal),
    months: Number(rate.months),
    installment: String(rate.installment),
    maximum: String(rate.maximum),
    charges: row.chargesSnapshot as DealQuoteDTO["charges"],
    policy: rate.policy as DealQuoteDTO["policy"],
    expiresAt: String(rate.expiresAt),
    effectivePolicy: row.effectivePolicySnapshot as DealQuoteDTO["effectivePolicy"],
    selectedAt: row.selectedAt.toISOString(),
    selectedBy: row.selectedBy,
    replacedQuoteId: row.replacedSelectionId,
    ...(row.reason ? { reason: row.reason } : {}),
  }
}
const paymentDTO = (row: FacilityPayment): PaymentDTO => ({
  id: row.id,
  amount: row.amount.toString(),
  date: row.occurredDate.toISOString().slice(0, 10),
  method: row.method as PaymentDTO["method"],
  direction: row.direction as PaymentDTO["direction"],
  category: row.component,
  recordedAt: row.recordedAt.toISOString(),
  ...(row.reference ? { reference: row.reference } : {}),
  ...(row.reversalOf ? { reversalOf: row.reversalOf } : {}),
})
function recovered(row: { payments: FacilityPayment[] }, component: string) {
  return row.payments.reduce(
    (total, payment) =>
      payment.component === component
        ? total +
          (payment.direction === "IN" ? payment.amount : -payment.amount)
        : total,
    0n
  )
}
function facilityDTO(row: CashFacility & { payments: FacilityPayment[] }) {
  const principal = row.net - recovered(row, "PRINCIPAL")
  const charges = row.separatelyRecoverableCharges - recovered(row, "CHARGE")
  const feeOwed = row.feeMode === "SEPARATE" ? row.fee : 0n
  const fee = feeOwed - recovered(row, "FEE")
  return {
    id: row.id,
    revision: row.revision,
    dealId: row.dealId,
    state: row.state,
    terms: {
      gross: row.gross.toString(),
      deductions: row.deductions as FacilityTerms["deductions"],
      fee: row.fee.toString(),
      feeMode: row.feeMode as FacilityTerms["feeMode"],
      separatelyRecoverableCharges: row.separatelyRecoverableCharges.toString(),
    } satisfies FacilityTerms,
    net: row.net.toString(),
    principalOutstanding: (principal < 0n ? 0n : principal).toString(),
    chargesOutstanding: (charges < 0n ? 0n : charges).toString(),
    feeOutstanding: (fee < 0n ? 0n : fee).toString(),
    payments: row.payments.map(paymentDTO),
  }
}

export const dealChecklistHash = (row: DealRow) =>
  checklistHashFor(
    row.checklist.map((item) => ({
      uniqueKey: item.uniqueKey,
      kind: item.kind,
      label: item.label,
      participantId: item.participantId,
      applicability: item.applicability,
      applicabilityReason: item.applicabilityReason,
      collected: item.collected,
      quantity: item.quantity,
      attachments: item.documents.map((d) => d.attachmentId),
    })),
    row.selections.at(-1)?.version ?? 0
  )

export function dealDTO(row: DealRow): BrokerageDTO {
  const current = row.selections.at(-1)
  if (!current) fail("INVALID_STATE")
  return {
    id: row.id,
    revision: row.revision,
    customerId: row.customerId,
    companyId: row.companyId,
    vehicle: row.externalVehicle as BrokerageDTO["vehicle"],
    path: row.path as BrokerageDTO["path"],
    state: row.state as BrokerageDTO["state"],
    guarantors: row.guarantors.map((g) => ({
      id: g.id,
      name: g.name,
      identity: g.identity,
      address: g.address,
      phone: g.phone,
    })),
    quote: selectionDTO(current),
    originalQuoteId: row.originalQuoteId,
    quoteHistory: row.selections.map(selectionDTO),
    quoteStatus: row.quoteStatus as BrokerageDTO["quoteStatus"],
    approvedLoan: row.approvedLoan.toString(),
    processingFee: row.processingFee.toString(),
    ...(row.fileReference ? { fileReference: row.fileReference } : {}),
    eligibility: row.eligibility.map((e) => ({
      target: e.target as "CUSTOMER" | "GUARANTOR" | "VEHICLE",
      ...(e.guarantorId ? { guarantorId: e.guarantorId } : {}),
      outcome: e.outcome as "CONFIRMED" | "REJECTED",
      contactId: e.companyContactId,
      at: e.checkedAt.toISOString(),
      feedback: e.feedback,
    })),
    photos: row.photos.map((p) => ({
      category: p.category as BrokerageDTO["photos"][number]["category"],
      attachmentId: p.attachmentId,
    })),
    checklist: row.checklist.map((item) => ({
      kind: item.kind as Commands["setChecklist"]["items"][number]["kind"],
      ...(item.label ? { label: item.label } : {}),
      ...(item.participantId ? { participantId: item.participantId } : {}),
      applicability:
        item.applicability as Commands["setChecklist"]["items"][number]["applicability"],
      ...(item.applicabilityReason ? { reason: item.applicabilityReason } : {}),
      collected: item.collected,
      quantity: item.quantity,
      attachmentIds: item.documents.map((d) => d.attachmentId),
    })),
    verification: row.verification.map((v) => ({
      id: v.id,
      dealId: v.dealId,
      checklistHash: v.checklistHash,
      outcome: v.outcome as "CLEAN" | "ISSUES" | "RESOLVED",
      issues: v.issues as Commands["verifyDocuments"]["issues"],
      contactId: v.companyContactId,
      confirmedAt: v.confirmedAt.toISOString(),
      feedback: v.feedback,
    })),
    issues: row.issues.map((i) => ({
      id: i.id,
      dealId: i.dealId,
      kind: i.kind as "BLOCKER" | "DELAY_INQUIRY" | "NON_REMITTANCE",
      text: i.text,
      at: i.openedAt.toISOString(),
      ...(i.blocksStep ? { blocksStep: i.blocksStep as "DISPATCH" | "COMPLETE" } : {}),
      ...(i.resolvedAt ? { resolvedAt: i.resolvedAt.toISOString() } : {}),
      feedback: i.feedback.map((f) => ({
        contactId: f.companyContactId,
        at: f.at.toISOString(),
        text: f.feedback,
      })),
    })) as unknown as BrokerageDTO["issues"],
    ...(row.facility ? { facility: facilityDTO(row.facility) } : {}),
    events: row.events.map((e) => ({
      kind: e.kind,
      at: e.at.toISOString(),
      ...(e.contactId ? { contactId: e.contactId } : {}),
      text: e.text,
    })),
    nextActions: nextActions(row),
    provenance: { imported: false },
  }
}
function nextActions(row: DealRow): BrokerageDTO["nextActions"] {
  const actions: BrokerageDTO["nextActions"] = []
  if (["INTAKE", "ELIGIBILITY_PENDING", "ELIGIBLE"].includes(row.state) || (row.state === "REJECTED" && !row.events.some((event) => event.kind === "REJECTED"))) {
    actions.push("recordEligibility")
  }
  if (row.path === "APPLICATION") {
    if (["ELIGIBLE", "INSPECTED", "DOCUMENTS_READY"].includes(row.state)) actions.push("recordInspection")
    if (["INSPECTED", "DOCUMENTS_READY"].includes(row.state)) {
      actions.push("adjustLoan", "replaceDealQuote", "setChecklist")
    }
    if (row.state === "DOCUMENTS_READY") {
      actions.push("informCompany", "dispatchBatch")
    }
    if (row.state === "DISPATCHED") actions.push("completeBrokerage")
  }
  if (row.path === "REFERRAL") {
    if (row.state === "ELIGIBLE") actions.push("referDeal", "replaceDealQuote")
    if (row.state === "REFERRED") actions.push("completeBrokerage")
  }
  if (!["INTAKE", "COMPLETED", "REJECTED"].includes(row.state)) actions.push("rejectDeal")
  if (row.facility?.state === "REQUESTED" && !["REJECTED", "COMPLETED"].includes(row.state) &&
    commonEligible(row) && row.facility.gross === row.approvedLoan)
    actions.push("disburseFacility")
  if (["DISBURSED", "PARTIAL"].includes(row.facility?.state ?? ""))
    actions.push("recoverFacility")
  return [...new Set(actions)]
}

const dealSubject = (row: DealRow) => ({
  ...dealDTO(row),
  createdBy: row.createdBy,
})
function authorizeDeal(actor: Actor, row: DealRow, write: boolean) {
  requireFields(actor.ability, "BrokerageDeal", "read", dealSubject(row), [
    "id",
    "revision",
    "path",
    "state",
    "customerId",
    "companyId",
  ])
  if (write)
    requireFields(actor.ability, "BrokerageDeal", "update", dealSubject(row), [
      "dealId",
    ])
}
async function loadDeal(
  tx: Tx,
  actor: Actor,
  dealId: string,
  write: boolean | string[] = false
): Promise<DealRow> {
  if (write)
    await tx.$queryRaw`SELECT id FROM vamotors."BrokerageDeal" WHERE id=${dealId}::uuid FOR UPDATE`
  const row = await tx.brokerageDeal.findUnique({
    where: { id: dealId },
    include: dealInclude,
  })
  if (!row) fail("NOT_FOUND", 404)
  authorizeDeal(actor, row, Boolean(write))
  if (Array.isArray(write))
    requireFields(actor.ability, "BrokerageDeal", "update", dealSubject(row), write)
  return row
}
function requirePath(row: DealRow, path: "APPLICATION" | "REFERRAL") {
  if (row.path !== path) fail("PATH_MISMATCH")
}
async function activeContact(tx: Tx, companyId: string, contactId: string) {
  const contact = await tx.financeContact.findUnique({ where: { id: contactId } })
  if (
    !contact ||
    contact.companyId !== companyId ||
    !contact.active
  )
    fail("CONTACT_MISMATCH", 422)
  return contact
}
function latestFor(row: DealRow) {
  const map = new Map<string, EligibilityCheck>()
  for (const check of row.eligibility)
    map.set(check.target === "GUARANTOR" ? `G:${check.guarantorId}` : check.target, check)
  return map
}
export function commonEligible(row: DealRow) {
  const latest = latestFor(row)
  if (latest.get("CUSTOMER")?.outcome !== "CONFIRMED") return false
  return row.guarantors.length > 0 && row.guarantors.every(
    (g) => latest.get(`G:${g.id}`)?.outcome === "CONFIRMED"
  )
}
function currentSelection(row: DealRow) {
  const selection = row.selections.at(-1)
  if (!selection) fail("INVALID_STATE")
  return selection
}
export function effectiveVerification(row: DealRow) {
  const last = row.verification.at(-1)
  if (!last) return undefined
  const selection = currentSelection(row)
  if (
    last.checklistHash !== dealChecklistHash(row) ||
    last.quoteSelectionId !== selection.id
  )
    return undefined
  if (!["CLEAN", "RESOLVED"].includes(last.outcome)) return undefined
  return last
}
function blocking(row: DealRow, step: "DISPATCH" | "COMPLETE") {
  return row.issues.filter(
    (issue) =>
      issue.kind === "BLOCKER" &&
      issue.blocksStep === step &&
      issue.resolvedAt === null
  )
}
export function missingChecklist(row: DealRow) {
  const missing: string[] = []
  const byKind = new Map<string, typeof row.checklist>()
  for (const item of row.checklist) {
    const list = byKind.get(item.kind) ?? []
    list.push(item)
    byKind.set(item.kind, list)
  }
  for (const kind of MANDATORY_BASE) {
    const items = byKind.get(kind) ?? []
    if (!items.length) {
      missing.push(`checklist.${kind}`)
      continue
    }
    if (kind === "GUARANTOR_ID") {
      for (const guarantor of row.guarantors) {
        const match = items.find((i) => i.participantId === guarantor.id)
        if (!match || !match.collected || !match.documents.length)
          missing.push(`checklist.GUARANTOR_ID.${guarantor.id}`)
      }
      continue
    }
    if (kind === "EXTRA_KEY" && !items.some((item) => item.collected))
      missing.push("checklist.EXTRA_KEY.collected")
    for (const item of items) {
      if (item.applicability !== "REQUIRED") {
        missing.push(`checklist.${kind}.applicability`)
        continue
      }
      if (!item.collected) missing.push(`checklist.${kind}.collected`)
      if (kind !== "EXTRA_KEY" && !item.documents.length) missing.push(`checklist.${kind}.attachments`)
      if (kind === "PASSPORT_PHOTOS" && item.quantity < 4)
        missing.push(`checklist.PASSPORT_PHOTOS.quantity`)
    }
  }
  for (const kind of ["RELATIONSHIP_PROOF", "DELETION_LETTER"]) {
    const item = byKind.get(kind)?.[0]
    if (!item || (item.applicability !== "REQUIRED" &&
      (item.applicability !== "NOT_REQUIRED" || !item.applicabilityReason)))
      missing.push(`checklist.${kind}.applicability`)
  }
  for (const item of row.checklist) {
    if (item.applicability !== "REQUIRED") continue
    if (!item.collected) missing.push(`checklist.${item.uniqueKey}.collected`)
    if (item.kind !== "EXTRA_KEY" && !item.documents.length)
      missing.push(`checklist.${item.uniqueKey}.attachments`)
  }
  return [...new Set(missing)]
}

// ── Command plumbing ─────────────────────────────────────────────────────────
type Envelope = {
  schemaVersion: 1
  idempotencyKey: string
  expected: Dependency[]
  input: Record<string, unknown>
}
const receiptScope = (
  actorId: string,
  commandName: string,
  idempotencyKey: string
) => ({
  environmentId: runtimeConfig().ENVIRONMENT_ID,
  actorKey: `USER:${actorId}`,
  commandName,
  idempotencyKey,
})
function applied(
  commandId: string,
  replayed: boolean,
  result: Applied["result"],
  affected: Dependency[]
): Applied {
  return {
    ok: true,
    status: "APPLIED",
    commandId,
    replayed,
    result,
    affected,
    invalidate,
  }
}
export function checkRefs(expected: readonly Dependency[], required: Dependency[]) {
  for (const dep of required) {
    const match = expected.find((r) => r.type === dep.type && r.id === dep.id)
    if (!match) fail("REVISION_REQUIRED", 428)
    if (match.revision !== dep.revision)
      throw new CommandError("STALE_REVISION", 409, false, required)
  }
}
async function priorReceipt(
  tx: Tx,
  actor: Actor,
  name: string,
  envelope: Envelope,
  digest: string,
  authorize: (row: DealRow) => Promise<Applied>
) {
  const scope = receiptScope(actor.userId, name, envelope.idempotencyKey)
  const prior = await tx.commandReceipt.findUnique({
    where: { environmentId_actorKey_commandName_idempotencyKey: scope },
  })
  if (!prior) return { scope, prior: null as null }
  const result = prior.result as Applied["result"]
  if (result.type !== "BrokerageDeal" && result.type !== "DispatchBatch")
    fail("IDEMPOTENCY_MISMATCH")
  if (result.type === "BrokerageDeal") {
    const row = await loadDeal(tx, actor, result.id)
    if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
    return {
      scope,
      prior: { ...(await authorize(row)), commandId: prior.id },
    }
  }
  if (prior.inputHash !== digest) fail("IDEMPOTENCY_MISMATCH")
  return { scope, prior: await dispatchReplay(tx, actor, prior) }
}
async function commitDeal(
  tx: Tx,
  actor: Actor,
  input: {
    commandId: string
    commandName: string
    digest: string
    scope: ReturnType<typeof receiptScope>
    sequence: bigint
    before: DealRow | null
    after: DealRow
    extra?: {
      entityType: "CashFacility" | "DispatchBatch" | "CommissionEntitlement"
      entityId: string
      revision: number
      before: Record<string, unknown> | null
      after: Record<string, unknown>
    }[]
    events?: {
      kind: string
      contactId?: string | null
      at: Date
      text: string
    }[]
    result?: Applied["result"]
    reason?: string
  }
) {
  const result = input.result ?? {
    type: "BrokerageDeal" as const,
    id: input.after.id,
    revision: input.after.revision,
  }
  await tx.commandReceipt.create({
    data: {
      id: input.commandId,
      ...input.scope,
      inputHash: input.digest,
      result,
      businessSequence: input.sequence,
    },
  })
  for (const event of input.events ?? [])
    input.after.events.push(await tx.dealEvent.create({
      data: {
        dealId: input.after.id,
        kind: event.kind,
        contactId: event.contactId ?? null,
        at: event.at,
        text: event.text,
        commandId: input.commandId,
      },
    }))
  const payload = dealDTO(input.after)
  await tx.auditEntry.create({
    data: {
      commandId: input.commandId,
      userId: actor.userId,
      entityType: "BrokerageDeal",
      entityId: input.after.id,
      actorKind: "USER",
      action: input.commandName,
      reason: input.reason,
      fieldDiff: fieldDiff("BrokerageDeal", input.before ? dealSubject(input.before) : null, {
        ...payload,
        createdBy: input.after.createdBy,
      }),
    },
  })
  await writeReadVersion(tx, {
    commandId: input.commandId,
    sequence: input.sequence,
    entityType: "BrokerageDeal",
    entityId: input.after.id,
    revision: input.after.revision,
    payload,
  })
  for (const extra of input.extra ?? []) {
    await tx.auditEntry.create({
      data: {
        commandId: input.commandId,
        userId: actor.userId,
        entityType: extra.entityType,
        entityId: extra.entityId,
        actorKind: "USER",
        action: input.commandName,
        fieldDiff: fieldDiff(
          extra.entityType,
          extra.before,
          extra.after
        ),
      },
    })
    await writeReadVersion(tx, {
      commandId: input.commandId,
      sequence: input.sequence,
      entityType: extra.entityType,
      entityId: extra.entityId,
      revision: extra.revision,
      payload: extra.after,
    })
  }
  const affected = [ref(input.after)]
  for (const extra of input.extra ?? [])
    affected.push({
      type: extra.entityType,
      id: extra.entityId,
      revision: extra.revision,
    } as Dependency)
  return applied(input.commandId, false, result, affected)
}

function facilityTerms(terms: z.infer<typeof import("./validators").facilityTerms>) {
  const gross = money(terms.gross)
  const deductions = terms.deductions.map((d) => ({
    ...d,
    amount: money(d.amount),
  }))
  const fee = money(terms.fee)
  const charges = money(terms.separatelyRecoverableCharges)
  let result
  try {
    result = calculateFacilityDisbursement({
      gross,
      deductions,
      fee,
      feeMode: terms.feeMode,
      separatelyRecoverableCharges: charges,
    })
  } catch {
    fail("BALANCE_MISMATCH", 422)
  }
  return { result, gross, fee, charges, deductions }
}
const storedTerms = (
  terms: z.infer<typeof import("./validators").facilityTerms>,
  result: ReturnType<typeof calculateFacilityDisbursement>
) => ({
  gross: result.gross.toString(),
  deductions: terms.deductions.map((d) => ({
    label: d.label,
    amount: d.amount,
    recipient: d.recipient,
    handling: d.handling,
  })),
  fee: terms.fee,
  feeMode: result.feeMode,
  separatelyRecoverableCharges: result.separatelyRecoverableCharges.toString(),
})
const expectedCommission = (policy: Record<string, unknown>, principal: bigint) => {
  const value = policy.commission as
    | { basis: "FIXED"; fixed: string; rateBps: number }
    | { basis: "FINANCED_PRINCIPAL"; rateBps: number }
  return value.basis === "FIXED"
    ? money(value.fixed)
    : commission(principal, value.rateBps)
}

// ── Entrypoint ───────────────────────────────────────────────────────────────
export async function executeBrokerage(
  identity: Identity,
  name: Name,
  raw: unknown,
  existingTx?: Tx
): Promise<Applied> {
  if (name === "dispatchBatch") return executeDispatch(identity, raw, existingTx)
  const parsed =
    name === "reversePayment"
      ? brokerageReversalEnvelope.safeParse(raw)
      : brokerageEnvelope(name).safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const envelope = parsed.data as Envelope
  const digest = inputDigest(envelope, runtimeConfig().BETTER_AUTH_SECRET)
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE`
    await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
    await tx.$queryRaw`SELECT id FROM vamotors.session WHERE id=${identity.sessionId}::uuid FOR SHARE`
    const actor = await currentActor(tx, identity)
    if (name === "reversePayment")
      return reverseBrokeragePayment(tx, actor, envelope, digest, raw)
    return handlers[name as BrokerageCommandName](tx, actor, envelope, digest)
  }, existingTx)
}

type Handler = (
  tx: Tx,
  actor: Actor,
  envelope: Envelope,
  digest: string
) => Promise<Applied>

const handlers: Record<BrokerageCommandName, Handler> = {
  openBrokerage: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.openBrokerage.parse(envelope.input)
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
    })
    if (!customer) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "Customer", "read", customer, [
      "id",
      "revision",
      "active",
    ])
    if (!customer.active) fail("INVALID_STATE")
    const quote = await quoteForUse(tx, actor, input.quoteId)
    const company = await tx.financeCompany.findUnique({
      where: { id: quote.companyId },
    })
    if (!company) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "FinanceCompany", "read", company, [
      "id",
      "revision",
      "active",
    ])
    if (!company.active) fail("INVALID_STATE")
    await tx.$queryRaw`SELECT id FROM vamotors."FinanceCompany" WHERE id=${company.id}::uuid FOR UPDATE`
    const settings = await currentSettings(tx)
    const candidate = {
      ...input,
      createdBy: actor.userId,
      customerId: customer.id,
    }
    requireFields(actor.ability, "BrokerageDeal", "create", candidate, [
      "customerId",
      "guarantors",
      "quoteId",
      "facility",
    ])
    if (input.facility)
      requireFields(actor.ability, "CashFacility", "create", { createdBy: actor.userId }, ["dealId", "terms"])
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "openBrokerage",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [
      { type: "Customer", id: customer.id, revision: customer.revision },
      quoteRef(quote),
      companyRef(company),
      { type: "Settings", id: settings.id, revision: settings.revision },
    ])
    const path = (quote.policySnapshot as { path: "APPLICATION" | "REFERRAL" })
      .path
    const normalized = new Set<string>([customer.normalizedIdentity])
    for (const guarantor of input.guarantors) {
      const identity = normalizeIdentity(guarantor.identity)
      if (normalized.has(identity)) fail("IDENTITY_CONFLICT")
      normalized.add(identity)
    }
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      dealId = randomUUID(),
      now = new Date()
    await tx.brokerageDeal.create({
      data: {
        id: dealId,
        customerId: customer.id,
        companyId: company.id,
        externalVehicle: quote.vehicle as Prisma.InputJsonObject,
        path,
        state: "INTAKE",
        originalQuoteId: quote.id,
        quoteStatus: "SUPPORTED",
        requestedLoan: quote.principal,
        approvedLoan: quote.principal,
        processingFee: money(
          (quote.policySnapshot as { processingFee: string }).processingFee
        ),
        processingFeeOverridden: false,
        effectivePolicySnapshot: quote.policySnapshot as Prisma.InputJsonObject,
        chargesSnapshot: quote.charges as Prisma.InputJsonObject,
        commandId,
        createdBy: actor.userId,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      },
    })
    const selection = await tx.dealQuoteSelection.create({
      data: {
        dealId,
        version: 1,
        quoteId: quote.id,
        selectedBy: actor.userId,
        selectedAt: now,
        rateSnapshot: {
          sheetId: quote.sheetId,
          cardId: quote.cardId,
          companyId: quote.companyId,
          principal: quote.principal.toString(),
          months: quote.months,
          installment: quote.installment.toString(),
          maximum: quote.maximum.toString(),
          policy: quote.policySnapshot,
          expiresAt: quote.expiresAt.toISOString(),
        } as Prisma.InputJsonObject,
        effectivePolicySnapshot: quote.policySnapshot as Prisma.InputJsonObject,
        chargesSnapshot: quote.charges as Prisma.InputJsonObject,
        path,
      },
    })
    await tx.brokerageDeal.update({
      where: { id: dealId },
      data: { currentQuoteSelectionId: selection.id, revision: 2, updatedAt: now },
    })
    for (const guarantor of input.guarantors)
      await tx.guarantorParticipation.create({
        data: {
          dealId,
          name: guarantor.name,
          identity: guarantor.identity,
          normalizedIdentity: normalizeIdentity(guarantor.identity),
          address: guarantor.address,
          phone: guarantor.phone,
          createdBy: actor.userId,
        },
      })
    let facilityExtra:
      | {
          entityType: "CashFacility"
          entityId: string
          revision: number
          before: null
          after: Record<string, unknown>
        }
      | undefined
    if (input.facility) {
      const { result, fee } = facilityTerms(input.facility)
      if (result.gross !== quote.principal) fail("BALANCE_MISMATCH", 422)
      const facility = await tx.cashFacility.create({
        data: {
          dealId,
          requestedAt: now,
          gross: result.gross,
          deductions: storedTerms(input.facility, result)
            .deductions as unknown as Prisma.InputJsonArray,
          fee: fee,
          feeMode: result.feeMode,
          net: result.netDisbursed,
          separatelyRecoverableCharges: result.separatelyRecoverableCharges,
          reason: "Facility requested at brokerage intake",
          state: "REQUESTED",
          revision: 1,
          createdBy: actor.userId,
          commandId,
        },
      })
      facilityExtra = {
        entityType: "CashFacility",
        entityId: facility.id,
        revision: 1,
        before: null,
        after: facilityDTO({ ...facility, payments: [] }),
      }
    }
    const after = await loadDeal(tx, actor, dealId)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "openBrokerage",
      digest,
      scope,
      sequence,
      before: null,
      after,
      ...(facilityExtra ? { extra: [facilityExtra] } : {}),
    })
  },

  recordEligibility: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.recordEligibility.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    requireFields(actor.ability, "FinanceCompany", "read", company, [
      "id",
      "revision",
    ])
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "recordEligibility",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    if (!["INTAKE", "ELIGIBILITY_PENDING", "ELIGIBLE", "REJECTED"].includes(deal.state))
      fail("INVALID_STATE")
    if (deal.state === "REJECTED" && deal.events.some((event) => event.kind === "REJECTED"))
      fail("INVALID_STATE")
    await activeContact(tx, deal.companyId, input.contactId)
    if (input.target === "VEHICLE") requirePath(deal, "APPLICATION")
    if (input.target === "GUARANTOR") {
      const guarantor = deal.guarantors.find((g) => g.id === input.guarantorId)
      if (!guarantor) fail("INVALID_INPUT", 422)
    }
    const targetKey =
      input.target === "GUARANTOR" ? `G:${input.guarantorId}` : input.target
    const latest = latestFor(deal)
    const previous = latest.get(targetKey)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.eligibilityCheck.create({
      data: {
        dealId: deal.id,
        target: input.target,
        guarantorId: input.guarantorId ?? null,
        outcome: input.outcome,
        companyContactId: input.contactId,
        feedback: input.feedback,
        checkedAt: new Date(input.checkedAt),
        actorId: actor.userId,
        supersedesId: previous?.id ?? null,
        commandId,
      },
    })
    let state = deal.state
    let rejectionReason = deal.rejectionReason
    let rejectedAt = deal.rejectedAt
    if (input.outcome === "REJECTED") {
      state = "REJECTED"
      rejectionReason = `${input.target} eligibility rejected: ${input.feedback}`.slice(
        0,
        2000
      )
      rejectedAt = new Date(input.checkedAt)
    } else {
      const all = new Map(latest)
      all.delete(targetKey)
      const remainingRejection = [...all.values()].reverse().find((check) => check.outcome === "REJECTED")
      if (remainingRejection) {
        state = "REJECTED"
        rejectionReason = `${remainingRejection.target} eligibility rejected: ${remainingRejection.feedback}`.slice(0, 2000)
        rejectedAt = remainingRejection.checkedAt
      } else {
        all.set(targetKey, { outcome: "CONFIRMED" } as EligibilityCheck)
        const common =
          all.get("CUSTOMER")?.outcome === "CONFIRMED" &&
          deal.guarantors.every((g) => all.get(`G:${g.id}`)?.outcome === "CONFIRMED")
        state = common && (deal.path === "REFERRAL" || all.get("VEHICLE")?.outcome === "CONFIRMED")
          ? (deal.photos.length === PHOTO_CATEGORIES.length ? "INSPECTED" : "ELIGIBLE")
          : "ELIGIBILITY_PENDING"
        rejectionReason = null
        rejectedAt = null
      }
    }
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        state,
        rejectionReason,
        rejectedAt,
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "recordEligibility",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  recordInspection: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.recordInspection.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "APPLICATION")
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "recordInspection",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal)])
    if (!["ELIGIBLE", "INSPECTED", "DOCUMENTS_READY"].includes(deal.state))
      fail("INVALID_STATE")
    if (!commonEligible(deal)) fail("CHECKLIST_INCOMPLETE", 422)
    if (latestFor(deal).get("VEHICLE")?.outcome !== "CONFIRMED")
      fail("CHECKLIST_INCOMPLETE", 422)
    const provided = new Set(input.photos.map((p) => p.category))
    const existing = new Set(deal.photos.map((p) => p.category))
    if (!PHOTO_CATEGORIES.every((c) => provided.has(c) || existing.has(c)))
      fail("CHECKLIST_INCOMPLETE", 422)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      now = new Date()
    for (const photo of input.photos) {
      const attachment = await tx.attachment.findUnique({
        where: { id: photo.attachmentId },
      })
      if (
        !attachment ||
        attachment.targetType !== "BROKERAGE_DEAL" ||
        attachment.brokerageDealId !== deal.id ||
        attachment.purpose !== "INSPECTION" ||
        attachment.photoCategory !== photo.category
      )
        fail("UPLOAD_MISMATCH", 422)
      const current = deal.photos.find((p) => p.category === photo.category)
      if (current)
        await tx.inspectionPhoto.update({
          where: { id: current.id },
          data: { isCurrent: false },
        })
      const version =
        (
          await tx.inspectionPhoto.aggregate({
            where: { dealId: deal.id, category: photo.category },
            _max: { version: true },
          })
        )._max.version ?? 0
      await tx.inspectionPhoto.create({
        data: {
          dealId: deal.id,
          category: photo.category,
          version: version + 1,
          attachmentId: attachment.id,
          isCurrent: true,
          createdBy: actor.userId,
          createdAt: now,
          commandId,
        },
      })
    }
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { ...resetFileReference, state: "INSPECTED", revision: deal.revision + 1, updatedAt: now },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "recordInspection",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  adjustLoan: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.adjustLoan.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "APPLICATION")
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    requireFields(actor.ability, "FinanceCompany", "read", company, [
      "id",
      "revision",
    ])
    const facility = deal.facility
      ? await lockFacility(tx, deal.id)
      : null
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "adjustLoan",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    const required: Dependency[] = [ref(deal), companyRef(company)]
    if (facility)
      required.push({
        type: "CashFacility",
        id: facility.id,
        revision: facility.revision,
      })
    checkRefs(envelope.expected, required)
    if (!["INSPECTED", "DOCUMENTS_READY"].includes(deal.state))
      fail("INVALID_STATE")
    await activeContact(tx, deal.companyId, input.contactId)
    const amount = money(input.amount)
    const selection = currentSelection(deal)
    const rate = selection.rateSnapshot as { maximum: string; principal: string }
    if (amount > BigInt(rate.maximum)) fail("OVERALLOWANCE", 422)
    if (
      facility &&
      ["DISBURSED", "PARTIAL", "RECOVERED"].includes(facility.state) &&
      amount !== facility.gross
    )
      fail("OBLIGATION_OPEN")
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        ...resetFileReference,
        approvedLoan: amount,
        quoteStatus: BigInt(rate.principal) === amount ? "SUPPORTED" : "RESELECTION_REQUIRED",
        state: "INSPECTED",
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "adjustLoan",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      events: [
        {
          kind: "LOAN_ADJUSTMENT",
          contactId: input.contactId,
          at: new Date(input.confirmedAt),
          text: `Approved loan adjusted to ${input.amount}: ${input.feedback}`.slice(0, 2000).trimEnd(),
        },
      ],
    })
  },

  replaceDealQuote: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.replaceDealQuote.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    const quote = await quoteForUse(tx, actor, input.quoteId)
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    requireFields(actor.ability, "FinanceCompany", "read", company, [
      "id",
      "revision",
    ])
    const facility = deal.facility ? await lockFacility(tx, deal.id) : null
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "replaceDealQuote",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    const required: Dependency[] = [
      ref(deal),
      quoteRef(quote),
      companyRef(company),
    ]
    if (facility)
      required.push({
        type: "CashFacility",
        id: facility.id,
        revision: facility.revision,
      })
    checkRefs(envelope.expected, required)
    if (deal.path === "APPLICATION"
      ? !["INSPECTED", "DOCUMENTS_READY"].includes(deal.state)
      : deal.state !== "ELIGIBLE")
      fail("INVALID_STATE")
    await activeContact(tx, deal.companyId, input.contactId)
    const quotePolicy = quote.policySnapshot as { path: string }
    if (quote.companyId !== deal.companyId) fail("BALANCE_MISMATCH", 422)
    if (quotePolicy.path !== deal.path) fail("PATH_MISMATCH")
    const previousVehicle = deal.externalVehicle as BrokerageDTO["vehicle"]
    const candidateVehicle = quote.vehicle as BrokerageDTO["vehicle"]
    if (["make", "model", "year"].some((key) =>
      previousVehicle[key as "make" | "model" | "year"] !== candidateVehicle[key as "make" | "model" | "year"]
    )) fail("BALANCE_MISMATCH", 422)
    if (quote.principal !== deal.approvedLoan) fail("BALANCE_MISMATCH", 422)
    if (canonical(quote.charges) !== canonical(deal.chargesSnapshot))
      fail("BALANCE_MISMATCH", 422)
    if (facility && quote.principal !== facility.gross)
      fail("OBLIGATION_OPEN")
    const current = currentSelection(deal)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      now = new Date()
    const selection = await tx.dealQuoteSelection.create({
      data: {
        dealId: deal.id,
        version: current.version + 1,
        quoteId: quote.id,
        replacedSelectionId: current.id,
        selectedBy: actor.userId,
        selectedAt: now,
        contactId: input.contactId,
        reason: input.reason,
        rateSnapshot: {
          sheetId: quote.sheetId,
          cardId: quote.cardId,
          companyId: quote.companyId,
          principal: quote.principal.toString(),
          months: quote.months,
          installment: quote.installment.toString(),
          maximum: quote.maximum.toString(),
          policy: quote.policySnapshot,
          expiresAt: quote.expiresAt.toISOString(),
        } as Prisma.InputJsonObject,
        effectivePolicySnapshot: deal.effectivePolicySnapshot as Prisma.InputJsonObject,
        chargesSnapshot: deal.chargesSnapshot as Prisma.InputJsonObject,
        path: deal.path,
      },
    })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        ...resetFileReference,
        currentQuoteSelectionId: selection.id,
        quoteStatus: "SUPPORTED",
        state: deal.path === "APPLICATION" ? "INSPECTED" : "ELIGIBLE",
        revision: deal.revision + 1,
        updatedAt: now,
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "replaceDealQuote",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  setChecklist: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.setChecklist.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "APPLICATION")
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "setChecklist",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal)])
    if (!["INSPECTED", "DOCUMENTS_READY"].includes(deal.state))
      fail("INVALID_STATE")
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      now = new Date()
    const guarantorIds = new Set(deal.guarantors.map((g) => g.id))
    const attachments = new Map<string, Attachment>()
    for (const item of input.items) {
      if (MANDATORY_BASE.includes(item.kind) && item.applicability !== "REQUIRED")
        fail("CHECKLIST_INCOMPLETE", 422)
      if (
        ["RELATIONSHIP_PROOF", "DELETION_LETTER"].includes(item.kind) &&
        item.applicability === "NOT_REQUIRED" &&
        !item.reason
      )
        fail("CHECKLIST_INCOMPLETE", 422)
      if (item.kind === "GUARANTOR_ID"
        ? !guarantorIds.has(item.participantId ?? "")
        : item.participantId !== undefined)
        fail("INVALID_INPUT", 422)
      if (item.kind === "PASSPORT_PHOTOS" && (item.quantity < 4 || !item.attachmentIds.length))
        fail("CHECKLIST_INCOMPLETE", 422)
      if (item.kind === "PROCESSING_DOCUMENT" && !item.label)
        fail("INVALID_INPUT", 422)
      if (item.kind === "EXTRA_KEY" && item.attachmentIds.length)
        fail("CHECKLIST_INCOMPLETE", 422)
      const purpose = PARTICIPANT_KINDS.includes(item.kind)
        ? "PARTICIPANT_DOCUMENT"
        : VEHICLE_KINDS.includes(item.kind)
          ? "VEHICLE_DOCUMENT"
          : item.kind === "PROCESSING_DOCUMENT"
            ? "PROCESSING_DOCUMENT"
            : null
      if (purpose) {
        for (const attachmentId of item.attachmentIds) {
          let attachment = attachments.get(attachmentId)
          if (!attachment) {
            attachment =
              (await tx.attachment.findUnique({
                where: { id: attachmentId },
              })) ?? undefined
            if (attachment) attachments.set(attachmentId, attachment)
          }
          if (
            !attachment ||
            attachment.brokerageDealId !== deal.id ||
            attachment.purpose !== purpose ||
            attachment.photoCategory !== null
          )
            fail("UPLOAD_MISMATCH", 422)
        }
      }
    }
    const keys = new Set(input.items.map(checklistItemKey))
    for (const existing of deal.checklist) {
      if (keys.has(existing.uniqueKey)) continue
      await tx.checklistDocument.deleteMany({
        where: { checklistItemId: existing.id },
      })
      await tx.checklistItem.delete({ where: { id: existing.id } })
    }
    for (const item of input.items) {
      const key = checklistItemKey(item)
      const existing = deal.checklist.find((i) => i.uniqueKey === key)
      const data = {
        label: item.label ?? null,
        participantId: item.participantId ?? null,
        applicability: item.applicability,
        applicabilityReason: item.reason ?? null,
        collected: item.collected,
        quantity: item.quantity,
        updatedAt: now,
      }
      const row = existing
        ? await tx.checklistItem.update({
            where: { id: existing.id },
            data: { ...data, revision: existing.revision + 1 },
          })
        : await tx.checklistItem.create({
            data: {
              dealId: deal.id,
              uniqueKey: key,
              kind: item.kind,
              ...data,
              revision: 1,
              createdAt: now,
              commandId,
            },
          })
      if (existing)
        await tx.checklistDocument.deleteMany({
          where: { checklistItemId: row.id },
        })
      for (const attachmentId of item.attachmentIds)
        await tx.checklistDocument.create({
          data: { checklistItemId: row.id, attachmentId },
        })
    }
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { ...resetFileReference, state: "INSPECTED", revision: deal.revision + 1, updatedAt: now },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "setChecklist",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  verifyDocuments: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.verifyDocuments.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "APPLICATION")
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "verifyDocuments",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    if (!["INSPECTED", "DOCUMENTS_READY"].includes(deal.state))
      fail("INVALID_STATE")
    await activeContact(tx, deal.companyId, input.contactId)
    const hash = dealChecklistHash(deal)
    if (hash !== input.checklistHash) fail("VERIFICATION_STALE")
    const missing = missingChecklist(deal)
    const previous = deal.verification.at(-1)
    const outstanding = previous?.outcome === "ISSUES"
      ? (previous.issues as Commands["verifyDocuments"]["issues"]).map((issue) => issue.itemKey)
      : []
    const incoming = new Set(input.issues.map((issue) => issue.itemKey))
    if (input.outcome !== "ISSUES" && (missing.length || deal.quoteStatus !== "SUPPORTED"))
      fail("CHECKLIST_INCOMPLETE", 422)
    if (input.outcome === "CLEAN" && (incoming.size || outstanding.length))
      fail("INVALID_INPUT", 422)
    if (input.outcome === "ISSUES" && (
      !incoming.size || input.issues.some((i) => i.resolved) ||
      outstanding.some((key) => !incoming.has(key))
    ))
      fail("INVALID_INPUT", 422)
    if (input.outcome === "RESOLVED" && (
      !outstanding.length || incoming.size !== outstanding.length ||
      outstanding.some((key) => !incoming.has(key)) || input.issues.some((i) => !i.resolved)
    ))
      fail("INVALID_INPUT", 422)
    const keys = new Set(deal.checklist.map((i) => i.uniqueKey))
    if (input.issues.some((i) => !keys.has(i.itemKey) && !outstanding.includes(i.itemKey)))
      fail("INVALID_INPUT", 422)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.verificationEvent.create({
      data: {
        dealId: deal.id,
        checklistHash: hash,
        quoteSelectionId: currentSelection(deal).id,
        outcome: input.outcome,
        issues: input.issues as unknown as Prisma.InputJsonArray,
        companyContactId: input.contactId,
        confirmedAt: new Date(input.confirmedAt),
        feedback: input.feedback,
        actorId: actor.userId,
        commandId,
      },
    })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        ...(input.outcome === "ISSUES" ? resetFileReference : {}),
        state: input.outcome === "ISSUES" ? "INSPECTED" : "DOCUMENTS_READY",
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "verifyDocuments",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  setProcessingFee: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.setProcessingFee.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "APPLICATION")
    requireFields(actor.ability, "BrokerageDeal", "update", dealSubject(deal), [
      "processingFee",
    ])
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "setProcessingFee",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal)])
    if (!["INTAKE", "ELIGIBILITY_PENDING"].includes(deal.state))
      fail("INVALID_STATE")
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        processingFee: money(input.amount),
        processingFeeOverridden: true,
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "setProcessingFee",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      reason: input.reason,
    })
  },

  informCompany: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.informCompany.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "APPLICATION")
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "informCompany",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    if (deal.state !== "DOCUMENTS_READY") fail("INVALID_STATE")
    if (!effectiveVerification(deal)) fail("VERIFICATION_STALE")
    await activeContact(tx, deal.companyId, input.contactId)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        fileReference: input.fileReference,
        informedContactId: input.contactId,
        informedAt: new Date(input.informedAt),
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "informCompany",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      events: [
        {
          kind: "COMPANY_INFORMED",
          contactId: input.contactId,
          at: new Date(input.informedAt),
          text: `Company informed. File ${input.fileReference}. ${input.feedback}`.slice(0, 2000).trimEnd(),
        },
      ],
    })
  },

  referDeal: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.referDeal.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    requirePath(deal, "REFERRAL")
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "referDeal",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    if (deal.state !== "ELIGIBLE") fail("INVALID_STATE")
    if (!commonEligible(deal)) fail("CHECKLIST_INCOMPLETE", 422)
    await activeContact(tx, deal.companyId, input.contactId)
    if (deal.entitlement || deal.quoteStatus !== "SUPPORTED") fail("INVALID_STATE")
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      at = new Date(input.referredAt)
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        state: "REFERRED",
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const policy = deal.effectivePolicySnapshot as Record<string, unknown>
    const expectedAmount = expectedCommission(policy, deal.approvedLoan)
    const entitlement = await tx.commissionEntitlement.create({
      data: {
        companyId: deal.companyId,
        sourceType: "BROKERAGE",
        brokerageDealId: deal.id,
        expectedAmount,
        policySnapshot: policy as Prisma.InputJsonObject,
        eligibleAt: at,
        sentDate: new Date(`${colomboDate(at)}T00:00:00.000Z`),
        sentDateSource: "REFERRAL",
        state: expectedAmount === 0n ? "SETTLED" : "OPEN",
        revision: 1,
        createdBy: actor.userId,
        commandId,
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "referDeal",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      events: [
        {
          kind: "REFERRAL",
          contactId: input.contactId,
          at,
          text: `Referred to ${input.sentContact.name} (${input.sentContact.phone}). ${input.feedback}`,
        },
      ],
      extra: [
        {
          entityType: "CommissionEntitlement",
          entityId: entitlement.id,
          revision: 1,
          before: null,
          after: {
            id: entitlement.id,
            revision: 1,
            companyId: entitlement.companyId,
            sourceType: entitlement.sourceType,
            brokerageDealId: entitlement.brokerageDealId,
            expectedAmount: entitlement.expectedAmount.toString(),
            policySnapshot: entitlement.policySnapshot,
            eligibleAt: entitlement.eligibleAt.toISOString(),
            sentDate: date(entitlement.sentDate),
            sentDateSource: entitlement.sentDateSource,
            state: entitlement.state,
          },
        },
      ],
    })
  },

  rejectDeal: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.rejectDeal.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "rejectDeal",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    if (["COMPLETED", "REJECTED", "INTAKE"].includes(deal.state))
      fail("INVALID_STATE")
    await activeContact(tx, deal.companyId, input.contactId)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      at = new Date(input.at)
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        state: "REJECTED",
        rejectionReason: input.reason,
        rejectedAt: at,
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "rejectDeal",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      events: [
        {
          kind: "REJECTED",
          contactId: input.contactId,
          at,
          text: input.reason,
        },
      ],
    })
  },

  completeBrokerage: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.completeBrokerage.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "completeBrokerage",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    if (!["DISPATCHED", "REFERRED"].includes(deal.state))
      fail("INVALID_STATE")
    await activeContact(tx, deal.companyId, input.contactId)
    if (blocking(deal, "COMPLETE").length) fail("CHECKLIST_INCOMPLETE", 422)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      at = new Date(input.at)
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: {
        state: "COMPLETED",
        completedAt: at,
        revision: deal.revision + 1,
        updatedAt: new Date(),
      },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "completeBrokerage",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      events: [
        {
          kind: "COMPLETED",
          contactId: input.contactId,
          at,
          text: input.feedback,
        },
      ],
    })
  },

  openIssue: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.openIssue.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, Object.keys(input))
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "openIssue",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal)])
    if (input.kind === "NON_REMITTANCE") requirePath(deal, "REFERRAL")
    if (input.blocksStep === "DISPATCH") requirePath(deal, "APPLICATION")
    if (["COMPLETED"].includes(deal.state)) fail("INVALID_STATE")
    if (input.contactId) await activeContact(tx, deal.companyId, input.contactId)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    const issue = await tx.processingIssue.create({
      data: {
        dealId: deal.id,
        kind: input.kind,
        text: input.text,
        openedAt: new Date(input.at),
        blocksStep: input.blocksStep ?? null,
        createdBy: actor.userId,
        revision: 1,
        commandId,
      },
    })
    if (input.contactId && input.feedback)
      await tx.processingIssueFeedback.create({
        data: {
          issueId: issue.id,
          companyContactId: input.contactId,
          at: new Date(input.at),
          feedback: input.feedback,
          resolve: false,
          actorId: actor.userId,
          commandId,
        },
      })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { revision: deal.revision + 1, updatedAt: new Date() },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "openIssue",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  recordIssueFeedback: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.recordIssueFeedback.parse(envelope.input)
    const issue = await tx.processingIssue.findUnique({
      where: { id: input.issueId },
    })
    if (!issue) fail("NOT_FOUND", 404)
    const deal = await loadDeal(tx, actor, issue.dealId, true)
    requireFields(actor.ability, "BrokerageDeal", "update", dealSubject(deal), Object.keys(input))
    const company = await tx.financeCompany.findUniqueOrThrow({
      where: { id: deal.companyId },
    })
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "recordIssueFeedback",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal), companyRef(company)])
    await activeContact(tx, deal.companyId, input.contactId)
    if (issue.resolvedAt) fail("INVALID_STATE")
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.processingIssueFeedback.create({
      data: {
        issueId: issue.id,
        companyContactId: input.contactId,
        at: new Date(input.at),
        feedback: input.feedback,
        resolve: input.resolve,
        actorId: actor.userId,
        commandId,
      },
    })
    if (input.resolve)
      await tx.processingIssue.update({
        where: { id: issue.id },
        data: {
          resolvedAt: new Date(input.at),
          resolution: input.feedback,
          revision: issue.revision + 1,
          updatedAt: new Date(),
        },
      })
    else
      await tx.processingIssue.update({
        where: { id: issue.id },
        data: { revision: issue.revision + 1, updatedAt: new Date() },
      })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { revision: deal.revision + 1, updatedAt: new Date() },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "recordIssueFeedback",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },

  requestFacility: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.requestFacility.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, true)
    const facility = deal.facility ? await lockFacility(tx, deal.id) : null
    requireFields(actor.ability, "CashFacility", facility ? "update" : "create", facility ?? { createdBy: actor.userId }, Object.keys(input))
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "requestFacility",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(
      envelope.expected,
      facility
        ? [
            ref(deal),
            { type: "CashFacility", id: facility.id, revision: facility.revision },
          ]
        : [ref(deal)]
    )
    if (["REJECTED", "COMPLETED"].includes(deal.state)) fail("INVALID_STATE")
    if (facility && facility.state !== "REQUESTED") fail("INVALID_STATE")
    const { result, fee } = facilityTerms(input.terms)
    if (result.gross !== deal.approvedLoan) fail("BALANCE_MISMATCH", 422)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx),
      terms = storedTerms(input.terms, result)
    const data = {
      gross: result.gross,
      deductions: terms.deductions as unknown as Prisma.InputJsonArray,
      fee: fee,
      feeMode: result.feeMode,
      net: result.netDisbursed,
      separatelyRecoverableCharges: result.separatelyRecoverableCharges,
      reason: input.reason,
      updatedAt: new Date(),
    }
    const row = facility
      ? await tx.cashFacility.update({
          where: { id: facility.id },
          data: { ...data, revision: facility.revision + 1 },
          include: { payments: true },
        })
      : await tx.cashFacility.create({
          data: {
            dealId: deal.id,
            requestedAt: new Date(),
            ...data,
            state: "REQUESTED",
            revision: 1,
            createdBy: actor.userId,
            commandId,
          },
          include: { payments: true },
        })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { revision: deal.revision + 1, updatedAt: new Date() },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "requestFacility",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      extra: [
        {
          entityType: "CashFacility",
          entityId: row.id,
          revision: row.revision,
          before: facility ? facilityDTO({ ...facility, payments: facility.payments }) : null,
          after: facilityDTO(row) as unknown as Record<string, unknown>,
        },
      ],
    })
  },

  disburseFacility: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.disburseFacility.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, true)
    const facility = await lockFacility(tx, deal.id)
    if (!facility) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "CashFacility", "pay", facility ?? { createdBy: actor.userId }, Object.keys(input))
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "disburseFacility",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [
      ref(deal),
      { type: "CashFacility", id: facility.id, revision: facility.revision },
    ])
    if (facility.state !== "REQUESTED") fail("INVALID_STATE")
    if (["REJECTED", "COMPLETED"].includes(deal.state) || !commonEligible(deal)) fail("INVALID_STATE")
    if (facility.gross !== deal.approvedLoan) fail("BALANCE_MISMATCH", 422)
    const deductions = facility.deductions as FacilityTerms["deductions"]
    const separatelyPaid = deductions.flatMap((deduction, index) =>
      deduction.handling === "PAID_BY_DEALERSHIP" && money(deduction.amount) > 0n
        ? [{ deduction, index }]
        : []
    )
    const supplied = new Map(
      input.separatelyPaidDeductions.map((entry) => [entry.index, entry.payment])
    )
    for (const { deduction, index } of separatelyPaid) {
      const payment = supplied.get(index)
      if (!payment || money(payment.amount) !== money(deduction.amount))
        fail("BALANCE_MISMATCH", 422)
    }
    if (supplied.size !== separatelyPaid.length)
      fail("BALANCE_MISMATCH", 422)
    const net = facility.net
    if (net === 0n && input.payment) fail("BALANCE_MISMATCH", 422)
    if (net > 0n && (!input.payment || money(input.payment.amount) !== net))
      fail("BALANCE_MISMATCH", 422)
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.facilityPayment.createMany({
      data: [
        ...(net > 0n && input.payment
          ? [
              {
                facilityId: facility.id,
                amount: net,
                direction: "OUT",
                component: "PAYOUT",
                occurredDate: new Date(input.payment.date),
                method: input.payment.method,
                reference: input.payment.reference ?? null,
                createdBy: actor.userId,
                commandId,
                lineKey: "payout",
              },
            ]
          : []),
        ...separatelyPaid.map(({ deduction, index }) => {
          const payment = supplied.get(index)!
          return {
            facilityId: facility.id,
            amount: money(deduction.amount),
            direction: "OUT" as const,
            component: "DEDUCTION" as const,
            occurredDate: new Date(payment.date),
            method: payment.method,
            reference: payment.reference ?? null,
            createdBy: actor.userId,
            commandId,
            lineKey: `deduction:${index}`,
          }
        }),
      ],
    })
    const updated = await tx.cashFacility.update({
      where: { id: facility.id },
      data: {
        state: net === 0n && facility.separatelyRecoverableCharges === 0n &&
          (facility.feeMode === "WITHHELD" || facility.fee === 0n)
          ? "RECOVERED"
          : "DISBURSED",
        revision: facility.revision + 1,
        updatedAt: new Date(),
      },
      include: { payments: { orderBy: { recordedAt: "asc" } } },
    })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { revision: deal.revision + 1, updatedAt: new Date() },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "disburseFacility",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      extra: [
        {
          entityType: "CashFacility",
          entityId: updated.id,
          revision: updated.revision,
          before: facilityDTO(facility) as unknown as Record<string, unknown>,
          after: facilityDTO(updated) as unknown as Record<string, unknown>,
        },
      ],
    })
  },

  recoverFacility: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.recoverFacility.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, true)
    const facility = await lockFacility(tx, deal.id)
    if (!facility) fail("NOT_FOUND", 404)
    requireFields(actor.ability, "CashFacility", "pay", facility ?? { createdBy: actor.userId }, Object.keys(input))
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "recoverFacility",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [
      ref(deal),
      { type: "CashFacility", id: facility.id, revision: facility.revision },
    ])
    if (!["DISBURSED", "PARTIAL"].includes(facility.state))
      fail("INVALID_STATE")
    const obligations: FacilityObligationBuckets = {
      principal: facility.net,
      charges: facility.separatelyRecoverableCharges,
      fee: facility.feeMode === "SEPARATE" ? facility.fee : 0n,
    }
    const already = {
      principal: recovered(facility, "PRINCIPAL"),
      charges: recovered(facility, "CHARGE"),
      fee: recovered(facility, "FEE"),
    }
    let maths
    try {
      maths = calculateFacilityRecovery({
        obligations,
        alreadyRecovered: already,
        payment: {
          ...(input.principal ? { principal: money(input.principal.amount) } : {}),
          ...(input.chargeRecovery
            ? { charges: money(input.chargeRecovery.amount) }
            : {}),
          ...(input.fee ? { fee: money(input.fee.amount) } : {}),
        },
      })
    } catch {
      fail("BALANCE_MISMATCH", 422)
    }
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.facilityPayment.createMany({
      data: [
        ...(input.principal
          ? [
              {
                facilityId: facility.id,
                amount: money(input.principal.amount),
                direction: "IN" as const,
                component: "PRINCIPAL" as const,
                occurredDate: new Date(input.principal.date),
                method: input.principal.method,
                reference: input.principal.reference ?? null,
                createdBy: actor.userId,
                commandId,
                lineKey: "recover:principal",
              },
            ]
          : []),
        ...(input.chargeRecovery
          ? [
              {
                facilityId: facility.id,
                amount: money(input.chargeRecovery.amount),
                direction: "IN" as const,
                component: "CHARGE" as const,
                occurredDate: new Date(input.chargeRecovery.date),
                method: input.chargeRecovery.method,
                reference: input.chargeRecovery.reference ?? null,
                createdBy: actor.userId,
                commandId,
                lineKey: "recover:charge",
              },
            ]
          : []),
        ...(input.fee
          ? [
              {
                facilityId: facility.id,
                amount: money(input.fee.amount),
                direction: "IN" as const,
                component: "FEE" as const,
                occurredDate: new Date(input.fee.date),
                method: input.fee.method,
                reference: input.fee.reference ?? null,
                createdBy: actor.userId,
                commandId,
                lineKey: "recover:fee",
              },
            ]
          : []),
      ],
    })
    const updated = await tx.cashFacility.update({
      where: { id: facility.id },
      data: {
        state: maths.fullyRecovered ? "RECOVERED" : "PARTIAL",
        revision: facility.revision + 1,
        updatedAt: new Date(),
      },
      include: { payments: { orderBy: { recordedAt: "asc" } } },
    })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { revision: deal.revision + 1, updatedAt: new Date() },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "recoverFacility",
      digest,
      scope,
      sequence,
      before: deal,
      after,
      extra: [
        {
          entityType: "CashFacility",
          entityId: updated.id,
          revision: updated.revision,
          before: facilityDTO(facility) as unknown as Record<string, unknown>,
          after: facilityDTO(updated) as unknown as Record<string, unknown>,
        },
      ],
    })
  },

  recordBrokerageFee: async (tx, actor, envelope, digest) => {
    const input = brokerageInputs.recordBrokerageFee.parse(envelope.input)
    const deal = await loadDeal(tx, actor, input.dealId, ["amount", "processingFee"])
    const { scope, prior } = await priorReceipt(
      tx,
      actor,
      "recordBrokerageFee",
      envelope,
      digest,
      async (row) => applied(row.id, true, ref(row), [ref(row)])
    )
    if (prior) return prior
    checkRefs(envelope.expected, [ref(deal)])
    const commandId = randomUUID(),
      sequence = await nextBusinessSequence(tx)
    await tx.brokerageFeeReceipt.create({
      data: {
        dealId: deal.id,
        category: input.category,
        amount: money(input.payment.amount),
        direction: "IN",
        occurredDate: new Date(input.payment.date),
        method: input.payment.method,
        reference: input.payment.reference ?? null,
        createdBy: actor.userId,
        commandId,
        lineKey: "fee",
      },
    })
    await tx.brokerageDeal.update({
      where: { id: deal.id },
      data: { revision: deal.revision + 1, updatedAt: new Date() },
    })
    const after = await loadDeal(tx, actor, deal.id)
    return commitDeal(tx, actor, {
      commandId,
      commandName: "recordBrokerageFee",
      digest,
      scope,
      sequence,
      before: deal,
      after,
    })
  },
}

async function lockFacility(tx: Tx, dealId: string) {
  await tx.$queryRaw`SELECT id FROM vamotors."CashFacility" WHERE "dealId"=${dealId}::uuid FOR UPDATE`
  return tx.cashFacility.findUnique({
    where: { dealId },
    include: { payments: { orderBy: { recordedAt: "asc" } } },
  })
}

// ── Reversal ────────────────────────────────────────────────────────────────
async function reverseBrokeragePayment(
  tx: Tx,
  actor: Actor,
  envelope: Envelope,
  digest: string,
  raw: unknown
) {
  const parsed = brokerageReversalEnvelope.safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const input = parsed.data.input
  const facilityOwner =
    input.sourceType === "FACILITY"
      ? await tx.cashFacility.findUnique({ where: { id: input.sourceId } })
      : null
  const dealId =
    input.sourceType === "FACILITY" ? facilityOwner?.dealId : input.sourceId
  if (!dealId) fail("NOT_FOUND", 404)
  const deal = await loadDeal(tx, actor, dealId, true)
  const facility =
    input.sourceType === "FACILITY" ? await lockFacility(tx, deal.id) : null
  if (facility)
    requireFields(actor.ability, "CashFacility", "pay", facility, ["dealId", "payment", "reason"])
  else
    requireFields(actor.ability, "BrokerageDeal", "update", dealSubject(deal), ["amount", "processingFee", "reason"])
  const { scope, prior } = await priorReceipt(
    tx,
    actor,
    "reversePayment",
    envelope,
    digest,
    async (row) => applied(row.id, true, ref(row), [ref(row)])
  )
  if (prior) return prior
  const required: Dependency[] = [ref(deal)]
  if (facility)
    required.push({
      type: "CashFacility",
      id: facility.id,
      revision: facility.revision,
    })
  checkRefs(envelope.expected, required)
  if (!facility && input.sourceType === "FACILITY") fail("NOT_FOUND", 404)
  const commandId = randomUUID(),
    sequence = await nextBusinessSequence(tx)
  let beforeExtra: Record<string, unknown> | null = null
  let afterExtra: Record<string, unknown> | null = null
  let extraType: "CashFacility" | null = null
  let extraId = ""
  let extraRevision = 0
  if (input.sourceType === "FACILITY") {
    const payment = await tx.facilityPayment.findUnique({
      where: { id: input.paymentId },
    })
    if (!payment || payment.facilityId !== facility!.id) fail("NOT_FOUND", 404)
    if (payment.reversalOf || payment.component === "PAYOUT")
      fail("INVALID_STATE")
    if (
      await tx.facilityPayment.findFirst({ where: { reversalOf: payment.id } })
    )
      fail("INVALID_STATE")
    const opposite = payment.direction === "IN" ? "OUT" : "IN"
    await tx.facilityPayment.create({
      data: {
        facilityId: facility!.id,
        amount: payment.amount,
        direction: opposite,
        component: payment.component,
        occurredDate: payment.occurredDate,
        method: payment.method,
        reversalOf: payment.id,
        reason: input.reason,
        createdBy: actor.userId,
        commandId,
        lineKey: `reverse:${payment.id}`,
      },
    })
    if (input.replacement) {
      if (money(input.replacement.amount) > payment.amount)
        fail("BALANCE_MISMATCH", 422)
      await tx.facilityPayment.create({
        data: {
          facilityId: facility!.id,
          amount: money(input.replacement.amount),
          direction: payment.direction,
          component: payment.component,
          occurredDate: new Date(input.replacement.date),
          method: input.replacement.method,
          reference: input.replacement.reference ?? null,
          createdBy: actor.userId,
          commandId,
          lineKey: `replace:${payment.id}`,
        },
      })
    }
    const fresh = await tx.cashFacility.findUniqueOrThrow({
      where: { id: facility!.id },
      include: { payments: { orderBy: { recordedAt: "asc" } } },
    })
    const principal = fresh.net - recovered(fresh, "PRINCIPAL")
    const charges =
      fresh.separatelyRecoverableCharges - recovered(fresh, "CHARGE")
    const feeOwed = fresh.feeMode === "SEPARATE" ? fresh.fee : 0n
    const fee = feeOwed - recovered(fresh, "FEE")
    const obligation =
      fresh.net +
      fresh.separatelyRecoverableCharges +
      feeOwed
    const outstanding = principal + charges + fee
    const updated = await tx.cashFacility.update({
      where: { id: fresh.id },
      data: {
        state:
          outstanding === 0n
            ? "RECOVERED"
            : outstanding >= obligation
              ? "DISBURSED"
              : "PARTIAL",
        revision: facility!.revision + 1,
        updatedAt: new Date(),
      },
      include: { payments: true },
    })
    beforeExtra = facilityDTO(facility!) as unknown as Record<string, unknown>
    afterExtra = facilityDTO(updated) as unknown as Record<string, unknown>
    extraType = "CashFacility"
    extraId = updated.id
    extraRevision = updated.revision
  } else {
    const payment = await tx.brokerageFeeReceipt.findUnique({
      where: { id: input.paymentId },
    })
    if (!payment || payment.dealId !== deal.id) fail("NOT_FOUND", 404)
    if (payment.reversalOf) fail("INVALID_STATE")
    if (
      await tx.brokerageFeeReceipt.findFirst({
        where: { reversalOf: payment.id },
      })
    )
      fail("INVALID_STATE")
    const opposite = payment.direction === "IN" ? "OUT" : "IN"
    await tx.brokerageFeeReceipt.create({
      data: {
        dealId: deal.id,
        category: payment.category,
        amount: payment.amount,
        direction: opposite,
        occurredDate: payment.occurredDate,
        method: payment.method,
        reversalOf: payment.id,
        reason: input.reason,
        createdBy: actor.userId,
        commandId,
        lineKey: `reverse:${payment.id}`,
      },
    })
    if (input.replacement)
      await tx.brokerageFeeReceipt.create({
        data: {
          dealId: deal.id,
          category: payment.category,
          amount: money(input.replacement.amount),
          direction: payment.direction,
          occurredDate: new Date(input.replacement.date),
          method: input.replacement.method,
          reference: input.replacement.reference ?? null,
          createdBy: actor.userId,
          commandId,
          lineKey: `replace:${payment.id}`,
        },
      })
  }
  await tx.brokerageDeal.update({
    where: { id: deal.id },
    data: { revision: deal.revision + 1, updatedAt: new Date() },
  })
  const after = await loadDeal(tx, actor, deal.id)
  return commitDeal(tx, actor, {
    commandId,
    commandName: "reversePayment",
    digest,
    scope,
    sequence,
    before: deal,
    after,
    ...(extraType && afterExtra
      ? {
          extra: [
            {
              entityType: extraType,
              entityId: extraId,
              revision: extraRevision,
              before: beforeExtra,
              after: afterExtra,
            },
          ],
        }
      : {}),
  })
}

// ── Reads ────────────────────────────────────────────────────────────────────
export async function brokerageQuery(
  tx: Tx,
  actor: Actor,
  name: string,
  raw: unknown
) {
  if (name === "brokerage") {
    const parsed = brokerageQueryParams.safeParse(raw)
    if (!parsed.success) fail("INVALID_INPUT", 422)
    const input = parsed.data
    const includeRejected =
      input.includeRejected === true || input.includeRejected === "true"
    const scope = readScope(actor.grants, actor.userId, "BrokerageDeal", [
      "id",
      ...(input.companyId ? ["companyId"] : []),
      "state",
    ])
    const where: Prisma.BrokerageDealWhereInput = {
      AND: [
        scope,
        {
          ...(input.companyId ? { companyId: input.companyId } : {}),
          ...(input.status ? { state: input.status } : {}),
          ...(!input.status && !includeRejected ? { state: { not: "REJECTED" } } : {}),
        },
      ],
    }
    const [rows, total] = await Promise.all([
      tx.brokerageDeal.findMany({
        where,
        include: dealInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      tx.brokerageDeal.count({ where }),
    ])
    return {
      ok: true,
      data: await Promise.all(rows.map((row) => visibleDeal(tx, actor, row))),
      total,
      page: input.page,
      pageSize: input.pageSize,
      asOf: new Date().toISOString(),
      redactedFields: [],
    }
  }
  if (name === "brokerageDeal") {
    const parsed = z.object({ id }).strict().safeParse(raw)
    if (!parsed.success) fail("INVALID_INPUT", 422)
    const row = await tx.brokerageDeal.findFirst({
      where: {
        AND: [
          { id: parsed.data.id },
          readScope(actor.grants, actor.userId, "BrokerageDeal"),
        ],
      },
      include: dealInclude,
    })
    if (!row) fail("NOT_FOUND", 404)
    return visibleDeal(tx, actor, row)
  }
  if (name === "dispatchPreview") return dispatchPreviewQuery(tx, actor, raw)
  fail("NOT_FOUND", 404)
}
async function visibleDeal(tx: Tx, actor: Actor, row: DealRow) {
  const dto = dealDTO(row)
  const record = subject("BrokerageDeal", { ...dto, createdBy: row.createdBy })
  const visible = project(actor.ability, "BrokerageDeal", {
    ...dto,
    createdBy: row.createdBy,
  })
  delete (visible as Record<string, unknown>).createdBy
  visible.redactedFields = visible.redactedFields.filter((f) => f !== "createdBy")
  const quoteIds = [row.originalQuoteId, ...row.selections.map((s) => s.quoteId)]
  const quotes = await tx.quote.findMany({ where: { id: { in: quoteIds } } })
  const canReadQuote = (quoteId: string) => {
    const quote = quotes.find((q) => q.id === quoteId)
    if (!quote) return false
    const quoteRecord = subject("Quote", {
      ...quote,
      companyId: quote.companyId,
      createdBy: quote.createdBy,
    })
    return (
      actor.ability.can("read", quoteRecord) &&
      [
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
      ].every((field) => actor.ability.can("read", quoteRecord, field))
    )
  }
  if ("quote" in visible && !canReadQuote(row.selections.at(-1)!.quoteId)) {
    delete (visible as Record<string, unknown>).quote
    visible.redactedFields.push("quote")
  }
  if (
    "quoteHistory" in visible &&
    !row.selections.every((selection) => canReadQuote(selection.quoteId))
  ) {
    delete (visible as Record<string, unknown>).quoteHistory
    visible.redactedFields.push("quoteHistory")
  }
  if ("facility" in visible) {
    if (!actor.ability.can("read", record, "facility")) {
      delete (visible as Record<string, unknown>).facility
      visible.redactedFields.push("facility")
    }
  }
  visible.redactedFields = [...new Set(visible.redactedFields)]
  return visible
}

export async function brokerageAudit(
  tx: Tx,
  actor: Actor,
  raw: unknown
) {
  const parsed = listParams
    .extend({ ...auditFilterInputs,
      type: z.enum(["BrokerageDeal", "CashFacility"]),
      id,
    })
    .strict()
    .safeParse(raw)
  if (!parsed.success) fail("INVALID_INPUT", 422)
  const { type, id: entityId, page, pageSize } = parsed.data
  let row: Record<string, unknown> | null = null
  if (type === "BrokerageDeal") {
    const deal = await tx.brokerageDeal.findUnique({ where: { id: entityId } })
    if (deal) row = { ...deal, state: deal.state }
  } else {
    const facility = await tx.cashFacility.findUnique({
      where: { id: entityId },
    })
    if (facility) row = { ...facility }
  }
  if (!row) fail("NOT_FOUND", 404)
  requireFields(actor.ability, type, "read", row, ["id", "revision"])
  requireFields(actor.ability, "AuditLog", "read", {}, [])
  const where = {
    AND: [
      { entityType: type, entityId },
      auditScope(actor, parsed.data),
    ],
  }
  const [entries, total] = await Promise.all([
    tx.auditEntry.findMany({
      where,
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tx.auditEntry.count({ where }),
  ])
  const deal = type === "BrokerageDeal"
    ? await tx.brokerageDeal.findUniqueOrThrow({ where: { id: entityId }, include: dealInclude })
    : null
  const visible = deal ? await visibleDeal(tx, actor, deal) : null
  const redactedFields: string[] = []
  const data = entries.map((entry) => {
    const fields = entry.fieldDiff as Record<string, unknown>
    const diff = Object.entries(fields)
      .filter(([key]) => {
        try {
          if ((key === "quote" || key === "quoteHistory") && visible?.redactedFields.includes(key))
            fail("FIELD_FORBIDDEN", 403)
          requireFields(actor.ability, type, "read", row!, [key])
          return true
        } catch {
          redactedFields.push(`fields.${key}`)
          return false
        }
      })
      .map(([path, value]) => ({
        path,
        ...(value as { before: unknown; after: unknown }),
      }))
    return project(actor.ability, "AuditLog", {
      id: entry.id,
      entityType: type,
      entityId,
      action: entry.action,
      at: entry.recordedAt.toISOString(),
      actor: { kind: entry.actorKind, ...(entry.userId ? { userId: entry.userId } : {}) },
      reason: entry.reason,
      fields: diff,
    })
  })
  return {
    ok: true,
    data,
    total,
    page,
    pageSize,
    asOf: new Date().toISOString(),
    redactedFields,
  }
}

export async function brokerageReplay(
  tx: Tx,
  actor: Actor,
  receipt: import("@prisma/client").CommandReceipt
): Promise<Applied> {
  const result = receipt.result as Applied["result"]
  if (result.type === "BrokerageDeal") {
    const row = await loadDeal(tx, actor, result.id)
    return applied(receipt.id, true, ref(row), [ref(row)])
  }
  if (result.type === "DispatchBatch")
    return dispatchReplay(tx, actor, receipt)
  fail("IDEMPOTENCY_MISMATCH")
}

export async function brokerageRead(
  identity: Identity,
  name: string,
  raw: unknown
) {
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      return brokerageQuery(tx, actor, name, raw)
    },
    { isolationLevel: "RepeatableRead", timeout: 5000 }
  )
}


/** Exact-route page preflight: rewrites must not stream a soft 200 for hidden rows. */
export async function brokeragePageDetail(headers: Headers, dealId: string) {
  const identity = await authenticate(headers)
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      return brokerageQuery(tx, actor, "brokerageDeal", { id: dealId })
    },
    { isolationLevel: "RepeatableRead", timeout: 5000 }
  )
}