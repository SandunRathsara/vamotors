# VA Motors: full implementation orchestration contract

## Mission and authority

Deliver a running, authenticated **local application with every v1 feature working against real PostgreSQL and persistent synthetic data**. Completion is the local G6 gate below, not a mock demo, finished milestone, or worker's self-report. Deployment remains deferred and unaccepted.

**Superseding user instruction (2026-10-26):** “do not try to do the deployment now. I will handle the deployment later. Just focus on implementing the whole application and working locally”. [Local completion and deferred deployment mapping](implementation/local-completion.md) governs operational scope and all hosting-only subcriteria. Preserve all 134 v1 IDs, delegated implementation and fresh independent review. G0 remains accepted; G1 requires independent real local DB verification. Existing cloud evidence is historical, not a local prerequisite or cloud execution authorization.

The user explicitly approved:
- All v1 scope; v2 and out-of-scope items remain deferred.
- GPT-6.1 Sol on OpenAI for implementation and independent verification workers.
- Isolated task branches/worktrees and local commits. Pushes, PR changes and merges are paused by the current instruction (existing Vercel auto-deploy risk).
- Configurable, recorded development defaults where business documents conflict.
- Local PostgreSQL, private durable local file storage or a local compatible object service; Netlify/Neon/R2 deployment acceptance is deferred to the user.

**This document authorizes the future execution run; writing it did not start implementation.** A fresh orchestrator should begin when instructed to execute this plan.

### Orchestrator role: delegate and verify only

The orchestration agent owns task selection, dependency management, worker briefs, evidence inspection, acceptance/rejection, escalation, and concise user updates. It may read files/diffs, inspect local Git/runtime status, and assess evidence directly; cloud/CI/deploy checks are deferred.

**Every mutation is worker-owned:** application edits, tests/fixtures, local migrations/setup, dependency changes, conflict fixes, documentation/ledger updates and local commits. The orchestrator does not implement even a small fix. Delegate integration fixes to the integration owner and verification execution to a verifier. This includes writing progress records: delegate that to the integration/ledger worker. Cloud provisioning, deployment, cloud secret reads, pushes, PR changes and merges are outside current authorization.

Workers do their assigned work themselves; no recursive delegation. A reviewer must be a different agent session from the author. The orchestrator remains accountable for verifying reviewer evidence and deciding whether the gate passed.

## Start here: first dispatches

1. Read this file, `CLAUDE.md`, `.planning/REQUIREMENTS.md`, and the C4 model's decisions. Inspect the current Git status and available orchestration tools. Treat existing edits as user work.
2. Resolve the requested model through the live model catalog. Expected model is `openai/gpt-6.1-sol`; the earlier provider instance was `opencode`. Check the returned model/provider/options, rather than trusting the request. If unavailable, report the exact blocker; do not substitute a model.
3. For a new baseline, delegate **T00** to the integration/ledger worker for preservation/matrix and a read-only verifier for local readiness/model/checkout assumptions. On this resumption T00/T01/G0 are already accepted; reconcile concurrent foundation work instead of repeating them or checking cloud access.
4. Once T00 is accepted, delegate **T01 contracts**. T02 infrastructure preparation can run concurrently where it does not depend on unfinished schema/auth contracts.
5. Dispatch downstream tasks only when their declared dependencies and shared contracts are accepted. Worktree isolation starts from committed state: uncommitted parent files do not reach workers.
6. Advance through the gates below until **G6** passes. A blocker in one lane should not idle independent ready work. Resume failed/interrupted work from its last verified artifact, not from an assumed success.

**Startup done:** model resolved, baseline preserved, task ledger created, every v1 ID assigned, and first dependency-ready tasks dispatched with explicit acceptance criteria.

## Sources and scope precedence

Use these as targeted references, not as reasons to rediscover the whole application:

| Source | Use |
|---|---|
| This plan | User-approved delivery scope, host, orchestration rules, and explicit dev defaults |
| `.planning/REQUIREMENTS.md`, v1 section | Exhaustive feature acceptance catalog; assign every requirement ID |
| `docs/architecture/c4-model.json` | Target boundaries, transactions, purchase cycles, source-owned payment facts, private files and deployment intent |
| `docs/round_1_customer_feedback.md` | Brokerage, dispatch, verification and reconciliation workflow detail |
| `docs/02-1-business-requirements-specification.md`, `docs/02-2-requirements-specification.md` | Detailed business fields, transitions, constraints and invoice/import behavior |
| `.planning/research/c4-{current,business,infrastructure}-findings.md` | Audit leads and known contradictions; confirm against code |
| Actual source/configuration and fresh test output | Evidence of what currently exists, not proof of the intended requirements |

Old roadmap completion counters are not evidence. Explicit decisions below supersede stale implementation prescriptions in planning docs. For a newly discovered conflict, the contract owner records the chosen development rule and affected IDs; the verifier checks that the observable feature remains covered. Material new scope/cost or irreversible business-policy decisions go to the user.

### Explicit architecture/default decisions

- Keep the current Next.js monolith, pnpm, UI stack, Prisma/PostgreSQL, Better Auth/CASL, private file lifecycle and server-rendered PDFs. Adapt provider wiring for local operation without removing application features. Foundation owns compatible backend pins and runtime scripts; no unnecessary framework upgrade or directory rewrite.
- Netlify Free remains historical deployment intent only. Leave existing cloud resources and Vercel configuration untouched; no pushes that could trigger its auto-deploy.
- Physical vehicle identity and purchase cycles are separate. Bind repairs/costs/sales/reservations/disposal to their actual cycle. A later repurchase never rewrites earlier profit.
- Use bounded integer minor units and wide database storage. Validate input, arithmetic, rounding, aggregates and JSON conversion. Default currency LKR with two decimal places; timezone Asia/Colombo. Settings cannot reinterpret historical amounts.
- Load current activation and permissions per request initially. This is the explicit FNDN-04 implementation adjustment: immediate permission invalidation is required; session caching is unnecessary to meet it.
- Write explicit field-level audit entries through the caller's transaction. This is the explicit FNDN-07 implementation adjustment: a Prisma extension is optional, atomic audit is mandatory. Record both adjustments in the requirement matrix.
- Each business command authenticates/authorizes, validates, checks current state/revision, and commits business rows, source-owned receipts/payments, audit and required notifications atomically. Enforce retry and concurrency protection. Keep external storage/PDF IO outside database transactions.
- Preserve source-owned immutable payment facts and aggregate cash projections, as in the final C4 model. A generic ledger/double-entry accounting rewrite is outside scope. DO, invoice issuance and trade-in consideration are not cash receipts.
- Advance percentages use a snapshotted listed-price denominator. Development tiers: positive advance up to 5% = 7 days; above 5% through 10% = 14; above 10% through 15% = 21; above 15% = 31. Reject zero price/advance and test exact boundaries. Settings may change future terms; existing reservations keep snapshots.
- Expiry automatically flags and notifies; it never releases stock or refunds money. Three v1 resolutions are conversion, approved refund cancellation, retained-advance cancellation. Extensions stay v2.
- Preserve all ten required lifecycle states in the state model and historical display. Normal handover completes the sale atomically; a Delivered compatibility state is not a bypass around sale completion. Contract owner documents legal transitions and evidence for VSTS-01 and SLLS-05.
- Separate requester/reviewer for approvals; seed at least two suitable test accounts. Pending proposals have no business effect; stale proposals cannot execute. Re-check current reviewer authority.
- Finance consideration defaults to down payment + financed amount = agreed sale price. Payments are recorded independently. Trade-in value reduces monetary balance and optionally creates an acquisition with customer-as-seller; no invented supplier FK or cash purchase. Reject negative balance/overallowance pending a future policy decision.
- Rates are versioned exact synthetic cards. Unsupported combinations show an explicit unsupported result, not approximate finance quotes. Implement both input directions with supported fixtures. Snapshot rates, company processing paths, fees and commission expectations.
- Cash facility development policy: gross less itemized deductions less withheld facility fee = net paid; separately paid fees remain explicit. This resolves conflicting 'plus fee' wording for synthetic dev only. Implement disbursement and recovery fully and test it; a disabled feature does not satisfy LBRK-11.
- Commission policy is configurable and synthetic. Use explicit expected amounts or a documented basis/rounding policy, never an unexplained percentage. Default eligibility date: Application dispatch, Referral referral, vehicle lease handover. Notices/allocations span both sources; partials and discrepancies remain traceable.
- Default draft A4 invoices, synthetic dealership details and declarations, immutable numbered versions. Clearly mark dev documents/data. All invoice functionality must work despite later business wording approval.
- Show net cash movement unless an explicit opening balance exists. Historical imports use synthetic source files/control totals for development acceptance.
- Indefinite retention means no automatic deletion of business records/documents. Quotas require monitoring and an explicit stop/escalation policy, not silent pruning or paid upgrades. Disposable isolated test data is distinct from retained shared-dev business data.

## Current handoff facts: verify, do not repeat setup blindly

The application is a substantial mock-backed frontend, not a transactional backend. Real persistence/auth/permissions, lifecycle commands, file uploads, invoices, imports and complete financial behavior remain to be built. Runtime fixture imports cause split truth; remove them as features migrate.

At the audit baseline, build/typecheck and 16 unit tests passed. Lint had three errors; the API suite passed three tests only when browser setup was bypassed. Default Playwright browser installation was missing. These are historical results, not release evidence.

Historical cloud setup (retained evidence; not a current execution path):
- Netlify CLI authenticated as the user's account/team. Repository is **not linked to a Netlify project**. Plan tier, region and permissions must be checked when linking/provisioning.
- Neon project `vamotors-dev`, AWS US East 2 (Ohio), created by user. Both pooled and direct connections passed read-only transactions.
- Private R2 bucket `vamotors-dev` created by user. Bucket-scoped credentials passed a signed bucket metadata request. Object write/read, CORS and isolation are still untested.
- GitHub admin/push access was verified earlier for `SandunRathsara/vamotors`; verify current permissions/default branch before writes.
- Local secret files: `~/.config/vamotors/dev-neon.env` (`DATABASE_URL`, `DIRECT_URL`) and `~/.config/vamotors/dev-r2.env` (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET_NAME`). Files are owner-only, outside Git. Their existence and cloud access may differ on another machine.
- Current workers use local-only configuration; cloud secret files above remain unopened. Never print credentials, connection URLs, signed URLs or tokens. Keep private local credentials outside Git/artifacts; use private handoff, not chat passwords.
- The direct database credential may be an owner role. Foundation/infrastructure workers establish restricted runtime access and migration ownership; current connectivity does not prove least privilege.
- Netlify and Neon resource management beyond these credentials is unverified. R2 object credentials do not imply bucket/CORS management permission. Ask for scoped authorization or exact dashboard action only if needed.

At plan creation there were existing modifications to `.gitignore`, `package.json`, `pnpm-lock.yaml`, plus untracked `pnpm-workspace.yaml`, C4 research files and `docs/architecture/`. Preserve and inspect them. Do not reset, clean, force-push or blindly stage the checkout. T00 must resolve how to carry relevant baseline changes into committed worker branches without losing user work.

## Worker organization and shared-file ownership

Use short, bounded tasks with explicit deliverables, not seven agents each asked to 'finish their area'. A feature owner delivers its schema proposals, commands, HTTP/UI integration and tests end to end; verification is independent.

| Role | Owns | Coordination rule |
|---|---|---|
| Integration/ledger worker | Integration branch, PR integration, task ledger, requirement matrix, conflict resolution, release manifest | Sole merge writer; records decisions requested by orchestrator |
| Foundation/contract worker | Prisma schema/migration order, shared money/state/actor/error contracts, transaction/audit primitives, package manifests | Sole shared-schema/dependency writer; incorporates feature proposals before dependent implementation |
| Foundation/local-runtime worker | Code, packages, local PostgreSQL/runtime configuration, local scheduler and backup/restore tooling | Sole writer for these active runtime surfaces; coordinate via parent; cloud work deferred |
| Feature workers | Assigned feature routes/components/services/tests | Touch only declared ownership; request shared changes from owner |
| Independent verifier | Acceptance scenarios, negative/security/concurrency testing, evidence and review findings | Own test/evidence branch if editing; never accepts based solely on author test claims |

Use bounded parallelism (default three active implementation workers plus a verifier if the live harness permits). Never exceed tool/provider concurrency restrictions. Shared-schema changes and deploys are serialized. Run only independent ready tasks concurrently. Same-model workers still require distinct task identities and reviewer sessions; follow the live delegation tool's model/session constraints.

Worktrees branch from the exact parent-approved checkpoint; distinguish carried unaccepted source from accepted work. Include base SHA in each brief. Return a local commit and head SHA, without push/PR/merge. The integration worker brings changes forward locally when authorized and reruns affected checks. Verification binds to the resulting integrated SHA; earlier branch checks do not certify a changed result.

Historical autonomous merge permission is paused. Keep default/integration remote refs unchanged; no PR changes, pushes or merges during local implementation. Use supported worker completion notifications rather than polling loops. Future deployment/promotion needs the user's later authorization.

## Task graph and acceptance packages

Dependencies refer to accepted contracts/work, not simply 'agent started'. Subdivide large packages into daily-sized vertical slices in the ledger, preserving parent acceptance and a single owner per requirement.

| ID | Task / owner | Dependencies | Deliverable and acceptance |
|---|---|---|---|
| T00 | Baseline and traceability / integration | None | Preserved committed baseline, current checks, exhaustive v1 matrix, ownership map, branch strategy, evidence paths; no credential files tracked |
| T01 | Domain/API contracts / foundation | T00 | Reviewed entity/cycle relations, money bounds/rounding, lifecycle transitions, command/query DTOs, actor/permissions, error/retry contract, policy defaults; schema proposals cover every feature lane |
| T02 | Local operational preparation / foundation-local runtime | T00; T01 for runtime details | Repeatable local PostgreSQL and app setup, isolated test/recovery destinations, separate runtime/migration secrets, private durable file root/service, local scheduler and backup/run instructions. No cloud/linkage prerequisite; deferred deployment subcriteria tracked separately. |
| T03 | Database/security spine / foundation | T01 | Version-pinned client/adapter, migrations/constraints, deterministic seed, Better Auth, CASL multirole record/field checks, admin bootstrap, audit/notifications transaction primitives, idempotency; tests prove rollback, denied access and immediate revocation |
| T04 | Parties/settings / feature | T03 | Full suppliers/vendors/finance companies/customers, active/archive behavior, contacts, inline creation/search, runtime settings validation and history-preserving policy snapshots; new entities selectable everywhere |
| T05 | Purchases and availability / feature | T03,T04 | Three purchase types, settlement breakdown, physical identity/re-purchase, costs/mileage/listed price, reasoned edits, receipt/hold/release; atomic purchase/payment/audit and cross-browser persistence |
| T06 | Private documents / feature + foundation-local runtime | T03; T02 local storage/origin readiness | Authorized upload-init/complete/download against private durable local storage or local compatible object service; staging/final isolation, byte verification, immutable evidence, orphan handling and actual denial/IO/restart tests. Cloud R2/CORS acceptance deferred, functionality retained. |
| T07 | Approvals / feature | T03,T04 | Four proposal types with version-bound payloads, authority checks, separate requester/reviewer, approve/reject exactly once; domain effects applied by owner commands, not arbitrary patches |
| T08 | Repair/disposal / feature | T05,T07 | Dispatch/return/invoice dates/actual payments, held availability after return, cycle cost projection, approved write-off with zero/positive proceeds; complete UI/history and audit |
| T09 | Immediate sales and trade-in / feature | T05,T07 | Cash/transfer/handover, customer flow, optional reference, discounted pending sale, trade-in descriptive or inventory intake, source payments, concurrency and receipt invariants |
| T10 | Reservations and lease sales / feature | T09,T06; T02 local scheduler readiness | Tiered placement, warning/expiry, three resolutions, partial refunds, conversion balance, mandatory down payment, DO receipt/handover and independent finance receipts; observe real local scheduled idempotent invocation and authorized manual catch-up, including missed/failed runs. |
| T11 | Rates and brokerage intake / feature | T04,T06 | Versioned sheets/cards, both comparison inputs, maxima, quote handoff/charges, customer/guarantors/eligibility with contacts, rejection filtering; no automatic owned-inventory acquisition |
| T12 | Brokerage execution / feature | T11 | Application inspection/photos/loan adjustments/document verification/fees/file references/batched dispatch; separate Referral flow; blockers/inquiries/non-remittance; cash facility disbursement/recovery; end-to-end UI |
| T13 | Unified reconciliation / feature | T10,T12 | Company methods, entitlements from both sources, notices/remittances/allocations, partials/overpayments/discrepancy resolutions, reproducible overdue cutoff, Finance navigation; money counted once |
| T14 | Invoices / feature | T06,T09,T10 | Printable sale PDFs with full fields/declarations/signatures, immutable snapshots and retained versions, safe retry/regeneration after sale edits; all sale types supported |
| T15 | Reports/dashboard/notification UI / feature | T08,T10,T12,T13; T14 PDF infrastructure | All seven required reports, full filtered CSV/PDF exports, consistent financial breakdown/cash history, dashboard dates and metrics, recipient-specific notification read/link behavior; authoritative queries only |
| T16 | Historical import / feature | T08,T10,T13; stable schema | CSV/Excel templates, all seven primary record types, row errors/preview/revalidation, bounded all-or-nothing commits, repeat protection and provenance; synthetic historical reconciliation |
| T17 | UX/PWA and fixture removal / feature | Feature tasks integrated | 360–1920px keyboard/mobile flows, validation and retained failed forms, filters/pagination/cache refresh, real loading/error/conflict states, installable manifest/service worker without sensitive caching; no runtime fixture reads |
| T18 | Local completion verification and recovery / independent verifier + foundation-local runtime | T02–T17 local acceptance, excluding deferred deployment subcriteria | Fresh final-SHA real-DB/API/multi-browser/end-to-end/security/financial tests, actual local scheduler execution/manual catch-up, restart durability, isolated DB+file restore rehearsal and runnable handoff; separate deferred deployment dossier. |

T02 preparation is not feature acceptance. Early usable local G2 requires T03–T05 and the local security portion of T02; later features still require their complete acceptance packages.

### Requirement ownership: coverage seed for T00

Every individual ID must become its own matrix row. Ranges below are task ownership, not permission to omit details.

| Requirement IDs | Accountable task |
|---|---|
| FNDN-01–08 | T03 (T01 contracts; T00 baseline) |
| FNDN-09 | T17 |
| VPRC-01–09, VSTS-01–04 | T05 (T08–T10 contribute transitions) |
| TPRT-01–08, CUST-01–04 | T04 (T09 integrates sale inline creation/history) |
| REPR-01–05, WROF-01–03 | T08 |
| SLGN-01–03, SLCS-01–02, SLTI-01–03 | T09 (T10 supplies in-progress next steps) |
| SLAD-01–06, SLLS-01–05 | T10 |
| USER-01–05, AUDT-01–04 | T03 (all feature commands must participate) |
| APRV-01–05 | T07 (T08–T10 supply domain actions) |
| INVC-01–03 | T14 |
| NOTF-01–04, REPT-01–08, FINT-01–04, DASH-01–02 | T15 (domain tasks supply facts/events) |
| LBRK-01–08, LBRK-10 | T11 |
| LBRK-09, LBRK-11–24 | T12 |
| RCNL-01–05 | T13 |
| IMPT-01–05 | T16 |
| NFNL-01–02 | T17 |
| NFNL-03–04 | T02 (T18 verifies local transport boundary, retention and recovery; hosted TLS deferred explicitly) |

## Gates: evidence before progress

### G0 — Ready to implement
T00/T01 accepted. Every v1 ID has an owner and planned acceptance scenario; explicit deviations/defaults recorded. Integration and worker checkouts share a known committed baseline. Secret access is scoped and model selection verified.

### G1 — Transactional LOCAL foundation (not yet accepted)
Fresh independent verification against real isolated local PostgreSQL is required; source/unit PASS alone is insufficient. Database installs from committed migrations and deterministic seed. Real sessions/multiple roles work; public signup disabled; last admin protected. Unauthorized API/RSC access and forbidden fields are denied. Permission removal is effective next request. A forced essential-write failure rolls back business and audit. Restricted application role cannot update/delete audit; runtime/migration/bootstrap secrets remain separate. No cloud-provider or global PG lockdown prerequisite is added.

### G2 — Early running dev
A loopback local URL runs the verified SHA with real PostgreSQL login/sessions and persistent synthetic purchases. Two independent browser contexts/accounts see the same authorized purchase; app and database/storage process restarts preserve rows, sessions as intended, and private files. Runtime and migration credentials are separated; normal runtime has no test-reset capability. User receives private local login handoff, never a public default password. Hosted HTTPS is deferred, not passed. This is an intermediate milestone, not completion.

**Current gate/acceptance status:** [literal LOCAL G2 remains accepted/pinned EXACTd0/http://127.0.0.1:8000/login](implementation/evidence/G2-d0-literal-acceptance-attributed.md), original G2 heading/criterion paragraph above unchanged. Parent [ACCEPTS bounded T05c.2+combined EXACT236, CLOSES FC-UI-C01/P2 and separately accepts complete ORIGINAL VPRC-02 LOCAL236](implementation/evidence/T05c2-2360cbb-acceptance-attributed.md). Effective **27 LOCAL/107 U/134**, only VPRC-02 result/header count changed, all other133/old26 bindings unchanged/VSTS-03 U. Actual primary FF-only236 clean, its historical26 matrix preserved; later effective27 acceptance records not promoted/human runtime not advanced. **G3 next/G3–G6 pending**, not wholeT05/G3/v1/restore/device/hosted acceptance. [Current HANDOFF](implementation/HANDOFF.md) owns WRITE_OFF same-task accepted236 reconciliation steering; separate fixture dispatch pending, no outcome inferred.

### G3 — Core dealership workflows
T04–T10 and T14 accepted end to end. Verify: three purchase channels; repurchase history; repair dispatch/return; availability; four sale types; advance expiry/resolution; four approval types; write-off; audit and invoice versions. UI and direct HTTP share the same authoritative rules.

### G4 — Brokerage and finance
T11–T13 accepted with both mutually exclusive paths, real evidence attachments, verification including no-issue outcomes, dispatch batches, cash facility recovery and mixed-source reconciliation. Neither dummy buttons nor hardcoded timelines pass.

### G5 — Complete v1 surface
T15–T17 accepted; every requirement has implementation evidence and passing tests. Seven correct reports, complete filtered exports, historical import and PWA work. Runtime fixture imports are removed or demonstrably test-only. Navigation, role visibility and cross-view consistency are verified.

### G6 — Final LOCAL completion gate (all local conditions required)

The orchestrator may say **local v1 complete; deployment deferred** only when a fresh independent verifier confirms the final integrated SHA:

1. **Coverage:** all 134 IDs have accepted local criteria, code locations, executed scenarios/results, reviewer and verified commit. Hosting-only subcriteria are separately marked DEFERRED DEPLOYMENT per the mapping, never accepted by local evidence. No TODO/placeholder/mock-only substitution, disabled required action or silently waived application functionality remains.
2. **Integrated checks:** install from lockfile, typecheck, lint with zero errors, formatting gate, unit tests, real-DB API tests, full authenticated multi-browser end-to-end journeys and production build pass against the final integrated SHA. Exercise distinct supported browser engines as well as independent account/context sessions; record engines/versions/results, not just repeated tabs. Warnings are triaged. No browser-setup bypass is used for release proof.
3. **Local runtime acceptance:** the documented local URL serves that SHA with real PostgreSQL/auth, multiple accounts/browser contexts and durable private files. All v1 journeys pass locally; unauthorized API/RSC/export/file reads fail. Restart app, PostgreSQL and storage processes using retained volumes/root; compare rows, audit, hashes and immutable invoice versions. No in-memory/file-JSON database substitute or temporary/public upload directory passes.
4. **Finance and race tests:** purchase-cycle profit, refunds, trade-in, delayed lender payment, partial commission settlement, concurrent completion, stale approvals and idempotent retries produce correct durable outcomes.
5. **Operational proof:** observe a real local timer/scheduler invoking expiry (configuration or manual-only invocation is insufficient), persisted JobRun evidence and authorized manual catch-up after missed/partial/failed runs without duplicate effects. Logs expose failures without secrets; local capacity stop/escalation is tested. Backup and restore real PostgreSQL plus referenced file bytes/hashes into a separate isolated DB and private root/service namespace; verify restored authorized reads and financial totals without overwriting source. This is synthetic local recovery, not production DR.
6. **Usability:** 360px and 1920px flows plus keyboard navigation pass; PWA installation/relaunch is verified on a supported browser/device. Human-only checks are explicitly requested and evidenced, not guessed.
7. **Handoff:** local URL, exact verified SHA, prerequisites and reproducible setup/start/stop/restart/test/scheduler/catch-up/backup/isolated-restore instructions, private admin access, synthetic-data notice and evidence index are delivered. Account for every worker change. No default-branch merge, deployment URL/ID or cloud acceptance is required or claimed; deliver the deferred deployment checklist for the user's later work.

Real lender rates, approved legal invoice wording, real historical records, production recovery ownership and operational launch approval remain a **separate live-launch checklist**. Synthetic substitutes must exercise the full functionality; they cannot remove dev features. Costs beyond approved free allowances require user approval. Quota exhaustion is a blocker to a running final environment, not a passing caveat.

## Minimum cross-cutting acceptance scenarios

Amounts below are illustrative major units; test helpers convert to exact minor units.

- Buy 100, repair 10, sell 140; repurchase same identity 120, repair 5, sell 150: one vehicle, two cycles, profits 30 and 25 permanently.
- Purchase 100 + repair 10 + extra cost 5: 115 in all views/reports; asking-price edits do not change cost. Zero mileage persists; omitted optional VIN/CR is valid.
- Advance 100 then balance 900: receipts total 1,000. Refund 60 leaves dated +100 and -60. Retained cancellation keeps receipt history and requires explicit disposition before release.
- Advance-tier exact boundaries, month/year/timezone boundaries, repeated expiry, expiry-versus-sale races, unresolved expired stock and notification deduplication.
- Sale 1,500 with trade-in 500: monetary receipt 1,000; optional acquired-cycle basis 500; retry creates neither duplicate acquisition nor invented cash outflow.
- DO receipt produces no lender payment. Handover produces one completed sale; later lender receipt has its actual date. Unpaid repair invoices affect cost, not cash.
- Two concurrent buyers produce one completion. Repeated request returns one result. Changed/stale approval cannot apply. Unauthorized direct calls cannot bypass UI restrictions. Audit failure rolls back all essential writes.
- Roles combine grants; revoked/deactivated staff lose access; hidden financial fields never reach browser JSON/exports. Final-admin concurrent changes cannot eliminate all administrators.
- Signed upload permissions are record-bound; invalid type/size fails; staging reuse cannot overwrite final evidence; unauthorized reads fail; regenerated invoice retains prior bytes/version.
- Exact rates both directions, over-limit/expired/unsupported quote behavior, at least one guarantor, rejected eligibility blocks progression, Application/Referral commands cannot cross paths.
- All nine inspection-photo categories, conditional document applicability, clean/problem verification with contact/time, incomplete dispatch rejection and atomic batch/deal transition.
- One remittance allocates across sale lease and brokerage once; partial/outstanding/overpayment remain visible; overdue tests cover two-day boundary and last-reconciled sent-date rule.
- Reports filter correct populations and export the full filtered dataset across pages; cash dates differ correctly from completion/invoice dates. Dashboard excludes future/cancelled sales and separates years.
- Equivalent CSV/Excel imports match; one invalid row prevents whole batch; duplicate confirmation is idempotent; imported identity/cycle links/provenance and control totals reconcile.
- Local app/DB/storage restart preserves records/private bytes and prior invoice versions; normal local runtime reset is unavailable; isolated DB+file restore cannot overwrite source. Hosted redeploy proof remains deferred.

## Dispatch and verification protocol

Every delegation brief includes:

```text
Task ID and bounded objective:
Model: GPT-6.1 Sol / OpenAI (resolved live ID)
Base branch/SHA and worktree:
Prerequisites accepted, contracts and exact reference paths:
Owned files/modules; shared owners to request changes from:
Requirement IDs and development decisions:
Required UI + server + persistence behavior:
Acceptance scenarios, negative cases and commands to run:
Allowed local actions and isolated environment (cloud actions: none):
Secret locations by name only; no values in output:
Return: local branch/head SHA (no push/PR/merge), files, migrations, test evidence, requirement results,
       unresolved findings, integration instructions and next dependency needs.
No recursive delegation. No scope reduction. Report blockers precisely.
```

Worker completion enters `review`, not `accepted`. Delegate a fresh independent verifier with the original requirements, diff/base SHA, prior findings and worker evidence. Verifier runs meaningful checks on the relevant environment, traces UI→API→command→database behavior, and reports pass/fail per criterion. Accept only the integrated revision. A passing test that mocks the invariant being claimed is not evidence.

On failure, delegate a bounded correction with the exact reproduction. Verify the changed behavior and relevant regression set. After repeated failures, request a focused diagnostic worker rather than re-running the same unbounded task. The orchestrator never repairs the code itself.

## Durable progress and resumption

T00 creates and the integration worker maintains:
- `.planning/implementation/task-ledger.md`: task/subtask ID, owner, dependency, state, live task/session ID, checkout/base SHA, PR/head SHA, reviewer, evidence path, blockers and next action.
- `.planning/implementation/requirements-matrix.md`: one row per v1 ID, owner, source rule, explicit adjustment/default if any, implementation location, acceptance test, verification result and accepted SHA.
- `.planning/implementation/decisions.md`: dated decisions, rationale, affected IDs and live-launch questions. Record actual region, free-plan behavior and finalized business defaults.
- `.planning/implementation/evidence/`: redacted local check/recovery evidence and historical hosted records, indexed by task and commit. Do not commit credentials, auth browser states, signed URLs or secret-bearing traces.
- `.planning/implementation/HANDOFF.md`: current local gate, local URL/SHA, active work, next ready tasks, resume/runbook links and deferred deployment status (never invented deploy URL/ID).

Allowed task states: `ready → running → review → accepted`; `blocked` or `failed` requires a reason, owner and next action. Claim requirement completion only after acceptance. Update records after each accepted/rejected task and deployment, and before stopping for a blocker or context limit. The orchestrator delegates these updates.

On resumption: read HANDOFF + ledger + matrix + local-completion mapping, inspect local Git/runtime status, reconcile active task notifications and artifacts, and continue the earliest ready dependency. Cloud history is reference only; no cloud/secret checks. Do not launch duplicate work for a live task. Follow harness completion/wait semantics; no polling loops. Partial artifacts require verification before reuse.

## Escalation and stop rules

Ask only when a decision/access boundary is real: unavailable requested model, missing account permission, required billing upgrade, destructive changes to existing user data, or a business contradiction without a safe synthetic default. Give one concrete action/question and keep independent work moving.

If local completion is blocked, report **blocked**, the exact local gate, evidence, coverage and next action. Do not redefine 'all features' or declare a mock demo complete. When local G6 passes, report **local v1 complete; deployment deferred**, local URL/SHA and evidence summary; hosted acceptance remains unpassed for the user's later work.
