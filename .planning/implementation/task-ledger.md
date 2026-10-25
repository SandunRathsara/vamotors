# Full-v1 implementation task ledger

Updated: 2026-10-25. Integration owner: T00 integration/ledger worker. Contract: `.planning/FULL-IMPLEMENTATION-ORCHESTRATION.md`. States: `ready → running → review → accepted`; `blocked`/`failed` always have owner and next action. **No task is accepted yet.** T00 author completion enters review; independent orchestrator acceptance is still required.

## Checkout and task identity

- Integration branch: `integration/full-v1` in `/Users/alpha/Developer/Personal/vamotors` (initial shared checkout intentionally preserved).
- Supplied/observed base: `233249f6e874796df9ee80cd58c6d40040e1f84c` on `main`.
- Original user work preservation head: `8203d2a1dbd9b98c13d3188abf53286f393d98c7`.
- T00 review head: the commit containing the final T00 ledger/evidence; resolve `git rev-parse integration/full-v1` and bind review to that full SHA (returned in worker handoff). No PR/push has been made; PR = none.
- Harness task/thread identifier: `thread:delegated-task:command%3Amcp%3Ac7da7ebe-28a5-4c15-983f-3a7a818760fd%3Adelegate-task%3A0874a083-37c4-457a-a2a6-9049ed38f896`. Native OpenCode session ID is not exposed; do not invent it. No downstream/live worker task IDs exist yet.
- Live identity confirmed: provider instance `opencode`, model `openai/gpt-6.1-sol`, no inherited option overrides. No recursive delegation. GSD unavailable; see evidence.

## Task dependency graph / acceptance ledger

The dependency column is the complete task-level graph. An edge means **accepted** prerequisite, not merely started. All not-yet-dispatched rows have no checkout/base/head/PR/reviewer/evidence; those fields must be filled in at dispatch and review, never guessed from this proposed graph. Shared checkouts are prohibited after initial T00 preservation.

| Task | Accountable owner | Accepted dependencies required | State | Checkout/base; task identity; head/PR/reviewer/evidence | Blocker and exact next action |
| --- | --- | --- | --- | --- | --- |
| T00 Baseline/traceability | Integration/ledger | None | review | Current shared checkout; supplied base above; task identity above; head resolve branch; PR none; reviewer unassigned; evidence/T00-*.md | Orchestrator assigns independent session to verify preservation hashes, all 134 mappings, checks/decisions and final SHA; do not accept own work. |
| T01 Domain/API contracts | Foundation/contract | T00 | blocked | Not dispatched; no branch/head/reviewer/evidence | T00 independent acceptance; then dispatch contracts/schema proposals for every lane, numeric bounds, lifecycle, actor, command/query/error/retry contracts. |
| T02 Hosting preparation | Infrastructure | T00; T01 for runtime details | blocked | Not dispatched | After T00, can prepare access/Free site plan concurrently with T01; defer runtime/credential/deploy decisions requiring accepted T01. |
| T03 DB/security spine | Foundation/contract | T01 | blocked | Not dispatched | Accept T01; pin backend set, isolated migration/seed, auth/permissions/audit/notifications/idempotency and negative tests. |
| T04 Parties/settings | Feature: parties | T03 | blocked | Not dispatched | Accept T03; deliver all directory/customer/settings flows and selectable persisted entities. |
| T05 Purchases/availability | Feature: inventory | T03, T04 | blocked | Not dispatched | Accept both; deliver three channels, identity/cycle, costs/mileage/listed-price/hold/release and atomic payments. |
| T06 Private documents | Feature: documents; infrastructure contributor | T03; T02 for hosted origins | blocked | Not dispatched | Accept security spine; implement authorized upload-init/complete/download; hosted CORS proof waits T02. |
| T07 Approvals | Feature: approvals | T03, T04 | blocked | Not dispatched | Accept prerequisites; implement four version-bound proposal types, separate reviewers and exactly-once decisions. |
| T08 Repair/disposal | Feature: operations | T05, T07 | blocked | Not dispatched | Accept cycle and approval contracts; deliver repair dispatch/return/payment + approved disposal. |
| T09 Immediate sales/trade-in | Feature: sales | T05, T07 | blocked | Not dispatched | Accept stock and approval work; deliver actual completion, inline customers, optional acquisition, concurrency/payment invariants. |
| T10 Reservations/lease sales | Feature: reservations/finance sales | T09, T06; T02 for scheduler | blocked | Not dispatched | Accept prerequisites; deliver tiers/three resolutions/down payment/DO/completion/later lender receipts and scheduler. |
| T11 Rates/brokerage intake | Feature: brokerage intake | T04, T06 | blocked | Not dispatched | Accept directories/files; exact versioned rates, both directions, quote handoff, guarantors/eligibility/rejections. |
| T12 Brokerage execution | Feature: brokerage execution | T11 | blocked | Not dispatched | Accept intake; deliver mutually exclusive Application/Referral, evidence/verification/batches/issues/facility recovery. |
| T13 Unified reconciliation | Feature: finance | T10, T12 | blocked | Not dispatched | Accept both source lanes; methods/entitlements/notices/remittance allocation, partials/discrepancies/overdue/Finance nav. |
| T14 Invoices | Feature: documents/invoices | T06, T09, T10 | blocked | Not dispatched | Accept completed-sale and files contracts; all sale types with immutable PDF snapshots/versions and safe retry. |
| T15 Reports/dashboard/notifications | Feature: reporting | T08, T10, T12, T13; T14 PDF infrastructure | blocked | Not dispatched | Accept authoritative facts/PDF infrastructure; seven reports/full exports/financial views/dashboard/recipient notification UI. |
| T16 Historical import | Feature: import | T08, T10, T13; stable schema | blocked | Not dispatched | Accept domain/schema; seven entity templates, CSV/Excel preview/revalidation, bounded atomic replay-safe import/provenance. |
| T17 UX/PWA/fixture removal | Feature: UX integration | Feature tasks integrated | blocked | Not dispatched | Integrate T04–T16; verify responsive/keyboard/errors/form retention/filters/cache/PWA; remove runtime fixtures. |
| T18 Release verification/recovery | Independent verifier; infrastructure contributor | T02–T17 | blocked | Not dispatched | Fresh integrated and hosted checks, exact deploy SHA, observed scheduler, isolated DB/object recovery, final dossier; never author self-acceptance. |

## Ownership and shared-file serialization

Ownership below is exclusive write responsibility, not a ban on others reading/proposing changes. Feature workers request shared edits from the owner; integration resolves reviewed conflicts and reruns affected checks. Feature ownership covers its assigned routes/components/services/tests **only**, not whole shared directories.

| Shared surface | Sole writer / rule |
| --- | --- |
| Integration branch, merges, `.planning/implementation/{task-ledger.md,requirements-matrix.md,decisions.md,HANDOFF.md,evidence/}`, release manifest | Integration/ledger. Verifier submits evidence on own branch; integration records results without upgrading verdict. T00 only initial preservation + these files. |
| Prisma schema, migration sequence, DB shared constraints, seeds/contracts affecting shared entities | Foundation/contract. Feature owners submit entity/constraint proposals before dependent implementation. Serialize schema integration; infrastructure executes deployment/migrations serially. |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, backend/client version set | Foundation/contract after T00 preservation. No feature-worker installs or lockfile edits. Existing portless/workspace user changes retained. |
| Money/state/actor/error DTOs, transaction/audit/idempotency/permissions/query primitives | Foundation/contract. Shared runtime utilities/hooks require declaration; no silent generalized redesign. |
| Netlify config/linkage, CI, environment secret names/install, runtime/migration credentials, scheduler deployment, backup/restore tooling | Infrastructure. No cloud mutations in T00; no touching old Vercel site. No preview writes to shared DB. |
| Shared file pipeline/private metadata/final keys and invoice primitives | T06 documents owner; infrastructure alone changes bucket/CORS/host settings; T14 requests primitives rather than duplicate pipeline. |
| Shared navigation/layout/providers/table/mutation hooks, PWA shell | T17 UX integration owner; T13/T15 submit Finance/notification needs, foundation coordinates auth/DTO hooks. Declare early shared-shell changes explicitly before implementing. |
| Domain routes/components/commands/queries/tests | Each dispatched feature owner for bounded assigned slice. Directories are not wholesale ownership; exact paths in brief. |
| Independent acceptance tests/security/concurrency/hosted evidence | Independent verifier, on isolated evidence/test branch if editing; never the same author session. |
| User-preserved C4/research/orchestration docs | Preserved immutable by T00; future material corrections require explicit owner/orchestrator scope, not incidental formatting. |

Current lint/style debt must be assigned by actual file ownership after T00: cash-flow query to reporting, composed-ref/shared-hook fixes coordinated with shared UI owner, repository-wide formatting policy coordinated by integration/foundation. No correction is silently included in T00 or exempted from final gates.

## Branch and review strategy

1. Independent review T00 final head; preservation commit is not itself independent acceptance. `main` remains untouched at supplied base.
2. After acceptance, orchestrator briefs T01 and independent T02 preparation with exact **accepted integration SHA**. Create isolated worktrees/branches such as `impl/t01-contracts`, `impl/t02-hosting`; never rely on parent dirty files. Use session/worktree harness binding where supported, not anonymous shell checkouts.
3. Each feature dispatch names exact owned files, every assigned requirement, accepted contracts/base SHA, meaningful UI/server/persistence/negative tests, allowed cloud environment, secret locations by name only and reviewer requirements. Default at most three independent implementation workers plus a verifier, further limited by live harness.
4. Foundation alone integrates shared-schema/dependency proposals before downstream code. Infrastructure serializes deploys/migrations; previews use isolated resources or no mutation.
5. At dispatch subdivide daily-sized slices without changing parent ownership/acceptance. First contract slices: T01a entity/cycle/money/state proposals; T01b actor/DTO/error/retry/audit contracts; T01c cross-lane contract review. First hosting slices: T02a read-only access/Free-plan/region readiness; T02b approved site/CI/secrets isolation after needed T01 contracts. These are plans, not started/accepted tasks; record separate task IDs/branches/evidence on dispatch.
6. Worker returns committed branch/PR/head and exact tests/blockers. State moves to review; fresh independent reviewer tests original scenario + denial/race cases. Integration alone brings reviewed changes forward and reruns impacted checks. Verification binds resulting integrated SHA, not premerge branch head.
7. Ordinary PRs/checks/protection only, no force pushes or bypass. Link every PR created/taken over/pushed immediately through harness; record full URL/head/checks/review. No T00 PR created; this worker does not watch PRs. Default-branch promotion only after contract gates and independent authorization, never in T00.

## Gates and current blockers

- G0 pending: T00 and T01 not accepted; model resolved and preservation/matrix authored, not independently certified. No implementation task dispatched by this worker.
- G1–G6 not reached; **0/134 accepted requirements**. No deploy URL/ID, hosted security proof, persistent workflow acceptance or restore evidence.
- Fresh baseline failures/omissions: offline install missing metadata, lint 3 errors/17 warnings, formatting 272 files, browser setup missing Chromium. See evidence/T00-checks.md. No fixes attempted.
- Readiness verifier is a separate orchestrator-owned dispatch. T00 does not claim current GitHub/cloud permissions, credential existence/least privilege, Netlify Free entitlement or region are verified.
- Exact next action: independent read-only T00 review at final returned SHA; then orchestrator acceptance and T01/T02 dispatch. No default merge before that review.
