# T01 domain/API contract package — review candidate

Author: foundation owner, 2026-10-25. Base verified before edits: `f51b1648bbbda5fb8e37129ba31be0683d63678f`, clean harness-isolated branch `t3/t01-domain-api-contracts`. T00 acceptance is supplied by dispatch; stale T00 ledger status is not rewritten here. **Author work enters review, not acceptance.** No application/schema/dependency/cloud changes. These files are the proposed normative seams for T03–T16, not proof those features exist.

## Contract index

Pending additive candidate: [import staging/file discovery](import-file-discovery.proposal.md) adds only importBatches/importBatchFiles reads and typed specimens. Independent review/parent acceptance required before runtime adoption; no feature/gate acceptance is asserted.

2026-10-26 bounded amendment: parent explicitly accepted proposal `da040cf9d1da91c1885326b0edcccae8b48e0f96` after independent `433aae87` PASS (dispatch attribution). [Promoted normative semantics](party-detail-settings.md) and [T04c brief](../T04c-next-slice.md) apply on accepted runtime base `dda76e3f9c078360118722feee1f14f23fdd7fa3`. The three `party-detail-settings.proposal*` files remain byte-identical historical review artifacts; their pending labels describe that earlier submission, not current amendment authority. This accepts contract policy only, not implementation, whole T04, any whole requirement or G2–G6. Shared acceptance records remain integration-owned.

Fresh promotion checks: PASS contracts19; strict standalone compile of `api.ts`, `api-check.ts`, `roundtrip-check.ts` and both proposal TS files; CommonJS execution of existing5 + reviewed3 specimens; 315 local Markdown targets (path existence, not anchors). Use the five-file compile/emission commands preserved in proposal §Contract-only checks; existing installed TypeScript, no install. `api-check.ts` now asserts exact equality between reviewed and promoted query/detail/contribution/link types. These checks are specification only, not DB/HTTP/browser proof.

| File | Contract / consumers |
| --- | --- |
| [entities.md](entities.md) | Complete relational proposal, keys/checks/indexes, source-owned cash, migration order; T03–T16 |
| [money-state.md](money-state.md) | Numeric/JSON/rounding bounds, dates, ten-state action map, compatibility; T03/T05/T08–T15 |
| [access-transactions.md](access-transactions.md) | Actor/current grants, record/field permissions, audit, notifications, idempotency, races, four approvals; T03 and all lanes |
| [api.ts](api.ts) | Concrete wire DTO types, discriminated commands/queries/results/errors; T04–T16 adapters |
| [workflows.md](workflows.md) | Command preconditions/effects/errors, rates/brokerage/facility/reconciliation, reports/import; T04–T16 |
| [files-runtime.md](files-runtime.md) | Private file/PDF lifecycle, T02 secret/role/bootstrap/preview interface, scheduler; T02/T03/T06/T10/T14 |
| [coverage.md](coverage.md) | All 134 individual IDs → relevant seams; no acceptance claims |
| [reference.mjs](reference.mjs) | Dependency-free executable reference for exact money, dates, lifecycle and overdue semantics; not installed in runtime |
| [check.mjs](check.mjs) | Runnable assertions and exhaustive catalog/DTO/index coverage check |
| [api-check.ts](api-check.ts) | Compile-time review regressions: formerly missing dependency types, admin/actor reads, cycle edit roundtrip, graph import/maxima/requote/export interfaces |
| [roundtrip-check.ts](roundtrip-check.ts) | Executable typed read-to-command specimens, including current import staging/file discovery without receipt/error lookup |
| [import-file-discovery.proposal.md](import-file-discovery.proposal.md) | Pending additive read candidate, compatibility/scope and contract-only validation evidence |
| [party-detail-settings.md](party-detail-settings.md) | Accepted bounded party detail and persisted Settings/finance prerequisites; no new write/policy protocol |
| [party-detail-settings.proposal-check.ts](party-detail-settings.proposal-check.ts) | Preserved three reviewed typed specimens; api-check.ts binds their query/DTO/link types exactly to promoted api.ts |
| [review-handoff.md](review-handoff.md) | Integration-owner update proposal, defaults, review scenarios, exact T03 prerequisites and validation scope |

## Authority and boundaries

**Accepted bounded policy addition (2026-10-26):** [A1D/A3](access-transactions.md) promotes exact delegated-admin source `909076451f7cbdac993ef78324f2c6567746928a`, including explicit reference-only replay clarification, after parent-attributed independent PASS `26b21d2f-2b27-4de8-840e-c08ce6221e61` and explicit parent acceptance. [Source/status record](../delegated-admin-proposal.md); [future T03c implementation brief](../T03c-next-slice.md). Policy accepted only; implementation pending, T03/G1 unaccepted, 134 U / 0 accepted. Historical candidate prose below is not a reversal of this bounded acceptance.

**Current operational override (2026-10-26):** [local completion contract](../local-completion.md) and updated orchestration govern T02/T06/T10/T18. All 134 seams and application semantics remain; local PostgreSQL, private durable files and actual local scheduling replace hosted prerequisites for LOCAL acceptance only. Hosted acceptance stays deferred/not passed. Candidate/review statements below remain historical; T01/G0 were accepted at `ddd69fb`, but adapted local real-DB G1 is not accepted.

Read in conjunction with `.planning/FULL-IMPLEMENTATION-ORCHESTRATION.md`, `CLAUDE.md`, `.planning/REQUIREMENTS.md` v1, `docs/architecture/c4-model.json` decisions, T00 matrix/decisions/ledger/HANDOFF, both `docs/02-{1,2}-*specification.md` and `docs/round_1_customer_feedback.md`. Orchestration and D32 local scope supersede historical hosting prerequisites and old Vercel/NestJS/RabbitMQ/offline-read/extension/general-ledger prescriptions. Business defaults remain; refinements are listed in review handoff. No feature is waived by a transport/type simplification.

Types describe the proposed `/api/v1` contract; existing mock `/api` DTOs are NOT compatible (number money, single role, embedded purchase facts). Migrate a lane end-to-end; never silently cast mock data into these DTOs. No arbitrary status PATCH or unrestricted entity JSON patch. Adapters must perform strict runtime validation; TypeScript alone is not validation. UUID IDs in examples/types are semantic aliases, not permission capabilities. Unknown command keys/fields fail, not strip silently.

Validation: `node .planning/implementation/contracts/check.mjs`; `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .planning/implementation/contracts/api.ts .planning/implementation/contracts/api-check.ts`. T03 adopts reference behavior into the existing shared utilities with real DB/security tests, rather than adding an alternate runtime money implementation now. Original b7f185a review FAILED (verifier54f910ef-a541-4ba8-8441-c509475e9ac6); seven bounded corrections and current validation are in review-handoff. T01/G0 remain unaccepted pending fresh independent re-review.
