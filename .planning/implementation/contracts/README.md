# T01 domain/API contract package — review candidate

Author: foundation owner, 2026-10-25. Base verified before edits: `f51b1648bbbda5fb8e37129ba31be0683d63678f`, clean harness-isolated branch `t3/t01-domain-api-contracts`. T00 acceptance is supplied by dispatch; stale T00 ledger status is not rewritten here. **Author work enters review, not acceptance.** No application/schema/dependency/cloud changes. These files are the proposed normative seams for T03–T16, not proof those features exist.

## Contract index

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
| [review-handoff.md](review-handoff.md) | Integration-owner update proposal, defaults, review scenarios, exact T03 prerequisites and validation scope |

## Authority and boundaries

Read in conjunction with `.planning/FULL-IMPLEMENTATION-ORCHESTRATION.md` (all 256 lines), `CLAUDE.md`, `.planning/REQUIREMENTS.md` v1, `docs/architecture/c4-model.json` decisions, T00 matrix/decisions/ledger/HANDOFF, both `docs/02-{1,2}-*specification.md` and `docs/round_1_customer_feedback.md`. Orchestration supersedes old Vercel/NestJS/RabbitMQ/offline-read/extension/general-ledger prescriptions. All approved D01–D24 defaults remain; refinements are listed in review handoff for integration to record. No feature is waived by a transport/type simplification.

Types describe the proposed `/api/v1` contract; existing mock `/api` DTOs are NOT compatible (number money, single role, embedded purchase facts). Migrate a lane end-to-end; never silently cast mock data into these DTOs. No arbitrary status PATCH or unrestricted entity JSON patch. Adapters must perform strict runtime validation; TypeScript alone is not validation. UUID IDs in examples/types are semantic aliases, not permission capabilities. Unknown command keys/fields fail, not strip silently.

Validation: `node .planning/implementation/contracts/check.mjs`; `pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .planning/implementation/contracts/api.ts`. T03 adopts reference behavior into the existing shared utilities with real DB/security tests, rather than adding an alternate runtime money implementation now.
