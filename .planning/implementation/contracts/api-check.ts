/** Compile-time regressions for the seven review findings; no runtime/application imports. */
import type { Commands, Dependency, Queries, QueryData, PurchaseCycleDTO, ImportRowInput,
  CurrentActorDTO, UserAdminDTO, RoleDTO, PermissionRegistryDTO, ExportManifestDTO } from "./api";

const omittedDependencies: Dependency[] = [
  { type: "Customer", id: "customer", revision: 1 },
  { type: "Supplier", id: "supplier", revision: 1 },
  { type: "RepairVendor", id: "vendor", revision: 1 },
  { type: "CashFacility", id: "facility", revision: 1 },
  { type: "UploadIntent", id: "upload", revision: 1 }
];
function roundTripPurchase(cycle: PurchaseCycleDTO): Commands["editPurchase"] {
  const payment = cycle.payments[0];
  return { cycleId: cycle.id, reason: "Correct channel and seller with recorded payment IDs",
    patch: { purchaseType: cycle.purchaseType, seller: { type: cycle.seller.type, id: cycle.seller.id },
      purchaseDate: cycle.purchaseDate, purchasePrice: cycle.purchasePrice, notes: cycle.notes,
      settlement: cycle.settlement ?? null },
    cashCorrections: payment ? [{ paymentId: payment.id, reason: "Recorded correction" }] : [] };
}
function convertFromSale(sale: QueryData["sale"]): Commands["convertReservation"] | null {
  return sale.reservation ? { reservationId: sale.reservation.id, balance: null,
    date: "2026-10-25", mileage: 0 } : null;
}
const graphStage: Commands["stageImport"] = { types: ["VEHICLES", "ADVANCES", "SALES"], namespace: "synthetic" };
const advance: Extract<ImportRowInput, { type: "ADVANCES" }>["payload"] = {
  cycle: { namespace: "synthetic", type: "VEHICLES", sourceKey: "cycle" },
  customer: { namespace: "synthetic", type: "CUSTOMERS", sourceKey: "buyer" },
  saleCaseSourceKey: "case", agreed: "100000", amount: "10000", placedDate: "2026-01-01",
  listedBasis: "100000", validThrough: "2026-01-15", expiresAt: "2026-01-15T18:30:00.000Z",
  policySnapshot: { timezone: "Asia/Colombo", tiers: [{ upperBps: null, days: 14 }], leadDays: 3, days: 14 },
  state: "CONVERTED", completedSale: { namespace: "synthetic", type: "SALES", sourceKey: "sale" }, payments: []
};
const maximaBeforeTerms: Queries["loanMaxima"] = { vehicle: { make: "Demo", model: "Demo100", year: 2026 }, asOf: "2026-10-25" };
const requote: Commands["replaceDealQuote"] = { dealId: "deal", quoteId: "quote", reason: "Supported exact adjusted card",
  contactId: "contact", confirmedAt: "2026-10-25T00:00:00.000Z" };
const serverOnlyExportTarget: Commands["initUpload"]["target"] = {
  // @ts-expect-error REPORT_EXPORT bytes are server-generated; no browser staging capability
  type: "EXPORT_JOB", id: "export"
};
type Assert<T extends true> = T;
type NoCredentials<T> = Extract<keyof T, "password" | "passwordHash" | "token" | "sessionToken" | "account"> extends never ? true : false;
type SafeActor = Assert<NoCredentials<CurrentActorDTO>>;
type SafeUsers = Assert<NoCredentials<UserAdminDTO>>;
type SafeRoles = Assert<NoCredentials<RoleDTO>>;
type SafeRegistry = Assert<NoCredentials<PermissionRegistryDTO>>;
type SafeUserShape = Assert<NoCredentials<CurrentActorDTO["user"]>>;
type AllQueriesReturn = Assert<Exclude<keyof Queries, keyof QueryData> extends never ? true : false>;
type ExportNotOneFile = Assert<ExportManifestDTO["parts"] extends { firstRow: number; lastRow: number }[] ? true : false>;
void [omittedDependencies, roundTripPurchase, convertFromSale, graphStage, advance, maximaBeforeTerms, requote, serverOnlyExportTarget];
