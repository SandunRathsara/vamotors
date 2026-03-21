# Pitfalls Research

**Domain:** Vehicle Dealership Management System (Next.js 15 App Router, Neon PostgreSQL, Prisma, CASL, Vercel Hobby, Cloudflare R2)
**Researched:** 2026-03-21
**Confidence:** HIGH (infrastructure pitfalls verified against official docs and community reports; domain pitfalls derived from spec analysis and cross-domain patterns)

---

## Critical Pitfalls

### Pitfall 1: Integer Currency Stored Correctly, Displayed Incorrectly

**What goes wrong:**
The project correctly stores all monetary values as integers (smallest currency unit). The failure happens at the display and input layer: developers forget to divide by 100 (or the correct decimal factor for the configured currency) before showing values, or accept user inputs as decimal strings and store them without multiplying. The result is 1,500,000 cents displayed as 1,500,000 or entered as 1500000 and stored as 1500000 when it should be 150000000. Financial reports become wildly incorrect and the bug is hard to catch because everything is internally consistent — it's consistently wrong.

**Why it happens:**
Currency format is configured via `APP_CURRENCY` env var, meaning the decimal precision (2 for LKR/USD, 0 for JPY) varies by deployment. Developers hardcode "divide by 100" and forget the env var controls decimal precision. The bug also appears when different developers implement different forms without sharing a central currency utility.

**How to avoid:**
- Create a single `formatCurrency(amountInSmallestUnit: number): string` utility on day one that reads `APP_CURRENCY` to determine decimal precision and symbol.
- Create a matching `parseCurrencyInput(displayString: string): number` for form inputs.
- Never allow raw integer-to-display conversion outside this utility.
- Add an explicit `CURRENCY_DECIMAL_PLACES` env var (e.g., `2`) alongside `APP_CURRENCY` to make precision unambiguous.

**Warning signs:**
- A vehicle purchased for 1.5M appears as 150,000,000 or 15,000 in the UI.
- Profit calculations are off by exactly 100x.
- Different forms show different decimal representations of the same amount.

**Phase to address:**
Foundation phase — build the currency utility before the first form is created.

---

### Pitfall 2: Vehicle State Machine Bypassed by Direct Database Updates

**What goes wrong:**
The 10-state vehicle lifecycle (`PURCHASED → IN_STOCK → IN_REPAIR → ...`) is enforced in application logic but not at the database layer. A developer fixes a bug by directly updating `primaryStatus` in a Prisma query without going through the state machine validation. Or a bulk import sets statuses that produce impossible combinations (e.g., `primaryStatus: SOLD` with `isAvailableForSale: true`). Vehicles get stuck in invalid states that no UI transition can recover from.

**Why it happens:**
The state machine is defined in the spec (Section 4.3) but will likely live as a service-layer function. Nothing prevents `prisma.vehicle.update({ data: { primaryStatus: 'SOLD' } })` from being called directly anywhere in the codebase. The two-field design (`primaryStatus` + `isAvailableForSale`) makes invalid combinations possible: 8 of the 10 statuses force `isAvailableForSale = false` (Section 4.4), but only IN_STOCK allows it to be `true`.

**How to avoid:**
- Implement one `transitionVehicleStatus(vehicleId, newStatus, actor)` function that is the only place `primaryStatus` is written.
- This function validates the transition against the allowed transition map, enforces `isAvailableForSale` forced-false rules, and writes an AuditLog entry — all in a single transaction.
- Add a Prisma middleware or database check constraint that rejects `isAvailableForSale = true` when `primaryStatus` is anything other than `IN_STOCK`.
- Data import (Section 12) must route through the same transition validator or explicitly whitelist known-good historical states.

**Warning signs:**
- A vehicle appears in SOLD status but still shows in the available inventory list.
- Audit log has no entry for a status change that clearly happened.
- Import creates vehicles in terminal states (`SOLD`, `WRITTEN_OFF`) that also have `isAvailableForSale = true`.

**Phase to address:**
Core vehicle lifecycle phase — state machine must be enforced before the first status-changing workflow is built.

---

### Pitfall 3: Neon Cold Start + Prisma Connection Exhaustion Causing Request Timeouts

**What goes wrong:**
Vercel Hobby plan limits function execution to 10 seconds. Neon free tier scales compute to zero after 5 minutes of inactivity; resuming from zero takes 500ms–3 seconds. Prisma's connection pool on serverless compounds this: each Vercel function invocation can open its own connections if the `PrismaClient` is instantiated inside the handler. Under a burst of requests after a cold period, the function hits Neon's connection limit (Neon free tier: 10 connections via PgBouncer) before the compute wakes up, causing P1001/P1017 errors that cascade.

**Why it happens:**
Developers place `new PrismaClient()` inside the Route Handler function body. In a hot Vercel instance this works. After a cold period, the combination of slow Neon wake-up and Prisma's own connection ramp-up consumes the 10-second budget before the query runs.

**How to avoid:**
- Use the global singleton pattern for `PrismaClient` (one instance per Vercel worker, reused across warm invocations).
- Use Neon's pooled connection string (PgBouncer endpoint, port 5432) — not the direct connection — for all application traffic.
- Add `?connect_timeout=10&pool_timeout=15` to the DATABASE_URL.
- Use `@neondatabase/serverless` HTTP driver with `@prisma/adapter-neon` for the lowest cold-start latency (HTTP over WebSocket avoids TCP handshake on first query).
- Add `?sslmode=require` — PgBouncer in transaction mode requires SSL.

**Warning signs:**
- `PrismaClientInitializationError: Can't reach database server` errors appearing in Vercel logs after periods of inactivity.
- Functions timing out at exactly 10s with no query result logged.
- Connection count at Neon dashboard hitting ceiling under normal load.

**Phase to address:**
Foundation / infrastructure phase — database connection setup before any feature work.

---

### Pitfall 4: CASL Permission Rules Loaded Synchronously on Every Request

**What goes wrong:**
CASL builds an `Ability` object from permission rules fetched from the database (Role → RolePermission → Permission join). If this fetch happens inside every Route Handler before the actual business logic runs, it adds 50–200ms per request. On Vercel serverless with a cold Neon start, this doubles the latency. At scale, it also generates N+1 queries for the role/permission join.

A secondary failure: permissions are loaded at login into the session/JWT, but when an admin modifies a role's permissions, users already logged in don't see the change until their session expires. They either get access they shouldn't have (security) or get denied access they should have (UX).

**Why it happens:**
The spec notes "Permission cache is invalidated when a role's permissions are modified" (Section 9.1) but doesn't specify the mechanism. Without an explicit invalidation strategy, developers either (a) never implement cache invalidation and rely on login-time loading, or (b) hit the DB on every request.

**How to avoid:**
- Cache the `AbilityRules[]` array per role in the session payload (JWT or database session). This avoids per-request DB hits.
- When a role's permissions change (via admin UI), invalidate affected sessions using Better Auth's session invalidation API. This forces re-login for affected users.
- Alternatively, store a `permissionsVersion` integer per role; include it in the session; if the version in the request's session doesn't match the DB version, re-fetch and re-sign the session.
- Limit the CASL permission model to the ~60–80 rules this system needs (6 actions × 11 subjects + conditional overrides). Don't over-engineer conditions beyond what the spec requires.

**Warning signs:**
- Each API response shows 3+ database queries for permission loading in query logs.
- Users can still perform actions after their role was stripped of that permission.
- CASL `Ability` build time becomes measurable (>5ms) as permissions grow.

**Phase to address:**
Auth and permissions phase — implement correct session-based caching before any permission-gated UI is built.

---

### Pitfall 5: Next.js App Router Data Cache Serving Stale Financial Data

**What goes wrong:**
In Next.js 15, `fetch()` calls in Server Components are no longer cached by default (changed from Next.js 13/14 behavior). However, Route Handlers that use Prisma directly (no `fetch`) are not subject to the Data Cache — they always run fresh. The confusion arises when developers mix `fetch()` calls to their own API routes with direct Prisma calls in Server Components.

The specific failure for VSMS: a cashier completes a sale, the vehicle status changes to SOLD, but the inventory page — served from a layout that caches its data — continues showing the vehicle as available. The sale is recorded, but the UI lies.

**Why it happens:**
Next.js has four caching layers: Request Memoization, Data Cache, Full Route Cache, and Router Cache (client). Developers using App Router for the first time treat it like a SPA: they expect data to be fresh because they know they "called the server." The Router Cache (client-side, 30s default in Next.js 15) will serve stale page state even when the server has fresh data, until the user navigates away and back.

**How to avoid:**
- For all mutable business data (vehicle status, sale records, financial figures), use TanStack Query on the client with `staleTime: 0` and explicit `invalidateQueries` after mutations.
- Do not rely on Server Component fetch caching for any entity that changes during normal operations.
- Call `revalidatePath('/inventory')` or `revalidateTag('vehicles')` in Server Actions/Route Handlers that mutate vehicle state.
- Prefer the pattern: Server Component prefetches data → passes to Client Component via TanStack Query hydration → Client Component owns cache invalidation.

**Warning signs:**
- After a sale is recorded, the vehicle still appears in the "available" inventory list until page refresh.
- Report data doesn't update after new transactions are added.
- TanStack Query and Next.js cache both caching the same data at different layers, causing double-stale issues.

**Phase to address:**
All phases that build data-displaying features — establish the caching/invalidation pattern in the first feature built and apply it consistently.

---

### Pitfall 6: PDF Invoice Generation Exceeding Vercel's 10-Second Function Timeout

**What goes wrong:**
`@react-pdf/renderer` renders React component trees to PDF using a pure-JS layout engine. For a single vehicle invoice, render time is typically 100–300ms in warm conditions. However, after a Neon cold start (adding 1–3s), the Vercel function cold start (~500ms), fetching all required data (vehicle, customer, sale details, business config), and PDF rendering, the total can breach the 10-second limit on Vercel Hobby — particularly during the first request after a cold period.

The documented failure mode: Vercel Hobby functions time out at 10s with no extension option. If the PDF generation function also imports heavy fonts or embeds images, bundle size and runtime memory increase further. A separate issue: `@react-pdf/renderer` v7+ causes "exceeds the maximum size limit of 50MB" build errors on Vercel when bundled naively.

**Why it happens:**
PDF generation is naturally slow compared to JSON API responses. Developers copy a working local setup to production without accounting for the cold start + timeout combination unique to the free Vercel tier.

**How to avoid:**
- Separate data fetching from PDF rendering: fetch all data in one query, then pass to the renderer. Avoid any DB calls inside the PDF component tree.
- Use `@react-pdf/renderer`'s `renderToBuffer()` (not `renderToStream()`) for simpler response handling in Route Handlers.
- Configure `@react-pdf/renderer` as a server-only import with Next.js `serverExternalPackages` in `next.config.ts` to avoid bundling it client-side and reduce bundle size.
- Avoid embedding large base64 images or custom fonts in the PDF; use system fonts or minimal font subsets.
- Add `export const maxDuration = 10` (Hobby limit) explicitly to the invoice Route Handler so failures are predictable.
- Test PDF generation with a Neon-cold-start simulation (query a fresh DB, then generate PDF) before declaring this complete.

**Warning signs:**
- PDF generation works locally but times out on Vercel after periods of inactivity.
- Vercel build fails with "bundle size exceeds 50MB" referencing react-pdf.
- Invoice download returns a 504 Gateway Timeout.

**Phase to address:**
Invoice generation phase — test with cold start conditions before shipping.

---

### Pitfall 7: Advance Payment Expiry Logic Failing Silently in Serverless

**What goes wrong:**
Section 6.2 specifies a "scheduled background job runs daily" to expire advances and set vehicle status to `ADVANCE_EXPIRED`. On Vercel serverless (including Hobby tier), there is no built-in cron infrastructure. Developers either (a) forget to implement it and expiry never happens, or (b) implement a Vercel Cron Job that runs correctly but fails silently when it encounters an unhandled exception (network blip, Neon cold start timeout), leaving expired advances in `ACTIVE` status indefinitely.

**Why it happens:**
Serverless cron jobs don't have the same retry and observability infrastructure as dedicated queue/scheduler services. Vercel Hobby supports cron jobs but provides no native dead-letter queue or alerting on failure.

**How to avoid:**
- Implement the expiry job as a Vercel Cron Job (`vercel.json` schedule, or `app/api/cron/advance-expiry/route.ts` with `vercel.json` config).
- Protect the cron endpoint with a shared secret header (`CRON_SECRET`) to prevent public invocation.
- Make the job idempotent: query for `AdvancePayment WHERE status = ACTIVE AND validUntil < NOW()`, process each in a loop with individual try/catch. A failure on one record should not abort the rest.
- Log a structured summary (how many processed, how many failed, IDs of failures) so failures are visible in Vercel logs.
- Add a "manual trigger" button in the admin UI for recovery when the cron misfires.
- Consider a "defensive display" in the UI: when rendering an advance, check `validUntil < today` and show it as visually expired even if the DB status hasn't been updated yet.

**Warning signs:**
- Advances show status `ACTIVE` past their `validUntil` date.
- No `ADVANCE_EXPIRING` or `ADVANCE_EXPIRED` notifications have been sent in days despite active advances.
- Vercel function logs show the cron endpoint returning 200 but audit log shows no expiry events.

**Phase to address:**
Advance payment phase — wire up and test the cron job as part of that feature, not as an afterthought.

---

### Pitfall 8: Audit Log Becoming a Performance Bottleneck

**What goes wrong:**
AuditLog is append-only and covers every CREATE/UPDATE/DELETE/STATUS_CHANGE across 14 entities (Section 8.1). With indefinite data retention (Section 3), the AuditLog table grows unbounded. The `changedFields` JSONB column stores before/after snapshots per field. Two failure modes:

1. **Write contention:** Each mutation opens a transaction, writes the business record, then writes the AuditLog row. Under concurrent operations, the AuditLog table becomes a serialization bottleneck.
2. **Read performance:** The admin audit history view queries `AuditLog WHERE entityType = X AND entityId = Y ORDER BY performedAt DESC`. Without a composite index on `(entityType, entityId, performedAt)`, this table scan takes seconds once the log has tens of thousands of rows.

**Why it happens:**
AuditLog is added as a "simple append" after the main logic. No index is applied because "it's just a log." The JSONB snapshot approach is correct but the query pattern is not anticipated during initial schema design.

**How to avoid:**
- Add composite index `(entityType, entityId, performedAt DESC)` to the AuditLog table from the first migration.
- Add index `(performedBy, performedAt DESC)` for user activity reports.
- Write AuditLog rows in the same transaction as the business record change (no separate async write). Async writes can miss failures and create phantom audit entries.
- Keep `changedFields` JSONB slim: only record fields that actually changed, not the full entity snapshot.
- For the admin dashboard, always paginate AuditLog queries — never `SELECT *` without a `LIMIT`.

**Warning signs:**
- Vehicle detail page loads slowly because it's fetching the full unindexed audit history.
- Sequential `EXPLAIN ANALYZE` shows `Seq Scan` on AuditLog.
- Prisma interactive transactions start timing out on heavily-edited vehicles.

**Phase to address:**
Database schema phase — add indexes in the initial Prisma migration, before any features are built.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skipping the state machine validator and writing `primaryStatus` directly in feature handlers | Faster to build each feature independently | Vehicles end up in invalid states; impossible to audit which handler caused it | Never |
| Reloading CASL permissions from DB on every request | Simplest to implement; always current | 50–200ms overhead per request; connection budget consumed | Never — session cache is straightforward |
| Generating PDF synchronously inside a Route Handler that also does data fetching | Single endpoint is simple | Timeout risk on Vercel Hobby cold starts | Never — separate data fetch from render |
| Using `SalePrice - (PurchasePrice + sum(repairs))` computed at query time without testing currency edge cases | Works for common cases | Fails for re-purchased vehicles if `activePurchaseId` is not correctly scoped | Never — test cost basis scoping from day one |
| Running the historical data import as a single Prisma transaction for thousands of rows | Simple rollback story | Prisma interactive transaction timeout at ~5000ms default; import of 500+ rows will fail | Never — use chunked batches with `createMany` |
| Instantiating `new PrismaClient()` in each Route Handler | No boilerplate needed | Connection exhaustion in production; P1001 errors under load | Never in Next.js — always use the global singleton |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Cloudflare R2 presigned URLs | Including `Content-Type` in the signed headers — browser upload will fail because R2 sees mismatched signed headers | Generate presigned PUT URL without signed `Content-Type`; let the browser set it at upload time |
| Cloudflare R2 CORS | Assuming dashboard CORS settings apply to S3 API endpoint — they don't; they apply only to public URLs | Configure CORS using Wrangler CLI for the bucket; set `AllowedOrigins` to your Vercel domain explicitly |
| Neon + Prisma pooled connection | Using the direct connection string (not PgBouncer) for application traffic — fails under any concurrency | Always use the pooled connection string (`?pgbouncer=true&connection_limit=1`) for app; use direct connection only for migrations |
| Better Auth + Next.js middleware | Calling `auth.api.getSession()` inside every middleware invocation (incl. static asset routes) — adds DB overhead to every request | Use middleware only for cookie existence check; validate the full session only in Route Handlers |
| Better Auth cookie in Server Actions | Calling sign-in methods in a Server Action without the `nextCookies` plugin — cookies won't be set | Install Better Auth's `nextCookies` plugin, which intercepts Set-Cookie headers from Server Action context |
| TanStack Query + Server Components | Fetching data in a Server Component and trying to use it in a Client Component query cache — the caches are separate | Use `HydrationBoundary` + `dehydrate()` pattern: prefetch in Server Component, pass dehydrated state to client |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Profit calculation computed at query time without pre-scoped `purchaseRecordId` | "Gross Profit" on the sales report is wrong for vehicles that have been re-purchased | Always join `VehicleCost` and `RepairRecord` on `purchaseRecordId = activePurchaseId`, not `vehicleId` alone | From the first re-purchased vehicle |
| Unindexed `AuditLog` full-table scans | Vehicle audit history takes 2–5s to load on vehicles with many edits | Composite index `(entityType, entityId, performedAt DESC)` from migration 0 | ~10,000 audit rows (expected within 1–2 years of active use) |
| `N+1` query on the inventory list — fetching cost basis per-vehicle in a loop | Inventory list with 100 vehicles takes 2–3s to load | Use Prisma `include` or aggregate the cost basis with a `groupBy` query; never loop over `findUnique` in a list render | ~50 vehicles in inventory |
| Notification polling interval too aggressive | Notification badge updates drain Vercel function invocations on Hobby plan (limited to 100K/month) | Poll no more than every 30s; use SSE (Server-Sent Events) for a persistent connection that pushes only on change | When multiple concurrent users are active |
| Report CSV/PDF export with no row limit | Exporting "all-time" sales report causes Vercel function memory pressure and timeout | Paginate or cap exports at 1,000 rows; add date range validation server-side | Reports spanning 3+ years of history |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Checking CASL permissions only on the frontend (`can('update', 'SaleRecord')`) | A user who can manipulate the client payload can perform any action by calling the API directly | Every Route Handler must independently re-build the CASL `Ability` from the session and check permissions before executing business logic |
| Exposing the raw `ApprovalRequest.payload` JSON to non-manager roles | Payload contains proposed sale details (including prices) that a sales person should not see before approval | Server-side filter `payload` out of the response for non-approve roles |
| Presigned R2 URLs with no expiry or long expiry (>15 minutes) | A leaked URL allows anyone to replace a DO document for a lease sale | Set presigned URL expiry to 5 minutes; validate that the uploaded file is a PDF before storing the path in `doDocumentPath` |
| Import endpoint accessible without auth | Historical data import bypasses approval workflows by design; if the endpoint is public, anyone can inject records | Protect the import endpoint with both authentication and an explicit `can('import', 'all')` admin-only permission |
| Storing `listedPrice` comparisons for discount detection purely client-side | Sale form could submit `salePrice < listedPrice` without triggering the approval workflow | Discount detection (`salePrice < Vehicle.listedPrice`) must occur in the Route Handler, not the client, and must create an `ApprovalRequest` before the sale is committed |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No optimistic UI on status transitions | Cashier clicks "Mark as Returned from Repair" — page freezes for 1–2s, staff clicks again creating a duplicate action | Use TanStack Query mutation + optimistic update; disable the button immediately on click; show loading state |
| Advance expiry displayed as server time only | Staff in a different timezone see confusing "expired yesterday" messages for advances that haven't technically expired locally | Display all dates in the configured `APP_TIMEZONE`; include relative time ("3 days overdue") alongside absolute date |
| Financial figures with no currency symbol or decimal formatting | "1500000" shown in the profit column — staff misread it as 15,000 | Every monetary value in the UI must pass through `formatCurrency()`; never render raw integers from the API |
| Approval request submits with no confirmation of what was submitted | Sales person submits discount request, doesn't know if it went through | Show a confirmation dialog summarizing the pending request before submission; show a "pending approval" badge on the sale record |
| Inactive/soft-deleted entities appear in dropdowns | Staff selects a deactivated supplier or customer by mistake | All `findMany` queries for dropdown data must filter `isActive: true` by default; add a "show inactive" toggle only where needed |

---

## "Looks Done But Isn't" Checklist

- [ ] **State machine:** Status transitions return 200 — verify that the inverse direction (e.g., SOLD → IN_STOCK) correctly returns 400, not 200.
- [ ] **Cost basis scoping:** Profit report shows correct figures for a vehicle that has been purchased, sold, and re-purchased — test this specific scenario explicitly.
- [ ] **Advance expiry job:** Cron endpoint returns 200 with correct body — verify that `AdvancePayment.status` and `Vehicle.primaryStatus` are actually updated in the database.
- [ ] **PDF invoice:** Invoice generates and downloads on Vercel — verify it also generates correctly after the Neon compute has been cold for >10 minutes.
- [ ] **CASL enforcement:** Frontend hides the "Edit Sale" button for a Sales Person — verify that calling `PATCH /api/sales/:id` directly without the button also returns 403.
- [ ] **R2 file upload:** DO document uploads succeed on localhost — verify it also works on Vercel prod with CORS configured for the production domain, not `*`.
- [ ] **Trade-in financial:** Trade-in sale profit calculation uses full sale price, not just cash received — verify by checking the Profit per Vehicle report for a trade-in sale.
- [ ] **Notification delivery:** Approval notification is created — verify it is also linked to the correct `ApprovalRequest.id` and appears in the manager's notification panel.
- [ ] **Import rollback:** Import with one invalid row rolls back the entire batch — verify no partial data persists after a batch failure.
- [ ] **Permission invalidation:** Admin removes `update:SaleRecord` from a role — verify that a logged-in user of that role immediately gets 403 on the next attempt (not after their session expires).

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Vehicle stuck in invalid state (e.g., SOLD + isAvailableForSale = true) | LOW | Admin UI "state correction" tool, or direct Prisma migration script; write AuditLog entry explaining manual correction |
| Prisma connection exhaustion in production | LOW | Restart the Vercel deployment (re-deploys clear stale connections); switch to pooled connection string permanently |
| Stale CASL permissions in active sessions | LOW | Force all sessions of affected users to expire via Better Auth's session management API; users re-login and get fresh permissions |
| Advance expiry cron missed a run | MEDIUM | Trigger the cron endpoint manually via admin UI; verify AuditLog shows the delayed expiry events; send manual notifications |
| PDF generation timeout on Vercel | MEDIUM | Optimize data fetch (single query instead of multiple), remove embedded assets from template, test again; if still failing, pre-generate PDF eagerly on sale creation rather than on-demand download |
| Historical import partially committed (transaction failed mid-batch) | MEDIUM | Identify the `importBatchId` from logs; query for records with that batch ID; either complete the remaining records or delete and re-import the entire batch |
| Audit log data corruption (missing entries for a period) | HIGH | Audit log gaps cannot be back-filled from application state — they are a permanent data integrity hole. Prevention is the only viable strategy. If discovered early, add compensating entries with `performedBy = system-recovery` and a note. |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Integer currency display/input errors | Foundation — currency utility | All monetary inputs and displays use the shared utility; no raw integer rendering anywhere in the codebase |
| Vehicle state machine bypassed | Core lifecycle phase | State transition tests cover every valid and every invalid transition; direct Prisma `update` of `primaryStatus` does not exist outside the transition function |
| Neon cold start + Prisma connection exhaustion | Foundation — infrastructure setup | Prisma singleton pattern in place; pooled connection string in DATABASE_URL; cold-start test passes under 10s |
| CASL permissions loaded per-request | Auth and permissions phase | Prisma query logs show 0 permission queries after initial session load |
| Next.js App Router stale cache | First data-displaying feature | Inventory list updates within 1s of a sale being recorded, without page reload |
| PDF invoice timeout | Invoice generation phase | Invoice generates successfully from a cold Neon compute on Vercel Hobby |
| Advance expiry cron silent failure | Advance payment phase | Cron job has idempotent error handling; manual trigger available; structured log output |
| Audit log index missing | Database schema phase (migration 0) | `EXPLAIN ANALYZE` on AuditLog queries shows index scan, not seq scan |
| R2 CORS misconfiguration | File upload phase | DO document upload works end-to-end from the deployed Vercel domain, not just localhost |
| Import transaction timeout | Data import phase | Import of 500 rows completes within 10s; import of 1 invalid row in a 100-row batch rolls back all 100 rows |

---

## Sources

- Neon cold start and connection pooling: [Neon Vercel Connection Methods](https://neon.com/docs/guides/vercel-connection-methods) | [Prisma + Neon Guide](https://neon.com/docs/guides/prisma)
- Prisma transaction timeouts: [Prisma Transactions Reference](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) | [Long-running transaction issue #11654](https://github.com/prisma/prisma/issues/11654)
- Next.js App Router caching: [Next.js Caching Docs](https://nextjs.org/docs/app/building-your-application/caching) | [Deep Dive Discussion #54075](https://github.com/vercel/next.js/discussions/54075)
- Vercel timeout limits: [What can I do about Vercel Functions timing out?](https://vercel.com/kb/guide/what-can-i-do-about-vercel-serverless-functions-timing-out)
- react-pdf + Vercel: [PDF Styling Breaking in Serverless Next.js #61243](https://github.com/vercel/next.js/discussions/61243) | [react-pdf 7 50MB build error](https://github.com/wojtekmaj/react-pdf/issues/1504)
- Cloudflare R2 presigned URLs: [R2 Presigned URL Docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | [Presigned URL + Signed Headers Gist](https://gist.github.com/jeremywall/c87a7bcf423a6dab780d0fb0054c7e6d)
- TanStack Query + App Router: [Advanced Server Rendering Guide](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr) | [Discussion #6267](https://github.com/TanStack/query/discussions/6267)
- Better Auth + Next.js: [Better Auth Next.js Integration](https://better-auth.com/docs/integrations/next)
- CASL dynamic permissions: [CASL Official Docs](https://casl.js.org/) | [CASL + Prisma RBAC Pattern](https://blog.devgenius.io/mastering-complex-rbac-in-nestjs-integrating-casl-with-prisma-orm-for-granular-authorization-767941a05ef1)
- Vehicle dealership operational patterns: [How Modern Software Helps Dealers Avoid Common Mistakes](https://support.mydealerjacket.com/blog/2025/01/19/how-modern-software-helps-dealers-avoid-common-mistakes)
- Domain-specific pitfalls: Derived from analysis of VSMS requirements specification (docs/02-2-requirements-specification.md) v1.2

---
*Pitfalls research for: Vehicle Sale Management System (VSMS)*
*Researched: 2026-03-21*
