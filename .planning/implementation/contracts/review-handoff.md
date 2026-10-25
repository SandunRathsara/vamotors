# T01 author handoff / integration-owner proposed updates

**State: review, not accepted.** No PR/push/cloud actions; integration alone merges. Branch `t3/t01-domain-api-contracts`, exact head returned in final response. All owned files are under contracts/. Base `f51b1648bbbda5fb8e37129ba31be0683d63678f` verified ancestor and exact initial HEAD; clean isolated harness worktree. No recursive delegation. Model inherited `openai/gpt-6.1-sol`, provider instance OpenCode. GSD search returned no tools and conventional local command directories absent; follow T00 D24 explicit workflow exception, do not simulate phase execution.

## Proposed integration records (do not treat as acceptance)

* Ledger T01→review with this branch/head, README index and validation below; independent verifier unassigned. T02 prepare may consume R02 names but runtime implementation waits accepted T01. T03 remains blocked pending review/acceptance.
* Matrix: link each row via coverage.md to normative seams; retain 0 implementation acceptance claims. Explicit FNDN-04/FNDN-07 adjustments from D05/D06 preserved. Do not replace actual feature evidence with contract tests.
* Decisions additions: M1 exact A/C/B bounds, all-wire-string money and half-away rounding; M3 inclusive validThrough/exclusive next-midnight expiry,3-day snapshotted warning; S1/S2 explicit receipt/hold and ten-state/Delivered compatibility; A1 grants-only union + bounded equality conditions + actual field projection; A3 permanent idempotency receipts/revision lock/replay reauthorization; A4 atomic review/effect and requester/reviewer recheck; W10C financial-entry correction safety; W11 exact synthetic cards; W12F net-funded facility recovery; W13 commission cutoff/watermark/partials; F06 exact validated-byte promotion; F14 pending/immutable invoice versions; W16 bounded200-row/5MiB import and explicit historical approval exception.
* Carry all D01–D24 defaults forward, with new synthetic settings: LKR2/Colombo; tiers7/14/21/31 and lead3; commission1% financed principal or explicit fixed; processingFeeLKR2500; rate fixtures as W11; quote max24h; draft synthetic A4 identity/declarations; upload5min/download60s; photos2MiB/docs5MiB; finalization lease5min; staging grace24h; PDF50 pages; dispatch50/import200/export10000; quota70% warning/85% stop subject to verified provider allowances; fail-closed preview/no public bootstrap. These are configurable synthetic development defaults, not production financial/legal policy.
* HANDOFF should point to README/coverage and preserve integration-owned files unchanged in this branch. No T00 state repair attempted despite stale base ledger; dispatch supplies T00 accepted status.

## Exact next T03 prerequisites

1. Independent reviewer checks this exact commit against all134 IDs, E1–E6 cardinalities/constraints, DTOs/errors/action map and negative cases; orchestrator accepts integrated revision. Any amended contracts reviewed again; no author self-acceptance.
2. T02 confirms runtime/migration credential delivery names, isolated disposable verification DB and Environment.id, least-privilege role ownership, future authenticated dev origin/preview exclusion. This author never consumed secrets. Cloud provisioning/SQL execution require that lane's authorization.
3. T03 performs fresh current-docs lookup and version-pins compatible Prisma/client/Neon adapter+transaction driver, Better Auth and CASL against installed Next16.1.7/React19.2.5/Zod3.25.76; no framework upgrade. Verify transaction callback/serialization support on actual selected backend. Generate/inspect auth schema before migrations. T01 deliberately does not choose an unverified backend version.
4. Foundation implements shared schema/SQL constraints in E6 serialized order, adopting reviewed reference behavior into lib/money/state (not parallel duplicate runtime copies); strict boundary validators for api.ts; trusted actor/read projection/command tx, idempotency, immutable audit/source cash and notification primitives; deterministic IDs + privately supplied passwords/two reviewers. No feature worker dependency/schema edits.
5. Real disposable-DB tests: fresh install; atomic forced audit/notification failure; current revocation/fields/API+RSC; last-admin two-session race; idempotency same/different-key collision; double buyer; normalized identity/open cycle uniqueness; illegal status SQL; runtime append-only/no DDL; public signup/bootstrap/reset denied. Local pure contract checks do not satisfy these gates.

## Review test brief / known risk boundaries

Use `node .planning/implementation/contracts/check.mjs` and isolated tsc command in README. Tests intentionally do not connect Neon/R2 or claim actual CASL/Prisma/auth behavior. Read every seam cross-reference manually: exact string money bounds beyond Number safe; aggregate separate-side overflow even net0; 5/10/15% endpoints one minor above/below; Colombo year boundary; direct cash state; due-vs-convert; Delivered missing completion negative; canceled advance retained cash; two-cycle profit30/25; trade-in1500/500; lender timing; facility gross1000→net880→recovery880; reconciliation mixed-source100+60 with bank160 counted once, two-day OR watermark; stale approvals and finalization TOCTOU described in contracts. API DTOs are compile-checked specification, NOT runtime validators.

Outstanding acceptance decisions: independent acceptance of proposed synthetic numeric/term defaults and correction seams; T02 actual provider limits/region/secret delivery/SQL roles; T03 backend pin and DB feasibility tests. No known deliberate feature omission. Real lender rate/commission cards, lawful invoice wording/dealership identity, overallowance/refinancing/recovered written-off identity policies, real historical source quality, production backup operator/recovery objectives remain live-launch decisions; full synthetic-v1 acceptance is not blocked by real wording but never implies live-launch approval.

## Author validation record

Exact fresh commands/results recorded here after execution; Git head in final response binds this file set. Contract tests validate executable reference, individual coverage and type-operation seams; application checks are regression smoke only. No hosted/database/security proof claimed, no review passed by author declaration.

| Command | Fresh result / scope |
| --- | --- |
| `git status --short`, `git branch --show-current`, `git rev-parse HEAD`, `git merge-base --is-ancestor f51b1648bbbda5fb8e37129ba31be0683d63678f HEAD`, `git worktree list` | Initial clean isolated branch at exact accepted base; ancestry exit0. No user changes overwritten. |
| `node .planning/implementation/contracts/check.mjs` | PASS11 checks, including exactly134 unique v1 IDs with existing seam references, all query response keys, numeric/state/date/finance examples. No DB simulation claimed as real race proof. |
| `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .planning/implementation/contracts/api.ts` | FAILED tooling availability: no node_modules/compiler in isolated checkout; wrapper returned “not the tsc command”. No install/lockfile mutation attempted. |
| `node /Users/alpha/Developer/Personal/vamotors/node_modules/typescript/lib/tsc.js --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .planning/implementation/contracts/api.ts` | PASS exit0 using existing accepted-checkout TypeScript5.9.3 read-only; no dependency changes. Portable README command works after normal lockfile install. |
| `git diff --check` and staged equivalent | PASS; only contracts/ added. |
| `npx ctx7@latest library CASL "CASL record and field level authorization with subject instances permittedFieldsOf MongoAbility conditions multirole grants union deny defaults"`; docs query `/stalniy/casl` | Retrieved current primary repo docs confirming record-instance field checks, fieldsFrom projection and query-conversion seam. Version pin remains T03. |

Application build/lint/browser/DB/cloud checks not executed in T01: no application/dependency changes and isolated checkout lacks node_modules. Baseline failures remain integration-owned; do not imply green release checks.

### Required independent race/security observations (not yet executed)

| Scenario / setup | Observable result |
| --- | --- |
| Two actors submit different-key cash sale commands at cycle revision7 simultaneously | Exactly one201 sale/completion/receipt/mileage/close; loser409 STALE_REVISION or STOCK_UNAVAILABLE; no loser residue. Same-key identical requests yield same IDs with replayed=true. |
| Drop response after committed reserve100; retry original envelope | One reservation/receipt100 only, same result IDs. Same key amount101 →409 IDEMPOTENCY_MISMATCH. No active session/revoked read on replay →401/403/404, never saved secret fields. |
| Expiry and conversion lock same due reservation | Conversion-first: SOLD remains and expiry skip; expiry-first: client409 revision, explicit refetch+new-key expired conversion succeeds once; no automatic stock release/refund. |
| Two different reviewers approve same pending refund60 against100 | One refund OUT60 + retained40 + cancellation/disposition; second new-key409 ALREADY_REVIEWED. Self-review403, revoked reviewer403, changed price/date/cycle revision409 APPROVAL_STALE with zero effects. |
| Inject audit or required-notification insert failure after sale/payment/trade-in creation | Zero sale/payment/mileage/acquired cycle/status/idempotency receipt persists. Retry after fault removal executes once. |
| Two administrators concurrently deactivate/remove each other | Guard serialization keeps >=1 active fully privileged admin; second409 LAST_ADMIN; direct restricted SQL cannot bypass trigger. |
| Validate staging image, overwrite staging via still-valid PUT before linking | Final bytes/hash are originally validated buffer, not overwritten staging; no public final PUT; stale target/revoked user fails link with quarantined orphan. |
| Two reconciliations allocate bank160 across sale100 and brokerage60 plus competing extra10 | Combined live allocation<=160; competitor409 ALLOCATION_EXCEEDED or STALE_REVISION; cash remains one IN160 regardless of allocation count. |
| Import200 rows: row200 violates cycle FK/audit insert after preview | Zero business/provenance/payment/commit rows, retained staged errors; next valid confirm same exact reviewed hash commits all once. Changed sources require new preview/hash. |
