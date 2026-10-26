/** Bounded T04 proposal ONLY. Pending independent review and parent acceptance.
 * Deliberately does not augment/change accepted api.ts or runtime dispatch. */
import type { ApiError, DateOnly, Id, Instant, PartyDTO, Queries, QueryData,
  Visible } from "./api";

export type PartyHistoryLink<K extends string> = {
  type: K; id: Id; date: DateOnly; status: string;
};
/** All links are independently target-authorized. No cash/amount/count summary.
 * PENDING_DOMAIN may contain known links but never asserts exhaustive history.
 * READY means exhaustive AUTHORIZED links in this domain at response asOf. */
export type PartyContribution<K extends string> = {
  state: "PENDING_DOMAIN" | "READY";
  links: PartyHistoryLink<K>[];
};
export type PartyDetailDTO = PartyDTO & (
  { type: "SUPPLIER"; contributions: {
    purchases: PartyContribution<"PURCHASE">;
  } } |
  { type: "REPAIR_VENDOR"; contributions: {
    repairs: PartyContribution<"REPAIR">;
  } } |
  { type: "FINANCE_COMPANY"; contributions: {
    settlementPurchases: PartyContribution<"PURCHASE">;
    leaseSales: PartyContribution<"SALE">;
    brokerage: PartyContribution<"BROKERAGE">;
    entitlements: PartyContribution<"ENTITLEMENT">;
    remittances: PartyContribution<"REMITTANCE">;
  } }
);
/** Adopt these two additive properties into api.ts ONLY after acceptance. */
export interface ProposedQueries extends Queries {
  party: { type: PartyDTO["type"]; id: Id };
}
export interface ProposedQueryData extends QueryData {
  party: PartyDetailDTO;
}
export type ProposedPartyResponse = {
  ok: true; data: Visible<PartyDetailDTO>; redactedFields: string[]; asOf: Instant;
} | ApiError;
