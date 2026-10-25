# C4 infrastructure findings — VA Motors

Verified: 2026-10-25. Scope: research for the architecture model, not an implementation or an approved change of stack/budget. No application code changed; no further delegation. Read `CLAUDE.md`, project/research/specification documents, package/config files, and representative implementation paths. Existing package/lock/workspace changes were left untouched.

## Read this first

1. **Production hosting is blocked by a policy/budget conflict.** Vercel Hobby is non-commercial only. This dealership operations application is commercial even if internal and used by one person. The documented “Vercel Hobby + $0 production” combination cannot be represented as viable without explicit provider permission or a changed hosting/budget decision. [S1, S2]
2. **The implementation is a mock-backed Next.js application, not the researched backend.** Real authentication, database transactions, audit persistence, R2 storage, and PDF generation remain target capabilities.
3. **Keep the monolith.** One Next.js deploy, one PostgreSQL database, private R2 storage, and a small operational backup procedure suffice. No bank integrations, message broker, queue, worker service, or microservice is justified by this research.
4. **Make one server-only authorization/domain seam authoritative for HTTP and RSC.** Commit business changes and audit entries together. Direct RSC calls must not bypass authorization.
5. **Integer money does not mean PostgreSQL `integer`.** A signed 32-bit cents column tops out at 21,474,836.47 major currency units. Use an explicitly bounded, wider integer design before creating the production schema.

## Status vocabulary and repository evidence

Use these labels separately in the eventual HTML/C4 model; recommendations are not existing components or accepted ADRs.

| Label | Evidence and meaning |
| --- | --- |
| **Implemented** | Next.js `16.1.7`, React `19.2.5`, TanStack Query/Table/Form, Zod 3: `package.json:20-50`. This supersedes research's description of Next.js 15 as the installed version; it does not authorize upgrades. |
| **Implemented** | HTTP Route Handlers exist, but vehicle GET/POST use an in-memory store with type assertions rather than real session/authz/runtime input parsing: `app/api/vehicles/route.ts:1-43`; arbitrary PATCH merges into the same store: `app/api/vehicles/[id]/route.ts:21-33`. Sale POST only inserts a mock sale, not a transactional lifecycle operation: `app/api/sales/route.ts:52-67`. |
| **Implemented** | `MockStore` owns a `Map` initialized from fixtures and mutates it in process: `lib/mock-store.ts:32-72,149-164`. It is neither durable nor shared consistently across serverless instances. A module singleton is not a production database. |
| **Implemented** | Login navigates to `/dashboard`, without credential verification: `app/login/page.tsx:11-17`. File upload UI simulates progress and creates local blob previews: `components/shared/file-dropzone.tsx:64-111`. Neither proves external integration. |
| **Implemented** | Browser API reads through TanStack hooks: `hooks/use-entity-query.ts:9-31,39-58`. Query clients are separate server/browser instances: `components/layout/providers.tsx:7-28`. This is not proof that RSC domain-service hydration is implemented. |
| **Implemented** | Money helpers use cents and JS `number`, with `Number.isInteger`, not safe-range validation: `lib/money.ts:11-28,31-63`. Currency scale is fixed at two decimals in these helpers. |
| **Documented target** | Whole dealership lifecycle, role permissions, approvals, audits, reports and brokerage: `.planning/PROJECT.md:19-44`. Primary cashier, occasional managers/sales people: `.planning/PROJECT.md:62-70`; the older infra doc's “single-user” is not a reason to remove authorization. |
| **Documented target** | One dealership; no external banks/accounting integrations; credentials-only; single configured currency: `.planning/PROJECT.md:46-58`. Bank/finance companies in business data are counterparties, not connected APIs. |
| **Documented target / constraint** | $0, fixed service shortlist, monolithic Next.js, no NestJS/RabbitMQ: `.planning/PROJECT.md:73-81`; `docs/03-tech-and-infra-stack.md:12-29`. Key decisions are explicitly marked pending: `.planning/PROJECT.md:83-94`. |
| **Documented target** | Prisma/Neon, Better Auth/CASL, R2 presigning, PDF service, RSC direct service calls: `.planning/research/ARCHITECTURE.md:65-78,400-434,591-608`. They are not installed backend integrations in `package.json:20-74`. |
| **Configuration evidence** | `next.config.mjs:1-8` only configures Turbopack root. No `vercel.json`, Prisma schema/config, middleware or proxy file was found in the repository search. No deployment account, production region, Fluid setting, secret, bucket policy, database version or quota was inspected. `.planning/config.json:9-32` describes planning automation, not runtime infrastructure. |

## 1. Hosting: terms first, capacity second

### Verified provider facts

- Vercel's Hobby page explicitly restricts it to **non-commercial personal use**. Fair-use policy says **all commercial usage requires Pro or Enterprise**, and defines commercial use broadly around financial gain of anyone involved, including paid employees/consultants. Internal operations and lack of online payment do not establish an exemption. [S1, S2]
- Current Vercel Fluid-compute function limits are **300 seconds default/maximum on Hobby**, not the repo's universal 10-second ceiling. The limits page conditions these values on Fluid compute, enabled by default for new projects. The actual deployment configuration remains unverified; do not apply this number blindly to a legacy project. Node runtime supports the full Node API. [S3]
- The function request/response payload ceiling remains **4.5 MB**. Direct browser-to-R2 transfers remain useful independent of duration changes. Do not assume large PDF/CSV buffers are exempt. [S3]
- Vercel cron currently supports **100 jobs/project** on each plan. Hobby jobs may run at most once daily, with a within-hour window rather than exact-time scheduling. These capabilities do not override commercial-use restrictions. [S4]

### Repository corrections and minimal recommendation

**Documented target:** `docs/03-tech-and-infra-stack.md:45-53`, `.planning/PROJECT.md:75-79`, `.planning/research/STACK.md:372-380`, and `.planning/research/PITFALLS.md:59-77,136-152` rely on stale 10-second assumptions. Research statements that a 30-second PDF function necessarily requires Pro are not a current general rule (`ARCHITECTURE.md:523-528`). PDF timings and row-count runways in these documents are estimates, not measured app properties.

**New recommendation:** retain one Node-capable Next.js deployment, colocated as closely as available with Neon; keep ordinary requests short and measure cold-start PDF/import/report workloads. No queue follows from an obsolete timeout claim. Generate small invoices synchronously after fetching data, outside database transactions.

**Decision required, not silently approved:**

- If retaining Vercel for dealership production, obtain approval for an eligible commercial plan (or explicit provider exception). This violates the currently specified $0 constraint unless an exception makes it free; no paid upgrade was authorized here.
- If $0 is absolute, mark production host **unresolved** and validate one commercially eligible Node/Next.js hosting arrangement separately. An already-owned machine might avoid a new hosting invoice, but availability, TLS, power, security, backups and operating effort are real constraints, not “free managed hosting.” No alternate provider is certified by this research.
- Continue locally with synthetic data while blocked. Do not label a business demo/preview as automatically Hobby-eligible: paid development itself may fall within the commercial definition. Ask Vercel when uncertain.

## 2. Neon: durable storage is not durable recovery

### Verified provider facts

- Current Neon plan documentation reports **1 GB PostgreSQL storage/project** (20 GB account total), **100 CU-hours/project/month**, **5 GB public transfer/project/month**, and mandatory suspension after five idle minutes on Free. This differs from the repo's older 0.5 GB assumption. Recheck the actual account entitlement before deployment. [S5]
- Scale-to-zero suspends compute, not the database's durable storage. A query reactivates compute. The plan FAQ explicitly says exceeding free quotas does not delete data; compute/network exhaustion can suspend service, and storage exhaustion makes growth operations fail. Persistence therefore does not imply uninterrupted availability. [S5, S6]
- The Free history window is **six hours**, subject to a change-history cap. Free has no uptime SLA. The plan page currently permits one manual snapshot and says automated snapshot schedules are paid; its table/body presentation of instant restore is not perfectly consistent, so rely on the detailed six-hour description and verify the console. Do not promise an unlimited free backup system or assume a snapshot is costless merely because creation is permitted. [S5]
- `pg_dump`/`pg_restore` are supported for independent exports/restores. Neon specifically requires **direct/unpooled** connections for these operations. Exports are not copies of R2 objects. [S7]
- Neon driver **HTTP supports one-shot queries and non-interactive transactions**; WebSocket `Pool`/`Client` supports interactive multi-step transactions. The Prisma Neon adapter uses **WebSockets**, not the bare `neon()` HTTP query function. [S8, S9]

### What changes for this application

**Correction:** `.planning/research/ARCHITECTURE.md:595`, `.planning/research/PITFALLS.md:67-72`, and `docs/03-tech-and-infra-stack.md:94-98` conflate HTTP transport with the Prisma adapter. HTTP transaction support does not mean arbitrary callback transactions over HTTP. Nor does a transport choice make PostgreSQL transactional integrity unavailable.

**New recommendation:** retain Prisma and Neon; select and pin a supported Prisma/client/adapter release set when backend work begins. Use pooled application connectivity and direct operational/migration/backup connectivity. Reuse a client/pool per worker as appropriate, but do not describe it as one global connection across the whole deployment. Test a dependent read/validate/write/audit transaction against the chosen adapter, including rollback and concurrent conflicts.

Current Neon Prisma guidance targets Prisma 7 and warns about an unpinned prerelease CLI; Context7's general Prisma corpus also surfaces newer ORM 8 syntax. The repository only documents Prisma 6 and installs none. **Do not copy current snippets into a supposedly pinned Prisma 6 implementation or treat this research as an ORM migration.** Exact construction, pool knobs, transaction options and runtime minimums need version-specific verification once selected. [S9, S14]

Free capacity is conditional, not “enough for 50K records.” Audit JSON, indexes, retained invoice metadata, branches, query transfer and backups matter. Keep notification polling only while the app is active, stop on hidden tabs where practical, and avoid synthetic keep-alive pings: regular polling can prevent idle suspension. Indefinite business retention (`.planning/PROJECT.md:70`) cannot have guaranteed indefinite runway in a bounded free tier.

## 3. Private R2 files: both directions require policy

### Verified provider facts

- Presigned URLs permit a specific operation on one key and are reusable bearer capabilities until expiry; supported expiry is 1 second–7 days. They support GET/HEAD/PUT/DELETE, not HTML-form POST. S3 API domains, not custom public domains, are the presigning target. [S10]
- Signed `Content-Type` is **supported and recommended**; the browser must send the matching header. Bucket CORS is needed for cross-origin browser fetches. Cloudflare documents dashboard configuration for this too. CORS is browser behavior, not authorization against a non-browser caller. [S10, S11]
- R2 Standard has a free monthly allowance of **10 GB-month storage, 1 million Class A operations, 10 million Class B operations**, and free direct egress. Excess usage is billable. Infrequent Access is not included in that free tier. “R2 free” is an allowance, not a universal $0 hard cap. [S12]

**Corrections:** the Content-Type/CORS advice in `.planning/research/PITFALLS.md:231-236` contradicts current official documentation. `.planning/research/STACK.md:359-364` proposes an optional public URL; it must not become a document-download policy. Existing upload examples authenticate only, accept client filenames/keys too freely, and do not verify completion (`ARCHITECTURE.md:320-348,420-434`).

**New recommendation — smallest complete file boundary:**

1. Keep the bucket private; no `r2.dev` public access/custom public read domain for this internal app. Server-only bucket-scoped credentials never reach the browser.
2. An authenticated, authorized upload-init operation checks the target business record, file purpose/type/size declaration, and generates an opaque staging key plus a short-lived PUT URL (five minutes is a proposed policy, not an R2 limit). Record a pending upload owned by the actor/record. Do not accept arbitrary existing object keys as attachments.
3. Browser PUT sends bytes directly to R2 with matching signed headers. CORS allows only intended production/local test origins, methods and headers. Preview origins require a deliberate policy, not a wildcard carrying production access.
4. Completion rechecks session, record permission, pending ownership and R2 object metadata/size, with bounded content inspection where required. A MIME header alone does not prove PDF/image content, and client-side size checks are not enforcement. Presigning by itself must not be presented as a hard file-size cap.
5. Avoid overwrite races from reusable PUT URLs: copy a validated staging object to a fresh server-written final key, validate the resulting object, then transactionally link immutable final metadata to the business record and audit it. Never give clients PUT capability to committed final keys. R2 and PostgreSQL cannot share one transaction; failures leave unreferenced objects for bounded/manual reconciliation, not a fictional distributed atomic commit.
6. Every download request resolves an attachment through its business record and checks read permission before minting a short-lived GET URL. Return private/no-store application responses; do not log signed query strings. Once minted, the bearer URL remains usable until expiry even if the user's role is revoked. This is an explicit short-lived capability trade-off.
7. Keep orphan cleanup small/manual initially; no queue required. Unreferenced staging cleanup is different from deleting retained business documents. Store only final key, size, type, checksum/version metadata in PostgreSQL, not the signed URL.

Invoice versions must also be retained: `docs/02-2-requirements-specification.md:888-892` requires generated PDFs to be immutable and regenerated versions retained. Rendering a transient buffer alone (`ARCHITECTURE.md:448-465`) is incomplete for that requirement. Store a uniquely keyed PDF version in private R2 and its issuance metadata/audit link in PostgreSQL; allow download/retry without rerunning the sale transaction. Failed storage/linking must not falsely mark an invoice issued.

## 4. Authorization + transaction + audit seam

### Why a route-only guard is insufficient

Next.js official guidance puts security checks close to the data source in a server-only DAL and requires independent protection for Route Handlers, Server Actions and data reads. Layout/proxy checks and hidden UI are not a reliable security boundary. Return minimized DTOs rather than raw database records to clients. [S13]

The earlier research simultaneously guards API routes and permits RSC direct service reads (`ARCHITECTURE.md:204-208,400-418,599-607`). Without authorization inside the callable boundary, that direct path bypasses the guard. The existing prototype provides no real guard at all (`app/api/vehicles/route.ts:6-43`, `app/login/page.tsx:14-17`). Do not put production personal/financial data into it yet.

### New recommendation: explicit, in-process boundary

- **Entrypoints:** Route Handlers parse HTTP and return status codes; RSC calls server-only authorized read functions directly. Any future Server Action calls the same authorized functions. No RSC-to-own-API HTTP hop is required.
- **Identity/policy:** trusted server-side session resolution builds an actor context, including active-user status and current DB permissions. Never accept actor/ability/approval authority from request JSON. Each public service/read operation checks action, actual record conditions and permitted fields; collection queries scope results before pagination, and DTOs remove financial/private fields the actor cannot view. Exports, invoices, file presigning and audit views need the same boundary.
- **Freshness:** initially load current permissions once per request and memoize only within that request. This deliberately resolves contradictory advice: `ARCHITECTURE.md:254-260` prefers per-request reads; `PITFALLS.md:84-106,223` insists on session caching. At this scale freshness is simpler than cross-instance invalidation. It is a **new recommendation differing from** login-cache wording in `docs/02-2-requirements-specification.md:898-902`, while meeting its immediate-invalidation intent. Benchmark before adding a versioned cross-request cache.
- **Commands:** expose named operations such as record purchase/sale, transition vehicle, decide advance and approve change. Reject generic assignment of lifecycle/financial fields. Keep pure money/state checks reusable but keep DB writes inside these command functions.
- **Atomic unit:** one database transaction reads/revalidates current lifecycle and cost-cycle facts, checks approval preconditions, applies all related business rows, appends explicit audit rows, and creates required in-app notification rows. If any essential write fails, the operation rolls back. Use the transaction client for every participating write, including audit. No post-response fire-and-forget audit.
- **Concurrency:** protect a vehicle's current purchase cycle and pending approval with an atomic expected-version/status predicate or row lock; back it with appropriate unique/check constraints. Retried sale/approval commands need a unique operation/idempotency key. A second racing request must not sell twice or apply approval twice. Handle serialization/conflict retries in a bounded way supported by the selected driver/version. Approval applies only after rechecking current prices/state, not by replaying stale arbitrary JSON.
- **Audit:** explicit helper receives the same transaction client, server actor, timestamp, reason and before/after values; approval execution records both requester and approver. Include all audited mutations and enforce mandatory reasons in the command, not just the form. `docs/02-2-requirements-specification.md:836-885` is the coverage/approval contract. Keep the app DB role unable to update/delete audit records where feasible; use a separate migration owner. “Append-only” is not tamper-proof against a database administrator.
- **Non-DB work:** R2 bytes, PDF rendering and external IO are outside the transaction; finalize their DB metadata with explicit failure/retry handling. In-app notifications share PostgreSQL, so no outbox/queue is needed for current requirements.

Prefer explicit command-level audit writes over the “transparent Prisma extension guarantees same-transaction audit” proposal (`ARCHITECTURE.md:351-359,563-569`). An extension is not automatically transaction-safe, and nested/bulk writes, before/after reads and actor context need proof. This is a recommendation, not a statement that explicit auditing is already implemented. [S14]

## 5. Money bounds: preserve integer minor units, widen storage

**Documented target:** minor-unit integers, one configurable currency (`.planning/PROJECT.md:64`, `docs/02-2-requirements-specification.md:72-76`). The research turns this into “all money as Prisma Int” (`ARCHITECTURE.md:505-515`), which adds an unsafe width assumption.

**Verified:** PostgreSQL `integer` is signed 32-bit, range -2,147,483,648–2,147,483,647. `bigint` is signed 64-bit, range -9,223,372,036,854,775,808–9,223,372,036,854,775,807. With two decimal minor units, a positive `integer` tops out at **21,474,836.47**; a **25,000,000.00** vehicle requires 2,500,000,000 minor units and will not fit. This example is illustrative, not an assertion that that vehicle exists in production. [S15]

The Prado fixture already has 1,680,000,000 minor-unit listed price (`lib/mock-data/vehicles.ts:20`), relatively near that ceiling. Indefinite aggregate cash/report totals need a wider range even when each sale fits. JavaScript safe integers stop at **9,007,199,254,740,991** (2^53 - 1), not the full PostgreSQL bigint range. `Number.isInteger` alone does not ensure exactness. [S16]

**New recommendation:** use PostgreSQL bigint / the selected Prisma version's corresponding wide-integer type for monetary columns. Keep the minor-unit rule. For the smallest UI transition, permit JSON numeric minor units only within an explicitly enforced JS safe-integer/application bound, checked before converting bigint to number; validate every input and arithmetic result, including intermediate multiplication and report aggregates. Never silently downcast an out-of-range database value. If the bound is exceeded, return an explicit error or introduce decimal integer strings plus bigint arithmetic at that seam. Raw JS bigint cannot simply be handed to JSON serialization. Do not introduce floating-point money as a workaround.

Before schema approval, confirm the configured currency/scale, maximum per-record amount, report-total bounds and percentage rounding policy. Existing two-decimal helpers do not implement arbitrary configurable precision; settings changes must not reinterpret historical stored amounts. Add boundary tests for 32-bit crossing, safe-integer crossing, negatives/refunds, aggregate overflow and tier comparisons. This report does not change helper code or prescribe a speculative multi-currency subsystem.

## 6. Backup/recovery: minimum credible $0 procedure

**Documented target:** business data retained indefinitely (`.planning/PROJECT.md:70`); no tested operational backup was found in the reviewed configuration. Neon persistence, branching and a six-hour restore window are not independent disaster recovery. R2 primary objects are also not their own backup.

**New recommendation, subject to owner acceptance:**

1. Name an operator and recovery owner. Before live data, take a custom-format `pg_dump` through the direct connection at least once per business day and before migrations/imports. Run this on an already-owned trusted machine initially; any automated runner's commercial eligibility, minutes and billing must be validated separately. Do not run a database dump through a Vercel request handler.
2. Encrypt exports, keep keys separately, and retain a rolling proposed set (for example seven daily plus four weekly copies), with an independent offline/off-account copy. Retaining backups for a bounded period is not permission to delete indefinite live business records. Capacity must be measured; even these copies can consume the entire free object allowance as the DB grows.
3. Back up private R2 final objects and a key/checksum manifest to an independent location; keep immutable invoice versions. A second prefix/bucket in the same account is useful isolation but not independent protection against account loss or a compromised administrator. DB dumps plus R2 manifests must let recovery reconcile referenced keys.
4. A private R2 backup bucket can be an additional off-Neon DB copy only within shared storage/operation allowances, with credentials isolated from the application. This is not the only copy and not a promise of unlimited free storage. Monitor allowances before uploads; on a strictly $0 budget, stop/ask before billable expansion rather than silently charging or deleting retained documents.
5. Restore to an isolated DB and test object availability at least monthly and before launch. Verify row counts, latest audit events, role access, vehicle-cycle balances, invoice versions and sample attachments. Record backup success/failure and last successful restore visibly. Never restore over the only live copy as the first test.
6. Proposed recovery-point objective: up to one business day of data loss **if daily backups actually succeed**. Recovery-time objective remains unmeasured until a rehearsal; no SLA is established. A sleeping/offline operator machine weakens this target. If the owner cannot accept that risk/operational effort, reliable scheduled recovery must reopen the $0 constraint, not be quietly omitted.

## 7. Expiry scheduling: distinguish flags from staff decisions

`.planning/PROJECT.md:66` summarizes expiry as manual, but the detailed specification says **automatic daily expiry flagging**, followed by a **manual decision** to sell/refund/cancel/extend (`docs/02-2-requirements-specification.md:748-770`). Treat this as a requirements clarification, not evidence that scheduling is unnecessary.

**Recommendation:** one daily authenticated/idempotent scheduler invocation of the same expiry command is enough; retain a permissioned manual catch-up. Commit each advance/vehicle/audit/notification transition together; bound the batch and expose failures/last success. Evaluate due dates against an agreed dealership timezone and reject stale/invalid mutations server-side even if a scheduled flag is delayed. Cron is an invocation mechanism, not the source of lifecycle truth. Never automatically refund/release availability merely because a date elapsed.

Vercel's once-daily window technically matches daily flagging but not exact midnight guarantees, and remains contingent on eligible hosting. No queue or new service is needed. If a host has no scheduler, a staff catch-up/on-access fallback must be explicitly accepted as weaker than the written daily requirement, not passed off as equivalent.

## 8. Consequences for the eventual C4/HTML

- **System context:** staff use VSMS. Customers, suppliers, repair vendors and finance institutions are business parties; show manual information exchange only where appropriate, not invented API integrations. Backup operator is an operational actor.
- **Container view — implemented:** browser UI; one Next.js app serving UI/HTTP; mock stores inside that process. Do not draw a production database, authentication provider or storage connection as already live.
- **Container view — target:** browser; monolithic Next.js Node app; Neon PostgreSQL; private R2 object storage. Hosting label is “Vercel intended — commercial-plan/$0 decision blocked.” Better Auth, CASL, Prisma and PDF renderer are in-process libraries/components, not independent network services. R2 direct PUT/GET flows cross a separate storage trust boundary.
- **Component view — recommendation overlay:** transport adapters → server-only authorized read/command functions → Prisma transaction → business/audit/notification tables. File capability/finalization and invoice generation are small adjacent components in the same deploy. Daily scheduler and backup procedure belong in dynamic/deployment/operational views, not fabricated business microservices.
- **Dynamic views worth showing:** sale/approval atomic commit versus conflict; denied RSC/API read; staged upload/finalization then authorized download; daily expiry plus manual decision; backup and restore rehearsal. Mark DB atomicity and the R2/DB non-atomic boundary explicitly.
- **Code-level view:** cite actual route/store/money files for implemented paths; proposed filenames/functions should be visibly tagged “recommendation,” not clickable evidence of nonexistent code.
- Keep three visible labels (**implemented**, **documented target**, **recommendation**) plus a prominent **blocked** badge for hosting. Show concise defaults with expandable evidence/risks. Do not add containers merely because a library or future concern has a name.

## Evidence URLs and verification method

Official primary sources retrieved during this research; no provider accounts were queried. Context7 resolution then docs queries were used for Next.js, Neon, Cloudflare R2 and Prisma (two commands per topic); plan/policy pages were fetched directly for current terms. Treat current docs as a point-in-time check, not a contract guaranteeing future free quotas.

- **S1** Vercel Hobby (commercial restriction, Fluid comparison): https://vercel.com/docs/plans/hobby
- **S2** Vercel fair use, commercial definition: https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage
- **S3** Vercel function limits (Fluid condition, durations, payload): https://vercel.com/docs/functions/limitations
- **S4** Vercel cron pricing/limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- **S5** Neon plans (current quotas, persistence on exhaustion, history, snapshots, SLA): https://neon.com/docs/introduction/plans
- **S6** Neon scale-to-zero: https://neon.com/docs/introduction/scale-to-zero
- **S7** Neon independent dump/restore: https://neon.com/docs/manage/backup-pg-dump
- **S8** Neon connection transport/transactions: https://neon.com/docs/connect/choose-connection and https://neon.com/docs/serverless/serverless-driver (Context7 excerpts)
- **S9** Neon official Prisma setup/adapter transport/version caveats: https://neon.com/docs/guides/prisma
- **S10** R2 presigned capabilities, supported methods, headers, expiry, reuse: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- **S11** R2 browser CORS/dashboard configuration: https://developers.cloudflare.com/r2/buckets/cors/ (Context7 excerpt)
- **S12** R2 free allowances/billable usage: https://developers.cloudflare.com/r2/pricing/
- **S13** Next.js authoritative authorization/DAL guidance: https://nextjs.org/docs/app/guides/authentication and https://nextjs.org/docs/app/guides/data-security (official source excerpts via Context7: https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/authentication.mdx and https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/data-security.mdx)
- **S14** Prisma official transaction/version evidence via Context7: https://github.com/prisma/web/blob/main/apps/docs/content/docs/orm/fundamentals/transactions.mdx and historical callback example https://github.com/prisma/web/blob/main/apps/blog/content/blog/wnip-q4-2022-f66prwkjx72s/index.mdx . General index currently mixes newer ORM APIs; do not use this as a pinned Prisma 6 API recipe.
- **S15** PostgreSQL exact numeric ranges: https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-INT
- **S16** ECMAScript normative safe-integer bound: https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.max_safe_integer

## Remaining uncertainty / approval checklist

- Approve an eligible production host without pretending the $0/Vercel Hobby conflict is resolved; ask provider if an exception is claimed.
- Confirm real account quotas, database/adapter versions, region, runtime/Fluid settings, R2 privacy/CORS, and overage controls. No live infrastructure was verified.
- Confirm daily automatic expiry flagging versus manual staff disposition, business timezone and notification lead time.
- Confirm currency/precision, amount/report bounds and immutable invoice-version storage policy.
- Approve backup owner, independent storage, retention/capacity, achievable recovery point and measured restore time. The current free Neon snapshot presentation and account entitlement need console confirmation.
- Test cold-start workflows, concurrent double sale/approval, rollback with forced audit failure, RSC/API unauthorized and field-limited reads, short-lived file capabilities and storage finalization races before production acceptance. No runtime integration benchmark or restore drill was performed in this research.
