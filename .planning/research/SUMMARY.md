# Project Research Summary

**Project:** VA Motors — Vehicle Sale Management System (VSMS)
**Domain:** Single-tenant internal dealership management system (used + new car dealer)
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

VA Motors VSMS is an internal operations system for a small car dealership, replacing physical documents and manual tracking. Research shows this class of system — a Dealer Management System (DMS) — is well-understood, and the requirements are unusually thorough compared to generic DMS implementations. The recommended approach is a monolithic Next.js 15 App Router application deployed to Vercel, backed by Neon PostgreSQL (serverless) via Prisma ORM, with Better Auth for session management and CASL for dynamic role-based access control. This stack delivers everything needed on free or low-cost tiers with no unnecessary infrastructure overhead for a single-tenant, ~5-user system.

The product differentiates from generic DMS tools (Frazer, DealerCenter, MotorDesk) in three key areas: enterprise-grade audit trail with field-level before/after logging, dynamic CASL-based permission management configurable at runtime without code changes, and vehicle lifetime identity across re-purchases. These features are straightforward to implement in the chosen stack but must be treated as first-class architectural concerns from day one — not bolted on later. The audit trail in particular is a cross-cutting concern that must be wired into every entity's write path before any feature is considered complete.

The primary risks are infrastructure-level: Neon's 5-minute scale-to-zero combined with Vercel Hobby's 10-second function timeout creates a cold-start window that affects PDF invoice generation and the first request after idle periods. The advance payment expiry cron job running on Vercel's serverless environment has no native retry or alerting, making silent failure a real risk. Both are solved by specific patterns identified in research (presigned uploads, PDF-only API routes with pre-fetched data, idempotent cron with manual override), and they must be addressed in the phases where those features are built rather than retrofitted.

---

## Key Findings

### Recommended Stack

The full stack is well-defined with version pinning and verified compatibility. See [STACK.md](.planning/research/STACK.md) for complete details and installation commands.

**Core technologies:**
- **Next.js 15 + React 19 (App Router):** Full-stack monolith — RSC for initial page loads, Route Handlers for API surface, deployed to Vercel with zero additional hosting cost
- **Prisma 6 + Neon PostgreSQL:** Schema-first ORM with type-safe migrations; `@prisma/adapter-neon` eliminates TCP overhead in serverless via HTTP driver; Neon free tier (0.5 GB, 100 CU-hours/month) is more than sufficient for a single dealership
- **Better Auth 1.x:** Session-based credentials auth with first-class TypeScript and Next.js App Router support; `nextCookies` plugin required for Server Action cookie handling
- **CASL (`@casl/ability` 6.8.0 + `@casl/react` 5.0.1):** Isomorphic permission rules engine — same ability definitions enforce on both server (API routes) and client (conditional UI rendering); rules loaded from DB per request
- **TanStack Query v5 + TanStack Table v8 + TanStack Form v1:** Complete data-layer toolkit — server-state caching, headless paginated/sorted tables, signals-based forms with Server Action support; TanStack Form v1 stable since May 2025
- **shadcn/ui + Tailwind CSS v4:** Copy-paste component library on Radix UI primitives; Tailwind v4 requires `@tailwindcss/postcss` and `tw-animate-css` (not the removed `tailwindcss-animate` plugin)
- **Cloudflare R2:** Zero egress fee object storage for DO documents (S3-compatible, accessed via AWS SDK v3 with presigned PUT URLs — file bytes never touch Vercel)
- **`@react-pdf/renderer` 4.3.x:** Server-side invoice PDF generation via `renderToBuffer()` in Route Handlers; requires `serverExternalPackages` config and must NOT run on Edge Runtime

**Critical version requirements:**
- `@react-pdf/renderer` must be ≥4.1.0 for React 19 support
- Prisma adapter version must match Prisma client version exactly (both 6.x)
- `tailwindcss-animate` is removed in Tailwind v4; use `tw-animate-css` instead
- pnpm preferred over npm to avoid React 19 peer dependency resolution issues

---

### Expected Features

All 38 business requirements are P1 (must-have for launch). See [FEATURES.md](.planning/research/FEATURES.md) for the full prioritization matrix, competitor analysis, and dependency graph.

**Must have (table stakes) — users expect these to exist:**
- Vehicle inventory list with status badges and quick search (plate, chassis, make/model)
- Vehicle detail page as a single timeline: purchases, repairs, costs, sales, mileage
- PDF invoice generation covering all fields per BR-022
- Role-based access control with approval workflows (4 gates: discount, write-off, refund, sale edit)
- Field-level audit trail — append-only, every CREATE/UPDATE/DELETE/STATUS_CHANGE
- Seven standard reports with date-range filtering and CSV + PDF export
- In-app notification bell (expiry alerts, approval events; email/SMS explicitly excluded)
- PWA capabilities — installable, 360px–1920px responsive
- Historical data import — validation-first, atomic per batch

**Should have (differentiators) — VA Motors-specific competitive advantage:**
- Vehicle lifetime identity across re-purchases (engine + chassis as identity key; BR-038)
- Tiered advance validity rules (0–5% = 1 week, 5–10% = 2 weeks, etc.) — auto-enforced by system
- Two-field vehicle status model (`primaryStatus` + `isAvailableForSale`) — clean separation of lifecycle state from sale readiness
- Multi-channel purchase types (cash, lease settlement, brand-new from supplier) with distinct cost structures
- Multi-channel sale types (cash immediate, advance/reservation, lease/finance, trade-in)
- Cost basis auto-update on every new repair or additional cost
- Approval decisions permanently linked to audit trail with mandatory edit reasons

**Defer to v1.x / v2+:**
- Vehicle photo gallery — storage budget dependent; internal ops tool doesn't require it
- Stock ageing alerts — manual review via RPT-001 is sufficient at launch
- Email/SMS notifications — in-app bell is sufficient; external channels add cost and deliverability risk
- Multi-branch support — only if VA Motors expands
- Customer-facing portal / online listings — entirely separate product

**Confirmed anti-features (do not build):**
- Automated advance expiry resolution — cancellation has financial consequences requiring human judgment
- Automated market pricing / valuation — local market conditions require manual override regardless
- Bulk status updates — individual transitions enforce integrity and may require approval

---

### Architecture Approach

The system is a standard monolith: React Server Components for initial page loads (calling Prisma directly, no HTTP round-trip), Route Handlers as the HTTP API surface, and domain services in `lib/services/` holding all business logic. The separation between thin Route Handlers and rich domain services is the most important structural decision — it keeps Route Handlers testable, prevents logic duplication across endpoints, and allows cron jobs to reuse the same service functions. See [ARCHITECTURE.md](.planning/research/ARCHITECTURE.md) for the full project structure, data flow diagrams, and Prisma schema topology.

**Major components:**
1. **Route Handler pipeline** (`app/api/`) — fixed execution order: authenticate → authorize (CASL) → validate (Zod) → delegate to service → respond. No business logic inline.
2. **Domain services** (`lib/services/`) — vehicles, sales, advances, repairs, reports, audit, PDF, notifications. Pure functions + Prisma calls; the only place state-machine transitions and financial calculations live.
3. **CASL factory** (`lib/casl/ability.ts`) — `createAbilityForUser(userId)` called once per Route Handler request; caches rules in session to avoid per-request DB queries.
4. **Status machine** (`lib/utils/status-machine.ts`) — pure function mapping valid 10-state transitions; called before any `primaryStatus` DB write; used on both server and client for UI affordances.
5. **Audit service** — implemented as a Prisma extension that intercepts `create`/`update`/`delete` on audited models; status changes logged explicitly with before/after values.
6. **TanStack Query layer** (client) — cache invalidation after mutations keeps the UI consistent with server state; `staleTime: 0` for mutable business data.

**Key schema decisions:**
- All monetary values stored as `Int` (smallest currency unit); display formatted through a shared `formatCurrency()` utility only
- Polymorphic `AuditLog` and `Notification` (entityType as string, no FK constraints) — allows new entities without migrations
- `VehiclePrimaryStatus` as a native PostgreSQL enum — DB-level enforcement
- `ApprovalRequest.payload` and `AuditLog.changedFields` as `Json` — handles varying shapes cleanly

---

### Critical Pitfalls

See [PITFALLS.md](.planning/research/PITFALLS.md) for the full list of 8 critical pitfalls, technical debt patterns, integration gotchas, and a "looks done but isn't" checklist.

1. **Integer currency displayed incorrectly** — build a single `formatCurrency()` + `parseCurrencyInput()` utility before the first form is created; never allow raw integer rendering anywhere in the UI. Address in Foundation phase.

2. **Vehicle state machine bypassed** — `transitionVehicleStatus()` must be the only place `primaryStatus` is written; add a DB check constraint rejecting `isAvailableForSale = true` when `primaryStatus` is not `IN_STOCK`; historical data import must route through the same validator. Address in Vehicle Lifecycle phase.

3. **Neon cold start + Prisma connection exhaustion** — use the global PrismaClient singleton and the pooled connection string (PgBouncer) with `connect_timeout=10`; `@neondatabase/serverless` HTTP driver eliminates TCP handshake overhead. Address in Foundation phase.

4. **CASL permissions loaded per-request** — cache the serialized `AbilityRules[]` in the session; invalidate affected sessions via Better Auth's API when a role's permissions change. Without this, every request incurs 50–200ms of permission DB queries. Address in Auth phase.

5. **Advance expiry cron failing silently** — implement as idempotent Vercel Cron with per-record try/catch, structured logging, and an admin-UI manual trigger. Defensive UI display (check `validUntil < today` in rendering) provides a safety net even when the cron misfires. Address in Advance Payment phase.

6. **Audit log missing indexes** — add composite index `(entityType, entityId, performedAt DESC)` in migration 0; without it the table becomes a sequential scan bottleneck at ~10,000 rows (expected within 1–2 years). Address in Database Schema phase.

7. **PDF invoice timeout on cold start** — separate data fetching from PDF rendering, use `renderToBuffer()` in a dedicated Route Handler with `export const runtime = 'nodejs'`, avoid embedded images or custom fonts. Test with cold Neon compute before shipping. Address in Invoice Generation phase.

8. **R2 CORS misconfiguration** — configure CORS via Wrangler CLI (not Cloudflare dashboard), set `AllowedOrigins` to the Vercel production domain explicitly. Test from the deployed domain, not localhost. Address in File Upload phase.

---

## Implications for Roadmap

Based on the combined research, dependency graph from FEATURES.md, and build order from ARCHITECTURE.md, the suggested phase structure is below. This is an opinionated recommendation — the roadmapper should treat it as a starting point, not a rigid contract.

---

### Phase 1: Foundation and Infrastructure
**Rationale:** Nothing else can be built without these. Prisma schema errors compound every subsequent phase; auth and permission architecture must be decided before any protected route is built; currency utility and audit log indexes must exist before the first form or write goes live.
**Delivers:** Working Next.js app skeleton with authentication, database connection, CASL permission system, core utilities, and Prisma schema with all migrations.
**Addresses:** All 38 BRs depend on this; explicitly resolves pitfalls 1, 3, 4, 6.
**Avoids:**
- Prisma connection exhaustion (global singleton + pooled URL)
- Currency display bugs (shared utility from day one)
- Missing audit log index (in migration 0)
- CASL per-request DB overhead (session cache strategy defined upfront)

**Specific deliverables:**
- Prisma schema (all entities, enums, relations) + migrations
- `lib/db.ts` singleton with Neon adapter
- Better Auth setup with `nextCookies` plugin
- CASL factory with session-cached rules
- `formatCurrency()` and `parseCurrencyInput()` utilities
- `assertValidTransition()` status machine function
- Route Handler pipeline helper (auth → authz → validate → service → respond)
- Dashboard shell layout with auth guard
- User and role management UI (seed default roles)

---

### Phase 2: Vehicle Lifecycle Core
**Rationale:** The vehicle record is the central entity that every other module references by `vehicleId`. Purchase recording, the 10-state machine, repair management, and cost tracking must all exist before sales can be built. Cost basis auto-calculation requires repair and additional cost systems to be cohesive from the start — not built independently.
**Delivers:** Complete vehicle inventory management — purchase recording (3 channels), status transitions, repair history, additional costs, mileage tracking, cost basis auto-calculation.
**Addresses:** BR-001 through BR-014, BR-034 (cost basis), mileage history.
**Avoids:** State machine bypass (pitfall 2 — transition function enforced before any UI is built).
**Implements:** `vehicles.service.ts`, `purchases.service.ts`, `repairs.service.ts`, `VehicleTable`, `VehicleDetail` page, status machine enforcement at DB level.

---

### Phase 3: Supplier and Customer Directories
**Rationale:** Reference data that purchase and sale forms depend on. Inline creation during forms (modal/slide-over, no redirect) is a table-stakes UX expectation. These are relatively simple CRUD modules but must exist before Phase 4 sales forms can be completed end-to-end.
**Delivers:** Supplier directory (company + contacts), repair vendor directory, customer directory, inline creation from any form that needs them.
**Addresses:** BR-008 (suppliers), BR-009 (repair vendors), BR-023 (customers).
**Avoids:** Leaving sales forms in a half-broken state where dropdowns have no data.

---

### Phase 4: Sales, Advances, and File Uploads
**Rationale:** Depends on vehicles (Phase 2) and customers (Phase 3). The four sale channels have distinct state transitions and the advance system has business-specific expiry logic that requires the Vercel cron job. R2 file uploads are a hard blocker for lease/finance sales (DO document is mandatory per BR-019). Building file upload in parallel with sale forms ensures lease sales are testable end-to-end when Phase 4 closes.
**Delivers:** Sale recording (cash, advance/reservation, lease/finance, trade-in), advance payment management with tiered expiry rules, Vercel cron for advance expiry, R2 presigned upload for DO documents.
**Addresses:** BR-015 through BR-021, BR-016–BR-017 (advance expiry), BR-018–BR-019 (lease/finance with DO).
**Avoids:**
- Advance cron silent failure (pitfall 7 — idempotent job with manual trigger and structured logging)
- R2 CORS misconfiguration (pitfall 8 — tested from deployed Vercel domain)
- Streaming file bytes through Vercel (presigned PUT URL pattern throughout)

---

### Phase 5: Approval Workflows and Notifications
**Rationale:** Approval gates (discount, write-off, refund, sale edit) depend on SaleRecord and AdvancePayment existing. Notifications depend on approval events being generated. Building this after sales ensures the approval triggers have real data to act on.
**Delivers:** ApprovalRequest creation and resolution for all 4 gates, in-app notification bell with unread count and linked records, notification delivery for approval events and advance expiry alerts.
**Addresses:** BR-027–BR-028 (approval workflows), BR-030–BR-031 (notifications).
**Avoids:** Approval payload exposure to non-manager roles (security — server-side filter enforced in this phase).

---

### Phase 6: PDF Invoice Generation
**Rationale:** Requires SaleRecord to exist (Phase 4). Isolated as its own phase because the Vercel cold-start timeout risk for `@react-pdf/renderer` requires careful testing and dedicated optimization that shouldn't block the rest of the sales flow.
**Delivers:** Invoice PDF generation from `/api/sales/:id/invoice`, downloadable from the sale detail page, audit log entry on each generation.
**Addresses:** BR-022 (invoice generation).
**Avoids:** PDF timeout on cold Neon start (pitfall 7 — pre-fetched data, `renderToBuffer()`, `runtime = 'nodejs'`, cold-start test before shipping).

---

### Phase 7: Reports
**Rationale:** All 7 reports are read-only aggregations over transactional data that must exist first. No new entities. Build last among core features — reports are only accurate once all data sources are stable.
**Delivers:** RPT-001 through RPT-007 with date-range filtering, CSV export, PDF export, per-vehicle profit, business cash flow view.
**Addresses:** BR-035–BR-036 (profit + cash flow), all 7 RPT requirements.
**Avoids:** N+1 queries on inventory list (pitfall — use Prisma `include` or `groupBy`, never loop over `findUnique`); report export row limits (cap at 1,000 rows with date range validation server-side).

---

### Phase 8: Audit Trail Viewer
**Rationale:** AuditLog is written throughout all previous phases. This phase adds only the read-only admin UI. Low risk, no new write paths, can be deferred without blocking any operation.
**Delivers:** Field-level audit history viewer on vehicle detail pages and per-entity pages; admin-accessible audit search.
**Addresses:** BR-029 (audit trail UI — the write side is implemented in Phases 1–7).

---

### Phase 9: Historical Data Import
**Rationale:** Must come last — import templates reference entity fields that must be finalized first. If schemas change after import is built, templates break. This is a one-time operation and does not block the system going live.
**Delivers:** One-time CSV import for historical vehicles, sales, customers, and suppliers. Validation-first (per-row error display before commit), atomic per batch, imported records flagged distinctly.
**Addresses:** BR-032–BR-033.
**Avoids:** Import transaction timeout (chunked batches with `createMany`, never a single transaction for 500+ rows); partial commit on failure (verify full rollback on batch with one invalid row).

---

### Phase Ordering Rationale

- **Foundation first:** Auth, Prisma schema, CASL, and utilities are load-bearing dependencies for everything. Mistakes here (wrong connection string, missing index, skipped currency utility) compound every subsequent phase.
- **Vehicle before sale:** A vehicle must exist before it can be sold — this is a hard data dependency, not just a suggestion.
- **Directories before sales:** Sale forms require customer records; repair records require vendor records. Building them before sales prevents half-working forms.
- **File uploads concurrent with sales:** R2 upload is a hard blocker for lease sales; it can be built in parallel with the sale form but must be ready before lease sales are testable.
- **Approvals after sales:** Approval gates are triggered by sale events; they can't be meaningfully tested without real sales data.
- **Reports last among core features:** Reports are read-only over existing data; they are the most stable to build once all data sources are established.
- **Import after everything:** Schema must be frozen before import templates are designed.

---

### Research Flags

**Phases needing deeper research during planning:**

- **Phase 4 (Sales + Advances):** The four sale types have distinct state transitions and financial implications. The lease/finance flow (Finance Pending → DO Received → Sold) and the trade-in-to-new-inventory conversion (BR-021) have enough edge cases that the planning step should include a dedicated research pass on the state machine transitions for each sale type.
- **Phase 6 (PDF Invoice):** Cold-start timeout behavior on Vercel Hobby is sensitive to system configuration at the time. Worth a spike test in the planning stage to confirm PDF generation stays under 10 seconds from a fresh Neon compute wake.
- **Phase 8 (Advance Cron):** Vercel Cron behavior on Hobby tier (frequency limits, failure visibility) should be verified against current Vercel documentation during planning — the docs change more frequently than the underlying behavior.

**Phases with standard, well-documented patterns (skip research-phase):**

- **Phase 1 (Foundation):** Prisma + Neon + Better Auth + CASL setup patterns are fully documented with code examples in STACK.md and ARCHITECTURE.md. No unknown territory.
- **Phase 3 (Directories):** Standard CRUD with inline modal creation. Established pattern in the stack with no novel decisions.
- **Phase 7 (Reports):** Aggregation queries over indexed Prisma tables. Well-understood; the TanStack Table server-side pagination pattern handles display.
- **Phase 9 (Import):** CSV validation + chunked `createMany` pattern is standard. The main risk (transaction timeout on large batches) is already identified and solved.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All libraries verified via official docs, GitHub releases, and community sources. Version compatibility matrix is fully specified. |
| Features | HIGH | Requirements are explicit and comprehensive (38 BRs). Feature landscape verified against DMS competitor analysis. Minor gaps (search bar on inventory, dashboard counts) are implicit and uncontroversial. |
| Architecture | HIGH | Patterns verified against Next.js official docs, Prisma guides, and CASL official cookbook. Build order is internally consistent with feature dependency graph. |
| Pitfalls | HIGH | Critical pitfalls verified against official docs and community incident reports. Domain pitfalls derived from spec analysis cross-referenced with common DMS failure patterns. |

**Overall confidence: HIGH**

### Gaps to Address

- **Dashboard / home screen:** No home screen is specified in the requirements. A dashboard showing key counts (vehicles in stock, in repair, pending advances, pending approvals) is expected by users but not formally required. Treat as implicit; define scope during Phase 1 planning.
- **Password reset:** Admin-only reset is the safest default given no email infrastructure, but the exact admin flow is unspecified. Define during Phase 1 (auth phase).
- **Advance extension (still-active):** BR-017 covers expired advance extension but the flow for extending a not-yet-expired advance is unspecified. Confirm with client before implementing Phase 4.
- **Currency decimal precision:** `APP_CURRENCY` env var exists but decimal places for non-standard currencies (e.g., JPY = 0 decimals) should also be captured in `CURRENCY_DECIMAL_PLACES`. Define in Phase 1 before any form is created.
- **Notification polling vs. SSE:** The research identifies both patterns as viable. The choice (30s polling vs. Server-Sent Events) should be decided during Phase 5 planning based on Vercel Hobby function invocation limits (100K/month).
- **TanStack Form + Zod v4 native compatibility:** Research is MEDIUM confidence (GitHub issue + community confirmation, not official docs). If issues arise during Phase 1 setup, fall back to `@tanstack/zod-form-adapter`.

---

## Sources

### Primary (HIGH confidence)
- [Next.js App Router Docs](https://nextjs.org/docs/app) — RSC patterns, Route Handlers, caching layers, serverExternalPackages
- [Prisma + Neon Guide](https://neon.com/docs/guides/prisma) — two-connection-string pattern, adapter setup
- [Better Auth Next.js Docs](https://better-auth.com/docs/integrations/next) — nextCookies plugin, session management
- [CASL Official Docs](https://casl.js.org/v6/en/cookbook/roles-with-persisted-permissions/) — persisted permissions, isomorphic enforcement
- [TanStack Form v1 Announcement](https://tanstack.com/blog/announcing-tanstack-form-v1) — stable May 2025, Server Actions support
- [Cloudflare R2 Presigned URL Docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) — presign pattern, CORS configuration
- [shadcn/ui Tailwind v4 Docs](https://ui.shadcn.com/docs/tailwind-v4) — tw-animate-css replacement
- [Neon Plans](https://neon.com/docs/introduction/plans) — free tier limits
- [Vercel Hobby Plan Limits](https://vercel.com/docs/plans/hobby) — 10s function timeout

### Secondary (MEDIUM confidence)
- [CASL GitHub Releases](https://github.com/stalniy/casl/releases) — @casl/ability@6.8.0, @casl/react@5.0.1 versions
- [@react-pdf/renderer GitHub Issue #2912](https://github.com/diegomura/react-pdf/issues/2912) — React 19 support confirmed in v4.1.0
- [Next.js Caching Deep Dive Discussion #54075](https://github.com/vercel/next.js/discussions/54075) — Router Cache stale data behavior
- [DealerClick 2026 DMS Buyer's Guide](https://dealerclick.com/blog/dealer-management-software-buyers-guide-2026) — DMS feature landscape
- [Frazer DMS](https://www.frazer.com/), [DealerCenter](https://www.dealercenter.com/), [MotorDesk](https://motordesk.com/) — competitor feature analysis

### Tertiary (LOW confidence)
- TanStack Form + Zod v4 native compatibility — GitHub issue #1529 + community confirmation; not yet in official docs

---

*Research completed: 2026-03-21*
*Ready for roadmap: yes*
