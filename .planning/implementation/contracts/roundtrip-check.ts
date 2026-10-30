/** Executable, typed specification specimens; NOT application/auth/DB implementations.
 * Assemble actual DTOs from source-shaped rows, then build commands without receipts/errors.
 * No money/state/reference helpers are replaced by these bounded regression specimens. */
import type { AllocationDTO, ApprovalProvenance, Commands, Dependency, DiscrepancyDTO,
  EntitlementDetailDTO, Envelope, Grant, ImportPayloads, PaymentDTO, PermissionRegistryDTO,
  PurchaseCycleDTO, QuoteDTO, RemittanceDTO, ReportRow, RevisionRef, Visible, WriteOff,
  ImportBatchSummaryDTO, ImportSourceUploadDTO, ImportBatchFilesDTO, Queries, Page } from "./api";
import { commandRevisionRules } from "./api";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
}
function rejects(run: () => unknown, code: string) {
  try { run(); } catch (error) { assert(error instanceof Error && error.message.includes(code), `expected ${code}, got ${String(error)}`); return; }
  throw new Error(`expected ${code}`);
}
let checks = 0;
function test(name: string, run: () => void) { run(); console.log(`ok ${++checks} - ${name}`); }
const ref = (row: RevisionRef): RevisionRef => ({ id: row.id, revision: row.revision });
const dep = (type: Dependency["type"], row: RevisionRef): Dependency => ({ type, ...ref(row) });
function envelope<T>(input: T, expected: Dependency[]): Envelope<T> {
  const unique = new Map(expected.map(d => [`${d.type}:${d.id}`, d]));
  return { schemaVersion: 1, idempotencyKey: "new-explicit-action", input, expected: [...unique.values()] };
}

// Source children have FKs, not caller-provided revision assertions.
type AllocationRow = Omit<AllocationDTO, "remittance" | "entitlement"> & { remittanceId: string; entitlementId: string };
type DiscrepancyRow = Omit<DiscrepancyDTO, "entitlement"> & { entitlementId: string };
type FinanceRows = { company: RevisionRef;
  remittances: Omit<RemittanceDTO, "company" | "allocations" | "discrepancies">[];
  entitlements: Omit<EntitlementDetailDTO, "company" | "allocations" | "discrepancies">[];
  allocations: AllocationRow[]; discrepancies: DiscrepancyRow[] };
function required<T>(value: T | null | undefined): T { if (!value) throw new Error("NOT_FOUND"); return value; }
function allocationDTO(db: FinanceRows, row: AllocationRow): AllocationDTO {
  const { remittanceId, entitlementId, ...values } = row;
  return { ...values, remittance: ref(required(db.remittances.find(r => r.id === remittanceId))),
    entitlement: { id: entitlementId, revision: required(db.entitlements.find(e => e.entitlementId === entitlementId)).revision } };
}
function discrepancyDTO(db: FinanceRows, row: DiscrepancyRow): DiscrepancyDTO {
  const { entitlementId, ...values } = row;
  return { ...values, entitlement: { id: entitlementId,
    revision: required(db.entitlements.find(e => e.entitlementId === entitlementId)).revision } };
}
function remittanceRead(db: FinanceRows, id: string): RemittanceDTO {
  return { ...structuredClone(required(db.remittances.find(r => r.id === id))), company: ref(db.company),
    allocations: db.allocations.filter(a => a.remittanceId === id).map(a => allocationDTO(db, a)),
    discrepancies: db.discrepancies.filter(d => d.remittanceId === id).map(d => discrepancyDTO(db, d)) };
}
function entitlementRead(db: FinanceRows, id: string): EntitlementDetailDTO {
  return { ...structuredClone(required(db.entitlements.find(e => e.entitlementId === id))), company: ref(db.company),
    allocations: db.allocations.filter(a => a.entitlementId === id).map(a => allocationDTO(db, a)),
    discrepancies: db.discrepancies.filter(d => d.entitlementId === id).map(d => discrepancyDTO(db, d)) };
}
function reconcileFromReads(r: RemittanceDTO, e: EntitlementDetailDTO): Envelope<Commands["reconcile"]> {
  assert(r.company.id === e.company.id);
  return envelope({ companyId: r.company.id, asOfDate: "2026-10-25", allocations: [{ remittanceId: r.id,
    entitlementId: e.entitlementId, noticeLineId: required(r.lines[0]).id, amount: r.lines[0].unallocated }], resolutions: [] },
    [dep("FinanceCompany", r.company), dep("Remittance", r),
      dep("CommissionEntitlement", { id: e.entitlementId, revision: e.revision })]);
}
function reversalFromRead(r: RemittanceDTO): Envelope<Commands["reverseAllocation"]> {
  const a = required(r.allocations.find(a => !a.reversalOf && !a.reversedById));
  return envelope({ allocationId: a.id, reason: "Correct source link" },
    [dep("FinanceCompany", r.company), dep("Remittance", a.remittance), dep("CommissionEntitlement", a.entitlement)]);
}
function returnFromRead(r: RemittanceDTO): Envelope<Commands["returnRemittanceOverpayment"]> {
  const d = required(r.discrepancies.find(d => d.classification === "OVERPAYMENT" && d.resolution === "RETURN_OVERPAYMENT"));
  assert(d.remittanceId === r.id && d.allocationId !== null && BigInt(d.returnOutstanding) > 0n);
  return envelope({ remittanceId: r.id, discrepancyId: d.id, reason: "Return actual surplus",
    payment: { amount: d.returnOutstanding, date: "2026-10-25", method: "BANK_TRANSFER" } },
    [dep("FinanceCompany", r.company), dep("Remittance", r), dep("CommissionEntitlement", d.entitlement)]);
}
function checkCurrent(expected: Dependency[], current: Dependency[]) {
  for (const row of current) {
    const supplied = expected.find(e => e.type === row.type && e.id === row.id);
    if (!supplied) throw new Error("REVISION_REQUIRED");
    if (supplied.revision !== row.revision) throw new Error("STALE_REVISION");
  }
}
type FinanceCommand = "reconcile" | "reverseAllocation" | "returnRemittanceOverpayment";
function checkFinanceRules(name: FinanceCommand, body: Envelope<Commands[FinanceCommand]>, db: FinanceRows) {
  const entitlement = (id: string) => dep("CommissionEntitlement", { id,
    revision: required(db.entitlements.find(e => e.entitlementId === id)).revision });
  const remittance = (id: string) => dep("Remittance", required(db.remittances.find(r => r.id === id)));
  const rows: Dependency[] = [];
  for (const selector of commandRevisionRules[name]) {
    const i = body.input;
    if (selector === "FinanceCompany:input.companyId" || selector === "@companyForRemittance") rows.push(dep("FinanceCompany", db.company));
    else if (selector === "Remittance:input.remittanceId" && "remittanceId" in i) rows.push(remittance(i.remittanceId));
    else if (selector === "@reconciliationMembers" && "allocations" in i) {
      for (const a of i.allocations) rows.push(remittance(a.remittanceId), entitlement(a.entitlementId));
      for (const resolution of i.resolutions) {
        rows.push(entitlement(resolution.entitlementId));
        for (const d of db.discrepancies.filter(d => d.entitlementId === resolution.entitlementId))
          if (d.remittanceId) rows.push(remittance(d.remittanceId));
      }
    } else if (selector === "@allocationOwners" && "allocationId" in i) {
      const a = required(db.allocations.find(a => a.id === i.allocationId));
      rows.push(remittance(a.remittanceId), entitlement(a.entitlementId), dep("FinanceCompany", db.company));
    } else if (selector === "@discrepancyEntitlement" && "discrepancyId" in i) {
      const d = required(db.discrepancies.find(d => d.id === i.discrepancyId));
      assert("remittanceId" in i && d.remittanceId === i.remittanceId);
      rows.push(entitlement(d.entitlementId));
    } else throw new Error(`Unimplemented specimen selector ${selector}`);
  }
  checkCurrent(body.expected, rows);
}
const payment: PaymentDTO = { id: "bank", amount: "160", date: "2026-10-24", method: "BANK_TRANSFER",
  direction: "IN", category: "COMMISSION", recordedAt: "2026-10-24T00:00:00.000Z" };
function financeFixture(): FinanceRows {
  return { company: { id: "company", revision: 7 }, remittances: [{ id: "remittance", revision: 4,
    state: "RECEIVED", reference: "bank-reference", currency: "LKR", receipt: payment, payments: [payment], unallocated: "100",
    lines: [{ id: "notice-line", key: "line", amount: "160", description: "mixed sources", unallocated: "100" }] }],
    entitlements: ["VEHICLE_SALE", "BROKERAGE"].map((source, i) => ({ entitlementId: `entitlement-${i}`, revision: 3,
      source: source as "VEHICLE_SALE" | "BROKERAGE", sourceId: `source-${i}`, companyId: "company", sentDate: "2026-10-23",
      expected: i ? "50" : "100", received: i ? "60" : "0", discrepancy: i ? "-10" : "100", outstanding: i ? "0" : "100",
      state: i ? "RESOLVED" : "OPEN", overdue: !i, cutoffDate: "2026-10-25", watermarkDate: null })),
    allocations: [{ id: "allocation", runId: "run", remittanceId: "remittance", entitlementId: "entitlement-1",
      noticeLineId: "notice-line", amount: "60" }],
    discrepancies: [{ id: "surplus", entitlementId: "entitlement-1", remittanceId: "remittance", allocationId: "allocation",
      classification: "OVERPAYMENT", expectedMinusAllocated: "-10", resolution: "RETURN_OVERPAYMENT",
      reason: "Actual surplus", returnOutstanding: "10", returns: [] }] };
}
test("fresh reads construct reconcile/reversal/return; concurrent allocation reload supplies all current parents", () => {
  const db = financeFixture();
  const before = reconcileFromReads(remittanceRead(db, "remittance"), entitlementRead(db, "entitlement-0"));
  db.remittances[0].revision++; db.company.revision++; db.entitlements[0].revision++;
  db.remittances[0].unallocated = "80"; db.remittances[0].lines[0].unallocated = "80";
  const current = [dep("FinanceCompany", db.company), dep("Remittance", db.remittances[0]),
    dep("CommissionEntitlement", { id: "entitlement-0", revision: db.entitlements[0].revision })];
  rejects(() => checkCurrent(before.expected, current), "STALE_REVISION");
  const loaded = remittanceRead(db, "remittance");
  const fresh = reconcileFromReads(loaded, entitlementRead(db, "entitlement-0"));
  checkCurrent(fresh.expected, current); equal(fresh.input.allocations[0].amount, "80");
  checkFinanceRules("reconcile", fresh, db);
  equal(fresh.input.allocations[0].noticeLineId, "notice-line");
  const ownerRows = [dep("FinanceCompany", db.company), dep("Remittance", db.remittances[0]),
    dep("CommissionEntitlement", { id: "entitlement-1", revision: 3 })];
  const reversal = reversalFromRead(loaded), returned = returnFromRead(loaded);
  checkCurrent(reversal.expected, ownerRows); checkCurrent(returned.expected, ownerRows);
  checkFinanceRules("reverseAllocation", reversal, db); checkFinanceRules("returnRemittanceOverpayment", returned, db);
  equal(reversal.input.allocationId, "allocation"); equal(returned.input.discrepancyId, "surplus");
  equal(returned.input.payment.amount, "10");
  // Fully allocated receipts and drafts still have detail reads, not an unallocated-only registry.
  db.remittances[0].unallocated = "0"; equal(remittanceRead(db, "remittance").allocations.length, 1);
  db.remittances.push({ id: "draft", revision: 1, state: "STAGED", reference: "draft-ref", currency: "LKR",
    receipt: null, payments: [], unallocated: "0", lines: [] });
  const draft = remittanceRead(db, "draft");
  const record: Envelope<Commands["recordRemittance"]> = envelope({ draftId: draft.id, companyId: draft.company.id,
    payment, lines: [] }, [dep("Remittance", draft), dep("FinanceCompany", draft.company)]);
  checkCurrent(record.expected, [dep("Remittance", db.remittances[1]), dep("FinanceCompany", db.company)]);
  const reverseBank: Envelope<Commands["reversePayment"]> = envelope({ sourceType: "REMITTANCE", sourceId: loaded.id,
    paymentId: required(loaded.receipt).id, reason: "Erroneous bank fact" }, ownerRows);
  equal(reverseBank.input.paymentId, "bank"); // execution must reject while allocations remain live
  const returnFact: PaymentDTO = { ...payment, id: "return-fact", amount: "10", direction: "OUT", category: "RETURN_OVERPAYMENT" };
  db.discrepancies[0].returns.push(returnFact); db.discrepancies[0].returnOutstanding = "0";
  db.remittances[0].payments.push(returnFact); db.remittances[0].revision++; db.entitlements[1].revision++; db.company.revision++;
  const afterReturn = remittanceRead(db, "remittance"), d = afterReturn.discrepancies[0];
  equal(d.returnOutstanding, "0"); rejects(() => returnFromRead(afterReturn), "assertion failed");
  const correctReturn: Envelope<Commands["reversePayment"]> = envelope({ sourceType: "REMITTANCE", sourceId: afterReturn.id,
    paymentId: required(d.returns[0]).id, reason: "Correct mistaken return fact" },
    [dep("FinanceCompany", afterReturn.company), dep("Remittance", afterReturn), dep("CommissionEntitlement", d.entitlement)]);
  equal(correctReturn.input.paymentId, "return-fact");
  checkCurrent(correctReturn.expected, [dep("FinanceCompany", db.company), dep("Remittance", db.remittances[0]),
    dep("CommissionEntitlement", { id: "entitlement-1", revision: db.entitlements[1].revision })]);
});
test("resolution-only and zero-allocation shortfall reads do not invent remittances", () => {
  const db = financeFixture();
  const detail = entitlementRead(db, "entitlement-1");
  const linked = detail.discrepancies.flatMap(d => d.remittanceId ? [remittanceRead(db, d.remittanceId)] : []);
  const resolution: Envelope<Commands["reconcile"]> = envelope({ companyId: detail.company.id,
    asOfDate: "2026-10-25", allocations: [], resolutions: [{ entitlementId: detail.entitlementId,
      kind: "CARRY_CREDIT", reason: "Keep documented surplus" }] }, [dep("FinanceCompany", detail.company),
      dep("CommissionEntitlement", { id: detail.entitlementId, revision: detail.revision }), ...linked.map(r => dep("Remittance", r))]);
  assert(resolution.expected.some(r => r.type === "Remittance"));
  checkFinanceRules("reconcile", resolution, db);
  db.discrepancies.push({ id: "shortfall", entitlementId: "entitlement-0", remittanceId: null, allocationId: null,
    classification: "SHORTFALL", expectedMinusAllocated: "100", resolution: "KEEP_OPEN", reason: "No receipt yet",
    returnOutstanding: "0", returns: [] });
  equal(entitlementRead(db, "entitlement-0").discrepancies[0].remittanceId, null);
});

type DisposalContext = { kind: "USER"; approval?: { id: string; state: string; cycleId: string; input: WriteOff;
  requesterId: string; reviewerId: string; reviewerActive: boolean; authorized: boolean; reviewedAt: string } } |
  { kind: "IMPORT"; batchId: string; rowId: string; adminId: string; administrator: boolean; importAuthorized: boolean;
    rowBatchId: string; cycleId: string; targetLinked: boolean; legacy: ImportPayloads["VEHICLES"]["disposal"] };
function disposalRead(input: WriteOff, context: DisposalContext): NonNullable<PurchaseCycleDTO["disposal"]> {
  let approval: ApprovalProvenance;
  if (context.kind === "USER") {
    const a = context.approval;
    if (!a || a.state !== "APPROVED" || a.cycleId !== input.cycleId || JSON.stringify(a.input) !== JSON.stringify(input)) throw new Error("APPROVAL_REQUIRED");
    if (!a.authorized || !a.reviewerActive || a.requesterId === a.reviewerId) throw new Error("FORBIDDEN");
    approval = { kind: "CURRENT", approvalId: a.id, reviewerId: a.reviewerId, reviewerName: "Current reviewer", reviewedAt: a.reviewedAt };
  } else {
    if (!context.administrator || !context.importAuthorized) throw new Error("FORBIDDEN");
    if (context.batchId !== context.rowBatchId || context.cycleId !== input.cycleId || !context.targetLinked) throw new Error("IMPORT_INVALID");
    const legacy = context.legacy?.legacyApproval;
    if (!legacy?.approverName.trim() || (legacy.approvalReference !== undefined && !legacy.approvalReference.trim())) throw new Error("IMPORT_INVALID");
    const { cycleId: _, ...expectedPayload } = input;
    const { legacyApproval: __, ...savedPayload } = required(context.legacy);
    if (JSON.stringify(expectedPayload) !== JSON.stringify(savedPayload)) throw new Error("IMPORT_INVALID");
    approval = { kind: "IMPORTED", batchId: context.batchId, rowId: context.rowId, initiatedByAdminId: context.adminId,
      historicalApprovalBypass: true, legacy: structuredClone(legacy) };
  }
  const proceeds = BigInt(input.proceeds);
  if (proceeds < 0n || (proceeds === 0n ? input.receipt !== undefined : !input.receipt ||
    input.receipt.amount !== input.proceeds || input.receipt.date !== input.date)) throw new Error("BALANCE_MISMATCH");
  return { id: "disposal", approval, date: input.date, reason: input.reason, method: input.method,
    proceeds: input.proceeds, basisVersionId: "basis", payments: input.receipt ? [{ ...input.receipt, id: "disposal-receipt",
      direction: "IN", category: "DISPOSAL", recordedAt: "2026-10-25T00:00:00.000Z", owner: { type: "DISPOSAL", id: "disposal" }, commandId: "import-command" }] : [] };
}
function disposalReport(d: NonNullable<PurchaseCycleDTO["disposal"]>): ReportRow["DISPOSALS"] {
  return { cycleId: "cycle", vehicle: "Synthetic vehicle", date: d.date, reason: d.reason, approval: d.approval,
    method: d.method, basis: "100", proceeds: d.proceeds, netLoss: (100n - BigInt(d.proceeds)).toString() };
}
test("zero/positive historical disposal preserves legacy evidence across detail/report without current reviewer", () => {
  for (const proceeds of ["0", "25"]) {
    const input: WriteOff = { cycleId: "cycle", date: "2026-01-01", reason: "Historical disposal", method: "SCRAPPED", proceeds,
      ...(proceeds === "0" ? {} : { receipt: { amount: proceeds, date: "2026-01-01", method: "CASH" as const } }) };
    const { cycleId: _, ...legacyInput } = input;
    const context: Extract<DisposalContext, { kind: "IMPORT" }> = { kind: "IMPORT", batchId: "batch", rowId: "row", adminId: "admin",
      administrator: true, importAuthorized: true, rowBatchId: "batch", cycleId: "cycle", targetLinked: true,
      legacy: { ...legacyInput, legacyApproval: { approverName: "Historical manager", approvalReference: "Paper-42" } } };
    const detail = disposalRead(input, context), report = disposalReport(detail);
    equal(detail.approval, report.approval); equal(detail.payments.length, proceeds === "0" ? 0 : 1);
    equal(report.netLoss, proceeds === "0" ? "100" : "75");
    assert(detail.approval.kind === "IMPORTED" && !("approvalId" in detail.approval) && !("reviewerId" in detail.approval));
    for (const patch of [{ administrator: false }, { importAuthorized: false }, { rowBatchId: "foreign" }, { targetLinked: false },
      { legacy: { ...required(context.legacy), legacyApproval: { approverName: "", approvalReference: "Paper-42" } } }]) {
      rejects(() => disposalRead(input, { ...context, ...patch }), "administrator" in patch || "importAuthorized" in patch ? "FORBIDDEN" : "IMPORT_INVALID");
    }
    const invalidReceipt: WriteOff = { ...input, receipt: proceeds === "0" ? { amount: "0", date: input.date, method: "CASH" } : undefined };
    rejects(() => disposalRead(invalidReceipt, { ...context, legacy: { ...required(context.legacy), receipt: invalidReceipt.receipt } }), "BALANCE_MISMATCH");
    const nameOnly = { ...context, legacy: { ...required(context.legacy), legacyApproval: { approverName: "Historical manager" } } };
    assert(disposalRead(input, nameOnly).approval.kind === "IMPORTED");
    rejects(() => disposalRead(input, { kind: "USER" }), "APPROVAL_REQUIRED");
  }
});
test("ordinary disposal always needs exact real approval, separate current authorized reviewer", () => {
  const input: WriteOff = { cycleId: "cycle", date: "2026-10-25", reason: "Ordinary disposal", method: "DONATED", proceeds: "0" };
  const approval = { id: "approval", state: "APPROVED", cycleId: "cycle", input, requesterId: "requester", reviewerId: "reviewer",
    reviewerActive: true, authorized: true, reviewedAt: "2026-10-25T00:00:00.000Z" };
  const detail = disposalRead(input, { kind: "USER", approval });
  assert(detail.approval.kind === "CURRENT" && detail.approval.approvalId === "approval");
  for (const patch of [{ state: "PENDING" }, { cycleId: "foreign" }, { input: { ...input, proceeds: "1" } }])
    rejects(() => disposalRead(input, { kind: "USER", approval: { ...approval, ...patch } }), "APPROVAL_REQUIRED");
  for (const patch of [{ reviewerId: "requester" }, { reviewerActive: false }, { authorized: false }])
    rejects(() => disposalRead(input, { kind: "USER", approval: { ...approval, ...patch } }), "FORBIDDEN");
});

// A1F registry specimen: a closed grantable Quote subject with independent private paths.
const quoteKeys = ["id", "revision", "createdBy", "vehicle", "sheetId", "sheetRevision", "cardId", "companyId", "companyRevision",
  "principal", "months", "installment", "maximum", "charges", "policy", "expiresAt"] satisfies (keyof QuoteDTO)[];
const quoteRegistry: PermissionRegistryDTO = { version: 1, subjects: [{ subject: "Quote", actions: [
  { action: "read", fields: quoteKeys.map(path => ({ path, dataType: "OBJECT", readable: true, writable: false })),
    conditions: [{ key: "createdBy", operator: "EQ", valueType: "ACTOR_ID" }, { key: "financeCompanyId", operator: "EQ", valueType: "UUID" }] },
  { action: "create", fields: ["sheetId", "cardId", "vehicle", "charges"].map(path => ({ path, dataType: "OBJECT", readable: false, writable: true })), conditions: [] }
] }] };
function validateQuoteGrant(g: Grant) {
  const action = quoteRegistry.subjects[0].actions.find(a => g.subject === "Quote" && a.action === g.action);
  if (!action || !g.fields.every(f => f === "*" || action.fields.some(k => f === k.path) || (g.action === "read" &&
    ["policy.path", "policy.processingFee", "policy.reconciliationMethod", "policy.commission.basis", "policy.commission.rateBps", "policy.commission.fixed",
      "charges.category", "charges.amount"].includes(f)))) throw new Error("INVALID_INPUT");
  if (!Object.keys(g.conditions ?? {}).every(k => ["createdBy", "financeCompanyId"].includes(k))) throw new Error("INVALID_INPUT");
}
function permits(grants: Grant[], actor: string, row: QuoteDTO, action: Grant["action"], path: string) {
  return grants.some(g => g.subject === "Quote" && g.action === action && Object.entries(g.conditions ?? {}).every(([key, value]) =>
    key === "createdBy" ? row.createdBy === (value === "$actor.id" ? actor : value) : key === "financeCompanyId" ? row.companyId === value : false) &&
    g.fields.some(f => f === "*" || path === f || path.startsWith(`${f}.`)));
}
function quoteRead(row: QuoteDTO, grants: Grant[], actor: string): Visible<QuoteDTO> {
  function project(value: unknown, path: string): unknown {
    if (path && permits(grants, actor, row, "read", path)) return structuredClone(value);
    if (Array.isArray(value)) {
      const items = value.map(v => project(v, path)).filter(v => v !== undefined);
      return items.length ? items : undefined;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value).map(([key, v]) => [key, project(v, path ? `${path}.${key}` : key)])
        .filter(([, v]) => v !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return undefined;
  }
  return required(project(row, "")) as Visible<QuoteDTO>;
}
const consumed = ["vehicle", "sheetId", "cardId", "companyId", "principal", "months", "installment", "maximum", "charges", "policy", "expiresAt"];
function quoteUse(row: QuoteDTO, grants: Grant[], actor: string, domain: "create" | "update") {
  quoteRead(row, grants, actor);
  if (!consumed.every(k => permits(grants, actor, row, "read", k))) throw new Error("FIELD_FORBIDDEN");
  if (!grants.some(g => g.subject === "BrokerageDeal" && g.action === domain && g.fields.includes("quoteId"))) throw new Error("FORBIDDEN");
}
test("grantable Quote creation/read/use enforces owner scope, policy/charge denial, explicit handoff and replacement", () => {
  equal(quoteRegistry.subjects[0].subject, "Quote");
  equal(quoteRegistry.subjects[0].actions.map(a => a.action), ["read", "create"]);
  validateQuoteGrant({ subject: "Quote", action: "read", fields: ["policy.commission.rateBps"], conditions: { createdBy: "$actor.id" } });
  for (const bad of [{ subject: "Quote", action: "update", fields: ["policy"] },
    { subject: "Quote", action: "create", fields: ["policy.path"] },
    { subject: "Quote", action: "read", fields: ["password"] },
    { subject: "Quote", action: "read", fields: ["id"], conditions: { customerId: "foreign" } }] satisfies Grant[])
    rejects(() => validateQuoteGrant(bad), "INVALID_INPUT");
  const row: QuoteDTO = { id: "quote", revision: 1, createdBy: "owner", vehicle: { make: "Demo", model: "Demo100", year: 2026, description: "External" },
    sheetId: "sheet", sheetRevision: 1, cardId: "card", companyId: "company", companyRevision: 7, principal: "1000", months: 12,
    installment: "90", maximum: "1200", charges: [{ category: "PRIVATE-CHARGE", amount: "10" }],
    policy: { path: "APPLICATION", commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 }, processingFee: "250000", reconciliationMethod: "PERIOD_NOTICE" },
    expiresAt: "2026-10-26T00:00:00.000Z" };
  const own: Grant = { subject: "Quote", action: "read", fields: ["*"], conditions: { createdBy: "$actor.id" } };
  const domains: Grant[] = ["create", "update"].map(action => ({ subject: "BrokerageDeal", action: action as "create" | "update", fields: ["quoteId"] }));
  const grants = [own, ...domains];
  const creation: Grant = { subject: "Quote", action: "create", fields: ["sheetId", "cardId", "vehicle", "charges"] };
  assert(["sheetId", "cardId", "vehicle", "charges"].every(k => permits([creation], "owner", row, "create", k)));
  assert(!permits([{ ...creation, fields: ["sheetId", "cardId", "vehicle"] }], "owner", row, "create", "charges"));
  rejects(() => quoteRead(row, [creation], "owner"), "NOT_FOUND"); // create is not read
  const loaded = quoteRead(row, grants, "owner"); equal(loaded.charges, row.charges);
  quoteUse(row, grants, "owner", "create"); quoteUse(row, grants, "owner", "update");
  const open: Commands["openBrokerage"] = { customerId: "customer", guarantors: [], quoteId: required(loaded.id) };
  const replace: Commands["replaceDealQuote"] = { dealId: "deal", quoteId: required(loaded.id), reason: "Exact replacement", contactId: "contact", confirmedAt: "2026-10-25T00:00:00.000Z" };
  equal(open.quoteId, replace.quoteId);
  const cas = [dep("Quote", { id: row.id, revision: row.revision }), dep("FinanceCompany", { id: row.companyId, revision: row.companyRevision })];
  assert(cas.length === 2); // settings/customer/deal/facility come from their existing scoped reads
  for (const hidden of ["policy", "charges"]) {
    const restricted = [{ ...own, fields: quoteKeys.filter(k => k !== hidden) }, ...domains];
    const projected = quoteRead(row, restricted, "owner"); assert(!(hidden in projected));
    rejects(() => quoteUse(row, restricted, "owner", "create"), "FIELD_FORBIDDEN");
    rejects(() => quoteUse(row, restricted, "owner", "update"), "FIELD_FORBIDDEN");
    // Nested deal quote/history uses exactly this intersection, not the original row.
    const nested = { quote: projected, quoteHistory: [projected] };
    assert(!JSON.stringify(nested).includes(hidden === "policy" ? "rateBps" : "PRIVATE-CHARGE"));
  }
  const leaf = quoteRead(row, [{ ...own, fields: ["id", "policy.path", "charges.category"] }], "owner");
  equal(leaf.policy, { path: "APPLICATION" }); equal(leaf.charges, [{ category: "PRIVATE-CHARGE" }]);
  assert(!JSON.stringify(leaf).includes("rateBps") && !JSON.stringify(leaf).includes("amount"));
  rejects(() => quoteRead(row, grants, "other"), "NOT_FOUND");
  rejects(() => quoteUse(row, grants, "other", "update"), "NOT_FOUND");
  const handoff: Grant = { subject: "Quote", action: "read", fields: ["*"], conditions: { financeCompanyId: "company" } };
  quoteUse(row, [handoff, ...domains], "other", "create"); quoteUse(row, [handoff, ...domains], "other", "update");
  rejects(() => quoteUse({ ...row, companyId: "foreign" }, [handoff, ...domains], "other", "create"), "NOT_FOUND");
  rejects(() => quoteUse(row, [handoff], "other", "update"), "FORBIDDEN");
  rejects(() => quoteUse(row, domains, "other", "update"), "NOT_FOUND");
});
// Bounded source-shaped read specimens, not a substitute for runtime readScope/CASL/DB tests.
type BatchRow = ImportBatchSummaryDTO & { createdBy: string };
type UploadRow = ImportSourceUploadDTO & { batchId: string; purpose: string; createdBy: string;
  stagingKey: string; attemptId: string | null };
type ImportRows = { batches: BatchRow[]; uploads: UploadRow[];
  attachments: { id: string; uploadId: string; batchId: string; createdBy: string }[] };
function importCan(grants: Grant[], actor: string, type: "ImportBatch" | "Document",
  row: { createdBy: string; state?: string }, field: string, action: Grant["action"] = "read") {
  return grants.some(g => g.subject === type && g.action === action &&
    Object.entries(g.conditions ?? {}).every(([key, value]) => key === "createdBy" ? row.createdBy ===
      (value === "$actor.id" ? actor : value) : key === "status" ? row.state === value : false) &&
    g.fields.some(f => f === "*" || field === f || field.startsWith(`${f}.`)));
}
const batchKeys = ["id", "revision", "state", "types", "namespace", "createdAt"] satisfies (keyof ImportBatchSummaryDTO)[];
function batchRead(row: BatchRow, grants: Grant[], actor: string): Visible<ImportBatchSummaryDTO> {
  if (!importCan(grants, actor, "ImportBatch", row, "id")) throw new Error("NOT_FOUND");
  return Object.fromEntries(batchKeys.filter(k => importCan(grants, actor, "ImportBatch", row, k))
    .map(k => [k, structuredClone(row[k])])) as Visible<ImportBatchSummaryDTO>;
}
function batchList(db: ImportRows, input: Queries["importBatches"], grants: Grant[], actor: string): Page<Visible<ImportBatchSummaryDTO>> {
  const order = input.sort.length ? [...input.sort] : [{ field: "createdAt", direction: "desc" as const }];
  if (!order.some(s => s.field === "id")) order.push({ field: "id", direction: "asc" });
  if (order.some(s => !["id", "createdAt", "state", "namespace"].includes(s.field))) throw new Error("INVALID_INPUT");
  const fields = [...order.map(s => s.field), ...(input.state ? ["state"] : []),
    ...(input.namespace || input.q ? ["namespace"] : []), ...(input.from || input.through ? ["createdAt"] : [])];
  const scope = db.batches.filter(r => importCan(grants, actor, "ImportBatch", r, "id"));
  if (scope.some(r => fields.some(f => !importCan(grants, actor, "ImportBatch", r, f)))) throw new Error("FIELD_FORBIDDEN");
  const localDate = (at: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date(at));
  const rows = scope.filter(r => (!input.state || r.state === input.state) && (!input.namespace || r.namespace === input.namespace) &&
    (!input.q || r.namespace.toLowerCase().includes(input.q.toLowerCase())) && (!input.from || localDate(r.createdAt) >= input.from) &&
    (!input.through || localDate(r.createdAt) <= input.through)).sort((a, b) => {
      for (const s of order) { const key = s.field as "id" | "createdAt" | "state" | "namespace";
        const cmp = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (cmp) return s.direction === "asc" ? cmp : -cmp; }
      return 0;
    });
  return { ok: true, data: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map(r => batchRead(r, grants, actor)),
    total: rows.length, page: input.page, pageSize: input.pageSize, asOf: "2026-10-30T00:04:00.000Z", redactedFields: [] };
}
function batchFiles(db: ImportRows, id: string, grants: Grant[], actor: string): Visible<ImportBatchFilesDTO> {
  const batch = required(db.batches.find(r => r.id === id)), result: Visible<ImportBatchFilesDTO> = batchRead(batch, grants, actor);
  const keys = ["uploadId", "revision", "state", "filename", "expiresAt", "attachmentId", "claimExpiresAt"] satisfies (keyof ImportSourceUploadDTO)[];
  const batchField = (field: string) => importCan(grants, actor, "ImportBatch", batch, `uploads.${field}`);
  if (!keys.some(batchField)) return result;
  result.uploads = db.uploads.filter(u => u.batchId === id && u.purpose === "IMPORT_SOURCE" &&
    importCan(grants, actor, "Document", u, "uploadId")).sort((a, b) => a.uploadId.localeCompare(b.uploadId)).map(u => {
      if (u.state === "FINAL") {
        const a = required(db.attachments.find(a => a.id === u.attachmentId && a.uploadId === u.uploadId && a.batchId === id));
        if (!importCan(grants, actor, "Document", a, "attachmentId")) return null;
      }
      return Object.fromEntries(keys.filter(k => batchField(k) && importCan(grants, actor, "Document", u, k))
        .map(k => [k, u[k]])) as Visible<ImportSourceUploadDTO>;
    }).filter((u): u is Visible<ImportSourceUploadDTO> => u !== null);
  return result;
}
function importFixture(): ImportRows {
  return { batches: ["own", "foreign"].map((id, i) => ({ id, revision: 1, state: "STAGED", types: ["CUSTOMERS"],
    namespace: "synthetic", createdAt: "2026-10-30T00:00:00.000Z", createdBy: i ? "other" : "owner" })),
    uploads: [{ batchId: "own", purpose: "IMPORT_SOURCE", uploadId: "upload", revision: 1, state: "INIT", filename: "customers.csv",
      expiresAt: "2026-10-30T00:05:00.000Z", attachmentId: null, claimExpiresAt: null, createdBy: "owner",
      stagingKey: "NEVER-OUTPUT-STORAGE-KEY", attemptId: null }], attachments: [] };
}
const ownBatch: Grant = { subject: "ImportBatch", action: "read", fields: ["*"], conditions: { createdBy: "$actor.id" } };
const ownDocument: Grant = { subject: "Document", action: "read", fields: ["*"], conditions: { createdBy: "$actor.id" } };
const ownImportReads = [ownBatch, ownDocument];
test("restart discovery lists scoped staged batches and builds init/finalize/download from fresh roots without preview", () => {
  const db = importFixture(), listInput: Queries["importBatches"] = { page: 1, pageSize: 10, sort: [], state: "STAGED", namespace: "synthetic" };
  const page = batchList(db, listInput, ownImportReads, "owner"); equal(page.total, 1);
  // A new browser has only the navigation list; no prior command body/receipt/capability is consumed.
  const detail = batchFiles(JSON.parse(JSON.stringify(db)) as ImportRows, required(page.data[0].id), ownImportReads, "owner");
  const root = dep("ImportBatch", { id: required(detail.id), revision: required(detail.revision) });
  const init = envelope<Commands["initUpload"]>({ target: { type: "IMPORT_BATCH", id: root.id }, purpose: "IMPORT_SOURCE",
    filename: "customers.csv", contentType: "text/csv", size: 10, sha256: "0".repeat(64) }, [root]);
  const upload = required(detail.uploads?.[0]);
  const finish = envelope<Commands["completeUpload"]>({ uploadId: required(upload.uploadId) },
    [root, dep("UploadIntent", { id: required(upload.uploadId), revision: required(upload.revision) })]);
  equal(init.expected, [root]); equal(finish.expected[1].revision, 1);
  assert(!("rows" in detail) && !("previewHash" in detail) && !("graph" in detail) && !("controlTotals" in detail));
  db.uploads[0] = { ...db.uploads[0], revision: 3, state: "FINAL", attachmentId: "attachment", claimExpiresAt: null };
  db.attachments.push({ id: "attachment", uploadId: "upload", batchId: "own", createdBy: "owner" }); db.batches[0].revision++;
  rejects(() => checkCurrent(finish.expected, [dep("ImportBatch", db.batches[0]), dep("UploadIntent", { id: "upload", revision: 3 })]), "STALE_REVISION");
  const after = batchFiles(JSON.parse(JSON.stringify(db)) as ImportRows, "own", ownImportReads, "owner");
  equal(after.revision, 2); equal(after.uploads?.[0].revision, 3);
  const download: Queries["download"] = { attachmentId: required(after.uploads?.[0].attachmentId) };
  equal(download.attachmentId, "attachment");
  assert(!JSON.stringify(after).includes("NEVER-OUTPUT") && !JSON.stringify(after).includes("attemptId"));
  db.attachments[0].createdBy = "other";
  equal(batchFiles(db, "own", ownImportReads, "owner").uploads, []); // Intent read cannot launder a hidden final attachment.
  db.batches.push(...Array.from({ length: 11 }, (_, i) => ({ ...db.batches[0], id: `own-${i}` })));
  db.batches[0].createdAt = "2026-10-29T20:00:00.000Z"; // Still Oct30 in Colombo.
  const secondPage = batchList(db, { ...listInput, page: 2, from: "2026-10-30", through: "2026-10-30", q: "SYNTHETIC" }, ownImportReads, "owner");
  equal(secondPage.total, 12); equal(secondPage.data.length, 2);
});
test("finalizing discovery reports persisted lease with no orphan attachment, expiry extension or per-owner truncation", () => {
  const db = importFixture();
  db.uploads[0] = { ...db.uploads[0], revision: 2, state: "FINALIZING", attachmentId: null,
    claimExpiresAt: "2026-10-30T00:06:00.000Z", attemptId: "NEVER-OUTPUT-ATTEMPT" };
  const before = JSON.stringify(db), detail = batchFiles(db, "own", ownImportReads, "owner"), upload = required(detail.uploads?.[0]);
  equal(upload.claimExpiresAt, "2026-10-30T00:06:00.000Z"); equal(upload.expiresAt, "2026-10-30T00:05:00.000Z");
  equal(upload.attachmentId, null); equal(JSON.stringify(db), before); // Repeated reads never renew/recover a claim.
  const recovery = envelope<Commands["completeUpload"]>({ uploadId: required(upload.uploadId) },
    [dep("ImportBatch", { id: required(detail.id), revision: required(detail.revision) }),
      dep("UploadIntent", { id: required(upload.uploadId), revision: required(upload.revision) })]);
  equal(recovery.expected[1].revision, 2); assert(!JSON.stringify(detail).includes("NEVER-OUTPUT"));
  db.uploads = Array.from({ length: 101 }, (_, i) => ({ ...db.uploads[0], uploadId: `upload-${String(i).padStart(3, "0")}` }));
  equal(batchFiles(db, "own", ownImportReads, "owner").uploads?.length, 101);
});
test("delegated read scope is not import/finalize authority; hidden batch/document/field data never becomes discovery", () => {
  const db = importFixture(), input: Queries["importBatches"] = { page: 1, pageSize: 10, sort: [] };
  rejects(() => batchFiles(db, "foreign", ownImportReads, "owner"), "NOT_FOUND");
  const delegated: Grant[] = [{ ...ownBatch, conditions: undefined }, { ...ownDocument, conditions: undefined }];
  equal(batchList(db, input, delegated, "delegate").total, 2);
  equal(batchList(db, input, [], "delegate").total, 0);
  rejects(() => batchFiles(db, "own", [], "delegate"), "NOT_FOUND"); // Fresh read after revocation.
  const noName = [ownBatch, { ...ownDocument, fields: ["uploadId", "revision", "state", "expiresAt", "claimExpiresAt", "attachmentId"] }];
  assert(!JSON.stringify(batchFiles(db, "own", noName, "owner")).includes("customers.csv"));
  equal(batchFiles(db, "own", [{ ...ownBatch, fields: ["id", "revision", "uploads.filename"] }, ownDocument], "owner").uploads,
    [{ filename: "customers.csv" }]); // A leaf never authorizes its sibling IDs/revisions.
  equal(batchFiles(db, "own", [ownBatch], "owner").uploads, []); // No document existence/count leak.
  assert(!("uploads" in batchFiles(db, "own", [{ ...ownBatch, fields: batchKeys }], "owner")));
  db.uploads.push({ ...db.uploads[0], uploadId: "other-document", createdBy: "other", filename: "HIDDEN-NAME.csv" });
  assert(!JSON.stringify(batchFiles(db, "own", ownImportReads, "owner")).includes("HIDDEN-NAME"));
  const hiddenNamespace = [{ ...ownBatch, fields: ["id", "revision", "createdAt"] }];
  rejects(() => batchList(db, { ...input, namespace: "synthetic" }, hiddenNamespace, "owner"), "FIELD_FORBIDDEN");
  const canConfirm = (administrator: boolean, grants: Grant[]) => administrator &&
    importCan(grants, "delegate", "ImportBatch", db.batches[0], "types", "import");
  const importGrant: Grant = { subject: "ImportBatch", action: "import", fields: ["types"] };
  assert(!canConfirm(true, delegated) && !canConfirm(false, [...delegated, importGrant]));
});
console.log(`PASS ${checks} typed round-trip/provenance/authorization checks; specification only, not DB/HTTP acceptance.`);
