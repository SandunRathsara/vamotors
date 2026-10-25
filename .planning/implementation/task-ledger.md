# Full-v1 implementation task ledger

Updated: 2026-10-25. Integration owner: T00 integration/ledger worker. Contract: `.planning/FULL-IMPLEMENTATION-ORCHESTRATION.md`. States: `ready → running → review → accepted`; `blocked`/`failed` always have owner and next action. **T00 accepted by orchestrator at `f51b1648bbbda5fb8e37129ba31be0683d63678f` after independent PASS and readiness reconciliation. G0 pending T01; 0/134 feature requirements accepted.**

## Current T02a integration candidate

- Integration target confirmed at `81216521917c726df1b93e52b487950a2aeb8b13` (T00 readiness PR #1 integrated). Current isolated candidate branch: `t3/integrate-t02a-neon-netlify`, checkout `/Users/alpha/.t3/worktrees/vamotors/t3-c797eb68`; retains the latest integration ledger documents.
- Reviewed source `t3/t02a-infra-neon-netlify-prep`, base `f51b1648bbbda5fb8e37129ba31be0683d63678f`, head `6b86b0c48cdb690fc79559eb69f1be3d17a33ff4`; exactly four authorized infrastructure files. Cherry-picked as `880c315`; interlock/config/diagnostic remain byte-identical. Operations report changes only label old remote-base statements historical.
- Independent verifier `c153437c-75c2-467d-a117-9c685b0556ec`: PASS all four source files, no blocking corrections. **T02a review passed pending integrated revision confirmation**; fresh verifier must check the combined PR head including these records before any merge. Orchestrator authorizes bounded T02a only, not full T02 acceptance. [Attributed report and integration evidence](evidence/T02a-review-integration.md).
- Ordinary PR targets `integration/full-v1`; URL and exact candidate head are returned with the PR (the commit containing this record). No merge, main change, bypass, force-push, watcher, installation or cloud mutation in this integration task.

## Historical T00 checkout and task identity

- Integration branch: `integration/full-v1` in `/Users/alpha/Developer/Personal/vamotors` (initial shared checkout intentionally preserved).
- Supplied/observed base: `233249f6e874796df9ee80cd58c6d40040e1f84c` on `main`.
- Original user work preservation head: `8203d2a1dbd9b98c13d3188abf53286f393d98c7`.
- Fixed accepted T00 head: `f51b1648bbbda5fb8e37129ba31be0683d63678f`. No `main`/`integration/full-v1` ref modifications authorized for this documentation task. No PR/push has been made; PR = none.
- Original T00 author harness task/thread identifier: `thread:delegated-task:command%3Amcp%3Ac7da7ebe-28a5-4c15-983f-3a7a818760fd%3Adelegate-task%3A0874a083-37c4-457a-a2a6-9049ed38f896`. Native OpenCode session ID is not exposed; do not invent it.
- Under the same command, readiness reviewer suffix `72173ee0-5850-4fac-9990-2250ee82e0cb` supplied its report; T00 acceptance reviewer suffix `427b0f2a-bbcc-4e04-ac65-63f9bdc64df3` returned PASS on fixed candidate. Orchestrator accepted T00; T01 and T02a are running as recorded below. [Attributed acceptance and execution exception](evidence/T00-acceptance-attributed.md).
- Readiness recording branch `t3/t00-readiness-ledger-handoff`, tool-created checkout `/Users/alpha/.t3/worktrees/vamotors/t3-b3ea0be0`, clean initial HEAD exactly the fixed candidate with ancestry verified. Its documentation commit is for subsequent integration only; [attributed report and exact follow-ups](evidence/T00-readiness-attributed.md).
- Live identity confirmed: provider instance `opencode`, model `openai/gpt-6.1-sol`, no inherited option overrides. No recursive delegation. GSD unavailable; see evidence.

## Task dependency graph / acceptance ledger

The dependency column is the complete task-level graph. An edge means **accepted** prerequisite, not merely started. All not-yet-dispatched rows have no checkout/base/head/PR/reviewer/evidence; those fields must be filled in at dispatch and review, never guessed from this proposed graph. Shared checkouts are prohibited after initial T00 preservation.

| Task | Accountable owner | Accepted dependencies required | State | Checkout/base; task identity; head/PR/reviewer/evidence | Blocker and exact next action |
| --- | --- | --- | --- | --- | --- |
| T00 Baseline/traceability | Integration/ledger | None | accepted | Accepted `f51b1648bbbda5fb8e37129ba31be0683d63678f`; author identity above; PR none; reviewer suffix `427b0f2a-bbcc-4e04-ac65-63f9bdc64df3` PASS; evidence/T00-acceptance-attributed.md | No T00 blockers; orchestrator accepted after readiness reconciliation. Release debt/omissions remain, no feature acceptance. |
| T01 Domain/API contracts | Foundation/contract | T00 (accepted) | running | Task/thread suffix `68e1de75-ae2d-4310-aa99-cd95764da374`, same command above; isolated accepted base f51b1648; opencode/openai/gpt-6.1-sol; path/branch/head/PR/reviewer not supplied | Await contract/schema proposals for every lane, numeric bounds, lifecycle, actor, command/query/error/retry contracts; independent review before acceptance. Do not duplicate dispatch. |
| T02 Hosting preparation | Infrastructure | T00 (accepted); T01 for runtime details | running | T02a author suffix `9c3eca5b-1f7a-47da-8320-282288cad0e8`; reviewed source and integration candidate above; evidence/T02a-review-integration.md | Parent not accepted. Safe linkage/GitHub App, restricted roles, hosted isolation, R2 and operational proof remain pending. |
| T02a Bounded preparation | Infrastructure; integration/ledger brings forward | T00 (accepted) | review | Source head `6b86b0c48cdb690fc79559eb69f1be3d17a33ff4`; independent verifier `c153437c-75c2-467d-a117-9c685b0556ec` PASS; candidate branch above; evidence/T02a-review-integration.md | Review passed pending integrated revision confirmation. Fresh verifier of combined PR head required before merge; do not equate source PASS with integrated acceptance. |
| T03 DB/security spine | Foundation/contract | T01 | blocked | Not dispatched | Accept T01; pin backend set, isolated migration/seed, auth/permissions/audit/notifications/idempotency and negative tests. With T02 establish restricted runtime versus migration role and prove chosen runtime pooled transport/transactions; libpq connectivity is not least-privilege or adapter proof. |
| T04 Parties/settings | Feature: parties | T03 | blocked | Not dispatched | Accept T03; deliver all directory/customer/settings flows and selectable persisted entities. |
| T05 Purchases/availability | Feature: inventory | T03, T04 | blocked | Not dispatched | Accept both; deliver three channels, identity/cycle, costs/mileage/listed-price/hold/release and atomic payments. |
| T06 Private documents | Feature: documents; infrastructure contributor | T03; T02 for hosted origins | blocked | Not dispatched | Accept security spine; implement authorized upload-init/complete/download. With T02 determine existing R2 credential scope; after actual origin, configure CORS or request exact dashboard action only if needed; prove privacy/object IO/isolation (HEAD400 is not proof). |
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
| T18 Release verification/recovery | Independent verifier; infrastructure contributor | T02–T17 | blocked | Not dispatched | Arrange browser binary install in authorized test environment; fresh integrated/hosted checks without browser bypass, exact deploy SHA, observed scheduler, isolated DB/object recovery, final dossier; never author self-acceptance. |

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

- G0 pending T01: T00 independently reviewed PASS and accepted by orchestrator at fixed candidate. T01/T02a dispatched by orchestrator, not this worker; live identities above.
- G1–G6 not reached; **0/134 accepted requirements**. No deploy URL/ID, hosted security proof, persistent workflow acceptance or restore evidence.
- Author baseline failures/omissions: offline install missing metadata, lint 3 errors/17 warnings, formatting 272 files at preservation, browser setup missing Chromium. Reviewer confirms typecheck/unit16/build53 pages pass, lint3/17 and formatting **278 at candidate**, including six new T00 docs; not all debt pre-existing. Frozen install/API E2E not independently reproduced. Unexpected pnpm auto-install/metadata/postinstall violated no-install brief; no tracked changes/cloud writes reported. See evidence/T00-acceptance-attributed.md; no fixes in this task.
- Earlier readiness report remains historical attributed evidence. T02a independent PASS supersedes pooled-connectivity/host-region uncertainty: direct and pooled read-only transactions pass, actual site region Ohio `us-east-2`. Earlier timeouts remain unexplained; reproduced startup-option rejection is distinct. Restricted roles, safe linkage/GitHub App, R2 CORS/privacy/object IO and browser installation remain pending. No independent-reviewer writes or installs reported.
- Governance finding: GitHub branch unprotected and rulesets `[]`; integration owner retains ordinary PRs/checks, no mandatory new protection policy approved or enacted.
- Exact next action: fresh independent verifier checks the combined T02a integration PR head and ledger updates before merge. Await original running T01 `68e1de75-ae2d-4310-aa99-cd95764da374`, no duplicate dispatch. Dependent provisioning/runtime work waits prerequisites; G0 pending T01, 0/134 accepted.
