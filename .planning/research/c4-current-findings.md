# VSMS C4 current-state findings

Research date: 2026-10-25. Scope: repository working tree at `/Users/alpha/Developer/Personal/vamotors`; source inspection, not an audit of a deployed environment. Application code was not changed. No further agents were delegated.

## 1. Read this first

**Implemented:** a Next.js frontend shell with real same-origin HTTP calls to mock Route Handlers, process-memory mutations, and some direct client fixture imports. **Not implemented:** production authentication, authorization, database, durable file storage, domain transaction pipeline, expiry scheduling, invoice generation, or deployment automation. The shell scope explicitly defers those capabilities (`.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:9-13,76-92,183-193`).

Status vocabulary used below:

- **I — Implemented:** observed executable source; does not mean production-ready or business-complete.
- **T — Documented target:** requirements or prior planning, not an existing code component.
- **R — New recommendation:** advice from this investigation, not an approved prior decision.
- Ownership means **code responsibility/logical subsystem**, not an inferred person or team. No operational ownership registry was found.

Evidence precedence: actual source for current behavior; phase context for intentional shell decisions; `.planning/PROJECT.md` and `.planning/REQUIREMENTS.md` for current targets; earlier specifications for business meaning and unresolved conflicts. Do not turn planning diagrams into current-state diagrams.

Instructions read: repository `CLAUDE.md` (notably constraints at lines 10-18 and GSD workflow at 184-194). No repository `AGENTS.md` or ancestor instructions file was found by the bounded filesystem scan. This file is the specifically commissioned research deliverable, not an application change. Initial working tree already had modifications to `package.json`, `pnpm-lock.yaml`, and untracked `pnpm-workspace.yaml`; those were left untouched.

## 2. C1 — System context

### People and system boundary

| ID | Element | Status and responsibility | Evidence |
|---|---|---|---|
| P1 | Cashier / daily operations staff | T persona; primary user recording purchases, repairs, sales, customers, and lease work. I can use all shell screens without role enforcement. | `.planning/PROJECT.md:62-69`; `docs/02-2-requirements-specification.md:35-47`; `app/(app)/layout.tsx:1-15` |
| P2 | Manager | T persona approving discounts, write-offs, refunds, sale edits and reviewing finances; shell approval API does not verify identity. | `.planning/ROADMAP.md:133-148`; `app/api/approvals/route.ts:31-58` |
| P3 | Administrator | T account/permission administrator; I user-directory CRUD is mock metadata, not identity provisioning. | `.planning/PROJECT.md:28-30`; `app/api/users/route.ts:20-72` |
| P4 | Sales person / finance staff | T occasional users. I schema hardcodes `SalesExecutive` and `FinanceOfficer` alongside `Administrator` and `Manager`; no separate Cashier role enum. | `.planning/PROJECT.md:63`; `lib/mock-data/schemas.ts:223-234` |
| S1 | VSMS — VA Motors internal operations system | I shell; T single-dealership vehicle financial lifecycle plus lease-brokerage operations. VA Motors owns business records. | `.planning/PROJECT.md:3-9,46-58`; `README.md:1-3` |
| X1 | Customers and guarantors | Business participants, **not application users or integrated external systems**. Staff enters their identity and eligibility information. | `.planning/PROJECT.md:54`; `docs/round_1_customer_feedback.md:13-16`; `lib/mock-data/schemas.ts:56-67,182-189` |
| X2 | Suppliers, repair vendors, finance companies | Business counterparties represented by records, **not network integrations**. Contact, eligibility confirmation, and file references are manual. | `lib/mock-data/schemas.ts:144-158`; `docs/round_1_customer_feedback.md:16-30`; `.planning/PROJECT.md:50` |
| X3 | Courier / physical documents / historical spreadsheets | T manual dispatch and one-time import sources. No courier API or spreadsheet import implementation. | `docs/round_1_customer_feedback.md:30`; `.planning/ROADMAP.md:226-239` |

### C1 relationships

1. P1/P2/P3/P4 → S1: use browser UI for internal operations. I interaction is HTML/JS/CSS and same-origin HTTP; local demo uses HTTP, not a proven HTTPS deployment (`playwright.config.ts:3-4`; `hooks/use-entity-query.ts:19-29`). Roles describe business responsibilities, not implemented access boundaries.
2. X1/X2/X3 ↔ staff: manual information/documents/phone or WhatsApp/courier exchange. **No software-to-software protocol edge** should be drawn from VSMS to banks, WhatsApp, finance companies, accounting systems, or couriers (`docs/round_1_customer_feedback.md:16-31`; `docs/02-1-business-requirements-specification.md:80-92`).
3. S1 → Neon PostgreSQL and Cloudflare R2: **T only**, service providers outside the VA Motors ownership boundary. Vercel is a T hosting/deployment boundary, not another business system (`docs/03-tech-and-infra-stack.md:18-42`).
4. Better Auth, CASL, Prisma, and PDF renderer are T **in-process libraries/components**, not external SaaS systems (`CLAUDE.md:33-67`; `docs/03-tech-and-infra-stack.md:84-106`).

## 3. C2 — Containers and deployment reality

| ID | Container/runtime | Status | Responsibility / storage / ownership |
|---|---|---|---|
| C2-B | Browser application | I | React 19.2.5 client components, TanStack Query cache, TanStack Table/Form, nuqs URL state, shadcn/Radix UI. VA Motors application code delivered to user's browser. Cache and form state are not durable business storage. (`package.json:20-49`; `components/layout/providers.tsx:7-38`) |
| C2-N | Next.js web application | I | Next.js 16.1.7, App Router page/layout server rendering plus JSON Route Handlers. One project and deployable application, not separately deployed frontend/backend microservices. (`package.json:6-18,36-42`; `app/layout.tsx:1-34`; `app/api/vehicles/route.ts:1-43`) |
| C2-D | Neon PostgreSQL | T, absent from runtime | Planned durable relational business/auth/audit records via Prisma/Neon driver. No `prisma/`, `lib/db.ts`, migrations, or database dependency in current package manifest. (`.planning/REQUIREMENTS.md:12-19`; `package.json:20-74`) |
| C2-O | Cloudflare R2 bucket | T, absent from runtime | Planned images and DO/inspection documents. API generates signed URL; browser uploads bytes directly. No AWS SDK dependency or presign handler exists. (`docs/03-tech-and-infra-stack.md:100-106`; `package.json:20-74`) |

**Important C4 modeling choice:** C2-B and C2-N are two runtime responsibilities of one Next.js application. They are not independently deployable services in this repository. At a deployment-centric C2 level it is also reasonable to draw one “Next.js web application” with browser client noted; preserve the browser/server trust boundary in either view. The mock Map is an **internal C3 component of C2-N**, not an external database container.

### C2 relationships and protocols

| From → to | Protocol / payload | Status and owner |
|---|---|---|
| Person → C2-B | Browser UI interactions | I; user device |
| C2-B → C2-N page renderer | Same-origin HTTP GET, HTML/RSC and JS/CSS delivery, Next navigation | I; App Router; representative server page only passes route ID to client detail (`app/(app)/vehicles/[id]/page.tsx:1-10`) |
| C2-B → C2-N API | Relative-URL HTTP GET/POST/PATCH, JSON; list query strings; no implemented auth token/session contract | I; fetch hooks (`hooks/use-entity-query.ts:9-57`; `hooks/use-entity-mutation.ts:37-79`) |
| C2-N handlers → memory store | In-process TypeScript calls, `Map<string,T>` | I; `lib/mock-store.ts:32-74,149-164` |
| C2-N/C2-B → bundled fixtures | ES module imports / array lookup, **not HTTP** | I; `lib/mock-data/reports.ts:5-10`; `components/sales/record-sale-dialog.tsx:5-6,82-85` |
| C2-B → local selected files | File API, `URL.createObjectURL`, browser blob URLs | I local preview only; no remote upload (`components/shared/file-dropzone.tsx:64-113`) |
| C2-N → C2-D | Prisma + Neon serverless driver, planned HTTP/serverless database access; pooled/direct connection separation | T only (`docs/03-tech-and-infra-stack.md:92-98`; `.planning/REQUIREMENTS.md:13`) |
| C2-N → C2-O; C2-B → C2-O | Signed URL generation with S3-compatible SDK; direct HTTPS PUT of bytes | T only (`CLAUDE.md:58-63`; `docs/03-tech-and-infra-stack.md:104-106`) |

### Deployment facts, not promises

- I scripts: `portless run next dev --turbopack`; direct port 8000 alternative; `next build`; `next start` (`package.json:6-10`). README still says plain localhost:3000 and Next.js 15 (`README.md:10-17,65-73`); prefer actual manifest.
- I `next.config.mjs` only sets `turbopack.root` (`next.config.mjs:1-8`). No `vercel.json`, CI workflows, Docker configuration, PWA manifest/service worker, database schema, or deployment IaC was found in the source inventory. Absence findings are filesystem observations, not line-addressable file claims.
- T intended hosting: Vercel Hobby + Neon free + R2 free; monolith, $0/month constraint (`.planning/PROJECT.md:73-81`). Cost quotas and 10-second timeout are **recorded project assumptions**, not independently revalidated provider guarantees.
- Prior local-demo decision explicitly excluded Vercel preview deployment (`.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:87-91,183-193`). No deployed URL or provisioned resources were verified.
- I mutable records are module-local Maps reset from fixtures. Process restart/cold start/redeployment loses writes; multiple processes or separately bundled serverless handlers cannot be assumed to share state. This follows from module-scoped store construction, not a durable DB contract (`lib/mock-store.ts:32-45,149-164`).
- `.env.local.example:1-2` only documents artificial latency. I `injectLatency()` defaults to 200–600ms for mock endpoints (`lib/utils.ts:8-15`).

## 4. C3 — Browser-side component inventory

Each row is a logical component/module group inside C2-B, not a separate deployable service.

| ID / owner | Responsibilities, key symbols, dependencies | Evidence |
|---|---|---|
| B-SHELL / navigation | `RootLayout` composes theme, data providers and toast host; `AppLayout` composes sidebar/header/content; `NAV_SECTIONS` provides 17 links in five groups; `CommandMenu` is navigation search, not entity search. | `app/layout.tsx:17-34`; `app/(app)/layout.tsx:5-15`; `components/layout/nav-config.ts:34-77`; `components/layout/command-menu.tsx:20-65` |
| B-DATA / HTTP/cache | `Providers`, `getQueryClient`, `useEntityQuery<T>`, `useEntityDetail<T>`, `useEntityMutation`. Browser singleton QueryClient; server render gets new client. Generic query stale time 30s (provider default 60s); keys `[entityKey, params]` / `[entityKey,id]`. Mutation success invalidates **one key prefix** and displays toast; no generalized optimistic update or transaction. | `components/layout/providers.tsx:7-38`; `hooks/use-entity-query.ts:9-57`; `hooks/use-entity-mutation.ts:46-79` |
| B-TABLE / reusable grids | `DataTableShell<TData>` → `useDataTable` → TanStack Table / nuqs → copied DiceUI components. URL page/perPage/sort, selection/visibility; callback exposes only page/perPage/first sort. Manual server pagination/sorting/filtering. | `components/shared/data-table-shell.tsx:15-20,48-104`; `hooks/use-data-table.ts:119-174,200-265,268-315` |
| B-VEHICLE / inventory | `VehiclesTable`, `vehicleColumns`, `VehicleDetailTabs`; detail composes overview, financials, repair and sales history. Main vehicle is API-backed; history/repair sums use bundled fixtures. Audit tab is explanatory placeholder. | `components/vehicles/vehicles-table.tsx:11-54`; `components/vehicles/vehicle-detail-tabs.tsx:79-84,139-174`; `components/vehicles/vehicle-financials.tsx:17-25`; `components/vehicles/vehicle-repairs.tsx:16-17`; `components/vehicles/vehicle-sales-history.tsx:16-17` |
| B-PURCHASE / acquisition | `PurchasesTable`, `RecordPurchaseSheet`, `PurchaseForm`, `CashPurchaseTab`, `LeaseSettlementTab`, `BrandNewTab`. Forms use TanStack Form, submit cents to `/api/purchases`; current purchase list is vehicles, not PurchaseRecord history. | `app/(app)/purchases/page.tsx:1-26`; `components/purchases/purchase-form.tsx:8-29`; `components/purchases/purchases-table.tsx:20-29`; `components/purchases/cash-purchase-tab.tsx:77-120` |
| B-SALES / sales | `SalesTable`, `RecordSaleDialog`, `SaleDetailView`, `SaleTimeline`. Main records from API; vehicle/customer/finance names from fixtures. Record dialog uses basic React state, not TanStack Form. Invoice button disabled. | `components/sales/record-sale-dialog.tsx:31-85`; `components/sales/sale-detail-view.tsx:30-32,63-64,207-209` |
| B-REPAIR / workshop | `RepairsTable`, `repairsColumns`, `SendRepairDialog`. API list/create; fixture-only vehicle/vendor selectors. Row links to vehicle detail; no repair detail route. | `components/repairs/repairs-table.tsx:20-54`; `components/repairs/send-repair-dialog.tsx:32-71` |
| B-DIRECTORY / customers and counterparties | `CustomersTable`, `AddCustomerDialog`, `CustomerDetailView`; `ThirdPartiesTable`, `AddThirdPartyDialog`, `ThirdPartyDetailView`. Supplier/vendor/finance variants share one entity/route, no standalone supplier system. | `app/(app)/customers/page.tsx:1-26`; `app/(app)/customers/[id]/page.tsx:1-14`; `app/(app)/third-parties/page.tsx:1-26`; `app/api/third-parties/[id]/route.ts:24-81` |
| B-GOV / approvals and notifications | `ApprovalsTable`, `ApprovalActionDialog`, `NotificationPopover`, `useApprovalsCount`. Approval pending count polls every 30s. Notification UI GET only: mark-all button unwired; links always use `/vehicles/{entityId}` regardless of entity type. No SSE. | `app/(app)/approvals/page.tsx:1-45`; `hooks/use-approvals-count.ts:5-17`; `components/layout/notification-popover.tsx:21-33,53-73` |
| B-ADMIN / mock configuration | `UsersTable`, `AddUserDialog`, `SettingsForm`, `AdvanceTiersTable`. Settings loaded to local state and PATCHed, but not a runtime configuration service consumed consistently throughout app. | `app/(app)/users/page.tsx:1-26`; `components/settings/settings-form.tsx:31-96`; `lib/utils.ts:23-41` |
| B-DASH / overview | `KPICards`, `SalesChart`, `ActivityFeed`, `QuickActions`; read dashboard API; activity remains static fixture. | `app/(app)/dashboard/page.tsx:1-21`; `app/api/dashboard/route.ts:8-43` |
| B-REPORT / reporting UI | `ReportHubCards`, generic `ReportTable<TData>`, seven report pages; URL date filters and paginated HTTP reads. Cash flow page additionally renders summary cards. No export operation in generic report component. | `app/(app)/reports/page.tsx:1-14`; `components/reports/report-table.tsx:38-76,95-159`; `app/(app)/cash-flow/page.tsx:1-242` |
| B-LEASE / brokerage | `LeaseDealsTable`, `LeaseDealDetailTabs`, `LeaseComparisonView`, `RateSheetsView`, `DispatchTables`, `ReconciliationTable`. HTTP reads; create deal, dispatch marking and reconcile mutation; deal detail largely read-only. Comparisons “Proceed” goes to local charge-summary state, not persisted deal creation. | `components/lease/lease-deals-table.tsx:46-104`; `components/lease/lease-deal-detail-tabs.tsx:118-187,223-228`; `components/lease/lease-comparison-view.tsx:100-144,152-167,304-314`; `components/lease/dispatch-tables.tsx:64-93`; `components/lease/reconciliation-table.tsx:144-178` |
| B-FILE / preview UI | `FileDropzone`, `FilePreview`: local browser File objects, size/count restrictions, simulated progress and blob previews; no network or durable storage. Lease `PhotoGrid` displays presence/filename, not an upload pipeline. | `components/shared/file-dropzone.tsx:13-28,64-123`; `components/lease/lease-deal-detail-tabs.tsx:133-167` |
| B-UI / design system | Copied shadcn/Radix primitives and DiceUI table helpers; radix-vega style, CSS variables; next-themes system/light/dark with keyboard toggle. | `components.json:1-24`; `components/theme-provider.tsx:6-20,37-66` |

**Table caveat:** the table hook sets `manualFiltering: true`, but `DataTableState` omits filters and `VehiclesTable` only forwards page/pageSize/sortBy/sortDir. Thus do not claim all visual filter controls execute server filters. API capability and UI wiring differ (`hooks/use-data-table.ts:297-299`; `components/shared/data-table-shell.tsx:15-20,71-80`; `components/vehicles/vehicles-table.tsx:20-29`).

### Page inventory (actual public URLs)

There are **31 `page.tsx` files: 29 under `(app)`, plus `/login` and `/` redirect**. Route-group name `(app)` is not part of a public URL and does not provide authentication.

- `/` → `/dashboard` (`app/page.tsx:1-5`); `/login` (`app/login/page.tsx:11-78`).
- `/dashboard` (`app/(app)/dashboard/page.tsx:1-21`).
- `/vehicles`, `/vehicles/[id]` (`app/(app)/vehicles/page.tsx:1-14`; `app/(app)/vehicles/[id]/page.tsx:1-10`).
- `/purchases`, `/repairs` (`app/(app)/purchases/page.tsx:1-26`; `app/(app)/repairs/page.tsx:1-26`).
- `/sales`, `/sales/[id]` (`app/(app)/sales/page.tsx:1-26`; `app/(app)/sales/[id]/page.tsx:1-14`).
- `/customers`, `/customers/[id]` (`app/(app)/customers/page.tsx:1-26`; `app/(app)/customers/[id]/page.tsx:1-14`).
- `/third-parties`, `/third-parties/[id]` (`app/(app)/third-parties/page.tsx:1-26`; `app/(app)/third-parties/[id]/page.tsx:1-14`).
- `/approvals`, `/users`, `/settings` (`app/(app)/approvals/page.tsx:1-45`; `app/(app)/users/page.tsx:1-26`; `app/(app)/settings/page.tsx:1-14`).
- `/reports` plus `/reports/stock`, `/reports/sales`, `/reports/purchases`, `/reports/repairs`, `/reports/advances`, `/reports/profit`, `/reports/audit` (corresponding `app/(app)/reports/*/page.tsx`, respectively lines 1-75, 1-105, 1-70, 1-90, 1-77, 1-86, 1-61; hub lines 1-14).
- `/cash-flow` (`app/(app)/cash-flow/page.tsx:1-242`).
- `/lease-deals`, `/lease-deals/[id]`, `/lease-comparison`, `/lease-rate-sheets`, `/lease-dispatch`, `/lease-reconciliation` (`app/(app)/lease-deals/page.tsx:1-18`; corresponding other page files each lines 1-14).

No current `/advances`, `/suppliers`, `/roles`, `/import`, repair-detail, purchase-detail, write-off, or invoice route. Some of those appear in older target architecture drawings, not executable routing.

## 5. C3 — Server-side component inventory and complete API surface

### Components

- **N-HTTP:** 30 Route Handler files under `app/api`, **49 exported HTTP handlers**. Each domain handler generally injects latency, parses request data, directly queries/updates a mock store or fixture projection, returns `NextResponse.json`. There is no common authentication/authorization/validation/service/audit pipeline; see representative full implementations `app/api/vehicles/route.ts:6-43`, `app/api/purchases/route.ts:6-66`, `app/api/sales/route.ts:6-67`.
- **N-MEM:** `MockStore<T>` and 13 typed instances plus singleton `SettingsStore`: vehicles, customers, sales, repairs, approvals, lease deals, third parties, notifications, users, cash-flow entries, dispatch entries, reconciliation entries, rate sheets. Owns memory lifecycle, CRUD and query, not domain transactions (`lib/mock-store.ts:23-164`). `resetAll()` resets all 14 stores (`lib/mock-store.ts:172-187`).
- **N-FIX:** fixture ES modules and report helpers. Initialization uses `structuredClone` to separate mutable store data from bundled fixture arrays (`lib/mock-store.ts:36-45`). Reports largely read original fixtures, not stores (`lib/mock-data/reports.ts:5-10,21-34,44-74,136-145`).
- **N-CONTRACT:** Zod entity/schema definitions and inferred TS types in `lib/mock-data/schemas.ts:1-357`; **not a relational schema**. Handlers mostly use `as` type assertions, not `Schema.parse/safeParse` (`app/api/vehicles/route.ts:32-41`; `app/api/sales/route.ts:55-65`). Runtime validation is selective ad hoc checks (e.g. approvals and required user fields), not comprehensive Zod validation (`app/api/approvals/route.ts:34-45`; `app/api/users/route.ts:23-38`).
- **N-UTIL:** `injectLatency`, `formatCurrency`, `parseCurrencyInput`; separate tested money helper `toCents/fromCents/addCents/formatCents`. Existing forms still use `parseFloat` and rounding rather than consistently calling the stricter helper (`lib/utils.ts:10-41`; `lib/money.ts:12-64`; `components/purchases/cash-purchase-tab.tsx:87-117`).
- **N-TEST:** gated `/api/test/reset`, not `/api/__test__/reset` (stale comments use the old name). Explicit nodejs runtime; Vercel production hard-block, production test override, optional secret header (`app/api/test/reset/route.ts:4-50`; `tests/api/vehicles.api.spec.ts:3-12`).

### Endpoint matrix

All paths below have `/api` prefix. Read endpoints use HTTP GET; mutations JSON POST/PATCH. No DELETE handler is currently exported, despite generic hook/store support.

| Route | Methods and source lines | Data owner / behavior |
|---|---|---|
| `/vehicles` | GET 6-27; POST 29-43 (`app/api/vehicles/route.ts`) | `vehiclesStore`; paginated top-level search, status/availability filters, raw create |
| `/vehicles/[id]` | GET 8-19; PATCH 21-33 (`app/api/vehicles/[id]/route.ts`) | `vehiclesStore`; patch arbitrary fields; no timestamp refresh or transition validation |
| `/purchases` | GET 6-25; POST 29-66 (`app/api/purchases/route.ts`) | **Same `vehiclesStore`**; creates Purchased/unavailable vehicle; no purchase ledger |
| `/sales` | GET 6-50; POST 52-67 (`app/api/sales/route.ts`) | `salesStore`; filters full set/date then paginates; create sale only |
| `/sales/[id]` | GET 8-19; PATCH 21-33 (`app/api/sales/[id]/route.ts`) | `salesStore`; no approval/edit reason/lifecycle effects |
| `/repairs` | GET 6-25; POST 27-42; PATCH 44-61 (`app/api/repairs/route.ts`) | `repairsStore`; PATCH uses body id; no vehicle/cost update |
| `/customers` | GET 6-21; POST 23-37 (`app/api/customers/route.ts`) | `customersStore` |
| `/customers/[id]` | GET 8-34 (`app/api/customers/[id]/route.ts`) | `customersStore` + `salesStore`; vehicle names from static fixture Map |
| `/third-parties` | GET 6-25; POST 27-43 (`app/api/third-parties/route.ts`) | `thirdPartiesStore`; Supplier/RepairVendor/FinanceCompany filter |
| `/third-parties/[id]` | GET 11-82; PATCH 84-100 (`app/api/third-parties/[id]/route.ts`) | `thirdPartiesStore`; supplier history from vehiclesStore; vendor history from repairsStore; finance history from **lease-finance sales**, not brokerage leaseDealsStore; static vehicle/customer labels |
| `/approvals` | GET 5-29; PATCH 31-59 (`app/api/approvals/route.ts`) | `approvalsStore`; approves/rejects metadata; actor hardcoded `u-001`; no target entity effect |
| `/notifications` | GET 5-18; PATCH 20-50 (`app/api/notifications/route.ts`) | `notificationsStore`; flat list/unread count; mark-one/all API exists, UI unwired |
| `/users` | GET 5-18; POST 20-44; PATCH 46-73 (`app/api/users/route.ts`) | `usersStore`; display-account metadata only, no password/session |
| `/settings` | GET 5-8; PATCH 10-22 (`app/api/settings/route.ts`) | `SettingsStore`; shallow merge |
| `/dashboard` | GET 8-44 (`app/api/dashboard/route.ts`) | `vehiclesStore` + `salesStore`; static activity fixture; Jan–Dec sales counts ignore year, not a true rolling last-12-month series |
| `/cash-flow` | GET 5-43 (`app/api/cash-flow/route.ts`) | `cashFlowStore`; independent seeded ledger; filtered inflow/outflow/net sums; stored running balances not regenerated |
| `/lease-deals` | GET 6-27; POST 29-48 (`app/api/lease-deals/route.ts`) | `leaseDealsStore`; CRUD metadata defaults, not eligibility/workflow enforcement |
| `/lease-deals/[id]` | GET 8-19; PATCH 21-33 (`app/api/lease-deals/[id]/route.ts`) | `leaseDealsStore`; arbitrary patch + updatedAt |
| `/lease-rate-sheets` | GET 5-18 (`app/api/lease-rate-sheets/route.ts`) | `leaseRateSheetsStore`; optional finance-company filter; no maintenance mutation |
| `/lease-comparison` | GET 17-84 (`app/api/lease-comparison/route.ts`) | `leaseRateSheetsStore`; model/year/rate lookup, ±20% loan candidates, selected period or first period, closest amount/company; total installment×months |
| `/lease-dispatch` | GET 5-13; PATCH 15-36 (`app/api/lease-dispatch/route.ts`) | `leaseDispatchStore`; pending/dispatched arrays; mark dispatched + actor default `u-001`; no lease deal update |
| `/lease-reconciliation` | GET 5-21; PATCH 23-45 (`app/api/lease-reconciliation/route.ts`) | `leaseReconciliationStore`; body receivedCommission; discrepancy expected-minus-received; no ledger/remittance batch |
| `/reports/stock` | GET 5-47 (`app/api/reports/stock/route.ts`) | `getStockReport()` → fixtures |
| `/reports/sales` | GET 5-48 (`app/api/reports/sales/route.ts`) | `getSalesReport()` → completed fixture sales with fixture vehicle/customer joins |
| `/reports/profit` | GET 6-72 (`app/api/reports/profit/route.ts`) | `getProfitLossReport()` plus fixture repair costs; no durable accounting |
| `/reports/repairs` | GET 5-45 (`app/api/reports/repairs/route.ts`) | `getRepairCostReport()` → **completed/invoiced** fixture repairs, not “currently in repair” |
| `/reports/purchases` | GET 6-71 (`app/api/reports/purchases/route.ts`) | fixture vehicles/suppliers; purchase + additional costs |
| `/reports/advances` | GET 7-70 (`app/api/reports/advances/route.ts`) | fixture advance sales + fixture vehicle/customer joins |
| `/reports/audit` | GET 5-37 (`app/api/reports/audit/route.ts`) | static `activityFixtures`, not mutation audit logs |
| `/test/reset` | POST 26-51 (`app/api/test/reset/route.ts`) | `resetAll()` rehydrates stores; deployment/test gating |

### C3 relationship list suitable for diagram edges

1. B-SHELL → feature UI components: React composition/props; B-SHELL → B-DATA: React context; B-SHELL → B-GOV: notification/count fetch consumers (`app/layout.tsx:25-29`; `app/(app)/layout.tsx:7-12`; `components/layout/notification-popover.tsx:21-30`).
2. Feature tables → B-TABLE: typed `ColumnDef<T>[]`, data, pageCount, callbacks. B-TABLE → browser URL: nuqs query state; B-TABLE → feature table: `DataTableState` callback; feature table → B-DATA: endpoint + query params (`components/shared/data-table-shell.tsx:27-43,59-80`; `components/vehicles/vehicles-table.tsx:13-29,44-54`).
3. B-DATA → N-HTTP: same-origin HTTP/JSON fetch. N-HTTP → N-UTIL: in-process await artificial delay. N-HTTP → N-MEM: synchronous TS query/create/update. N-MEM → N-FIX: initialization/reset clone. Each read returns JSON → query cache → component re-render (`hooks/use-entity-query.ts:19-31`; `app/api/vehicles/route.ts:6-26`; `lib/mock-store.ts:36-45,74-120`).
4. Feature forms → B-DATA → N-HTTP → N-MEM: POST/PATCH JSON; success → sonner toast + selected query-prefix invalidation. Lease creation/dispatch/reconcile use their own fetch/query-mutation plumbing rather than always reusing generic hook (`hooks/use-entity-mutation.ts:46-79`; `components/lease/lease-deals-table.tsx:73-104`; `components/lease/dispatch-tables.tsx:64-93`).
5. B-VEHICLE/B-SALES/B-REPAIR/B-LEASE → N-FIX **bundled copy**: direct imports/array lookup. This crosses neither HTTP nor a server security gate; show a dashed “static fixture lookup” edge distinct from API-backed reads (`components/vehicles/vehicle-financials.tsx:5-24`; `components/sales/record-sale-dialog.tsx:5-6,82-85`; `components/repairs/send-repair-dialog.tsx:32-38`; `components/lease/lease-deal-detail-tabs.tsx:38-39`).
6. B-REPORT → N-HTTP report handlers → N-FIX report helpers/arrays: HTTP then TS calls. **No read edge from report handlers to updated N-MEM business stores** (`lib/mock-data/reports.ts:5-10`; `app/api/reports/purchases/route.ts:3-4,31-47`; `app/api/reports/audit/route.ts:3-16`).
7. N-HTTP customer/third-party details → several N-MEM stores plus static fixture maps: in-process joins, not DB joins (`app/api/customers/[id]/route.ts:2-6,21-33`; `app/api/third-parties/[id]/route.ts:2-9,26-81`).
8. Test runner → N-TEST → N-MEM: HTTP POST → `resetAll` synchronous calls; then tests → N-HTTP over real HTTP or browser UI (`tests/api/vehicles.api.spec.ts:3-25`; `tests/e2e/fixtures/reset.ts:11-16`; `app/api/test/reset/route.ts:26-50`).

Do not draw event bus, queue, scheduled worker, external auth provider, persistent object-storage connection, or inter-service network edges in the I diagram: these do not exist in the current runtime.

## 6. Data model and ownership, including L4 anchors

| Aggregate / symbol | Current fields and relationships | Current integrity boundary |
|---|---|---|
| `VehicleSchema`, `VehicleStatusSchema` | Ten status strings: Purchased, InStock, InRepair, AdvancePlaced, AdvanceExpired, FinancePending, DOReceived, Delivered, Sold, WrittenOff. Separate availability flag. Vehicle embeds purchase fields, mileage, costs and photos; references supplierId. | Type/schema definition only; no engine+chassis uniqueness or state transition enforcement. `lib/mock-data/schemas.ts:5-50`; `app/api/purchases/route.ts:35-64` |
| `SaleSchema` | vehicleId, customerId, optional financeCompanyId/tradeInVehicleId, cents amounts, advance/DO fields, embedded timeline. Sale statuses omit Delivered; vehicle lifecycle owns it. | No foreign keys, guaranteed down payment/DO, coordinated vehicle update, or computed profit. `lib/mock-data/schemas.ts:73-100`; `app/api/sales/route.ts:52-67`; `.planning/STATE.md:75` |
| `RepairSchema` | vehicleId, vendorId, repair request, sent/return dates and optional invoice, status. | Standalone store write only. `lib/mock-data/schemas.ts:106-119`; `app/api/repairs/route.ts:27-61` |
| `CustomerSchema` / `ThirdPartySchema` | customer identity/contact; third party type, contact-person array, optional commission/processing path. | IDs are string references, not enforced relations. `lib/mock-data/schemas.ts:56-67,144-158` |
| `ApprovalSchema` / `NotificationSchema` | Approval references requestedBy/entityType/entityId and optional approvedBy. Notification references entityType/entityId, read flag. | No request creation/triggers, per-user notification ownership, authorization or business side effects. `lib/mock-data/schemas.ts:125-138,208-217`; `app/api/approvals/route.ts:47-58`; `app/api/notifications/route.ts:5-49` |
| `LeaseDealSchema` | Customer + finance-company IDs; independent vehicleDescription rather than owned inventory Vehicle FK; nested guarantors/photos/checklists, eligibility, fee and dispatch fields. | Suitable for brokerage without purchasing the vehicle; no path state machine or cross-store dispatch effects. `lib/mock-data/schemas.ts:164-202`; `docs/round_1_customer_feedback.md:8-11`; `app/api/lease-deals/[id]/route.ts:21-32` |
| `LeaseRateSheetSchema` | finance-company ID/name, vehicle model/year, maximum loan and amount/period/installment rate cards. | Seeded/read-only via current API; approximate lookup, not live lender quote. `lib/mock-data/schemas.ts:279-292`; `app/api/lease-comparison/route.ts:42-83` |
| `LeaseDispatchSchema` / `LeaseReconciliationSchema` | Dispatch has dealId/source/names/file; reconciliation has dealRef/source/expected/received/discrepancy. Both distinguish VehicleSale and Brokerage. | Independent denormalized store entries, not automatically generated by sale/deal writes. `lib/mock-data/schemas.ts:298-325`; `app/api/lease-dispatch/route.ts:15-35`; `app/api/lease-reconciliation/route.ts:23-44` |
| `CashFlowEntrySchema` / `ActivitySchema` | Cash flow: signed amount, stored runningBalance/reference; activity: user/action/entity/detail text. | No generated financial ledger or before/after audit entries. `lib/mock-data/schemas.ts:265-273,331-338`; `app/api/cash-flow/route.ts:20-42`; `app/api/reports/audit/route.ts:3-16` |
| `UserSchema` / `SettingsSchema` | Four fixed display roles; no password/session/permission model. Settings has company/currency/tier/preferences. | User directory is not Better Auth; settings shallow-merge independent of hardcoded display helpers. `lib/mock-data/schemas.ts:223-259`; `app/api/users/route.ts:34-41`; `lib/mock-store.ts:125-145`; `lib/utils.ts:23-41` |

Other useful L4 anchors: `MockStore.query` (search all top-level string fields, exact string filters, numeric/string sorting, slice pagination) at `lib/mock-store.ts:74-120`; `SettingsStore.update` at 138-141; `resetAll` at 172-187; query serialization at `hooks/use-entity-query.ts:14-19`; mutation HTTP/error handling at `hooks/use-entity-mutation.ts:46-69`; `getStockReport`, `getSalesReport`, `getProfitLossReport`, `getRepairCostReport` at `lib/mock-data/reports.ts:21-34,44-74,136-145`; `toCents`, `fromCents`, `addCents`, `formatCents` at `lib/money.ts:12-64`.

**Missing target entities:** separate PurchaseRecord/active purchase linkage, persistent audit log, dynamic Role/Permission, Session/Account, upload metadata lifecycle, ledger transactions and import batches are not current schema entities. A separate purchase history is especially important: the formal spec preserves physical vehicle identity across repurchases (`docs/02-2-requirements-specification.md:89-124`), whereas current POST purchase always creates a new vehicle (`app/api/purchases/route.ts:35-64`).

## 7. Representative execution traces

### A. Read inventory → detail (I)

1. `/vehicles` server page mounts `VehiclesTable` (`app/(app)/vehicles/page.tsx:1-14`).
2. Table reads local pagination/sort state; `useEntityQuery("vehicles", "/api/vehicles", params)` serializes query string and caches by entity/params (`components/vehicles/vehicles-table.tsx:13-29`; `hooks/use-entity-query.ts:14-31`).
3. GET handler waits artificial delay; builds filters; calls `vehiclesStore.query`; returns `{data,total,page,pageSize}` (`app/api/vehicles/route.ts:6-27`).
4. Store filters/sorts/slices its Map values (`lib/mock-store.ts:74-120`). UI renders with `DataTableShell`; URL changes propagate through callback to new HTTP query (`components/shared/data-table-shell.tsx:59-89`).
5. Row navigation `/vehicles/{id}` passes id through server page; `VehicleDetailTabs` does another GET via `useEntityDetail` (`components/vehicles/vehicles-table.tsx:52-54`; `app/(app)/vehicles/[id]/page.tsx:7-10`; `components/vehicles/vehicle-detail-tabs.tsx:79-84`).
6. Vehicle details are current Map data, but financial repair totals and repair/sales history are original fixture arrays. Therefore recently created repair/sale records need not appear in these tabs (`components/vehicles/vehicle-financials.tsx:17-24`; `components/vehicles/vehicle-repairs.tsx:16-17`; `components/vehicles/vehicle-sales-history.tsx:16-17`).

### B. Record cash purchase (I, partial simulation)

1. Purchases page opens RecordPurchaseSheet; PurchaseForm chooses channel (`app/(app)/purchases/page.tsx:1-26`; `components/purchases/purchase-form.tsx:8-29`).
2. `CashPurchaseTab` converts input decimals with parseFloat/rounding and POSTs via `useEntityMutation` with entityKey `vehicles`. It sends supplier free text but supplierId `""` (`components/purchases/cash-purchase-tab.tsx:77-120`).
3. `/api/purchases` constructs a new `Vehicle` with Purchased/unavailable, `costBasis = body.costBasis ?? body.purchasePrice ?? 0`; additional costs are stored but **not included automatically in costBasis**; photos always empty. It does not preserve supplied free-text supplier/internalNotes or lease settlement-specific fields (`app/api/purchases/route.ts:27-65`; compare `components/purchases/lease-settlement-tab.tsx:87-113`).
4. Only vehicles Map changes. No supplier creation, identity reuse, purchase transaction, audit entry, ledger entry, or notification is created. Success invalidates `["vehicles"]`, **not** purchase list key `["purchases"]`; list may stay stale until normal refetch (`hooks/use-entity-mutation.ts:71-74`; `components/purchases/purchases-table.tsx:20-29`).
5. Form resets immediately after scheduling mutation, not after confirmed success (`components/purchases/cash-purchase-tab.tsx:97-119`).

### C. Record sale / repair (I, misleading side-effect copy)

- Sale dialog uses static customer/vehicle choices; “available” includes AdvancePlaced/FinancePending/DOReceived. It posts basic fields, type-dependent status and **empty timeline** (`components/sales/record-sale-dialog.tsx:31-85`).
- Sale handler writes `salesStore` only. `timeline ?? default` preserves submitted `[]`. It does **not** mark vehicle sold, change availability, record mileage, calculate profit, enforce down payment/DO, create trade-in inventory, or create cash flow/approval/audit/notification. Toast nevertheless says vehicle marked Sold (`app/api/sales/route.ts:52-67`; `components/sales/record-sale-dialog.tsx:40-62`).
- Repair dialog similarly says vehicle status updated to In Repair; handler writes `repairsStore` only. Completing a repair via PATCH does not recalculate vehicle cost basis or change vehicle state (`components/repairs/send-repair-dialog.tsx:46-64`; `app/api/repairs/route.ts:27-61`).

### D. Approve / dispatch / reconcile (I metadata changes, not domain orchestration)

- Approval PATCH validates id/action, writes Approved/Rejected plus **hardcoded** actor `u-001` and date; does not perform the pending discount/refund/write-off/sale edit (`app/api/approvals/route.ts:31-58`).
- Dispatch PATCH writes status/time/tracking only to dispatch store; actor defaults `u-001`; deal status stays independent (`app/api/lease-dispatch/route.ts:15-35`).
- Reconciliation PATCH calculates expected-minus-received and marks Reconciled even with discrepancy; no remittance batch or ledger transaction, no computation of newly overdue deals (`app/api/lease-reconciliation/route.ts:23-44`).

### E. Reports / dashboard / cash flow (I mixed sources)

- Dashboard KPIs read mutable vehicle/sale stores, while activity is fixed; chart buckets by calendar month ignoring year (`app/api/dashboard/route.ts:11-42`).
- Reports read fixture arrays, so they do not reflect store mutations. Stock ageing uses frozen date **2024-11-11**, not today (`lib/mock-data/reports.ts:21-34`).
- Cash flow calculates summary of independent seeded cashFlowStore entries, not of new purchases/sales/repairs. RunningBalance comes from each stored record (`app/api/cash-flow/route.ts:20-42`; `lib/mock-data/schemas.ts:265-273`).

## 8. Authentication, trust boundaries, persistence and operational gaps

- **No real login/logout:** handleSubmit only router.push; logout is a link to `/login`; root redirect and `(app)` layout are unguarded (`app/login/page.tsx:11-17`; `components/layout/user-nav.tsx:29-39`; `app/page.tsx:1-5`; `app/(app)/layout.tsx:5-15`).
- **No identity-derived permissions:** role strings and avatar initials are presentation data; no Better Auth/CASL dependencies or auth service/handler. Mutation endpoints do not enforce user/manager access (`package.json:20-74`; `app/api/users/route.ts:20-72`; `app/api/approvals/route.ts:31-58`).
- **No durable record persistence:** module-memory only; do not describe TanStack cache, URL state, theme preference, sidebar UI preference or blob previews as a business database. Maps seed once per loaded module, and generic `getById/getAll` return object references rather than immutable transactional snapshots (`lib/mock-store.ts:36-72`).
- **No backend domain integrity:** TypeScript assertions are not runtime parsing; arbitrary PATCHes accepted; no transaction rollback, FK uniqueness, idempotency, concurrency controls, append-only audit, state machine or financial posting pipeline. IDs often use prefix + Date.now rather than the separate `generateId` helper (`app/api/purchases/route.ts:32-64`; `app/api/vehicles/[id]/route.ts:21-32`; `lib/id.ts:10-29`).
- **No true upload/PDF/export/background processing:** local dropzone progress is simulated; invoice disabled; report component has no export action; no cron/queue handlers in API inventory (`components/shared/file-dropzone.tsx:87-111`; `components/sales/sale-detail-view.tsx:207-209`; `components/reports/report-table.tsx:95-159`).
- **Test reset needs special attention before a DB migration:** currently protects Vercel production, but non-Vercel production can explicitly open override and secret is optional. Source already lists mandatory secret, origin allow-list, rate limit and audit as Phase 1 TODO (`app/api/test/reset/route.ts:7-50`).

## 9. Test architecture and verification performed

| Tier / owner | Actual implementation | Evidence |
|---|---|---|
| Unit/component / domain helpers and logic-heavy UI | Vitest + React Vite plugin, jsdom, explicit globals false, colocated `*.test.ts(x)`, RTL cleanup/jest-dom. Two current files: money and vehicle columns. | `vitest.config.ts:1-29`; `vitest.setup.ts:1-7`; `lib/money.test.ts:1-72`; `components/vehicles/vehicles-columns.test.tsx:1-59` |
| API / HTTP contract | Playwright request fixture against running production build. Current tests: vehicles paginated response, pageSize, reset reachable. Not handler-import unit tests. | `tests/api/vehicles.api.spec.ts:1-45`; `playwright.config.ts:14-26,37-44` |
| E2E / browser navigation | Chromium Desktop Chrome project; one dashboard → vehicles → detail path; each test calls reset endpoint. Test navigates with `page.goto`, then clicks a vehicle link; it is not a full purchase/sale business workflow. | `playwright.config.ts:45-52`; `tests/e2e/dashboard.spec.ts:1-32`; `tests/e2e/fixtures/reset.ts:11-16` |
| Auth setup / future fixture | Setup project creates empty browser storage-state file; no login performed, no per-role fixtures yet, consuming projects do not set storageState. | `tests/auth.setup.ts:5-20`; `playwright.config.ts:37-52` |
| Gate / developer tooling | `just check`: TS/lint/format/unit; `just test`: unit→API→E2E; optional feature path filtering; `just ci`: check/API/E2E/build. Coverage v8 text+HTML, no thresholds. GitHub Actions wiring deferred. | `Justfile:11-61`; `vitest.config.ts:23-28`; `.planning/phases/00.3-testing-strategy/00.3-CONTEXT.md:118-135` |

Playwright server uses `pnpm build && pnpm start`, localhost port from PORT or 3000, sets TEST_RESET_ENABLED=1; Justfile defaults PORT to 8000. Existing local server may be reused outside CI. API/E2E projects have setup dependency; CI workers 1, retries 1; fullyParallel true (`playwright.config.ts:3-26,37-52`; `Justfile:5`). Reset-per-test against shared global stores is not isolation between concurrent mutating tests; do not claim each worker has its own database.

**Executed during this investigation:** `pnpm test:unit` → **2 files, 16 tests passed**. API/E2E, full build, typecheck, lint, coverage and deployment were **not run** for this research. Passing helper/column tests does not prove business workflow correctness or production auth/security.

**Prior test decisions:** extract pure logic into lib for unit tests; exercise Route Handlers over real HTTP; test logic-heavy UI but not every primitive; performance, automated accessibility, screenshots and multi-browser coverage deferred (`.planning/phases/00.3-testing-strategy/00.3-CONTEXT.md:24-28,39-56,125-135`).

## 10. Documented target and prior-decision reconciliation (T, not I)

1. **Monolith supersedes older NestJS/JWT/RabbitMQ proposal.** Formal March spec still says NestJS, JWT, RabbitMQ (`docs/02-2-requirements-specification.md:11,58-70`). Current project/infra docs explicitly choose Next.js API monolith and credentials/session cookies; no NestJS or RabbitMQ (`.planning/PROJECT.md:75-94`; `docs/03-tech-and-infra-stack.md:14-27,84-90`). Do not copy the older backend/message-bus into the target as approved current design.
2. **Technology targets vs installed versions:** source manifest is Next 16.1.7/React 19.2.5/Zod 3.25.76, not README Next15. Some dependencies remain caret ranges despite original pin-all decision (`package.json:20-74`; `.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:24-31`).
3. **Shared shell + radix-vega + DiceUI are real prior choices.** Wireframes are IA only, not Stitch styling; copied table infrastructure with URL-state bridge is current implementation (`.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:35-46`; `.planning/ROADMAP.md:58-74`; `components.json:3-11`). Not every registry described in context is currently configured (`components.json:24`).
4. **Production request pipeline target:** authenticate → authorize → validate → service → audit → respond; state machine + DB checks; Prisma audit extension; dynamic CASL permissions (`.planning/REQUIREMENTS.md:12-20`). Proposed lib/services, db/auth/casl modules in `.planning/research/ARCHITECTURE.md:65-78,156-180` are not existing modules. That research's `src/` layout and `/suppliers`/`/roles` paths are not the current tree.
5. **Vehicle identity and repurchase target:** physical identity reused, separate PurchaseRecord, activePurchaseId; current denormalized Vehicle schema and purchase handler do not model this (`docs/02-2-requirements-specification.md:89-124`; `lib/mock-data/schemas.ts:18-50`).
6. **Automatic expiry conflict unresolved:** PROJECT says expiry handled manually, while REQUIREMENTS/ROADMAP explicitly require automatic flags + reliable idempotent cron. Present code does neither; fixtures only. Treat automatic detection vs staff resolution as a clarification candidate, not a silently approved interpretation (`.planning/PROJECT.md:66`; `.planning/REQUIREMENTS.md:73-78`; `.planning/ROADMAP.md:114-130`).
7. **Report scope mismatch:** target seven include cash-flow and write-off/disposal; current seven report endpoints include purchases and audit instead, with cash-flow separate and no write-off report. Current repair report is completed/invoiced repairs, target REPT-05 is currently-in-repair (`.planning/REQUIREMENTS.md:145-152`; `lib/mock-data/reports.ts:136-144`; endpoint matrix above).
8. **Single tenant is not single account:** old infra says single-user, but current requirements and user directory anticipate multiple roles and occasional staff. Do not draw tenant/company management or a customer portal (`docs/03-tech-and-infra-stack.md:8,26`; `.planning/PROJECT.md:46-58,63`; `.planning/REQUIREMENTS.md:107-121`).
9. **Commission reconciliation is cross-cutting:** current source enums already separate VehicleSale/Brokerage; business feedback expects finance-company-specific reconciliation methods and overdue logic, which are not implemented by current per-row PATCH (`lib/mock-data/schemas.ts:298-325`; `docs/round_1_customer_feedback.md:39-45`).
10. **Planning progress is stale/inconsistent:** STATE frontmatter says phase 0.3 executing, ROADMAP progress still says testing not planned and shell 0/11 even while shell plan checkboxes are complete. Use source and actual test results for current inventory, not phase percentages (`.planning/STATE.md:1-14,24-33`; `.planning/ROADMAP.md:45-56,248-273`).
11. **Approval status of major stack decisions:** PROJECT key-decision table marks choices `-- Pending`, despite infra narrative and constraints naming them. Label them documented target/constraint, not newly accepted ADRs (`.planning/PROJECT.md:83-94`).

## 11. New recommendations for the eventual C4/interactive artifact (R)

These are recommendations, **not existing architecture or application changes**.

- Default to an **I-only current-state view** with “mock-backed demo; data resets” prominent. Separate toggles/layers for T and R; never draw target Neon/R2/auth as if connected today.
- C1: keep cashier/manager/admin/sales-finance responsibilities visible, and counterparties as manual business context. C2: show browser/server runtime boundary inside a single monolith, memory component inside server, and target durable services separately. C3: group by business capability plus shared shell/data/table and server store/fixture seams. L4: drill into actual symbols and the five traces above instead of rendering a giant class chart.
- Give edges labels for **HTTP JSON**, **in-process call**, **static fixture import**, **local File/blob API**, and **T signed upload/DB access**. Explicitly visualize the two data sources (mutable store vs original fixtures) and missing cross-record effects.
- For ADHD-friendly presentation: one level at a time; short plain-language summary per node; progressive disclosure of source lines and caveats; keyboard-accessible controls; text labels in addition to colors; reduced-motion support; a small legend; “follow a purchase/sale/read” guided mode. This file does not implement or validate that HTML.
- Before production, retain the chosen monolith; implement the already documented secure request pipeline, durable database and transactionally coordinated lifecycle/financial/audit writes. Do not add a queue or split services merely to make a C4 diagram look complete.
- Resolve expiry, report catalog, single-user wording, repurchase model and stale planning counters explicitly before presenting a target as signed off. Revalidate hosting limits/terms against provider documentation at deployment design time rather than promoting historic quota assumptions to guarantees.
- Retain the test layers; add scenario tests for actual aggregate side effects, permission denial and malformed inputs when the production behavior lands. Remove/reset fixture shortcuts behind an explicit data seam rather than assuming existing query shapes already provide complete domain contracts.
