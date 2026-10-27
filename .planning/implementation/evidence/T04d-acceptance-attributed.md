# Bounded T04d acceptance and purchase-prerequisite decision

2026-10-27. Parent explicitly accepts exact source **`7ba9b9f4b28839afafe1b0468b9de8b8abf64b36`** after independent **`ccd9c73d` PASS**, and explicitly adjudicates **purchase-facing T04 foundational prerequisites satisfied for bounded T05**. The review identifier is parent-supplied, not a locally resolved Git SHA (local Git does not resolve it). This record attributes the supplied verdict; integration did not repeat the runtime campaign or inspect private reviewer artifacts. G1/T03 and bounded T04a–d remain accepted. This is **not whole T04, whole requirement, T05 or G2 acceptance**.

## Exact-source supplied evidence

| Campaign | Supplied result / provenance |
| --- | --- |
| Settings writes fresh installation | Independent 16 groups PASS |
| Genuine upgrade | Independent 16 groups PASS; existing initialized parent database upgraded, not a fresh fixture called an upgrade |
| Additional adversarial checks | Independent 7 PASS |
| Units | Independent 108 PASS |
| Retained finance / party / customer / retry | Independent 15 / 17 / 15 / 6 PASS |
| Administration / mobile / redacted-user | Independent 10 / 12 / 7 PASS |
| Portal privacy | 15 PASS **author-attributed, not independently rerun** |
| Specifications / round trips | Independent 19 / existing 5 + reviewed 3 PASS; specification/type checks, not application scenarios |
| Typecheck / production build / owned lint | Independent PASS |
| Full lint | **FAIL: 3 errors / 40 warnings**, retained G6 debt; not an owned-lint failure or clean full-lint result |

The administration campaign first failed using a reused fixture, then passed all10 on a fresh fixture. Preserve that failed attempt; do not claim a clean first run, infer a new source defect, or relabel the failed reused run PASS. No more precise failure cause or extra campaign counts were supplied here.

Independent verification supplied by the parent covers immutable Settings history, **singleton revision CAS versus immutable policyVersion**, current authorization on execution/replay and lock waiters, rollback, finance dependency races, and runtime grants. `lib/server/settings.ts` reads current persisted policy, checks changed leaf-field authority, appends SettingsVersion and atomically commits pointer/revision, receipt, audit, read version and sequence. Old SettingsVersion/FinancePolicyVersion identities are not future quote/deal/invoice snapshot proof. Existing earlier T04c FAIL/correction evidence stays unchanged in [its original record](T04c-acceptance-attributed.md).

## Requirement-matrix review, not count-based promotion

All134 original rows, owners and scenarios are retained. **No whole ID promoted**: supplied aggregate successes do not establish every clause of an original scenario. TPRT-01 still needs an explicit all-three-tab persisted-population/read-permission scenario map; TPRT-03 needs complete contact edit/reload plus invalid-input draft-retention evidence across the required populations, not only create/contact identity groups. CUST-01 omitted-optional/every-required-negative and CUST-02 distinct name-only search gaps are not explicitly closed by rerunning the existing15. TPRT-02/04 require real purchase selection/inline creation/history; TPRT-05 repair selection; TPRT-06 shared sale/brokerage/reconciliation use; TPRT-07 old deal/new policy snapshots; TPRT-08 lease selection; CUST-03/04 sale-inline/full lawful histories remain pending. Foundational purchase/payment audit criteria await T05 execution. Settings has no standalone catalog ID. Independent scenario-level evidence may later promote complete IDs without waiting for an entire task, but counts alone cannot.

## Current handoff

Prepare [T05a PURCHASE implementation](../T05a-next-slice.md) now; do not redispatch T04d, reopen prerequisite planning, or require future purchase histories before T05 can implement them. The parent binds the exact docs candidate and separate author/verifier with explicit own disposable-service authority. Integration adds records only directly atop the accepted source; [fresh local preservation/spec/types/links](T04d-integration-checks.md) do not extend runtime review binding. Whole T04/G2 and downstream history/selection/snapshot contributions remain pending, not waived. No services, secrets, cloud, push, PR, deploy or accepted-ref changes authorized here.
