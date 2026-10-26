/** Executable typed SPECIMENS ONLY; not runtime validators, permissions or DB tests. */
import type { Commands, Contact, Dependency, Envelope, PartyDTO, QueryData, Visible } from "./api";
import type { PartyContribution, PartyDetailDTO, ProposedQueries, ProposedQueryData } from "./party-detail-settings.proposal";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function rejects(run: () => unknown, code: string) {
  try { run(); } catch (error) { assert(error instanceof Error && error.message === code); return; }
  throw new Error(`expected ${code}`);
}
let checks = 0;
function test(name: string, run: () => void) { run(); console.log(`ok ${++checks} - ${name}`); }
type ContactRow = Contact & { id: string; parentId: string; active: boolean };
type SupplierRow = { id: string; revision: number; name: string; active: boolean; createdBy: string };
type PurchaseRow = { id: string; supplierId: string; purchaseDate: string; status: string; createdBy: string };
const contact: Contact = { name: "Synthetic contact", phone: "0112345678", role: "Agent", primary: true };
const party: SupplierRow = { id: "supplier", revision: 8, name: "Synthetic supplier", active: false, createdBy: "owner" };
const contacts: ContactRow[] = [
  { ...contact, id: "current", parentId: party.id, active: true },
  { ...contact, id: "old", parentId: party.id, active: false },
  { ...contact, id: "foreign", parentId: "other", active: true },
];
const purchases: PurchaseRow[] = [
  { id: "visible-cycle", supplierId: party.id, purchaseDate: "2026-10-01", status: "PURCHASED", createdBy: "owner" },
  { id: "hidden-cycle", supplierId: party.id, purchaseDate: "2026-10-02", status: "PURCHASED", createdBy: "other" },
  { id: "foreign-cycle", supplierId: "other", purchaseDate: "2026-10-03", status: "PURCHASED", createdBy: "owner" },
];
function readSupplier(input: ProposedQueries["party"], actor: string, canContacts: boolean,
  canLinks: boolean, ready = false): { data: Visible<PartyDetailDTO>; redactedFields: string[] } {
  if (input.type !== "SUPPLIER" || input.id !== party.id || actor !== party.createdBy) throw new Error("NOT_FOUND");
  const dto: Visible<PartyDetailDTO> = { id: party.id, revision: party.revision, type: "SUPPLIER", name: party.name,
    active: party.active, contacts: contacts.filter(c => c.parentId === party.id && c.active)
      .map(({ parentId: _, active: __, ...c }) => c), provenance: { imported: false },
    contributions: { purchases: { state: ready ? "READY" : "PENDING_DOMAIN",
      links: purchases.filter(p => p.supplierId === party.id && p.createdBy === actor)
        .map(p => ({ type: "PURCHASE", id: p.id, date: p.purchaseDate, status: p.status })) } } };
  // Projection, not a policy engine: only these two explicit specimen field grants vary.
  const redactedFields: string[] = [];
  if (!canContacts) { Reflect.deleteProperty(dto, "contacts"); redactedFields.push("contacts"); }
  if (!canLinks) { Reflect.deleteProperty(dto.contributions!, "purchases"); redactedFields.push("contributions.purchases"); }
  return { data: dto, redactedFields };
}
test("detail identity independent of list page; archive readable; wrong type/hidden/missing 404", () => {
  const query: ProposedQueries["party"] = { type: "SUPPLIER", id: party.id };
  const read = readSupplier(query, "owner", true, true);
  assert(read.data.id === party.id && read.data.revision === 8 && !read.data.active);
  assert(read.data.contacts?.length === 1 && read.data.contacts[0].id === "current");
  for (const input of [{ ...query, id: "missing" }, { ...query, type: "REPAIR_VENDOR" as const }])
    rejects(() => readSupplier(input, "owner", true, true), "NOT_FOUND");
  rejects(() => readSupplier(query, "other", true, true), "NOT_FOUND");
});
test("pending known links are scoped; pending empty is not ready empty; denied omitted", () => {
  const query: ProposedQueries["party"] = { type: "SUPPLIER", id: party.id };
  const read = readSupplier(query, "owner", true, true).data;
  assert(read.type === "SUPPLIER");
  assert(read.contributions?.purchases?.state === "PENDING_DOMAIN");
  assert(read.contributions.purchases.links?.length === 1 && read.contributions.purchases.links[0].id === "visible-cycle");
  const pending: PartyContribution<"PURCHASE"> = { state: "PENDING_DOMAIN", links: [] };
  const ready: PartyContribution<"PURCHASE"> = { state: "READY", links: [] };
  assert(JSON.stringify(pending) !== JSON.stringify(ready));
  const complete = readSupplier(query, "owner", true, true, true).data;
  assert(complete.type === "SUPPLIER" && complete.contributions?.purchases?.state === "READY");
  const denied = readSupplier(query, "owner", false, false);
  assert(!("contacts" in denied.data) && denied.data.contributions && !("purchases" in denied.data.contributions));
  assert(denied.redactedFields.join(",") === "contacts,contributions.purchases");
  assert(!JSON.stringify(denied).includes("hidden-cycle"));
});
const settings: QueryData["settings"] = { id: "settings-singleton", revision: 4, policyVersion: 9,
  company: { name: "Synthetic dev", identity: "DEV", address: "Synthetic address", phone: "0112345678", email: "dev@example.invalid" },
  declarations: ["Synthetic development only"], currency: "LKR", scale: 2, timezone: "Asia/Colombo",
  tiers: [{ upperBps: 500, days: 7 }, { upperBps: 1000, days: 14 }, { upperBps: 1500, days: 21 }, { upperBps: null, days: 31 }],
  warningLeadDays: 3, processingFee: "250000", dateFormat: "YYYY-MM-DD", itemsPerPage: 20, theme: "SYSTEM" };
const finance: PartyDetailDTO = { id: "finance", revision: 6, type: "FINANCE_COMPANY", name: "Synthetic finance",
  active: true, contacts: [{ ...contact, id: "finance-contact" }], provenance: { imported: false },
  policy: { path: "APPLICATION", commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
    processingFee: "250000", reconciliationMethod: "PERIOD_NOTICE" },
  contributions: { settlementPurchases: { state: "PENDING_DOMAIN", links: [] }, leaseSales: { state: "PENDING_DOMAIN", links: [] },
    brokerage: { state: "PENDING_DOMAIN", links: [] }, entitlements: { state: "PENDING_DOMAIN", links: [] },
    remittances: { state: "PENDING_DOMAIN", links: [] } } };
function envelope<T>(input: T, expected: Dependency[]): Envelope<T> {
  return { schemaVersion: 1, idempotencyKey: "one-intent", input, expected };
}
function current(expected: Dependency[], required: Dependency[]) {
  for (const row of required) {
    const supplied = expected.find(d => d.type === row.type && d.id === row.id);
    if (!supplied) throw new Error("REVISION_REQUIRED");
    if (supplied.revision !== row.revision) throw new Error("STALE_REVISION");
  }
}
test("finance create/update/archive and Settings full-object edit use read refs, not policy version", () => {
  assert(finance.policy);
  const settingsRef: Dependency = { type: "Settings", id: settings.id, revision: settings.revision };
  const financeRef: Dependency = { type: "FinanceCompany", id: finance.id, revision: finance.revision };
  const values: Commands["createFinanceCompany"] = { name: finance.name,
    contacts: finance.contacts.map(({ id: _, ...c }) => c), policy: finance.policy };
  const create = envelope<Commands["createFinanceCompany"]>(values, [settingsRef]);
  const update = envelope<Commands["updateFinanceCompany"]>({ ...values, id: finance.id, reason: "Recorded edit" }, [financeRef, settingsRef]);
  const archive = envelope<Commands["archiveParty"]>({ type: finance.type, id: finance.id, active: false, reason: "Recorded archive" }, [financeRef]);
  const { id: _, revision: __, policyVersion: ___, ...editable } = settings;
  const save = envelope<Commands["updateSettings"]>({ ...editable, reason: "Recorded settings edit" }, [settingsRef]);
  current(create.expected, [settingsRef]); current(update.expected, [financeRef, settingsRef]);
  current(archive.expected, [financeRef]); current(save.expected, [settingsRef]);
  assert(save.input.company.email === settings.company.email && !("policyVersion" in save.input));
  assert(update.expected[1].revision !== settings.policyVersion);
  rejects(() => current(update.expected, [financeRef, { ...settingsRef, revision: 5 }]), "STALE_REVISION");
  rejects(() => current(update.expected, [{ ...financeRef, revision: 7 }, settingsRef]), "STALE_REVISION");
  rejects(() => current([financeRef], [financeRef, settingsRef]), "REVISION_REQUIRED");
  assert(!("id" in update.input.contacts[0])); // accepted replacement-value command, no invented contact edit
});
type Assert<T extends true> = T;
type QueryMapComplete = Assert<Exclude<keyof ProposedQueries, keyof ProposedQueryData> extends never ? true : false>;
type SamePartyKind = Assert<PartyDetailDTO["type"] extends PartyDTO["type"] ? true : false>;
// @ts-expect-error No unlabelled empty history can stand in for a domain contribution.
const fabricatedComplete: PartyContribution<"PURCHASE"> = { links: [] };
// @ts-expect-error Repair records are not purchase links.
const wrongTarget: PartyContribution<"PURCHASE"> = { state: "READY", links: [{ type: "REPAIR", id: "r", date: "2026-10-26", status: "RETURNED" }] };
// @ts-expect-error Detail selector is not a text search or list scan.
const missingId: ProposedQueries["party"] = { type: "SUPPLIER", q: "name" };
const projectedFinance: Visible<PartyDetailDTO> = { id: "finance", type: "FINANCE_COMPANY", name: "Visible name" };
// @ts-expect-error A field-projected read cannot be submitted as a complete finance write.
const forbiddenReplacement: Commands["createFinanceCompany"] = projectedFinance;
void [fabricatedComplete, wrongTarget, missingId, forbiddenReplacement];
