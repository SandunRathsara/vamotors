"""Build the evidence-backed C4 model and embed it in the standalone viewer.

Run from any directory: python3 docs/architecture/build-model.py
This generates documentation only; proposed symbols are not application code.
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARCH = ".planning/research/ARCHITECTURE.md"
SPEC = "docs/02-2-requirements-specification.md"
BRS = "docs/02-1-business-requirements-specification.md"
FEEDBACK = "docs/round_1_customer_feedback.md"
ROADMAP = ".planning/ROADMAP.md"
PROJECT = ".planning/PROJECT.md"
VIEWS = []


def node(id, name, kind, tech, status, x, y, description, detail=(), sources=()):
    return dict(id=id, name=name, type=kind, technology=tech, status=status,
                x=x, y=y, w=260, h=116, description=description,
                detail=list(detail), sources=list(sources))


def edge(a, b, label, detail="", **routing):
    return dict(from_=a, to=b, label=label, detail=detail, **routing)


def view(id, level, title, summary, state, scope, nodes, edges, height=720, groups=(), notes=()):
    for e in edges:
        e["from"] = e.pop("from_")
    VIEWS.append(dict(id=id, level=level, title=title, summary=summary, state=state,
                      scope=scope, nodes=nodes, edges=edges, width=720,
                      height=height, groups=list(groups), notes=list(notes)))


def group(name, x, y, w, h):
    return dict(name=name, x=x, y=y, w=w, h=h)


view("context", "C1", "The dealership in context",
     "Staff run two connected businesses: vehicle trading and lease brokerage.",
     "Target · documented scope", "Software system: VA Motors VSMS", [
    node("staff", "Dealership staff", "Person / role group", "Cashier · sales · finance", "external", 30, 35,
         "Record day-to-day purchases, repairs, sales, payments and brokerage work.",
         ["Cashier is the primary daily user; permissions are configurable rather than hard-coded to these labels.",
          "Customers and finance-company staff do not log in."], [PROJECT+":62–69", BRS+" §5"]),
    node("manager", "Manager / administrator", "Person / role group", "Approvals · access · oversight", "external", 430, 35,
         "Approve controlled changes, manage users and inspect financial reports.",
         ["One person can have multiple roles. Manager approval is a business action, not a separate application."], [SPEC+" §3.14, §9"]),
    node("vsms", "VA Motors VSMS", "Software system", "Internal dealership platform", "planned", 230, 265,
         "Keeps the complete financial story of every vehicle and brokerage deal.",
         ["Inventory, purchases, repairs, sales, advances, lease finance, trade-ins and write-offs.",
          "Customers, third parties, approvals, notifications, reports, invoice generation and audit.",
          "Brokerage handles vehicles owned by customers; it does not automatically create dealership stock.", "Today this system is a mock-backed UI. Target capabilities are planned; proposed corrections are recommended."], [PROJECT, FEEDBACK+":8–44"]),
    node("partners", "Customers & partners", "People outside VSMS", "Suppliers · garages · financiers", "external", 230, 495,
         "Exchange vehicles, money, documents and decisions with staff outside the application.",
         ["Phone, WhatsApp, paper and courier activity is recorded manually by staff.",
          "No banking API, external portal, WhatsApp integration or accounting integration is in scope.",
          "Couriers transport documents; guarantors are recorded as brokerage participants."], [FEEDBACK, BRS+" §2.2"]),
], [edge("staff", "vsms", "Records operations"), edge("manager", "vsms", "Approves & reviews"),
    edge("staff", "partners", "Manual exchange", "No direct system integration.",
         points=[[30,93],[10,93],[10,553],[230,553]], labelX=94, labelY=430)],
     height=650, notes=["C1 shows people and the whole system. Database and hosting details belong in C2 / Deployment.", "Production hosting is unresolved: Vercel Hobby excludes commercial use, conflicting with the documented $0 target. See Deployment and Decisions."])

view("containers-target", "C2", "Target runtime containers",
     "One deployable web app, one database, one private file store.",
     "Target · planned", "VSMS software-system boundary", [
    node("browser", "Staff web application", "Container", "React 19 · browser / PWA", "implemented", 230, 55,
         "Interactive screens, forms, tables and local query cache.",
         ["The web UI exists. Installable PWA behavior is planned; offline business mutations are not proposed.",
          "Client validation improves usability; it never replaces server authorization or validation."], ["package.json", "components/", ROADMAP+" §Phase 1"]),
    node("server", "Next.js application", "Container", "Node.js · App Router + HTTP", "planned", 230, 285,
         "Renders pages and runs authenticated business operations in the same deployment.",
         ["Route Handlers, server-rendered reads, Better Auth, CASL and domain modules share one Node.js application.",
          "Auth libraries and business modules are components, not independent services.",
          "Current routes use mocks. Production domain logic and persistence are planned."], [ARCH+":65–78,365–418"]),
    node("db", "Business database", "Data-store container", "PostgreSQL · Neon · Prisma", "planned", 30, 535,
         "Persistent transactional records, sessions, roles, audit and notifications.",
         ["Single dealership; no multi-tenant or multi-branch partitioning.",
          "Money and lifecycle invariants belong in database transactions and constraints.",
          "Business changes and their audit entries commit together."], [ARCH+":473–515", PROJECT+":73–81"]),
    node("files", "Private documents", "Data-store container", "Cloudflare R2 · S3-compatible", "planned", 430, 535,
         "Vehicle photos, finance documents and brokerage attachments.",
         ["Browser transfers file bytes directly using short-lived signed URLs.",
          "Recommended: persist owned attachment metadata, validate staging uploads and copy to immutable final keys before linking.",
          "Authorize downloads as well as uploads; do not expose a public bucket."], [ARCH+":320–349", FEEDBACK+":19–30"]),
], [edge("browser", "server", "HTTPS · JSON / HTML"), edge("server", "db", "SQL over TLS", "Prisma's selected PostgreSQL adapter must support interactive transactions."),
    edge("server", "files", "S3 API · HTTPS", "Signs scoped object access and verifies upload metadata."),
    edge("browser", "files", "Signed file transfer", "HTTPS PUT/GET; file bytes bypass application functions.",
         points=[[490,113],[710,113],[710,593],[690,593]],labelX=615,labelY=220)],
     groups=[group("VA Motors VSMS — logically owned containers", 15, 15, 690, 670)],
     notes=["Managed providers host the data stores; those stores still belong to the logical VSMS system.",
            "Physical hosting and the commercial-plan constraint are shown in Deployment."])

view("containers-current", "C2", "Today: the prototype",
     "The screens work against process-local demo data, not a production backend.",
     "Current · code verified", "VSMS prototype", [
    node("browser", "Interactive UI", "Container", "React · TanStack · nuqs", "implemented", 230, 45,
         "Pages and forms fetch same-origin mock endpoints.", ["Login is a UI simulation; business permissions are not enforced."], ["app/", "hooks/use-entity-query.ts"]),
    node("next", "Next.js dev / app server", "Container", "Next.js 16.1.7 · Node.js", "implemented", 230, 285,
         "Renders routes and handles demo JSON requests.", ["There is no separate API server.", "In-memory stores are internal modules of this container, not a database container."], ["package.json", "app/api/"]),
], [edge("browser", "next", "Same-origin fetch")], height=455,
     notes=["Mock stores are internal components of the Next.js container (see C3 Today), not a separate data-store container. Process restart can discard demo edits.", "No Prisma, Better Auth, CASL or R2 integration is installed today."])

view("client", "C3", "Browser components",
     "The existing UI structure is reusable when the backend becomes real.",
     "Current + planned integrations", "Container: staff web application", [
    node("screens", "Feature screens", "Component", "React client components", "implemented", 30, 50,
         "Inventory, purchases, sales, repairs, parties, reports and brokerage screens.", ["The app shell provides navigation, sidebar, header and command palette.", "Each feature owns its screens; shared UI primitives stay reusable."], ["components/", "app/(app)/"]),
    node("forms", "Forms & shared UI", "Component", "TanStack Form · Zod · shadcn", "implemented", 430, 50,
         "Input controls, drawers, dialogs, toasts and reusable visual primitives.", ["Target: share input contracts with server-side parsing, but keep authorization server-side."], ["components/ui/", "components/shared/", "package.json"]),
    node("queries", "Server-state hooks", "Component", "TanStack Query · fetch", "implemented", 30, 300,
         "Read lists/details and submit HTTP mutations.", ["useEntityQuery/useEntityDetail have a 30-second stale time.", "useEntityMutation invalidates the named entity key only.", "Recommended: invalidate all affected inventory, sale, dashboard and report keys after cross-domain mutations."], ["hooks/use-entity-query.ts:9–57", "hooks/use-entity-mutation.ts:37–79"]),
    node("tables", "Table URL state", "Component", "TanStack Table · nuqs", "implemented", 430, 300,
         "Reusable sorting, filtering and pagination tied to URL parameters.", ["DiceUI table infrastructure is shared across feature tables.", "Target: database-side filtering/pagination replaces in-memory full scans."], ["hooks/use-data-table.ts", "components/data-table/"]),
    node("api", "Next.js HTTP interface", "External to this container", "HTTPS · JSON", "planned", 230, 550,
         "Current mock routes become authenticated production endpoints.", ["The browser never connects directly to the business database.", "Signed direct object transfers are the deliberate exception to app-proxied data access."], ["app/api/", ARCH]),
], [edge("screens", "forms", "Renders"), edge("screens", "queries", "Reads / mutates"),
    edge("forms", "tables", "Shares controls"), edge("tables", "queries", "Page + first sort", "Current bridge forwards pagination and first sort only. Filter forwarding is not complete; it must be implemented before claiming end-to-end server filtering."),
    edge("queries", "api", "JSON requests")], height=710,
     groups=[group("Browser application", 15, 15, 690, 430)],
     notes=["Browser checks are user experience only; production authorization is enforced for every server entry point."])

view("server-core", "C3", "Business components",
     "Business rules live behind a few domain operations—not inside HTTP handlers.",
     "Target · documented modules + recommended seams", "Container: Next.js application", [
    node("entry", "Authorized entry points", "Component", "Route Handlers · server reads", "planned", 230, 45,
         "Translate HTTP or server-rendered requests into domain operations.", ["Authenticate, validate, pass actor context; use record-aware authorization in domain operations.", "Server reads must not bypass the same access rules used by HTTP routes."], [ARCH+":216–251,400–418"]),
    node("inventory", "Inventory & ownership", "Component", "TypeScript domain module", "planned", 30, 280,
         "Vehicle identity, purchase cycles, repairs, costs, mileage and write-offs.", ["Same engine + chassis identifies the vehicle across re-purchases.", "Repairs and additional costs belong to a purchase cycle.", "Write-off requires approved action and records disposal proceeds."], [SPEC+" §3.1–3.4, §4, §5", ROADMAP+" §Phase 2,4"]),
    node("sales", "Sales & reservations", "Component", "TypeScript domain module", "planned", 430, 280,
         "Cash, advances, lease-finance and trade-in workflows.", ["Owns sale completion, receipt/refund facts, reservation decisions and finance documents.", "Calls inventory transitions inside the same transaction.", "Recommended: idempotency key, purchase-cycle binding and stale-state protection."], [SPEC+" §3.11–3.13, §5–7"]),
    node("parties", "People & counterparties", "Component", "TypeScript domain module", "planned", 30, 525,
         "Customers and third-party directory with contact people.", ["Supplier, repair vendor and finance company are third-party roles.", "Inline party creation is reused by purchase, sale and brokerage forms."], [ROADMAP+" §Phase 2,3", "lib/mock-data/schemas.ts:54–69,142–160"]),
    node("broker", "Lease brokerage", "Component", "TypeScript domain module", "planned", 430, 525,
         "Comparisons, eligibility, application/referral, dispatch and commission reconciliation.", ["Customer-owned vehicles are not dealership purchases.", "Finance companies communicate outside VSMS; staff record outcomes.", "Commission reconciliation can reference both vehicle-finance sales and brokerage deals."], [FEEDBACK, ROADMAP+" §Phase 8–9"]),
], [edge("entry", "inventory", "Invokes operations"),edge("entry", "sales", "Invokes operations"),
    edge("sales", "inventory", "Coordinates lifecycle"), edge("inventory", "parties", "Uses supplier / vendor"),
    edge("entry", "broker", "Invokes brokerage", points=[[490,103],[710,103],[710,583],[690,583]],labelX=610,labelY=210),
    edge("broker", "parties", "Uses customer / financier")],height=710,
     groups=[group("Next.js — core business modules",15,15,690,670)],
     notes=["These are in-process modules, not microservices. All mutations use the access + transaction components in the next view.",
            "Sales and brokerage both use Finance & reconciliation, shown in its own component view. Neither workflow owns the other."])

view("server-support", "C3", "Access & supporting components",
     "One trusted operation owns authorization, state changes and audit together.",
     "Target · recommended enforcement design", "Container: Next.js application", [
    node("access", "Identity & permissions", "Component", "Better Auth · CASL", "planned", 30, 50,
         "Sessions, users, multi-role permissions and record-aware checks.", ["Read current permission rules once per request; avoid an initial cross-request permission cache.", "Pass actor context to authorized operations from HTTP, server pages, imports and scheduled tasks.", "Role management and account activation are audited."], [SPEC+" §9", ARCH+":254–284"]),
    node("commands", "Domain operations", "Component", "Explicit transaction owner", "recommended", 430, 50,
         "Validate rules and apply each business action atomically.", ["One operation owns the database transaction, including audit and approval application.", "No public generic status setter that can bypass sale/repair/payment requirements.", "No new generic repository hierarchy or message bus is needed."], [ARCH+":365–398", ".planning/research/c4-infrastructure-findings.md"]),
    node("govern", "Approvals & history", "Component", "TypeScript · Prisma transaction", "planned", 30, 300,
         "Approval requests, immutable history and recipient-specific notifications.", ["Recommended: bind approvals to exact proposed payload and record version; re-check when applying.", "Notifications are stored transactionally and polled in-app.", "Audit actor, reason and before/after changes; do not audit credentials or secrets."], [SPEC+" §8–10", ROADMAP+" §Phase 4,6"]),
    node("persist", "Persistence & files", "Component", "Prisma · R2 signing client", "planned", 430, 300,
         "Database queries, transactions, private file access and attachment metadata.", ["Database constraints enforce identity and one active sale/reservation per cycle.", "Files are uploaded first; attach only verified owned objects. Failed uploads never become finance documents.", "Apply migrations explicitly, not during request handling."], [ARCH+":320–359", PROJECT+":73–94"]),
    node("outputs", "Reports & documents", "Component", "Queries · CSV · PDF renderer", "planned", 30, 550,
         "Dashboard, seven reports, cash position and invoice generation.", ["Required reports: inventory, sales, profit, outstanding advances, current repairs, cash flow and write-offs/disposal. Shell purchase/audit reports do not replace this catalog.", "Read authoritative purchase-cycle costs and dated payment facts; never sum mock reports.", "Retain immutable issued PDF versions in R2. Recommended snapshots keep reprints stable.", "Authorized queries filter records before serialization."], [SPEC+" §7, §8.4, §11", ROADMAP+" §Phase 5,7"]),
    node("jobs", "Import & expiry", "Component", "Bounded jobs · same domain rules", "planned", 430, 550,
         "Validate historical batches and flag expired advances.", ["Prevalidate whole bounded import batches, then commit atomically; stable import keys make retries safe.", "Expiry flags are automatic; staff decide refund, extension or conversion.", "Use date-based expiry checks even if the scheduled run is delayed."], [SPEC+" §6, §12", ROADMAP+" §Phase 3,10"]),
], [edge("access","commands","Supplies actor / rules"), edge("commands","persist","Commits transaction"),
    edge("commands","govern","Applies controls"), edge("govern","persist","Writes in same tx"),
    edge("outputs","persist","Authorized reads"), edge("jobs","commands","Domain calls", "Imports and expiry invoke the same authorized domain operations, not raw persistence.", points=[[690,608],[710,608],[710,108],[690,108]],labelX=650,labelY=195)],height=710,
     groups=[group("Next.js — access, persistence and supporting modules",15,15,690,670)],
     notes=["Arrows describe logical dependencies, not network calls. Report rendering and object transfer are outside the database transaction."])

view("code-current", "C4", "Existing query → store code",
     "These symbols exist today. The database seam is still a mock implementation.",
     "Current · implemented symbols", "Code-level zoom: vehicle list read", [
    node("hook", "useEntityQuery<T>()", "Function", "hooks/use-entity-query.ts", "implemented", 30, 50,
         "Builds URL params and a query key, then fetches JSON.", ["queryKey = [entityKey, params]; staleTime = 30,000ms."], ["hooks/use-entity-query.ts:9–32"]),
    node("route", "GET(request)", "HTTP function", "app/api/vehicles/route.ts", "mock", 430, 50,
         "Parses list parameters and delegates to vehiclesStore.", ["The current route has no production auth or business persistence."], ["app/api/vehicles/route.ts"]),
    node("instance", "vehiclesStore", "Object instance", "MockStore<Vehicle>", "mock", 430, 300,
         "Module-scoped singleton initialized from vehicle fixtures.", ["Each server process has its own Map; it is not distributed storage."], ["lib/mock-store.ts:151"]),
    node("store", "MockStore<T>", "Class", "query · create · update · reset", "mock", 30, 300,
         "Generic CRUD over a Map with cloning on creation/reset.", ["query(): string search, exact filters, sorting and array slicing.", "update(): shallow merges a Partial<T>; it does not validate business invariants."], ["lib/mock-store.ts:32–121"]),
    node("schema", "Vehicle / VehicleSchema", "Type + schema", "Zod · inferred TypeScript", "implemented", 30, 550,
         "Current UI data contract includes purchase facts directly on Vehicle.", ["This is a mock DTO, not the final purchase-cycle database schema.", "A TypeScript assertion on request JSON does not perform runtime validation."], ["lib/mock-data/schemas.ts:18–52"]),
    node("fixtures", "vehicleFixtures", "Seed data", "lib/mock-data/vehicles.ts", "mock", 430, 550,
         "Deterministic sample inventory for the shell and tests.", ["resetAll() restores all mock collections to their initial fixture state."], ["lib/mock-data/vehicles.ts", "lib/mock-store.ts:172–187"]),
], [edge("hook","route","fetch JSON"), edge("route","instance","query(params)"),
    edge("instance","store","Instance of"),edge("store","schema","Generic constraint"),edge("fixtures","instance","Constructor seed")],height=710)

view("code-cycle", "C4", "Purchase-cycle domain types",
     "A vehicle can be bought again. Each sale must retain its original costs.",
     "Target · conceptual code types, not implemented", "Code-level design: inventory / sale model", [
    node("vehicle", "Vehicle", "Entity type", "id · engine + chassis · status", "planned", 30, 50,
         "Long-lived physical vehicle identity.", ["Unique normalized engine/chassis pair; optional VIN and CR number.", "activePurchaseId points to current ownership, never to historical sale costs."], [SPEC+" §3.1"]),
    node("cycle", "PurchaseRecord", "Entity type", "id · vehicleId · purchasePrice", "planned", 430, 50,
         "One acquisition/ownership cycle, repeated when buying the vehicle back.", ["Purchase type: cash, lease settlement or brand-new.", "Trade-in acquisition additionally links tradeInSourceSaleId and the customer-as-seller; its purchase basis is the agreed noncash value.", "Recommended: explicit closed/open lifecycle and version for concurrent writes."], [SPEC+":130–149", SPEC+" §13"]),
    node("costs", "RepairRecord / VehicleCost", "Entity types", "purchaseRecordId · amount", "planned", 430, 300,
         "Costs are attached to this purchase cycle.", ["Actual repair invoice and additional costs contribute to cost basis.", "Incurred date and paid date are different concepts for cash reports."], [SPEC+" §3.3, §3.10, §7.1"]),
    node("sale", "SaleRecord", "Entity type", "purchaseRecordId · salePrice", "recommended", 30, 300,
         "Completed sale bound permanently to its acquisition cycle.", ["Add purchaseRecordId: the current specification links only vehicleId.", "One completed sale per cycle; a later buy-back creates a new PurchaseRecord.", "Optional trade-in consideration links a traded identity and, when added to stock, its new purchase cycle. Do not treat that asset value as cash.", "Final agreed sale price already includes discount; do not subtract discount twice."], [SPEC+":290–311,785–800", SPEC+" §13"]),
    node("advance", "Advance / finance details", "Entity types", "receipt facts · agreement state", "planned", 30, 550,
         "Reservation and lease progress precede final sale completion.", ["Advances can expire without automatically refunding money.", "Recommended: allow a finance agreement before a completed SaleRecord; DO and delivery fields remain optional until required by the transition."], [SPEC+" §3.12–3.13, §5.3"]),
    node("profit", "calculateCycleProfit()", "Proposed pure function", "sale − purchase − cycle costs", "recommended", 430, 550,
         "One shared financial calculation for detail pages and reports.", ["Select the sale's purchaseRecordId, never Vehicle.activePurchaseId, for historical profit.", "Use exact minor-unit arithmetic with explicit database and JSON bounds."], [SPEC+" §7.1–7.3"]),
], [edge("vehicle","cycle","1 → many cycles"),edge("cycle","costs","1 → many costs"),
    edge("sale","cycle","Belongs to one cycle"),edge("advance","sale","Converts / completes"),
    edge("sale","profit","Provides agreed price"),edge("costs","profit","Provides cycle costs")],height=710,
     notes=["C4 code-level views here are proposed entity/function designs, not generated Prisma schemas.",
            "Financial event dates persist when status changes. Trade-in value is non-cash consideration, not bank cash."])

view("code-sale", "C4", "One safe sale command",
     "Either the whole sale is saved—including its audit—or nothing is.",
     "Target · recommended function design", "Code-level zoom: Sales module", [
    node("command", "completeSale(input, actor)", "Proposed function", "Server-only domain operation", "recommended", 230, 50,
         "The single trusted entry for finalizing a vehicle sale.", ["Input: purchaseRecordId, expectedVersion, idempotencyKey, terms and payment facts.", "Actor: authenticated user and current permission rules.", "Return: completed sale or an explicit conflict/approval-required result."], [ARCH+":365–398", SPEC+" §5, §8–9"]),
    node("checks", "Validate + authorize", "Internal functions", "Zod · CASL subject checks", "planned", 30, 300,
         "Validate input, permissions, current cycle and exact approval payload.", ["Reject duplicate active reservations, stale versions and invalid financial combinations.", "Verify required down payment and DO; checking a role name alone is insufficient."], [SPEC+" §5.3, §8–9"]),
    node("tx", "Transaction callback", "Implementation seam", "Prisma interactive transaction", "recommended", 430, 300,
         "Re-check the current state and atomically persist the business result.", ["Claim idempotency key; compare/lock the active cycle; enforce unique sale-per-cycle.", "Create sale and payment facts, close inventory cycle, add mileage, apply approval and append audit/notifications.", "If adding a trade-in to stock: reuse/create its physical identity, create the linked purchase cycle at agreed noncash value and retain customer-as-seller. This participates in the same commit; never invent a cash purchase payment.", "Rollback all changes on error; retry only with the same request key."], [ARCH+":385–391", SPEC+" §13"]),
    node("policy", "transition + money rules", "Pure functions", "Allowed actions · exact amounts", "recommended", 30, 550,
         "Validate transitions and calculate balance/profit consistently.", ["IN_STOCK → SOLD must exist for a cash sale.", "Re-purchase starts a new cycle rather than rewriting the completed sale.", "A status change alone cannot substitute for the corresponding business operation."], [ARCH+":286–318", SPEC+" §4–7"]),
    node("result", "Committed result", "Return contract", "Sale DTO · affected identities", "recommended", 430, 550,
         "Return only after commit; refresh dependent UI queries.", ["File uploads/PDF work must not hold a database transaction open.", "Client invalidates inventory, sales, dashboards and relevant reports after success."], ["hooks/use-entity-mutation.ts:71–74", ARCH+":393–397"]),
], [edge("command","checks","Checks contract"),edge("command","tx","Owns transaction"),
    edge("checks","policy","Uses pure rules"),edge("tx","policy","Revalidates state"),edge("tx","result","Returns after commit")],height=710)

view("code-broker", "C4", "Brokerage domain types",
     "A customer-owned vehicle can receive finance without entering inventory.",
     "Target · conceptual domain types", "Code-level design: Lease brokerage module", [
    node("rates", "FinanceCompany + RateSheet", "Entity types", "Model / year · amount / term", "planned", 30, 50,
         "Rate sheets and cards drive the finance comparison.", ["Staff maintains rates manually. No finance-company integration.", "Recommended: capture selected terms on the deal so later rate edits do not rewrite it."], [FEEDBACK+":8–16", ROADMAP+" §Phase 8"]),
    node("deal", "LeaseDeal", "Entity type", "Customer · vehicle description", "planned", 430, 50,
         "Brokerage case with application-processing or referral path.", ["Links customer, guarantors, selected financier, loan terms and cash-advance facility.", "The described vehicle is not necessarily a stock Vehicle record."], [FEEDBACK+":13–37", "lib/mock-data/schemas.ts:162–204"]),
    node("processing", "Eligibility + case events", "Entity/value types", "Checks · blockers · inquiries", "planned", 430, 300,
         "Eligibility decisions, inspection, documents, verification and reference number.", ["Application path: collect/verify documents and dispatch.", "Referral path: handoff and follow-up; record rejection or non-remittance.", "Store finance-company contact and feedback on verification/blocker events."], [FEEDBACK+":18–37"]),
    node("dispatch", "DispatchBatch / item", "Proposed entity types", "LeaseDeal or finance-sale ref", "recommended", 30, 300,
         "Checked files grouped for physical courier handover.", ["Recommended: explicit links to the source sale or brokerage deal; retain dispatched time and actor.", "A single dispatch capability supports both sources."], [FEEDBACK+":30", "lib/mock-data/schemas.ts:296–309"]),
    node("commission", "Commission + allocation", "Proposed entity types", "Expected · received · match", "recommended", 30, 550,
         "Expected fees matched to dated finance-company remittances.", ["Support per-company reconciliation rules and partial/discrepant payments.", "Prevent allocating the same remittance amount twice.", "Overdue rules depend on dispatch/referral and the company's reconciliation method."], [FEEDBACK+":39–45", "lib/mock-data/schemas.ts:313–327"]),
    node("cash", "Disbursement facts", "Domain value / receipt data", "Gross − deductions − held fee", "recommended", 430, 550,
         "Record actual cash-advance payout and its fee/deductions.", ["Payout and commission receipt are separate cash events with independent dates.", "Recommended: retain them within source transaction records; no general-accounting ledger is introduced."], [FEEDBACK+":29,37", SPEC+" §7.4"]),
], [edge("rates","deal","Provides selected terms"),edge("deal","processing","1 → many events"),
    edge("processing","dispatch","Makes file ready"),edge("dispatch","commission","Starts eligibility clock"),
    edge("processing","cash","Records payout")],height=710,
     notes=["Detailed type names for dispatch/allocation are recommendations. The user-required workflows already exist in the business brief."])

view("server-current", "C3", "Today: two demo data paths",
     "Mutable records and bundled fixtures coexist. Reports can disagree with edited screens.",
     "Current · code verified", "Container: Next.js prototype (with browser context)", [
    node("ui", "Feature UI", "Browser component", "React · fetch + imports", "implemented", 230, 45,
         "Reads API data but also uses bundled fixtures for names and histories.", ["Fixture lookup is not an authorized server read."], ["components/sales/record-sale-dialog.tsx:5–6,82–85", "components/vehicles/vehicle-financials.tsx:17–25"]),
    node("crud", "CRUD Route Handlers", "Server component", "GET / POST / PATCH", "mock", 30, 275,
         "Direct request-to-store calls with artificial latency.", ["Purchases create Vehicle rows; sales/repairs do not coordinate vehicle status.", "Current TypeScript assertions do not validate arbitrary JSON."], ["app/api/purchases/route.ts", "app/api/sales/route.ts"]),
    node("reports", "Report Route Handlers", "Server component", "Fixture aggregation helpers", "mock", 430, 275,
         "Most report endpoints compute from original fixture arrays.", ["Dashboard mixes mutable store data with fixed activity; cash flow is a separate seeded store."], ["lib/mock-data/reports.ts:5–10,21–74", "app/api/dashboard/route.ts", "app/api/cash-flow/route.ts"]),
    node("maps", "MockStore / SettingsStore", "Server component", "Process-local Maps", "mock", 30, 525,
         "Mutable demo state; independent collections.", ["No FK, multi-record transaction, authorization or durable audit guarantee."], ["lib/mock-store.ts:32–164"]),
    node("fixtures", "Original fixtures", "Bundled data module", "TypeScript arrays", "mock", 430, 525,
         "Initial data and static joins, separately imported in server and browser bundles.", ["Store creation clones these arrays. Editing the Map does not edit the original fixture."], ["lib/mock-store.ts:36–39", "lib/mock-data/"]),
], [edge("ui","crud","HTTP JSON"),edge("ui","reports","HTTP JSON"),edge("crud","maps","In-process CRUD"),
    edge("reports","fixtures","Static imports"),edge("fixtures","maps","Seeds a clone"),
    edge("ui","fixtures","Bundled fixture lookup",points=[[490,103],[710,103],[710,583],[690,583]],labelX=610,labelY=200)],height=710,
     groups=[group("Next.js server — no production domain modules yet",15,235,690,445)])

view("finance-components", "C3", "Shared finance & reconciliation",
     "Sales and brokerage share financial evidence without becoming one workflow.",
     "Target · recommended module ownership", "Container: Next.js application", [
    node("sales", "Sales & inventory", "Domain component", "Sales · purchases · repairs", "planned", 30, 45,
         "Provides dated receipts, supplier/vendor payments, refunds and disposal proceeds.", ["A trade-in is non-cash acquisition and consideration; DO issuance is not finance-company cash receipt."], [SPEC+" §5–7", ".planning/research/c4-business-findings.md §8.2"]),
    node("broker", "Brokerage", "Domain component", "Cases · facility · commissions", "planned", 430, 45,
         "Provides cash-facility payout/recovery and commission entitlements.", ["Commission expectation is distinct from receipt; actual remittance is recorded separately."], [FEEDBACK+":29,37–45"]),
    node("finance", "Finance & reconciliation", "Domain component", "Receipt rules · allocation", "recommended", 230, 295,
         "Applies shared money rules and matches remittances to entitlements.", ["Source-linked immutable payment facts with occurredAt, amount, method, direction and reversal reference.", "Keep receipt child records within their business source; aggregate a read projection rather than introducing general-ledger accounting.", "Unified finance-company reconciliation covers vehicle-sale leases and brokerage, including discrepancy resolutions and overdue cutoffs."], [SPEC+" §7.4", ".planning/REQUIREMENTS.md:201–207"]),
    node("reports", "Reports & dashboard", "Read component", "Authorized projections", "planned", 30, 545,
         "Builds cash movement, stock cost and profit views from authoritative facts.", ["Date range means actual occurred date for cash, completion date for sales.", "Net movement is not an absolute cash balance without an opening balance."], [SPEC+" §7, §11", ".planning/research/c4-business-findings.md §8.2"]),
    node("data", "Database access", "Persistence component", "Prisma · PostgreSQL", "planned", 430, 545,
         "Persists facts/allocations under the calling domain transaction.", ["No duplicate allocations, money counted once, audit written in the same commit.", "Recommended bigint money columns with safe JSON-number bounds; use strings if a bound is exceeded."], [ARCH, ".planning/research/c4-infrastructure-findings.md §5"]),
], [edge("sales","finance","Records money facts"),edge("broker","finance","Records money facts"),
    edge("finance","data","Writes in caller tx"),edge("reports","finance","Uses shared semantics"),edge("reports","data","Queries facts")],height=710,
     groups=[group("One app and one database transaction model",15,15,690,675)])

view("code-access", "C4", "Identity, approval & audit types",
     "Authority belongs to the signed-in actor and the exact action being approved.",
     "Target · documented entities + proposed guards", "Code-level design: access and governance", [
    node("user", "User + Session", "Entity types", "Better Auth · active account", "planned", 30, 45,
         "Credentials-based sign-in; server resolves actor identity.", ["Do not accept actor IDs or permission rules from browser payloads.", "Protect the last administrator from accidental removal/deactivation."], [SPEC+" §3.14, §9", ".planning/REQUIREMENTS.md:107–113"]),
    node("roles", "Role / Permission", "Entity types", "UserRole · RolePermission", "planned", 430, 45,
         "Many roles per user; runtime-configurable actions and subjects.", ["Record/field conditions are enforced against actual entities and scoped collection queries.", "Fresh rules once per request; client rule copies only drive presentation."], [SPEC+" §3.14–3.17, §9"]),
    node("operation", "authorizeOperation()", "Proposed function seam", "Actor · record · action", "recommended", 230, 295,
         "Shared server-only authorization for API, RSC, exports and files.", ["Typed, minimized DTOs exclude unauthorized private or financial fields.", "System jobs have explicit system authority; imports need admin permission and provenance."], ["https://nextjs.org/docs/app/guides/authentication", ARCH+":400–418"]),
    node("approval", "ApprovalRequest", "Entity type + guard", "Payload · revision · decision", "recommended", 30, 545,
         "Stores a proposed action and consumes approval exactly once.", ["Recheck current authority, revision, price and obligations before applying.", "Recommend separate requester/reviewer for financial gates; any override must be explicit and audited."], [SPEC+" §8.3", ".planning/research/c4-business-findings.md §8.5"]),
    node("audit", "AuditLog / Notification", "Entity types", "Actor · reason · recipient", "planned", 430, 545,
         "Append-only field changes and recipient-specific in-app events.", ["Append with the transaction client, including requester and approver where relevant.", "Notifications are deduplicated and marked read per recipient.", "Append-only at application/DB-role level does not mean tamper-proof against a DB administrator."], [SPEC+" §8–10", ".planning/research/c4-infrastructure-findings.md §4"]),
], [edge("user","roles","Many-to-many roles"),edge("user","operation","Supplies trusted actor"),
    edge("roles","operation","Builds current rules"),edge("operation","approval","Checks exact proposal"),
    edge("approval","audit","Appends in same tx")],height=710)

view("flow-sale", "Flows", "Finalize a vehicle sale",
     "Same request key + same cycle version = one sale, even after a retry.",
     "Target · dynamic view", "Scenario: sale with optional approval", [
    node("staff", "Staff UI", "Container instance", "Browser", "planned", 30, 45,
         "Submits sale details, expected cycle version and operation key.", ["The same key is retained across a retry; a changed payload needs a different request."], ["hooks/use-entity-mutation.ts", ".planning/research/c4-business-findings.md §7"]),
    node("entry", "Authorized HTTP entry", "Component instance", "Next.js Route Handler", "planned", 430, 45,
         "Resolves session, validates the request and calls the sales command.", ["Return unauthorized/forbidden, validation, pending approval, conflict or success explicitly."], [ARCH+":216–251"]),
    node("sales", "Sales command", "Component instance", "completeSale(input, actor)", "recommended", 30, 295,
         "Checks cycle, balance, sale type and approval before completing.", ["If below asking price: store exact proposal and return pending; do not hand over or finalize.", "A manager's approved proposal is revalidated before the completion transaction."], [SPEC+" §5.3, §8.3"]),
    node("db", "PostgreSQL", "Data-store instance", "One atomic transaction", "planned", 430, 295,
         "Persist sale, receipt facts, inventory closure, mileage, audit and notifications together.", ["Lock/compare cycle revision and enforce a unique completed sale for that cycle.", "For trade-in-to-stock, also reuse/create the traded identity and its new purchase cycle, linked back to this sale and customer-as-seller at agreed noncash value.", "Any required write failure rolls back all effects.", "A duplicate operation returns its recorded result; a different racing sale returns conflict."], [ARCH+":385–391", SPEC+" §13", ".planning/research/c4-infrastructure-findings.md §4"]),
    node("manager", "Manager UI", "Container instance", "Browser · authorized approver", "planned", 30, 545,
         "Reviews the unchanged proposal and approves or rejects.", ["Approval does not authorize arbitrary future edits to the sale."], [SPEC+" §8.3"]),
    node("approval", "Approval operation", "Component instance", "Pending → decision once", "recommended", 430, 545,
         "Checks reviewer and applies the proposed action through the owning domain command.", ["Never replay arbitrary JSON directly into a record."], [SPEC+" §8.3", ".planning/research/c4-business-findings.md §8.5"]),
], [edge("staff","entry","1. POST sale"),edge("entry","sales","2. Trusted command"),
    edge("sales","db","3 / 6. Atomic write", "3 creates a pending proposal when approval is required; 6 commits the approved sale. Ungated sales complete at step 3."),
    edge("manager","approval","4. Review decision"),edge("approval","sales","5. Revalidate & apply"),
    edge("db","entry","7. Commit result")],height=710,
     notes=["The response flows back to the staff UI after commit; it invalidates all affected query keys.", "Invoice generation is a separate post-sale operation, not part of the sale transaction."])

view("flow-files", "Flows", "Private upload & invoice flow",
     "A file is usable only after it is verified and linked to an authorized record.",
     "Target · dynamic view", "Scenario: DO / inspection evidence, then protected download", [
    node("browser", "Staff browser", "Container instance", "File API · HTTPS", "planned", 30, 45,
         "Requests an upload slot, sends bytes, then asks to attach.", ["Declared file type/size are checked server-side; a MIME header alone is not proof of content."], [ARCH+":320–349", ".planning/research/c4-infrastructure-findings.md §3"]),
    node("app", "Document operations", "Component instance", "Authorize · sign · finalize", "recommended", 430, 45,
         "Owns pending upload metadata and short-lived file capabilities.", ["Init checks actor and target record; completion rechecks ownership and content/metadata.", "Copy validated staging object to a fresh server-only final key, then link final metadata.", "Downloads check the parent record's read permission before issuing a signed GET."], ["https://developers.cloudflare.com/r2/api/s3/presigned-urls/", ".planning/research/c4-infrastructure-findings.md §3"]),
    node("r2", "Private R2 bucket", "Data-store instance", "Staging + immutable final keys", "planned", 30, 335,
         "Holds bytes; browser can only write short-lived staging keys.", ["R2 and PostgreSQL do not share a transaction. Failures leave unreferenced objects for cleanup, not half-valid business attachments.", "A signed URL remains a bearer capability until expiry; revocation of a role cannot revoke an already issued URL immediately."], ["https://developers.cloudflare.com/r2/api/s3/presigned-urls/"]),
    node("db", "Attachment / invoice metadata", "Data-store instance", "PostgreSQL", "recommended", 430, 335,
         "Records owner, purpose, final key, hash/type/size and issuance version.", ["Invoice: authorize completed sale → snapshot → render PDF outside DB transaction → save new immutable R2 key → commit version metadata and audit.", "Failed persistence must not mark a PDF as issued. Retrying issuance is separate from retrying the sale."], [SPEC+":888–892", ".planning/research/c4-infrastructure-findings.md §3"]),
], [edge("browser","app","1 / 5. Request access", "1 init upload; later confirm completion; 5 request a permission-checked download."),
    edge("browser","r2","2. Signed PUT / GET"),edge("app","r2","3. Verify & finalize"),
    edge("app","db","4. Link + audit")],height=515,
     notes=["Pending metadata is created at init. Final metadata is committed only after bytes are verified.", "Required inspection photos and DO documents are v1. General inventory-photo galleries are deferred in the current requirement catalog."])

view("flow-broker", "Flows", "Brokerage → commission",
     "Processing completion and commission payment are separate outcomes.",
     "Target · dynamic view", "Scenario: customer-owned vehicle finance", [
    node("staff", "Brokerage operator", "Person using staff UI", "Manual finance liaison", "external", 30, 45,
         "Captures the external vehicle, customer, guarantors and finance-company responses.", ["Eligibility, contact handoff, DO/file references and courier handover are manual outside VSMS."], [FEEDBACK]),
    node("compare", "Rate comparison", "Component instance", "Finance-company rate cards", "planned", 430, 45,
         "Looks up supported principal / term / installment and maximum loan.", ["Recommend exact rate-card lookup; do not promote the mock's ±20% nearest-loan approximation to real quotations.", "Snapshot selected terms and charges on the deal."], [FEEDBACK+":8–16", ".planning/research/c4-business-findings.md §8.6"]),
    node("broker", "Brokerage case", "Component instance", "Common intake → selected path", "planned", 430, 295,
         "Records eligibility and selects Application or Referral.", ["Application: inspection → evidence/checklists → verification/contact → file number → dispatch; track blockers and inquiries.", "Referral: handoff contact/date → track rejection or non-remittance.", "Either path can disburse a cash facility; keep payout/recovery separate from commissions."], [FEEDBACK+":13–37"]),
    node("documents", "Documents & dispatch", "Component instance", "Private evidence · batch handover", "planned", 30, 295,
         "Stores verified evidence and records physical courier handover.", ["Application requires the specified inspection categories and conditional documents.", "Referral does not inherit Application-only photo/document prerequisites."], [FEEDBACK+":19–31"]),
    node("finance", "Finance & reconciliation", "Component instance", "Entitlements · remittance matches", "planned", 30, 545,
         "Matches actual received commission using the finance company's method.", ["Unmatched eligible items remain visible after reconciliation; preserve cutoff and discrepancy resolution.", "Also includes commission entitlements from owned-vehicle lease sales."], [FEEDBACK+":39–45", ".planning/REQUIREMENTS.md:201–207"]),
    node("db", "PostgreSQL", "Data-store instance", "Case history + finance facts", "planned", 430, 545,
         "Stores each command's outcome and audit atomically.", ["No automatic owned-inventory purchase is created by brokerage intake."], [SPEC+" §8", FEEDBACK+":9"]),
], [edge("staff","compare","1. Compare offers"),edge("compare","broker","2. Selected terms"),
    edge("broker","documents","3a. Application evidence"),edge("documents","finance","4a. Sent eligibility"),
    edge("broker","finance","3b / 4b. Referral date"),edge("finance","db","5. Match + audit")],height=710)

view("flow-expiry", "Flows", "Advance expiry & manual decision",
     "Expired does not mean refunded—or available for a different buyer.",
     "Target · dynamic view", "Scenario: daily expiry plus staff resolution", [
    node("cron", "Daily scheduler", "Infrastructure trigger", "Authenticated HTTPS invocation", "planned", 30, 45,
         "Calls a bounded, retry-safe expiry operation.", ["Scheduler is supplied by the eligible production host. Monitor last success and failures.", "A permissioned manual catch-up invokes the same operation."], [ROADMAP+" §Phase 3", ".planning/research/c4-infrastructure-findings.md §7"]),
    node("command", "Reservation operation", "Component instance", "expire / resolve reservation", "planned", 430, 45,
         "Checks due date and current cycle before flagging an active reservation.", ["If a sale has completed, expiry must not overwrite it.", "Business timezone and validity basis are explicit snapshotted inputs."], [SPEC+" §6", ".planning/research/c4-business-findings.md §8.6"]),
    node("staff", "Staff / approver", "Person using UI", "Convert · cancel · refund", "external", 30, 335,
         "Chooses what happens to the expired reservation.", ["Convert: record remaining balance only. No-refund cancel: keep original receipt. Refund: approval then a separately dated outflow.", "Active advance extension is deferred; do not invent a second receipt when an expired extension policy is approved."], [".planning/REQUIREMENTS.md:71–78,235–239", SPEC+" §6"]),
    node("db", "PostgreSQL", "Data-store instance", "Reservation + cycle + events", "planned", 430, 335,
         "Atomically writes reservation/cycle status, audit and notifications.", ["EXPIRED remains an unresolved commitment until staff acts.", "Mutation guards evaluate dates even if the cron flag is late; cash receipt history never disappears."], [".planning/research/c4-business-findings.md §8.2–8.4"]),
], [edge("cron","command","1. Expire due items"),edge("command","db","2 / 4. Atomic change"),
    edge("staff","command","3. Resolve with rules"),edge("db","staff","2b. In-app notification")],height=515)

view("flow-import", "Flows", "Historical import",
     "Preview the whole batch, then commit the whole batch—or reject it.",
     "Target · dynamic view", "Scenario: one-time historical data intake", [
    node("admin", "Administrator", "Person using UI", "CSV / Excel + review", "external", 30, 45,
         "Supplies transcribed legacy data and confirms a validated preview.", ["No OCR. Customer/supplier directories are loaded before records that reference them."], [SPEC+" §12"]),
    node("import", "Import component", "Component instance", "Parse · validate · stage", "planned", 430, 45,
         "Maps rows, flags missing identity, duplicates and inconsistent amounts.", ["Errors identify row/field; do not fabricate vehicle identity to make data pass.", "Keep file hash, reviewed data version and stable source-row keys."], [ROADMAP+" §Phase 10", ".planning/research/c4-business-findings.md §8.6"]),
    node("commands", "Historical intake operation", "Component instance", "Authorized bounded transaction", "recommended", 30, 335,
         "Rechecks conflicts and writes reviewed history with import provenance.", ["It may accept a historically final state without replaying physical handovers; integrity rules still apply.", "Chunking must remain inside one atomic batch transaction, not independent commits disguised as all-or-nothing."], [SPEC+" §12", ".planning/research/c4-business-findings.md §8.6"]),
    node("db", "PostgreSQL", "Data-store instance", "Business rows + import audit", "planned", 430, 335,
         "Commits or rolls back the complete approved batch.", ["Retry keys prevent duplicate historical cycles/payments.", "Mark records imported and retain source batch/row references."], [ROADMAP+":226–239"]),
], [edge("admin","import","1. Upload & preview"),edge("import","commands","2. Confirm snapshot"),
    edge("commands","db","3. One commit / rollback")],height=515)

view("deployment-target", "Deployment", "Production deployment — blocked",
     "The design fits one Node app. The $0 commercial hosting choice is not yet valid.",
     "Target · production hosting unresolved", "Deployment nodes and external managed infrastructure", [
    node("browser", "Staff device", "Deployment node", "Desktop / mobile browser", "planned", 30, 45,
         "Runs the React client; installable PWA planned.", ["No offline business writes; only synthetic data belongs in the current mock deployment."], [PROJECT, ".planning/REQUIREMENTS.md"]),
    node("host", "Production Node host", "Deployment node", "Vercel intended · plan BLOCKED", "blocked", 430, 45,
         "Hosts the Next.js renderer and API in one deployment.", ["Vercel Hobby is restricted to non-commercial personal use; the internal dealership application is commercial.", "Keep the $0 constraint visibly unresolved: no paid plan or replacement host is approved by this model.", "Choose eligible hosting before go-live. Runtime secrets remain server-side; dev/test resources are isolated from production."], ["vercel-policy", ".planning/research/c4-infrastructure-findings.md §1"]),
    node("db", "Neon project", "Managed deployment node", "PostgreSQL · pooled app access", "planned", 30, 305,
         "Hosts the business database including sessions, permissions and audit.", ["Scale-to-zero can cause cold starts; free capacity is finite, not guaranteed indefinite runway.", "Use direct operational access for migrations/backups; choose compatible Prisma/adapter versions at implementation time.", "Prisma's Neon adapter uses WebSockets for interactive transactions; do not label it a plain HTTP-only transaction client."], ["neon-prisma", "neon-plans", ".planning/research/c4-infrastructure-findings.md §2"]),
    node("r2", "Cloudflare account", "Managed deployment node", "Private R2 Standard bucket", "planned", 430, 305,
         "Hosts final attachments, invoice versions and temporary staging objects.", ["Bucket-scoped server credentials, explicit browser CORS and authenticated signing operations.", "Free allowance is not a hard spending cap; monitor storage/operations and confirm account controls."], ["r2-pricing", "r2-presign"]),
    node("scheduler", "Daily schedule", "Infrastructure node", "Host scheduler · secret request", "planned", 30, 565,
         "Triggers advance expiry; it does not host a separate business worker.", ["Record last successful run and failures. Staff can run authorized catch-up.", "Do not add a queue solely to satisfy stale 10-second assumptions."], ["vercel-limits", "vercel-cron", ROADMAP+" §Phase 3"]),
    node("ops", "Operator + recovery copy", "Operational deployment node", "Independent encrypted backup", "recommended", 430, 565,
         "Backs up PostgreSQL and final R2 objects to an independent location.", ["Proposed daily backups plus pre-migration/import copies; monthly restore rehearsal.", "Recovery owner/storage are not provisioned. Up to one business day loss assumes daily success; recovery time is unmeasured.", "Account monitoring, error/failed-job logs and a restore runbook are go-live tasks, not extra application services."], ["neon-backup", ".planning/research/c4-infrastructure-findings.md §6"]),
], [edge("browser","host","HTTPS"),edge("host","db","TLS · pooled SQL"),edge("host","r2","HTTPS · S3 API"),
    edge("scheduler","host","Daily invocation",points=[[30,623],[10,623],[10,215],[560,215],[560,161]],labelX=115,labelY=215),
    edge("ops","r2","Copy final objects"),edge("ops","db","Dump / restore rehearsal")],height=735,
     notes=["The browser also transfers signed bytes directly to R2 (C2). Infrastructure resources shown are planned, not account-verified.", "No commercial-plan purchase, cloud provisioning or production deployment was performed."])

view("deployment-test", "Deployment", "Local development & verification",
     "Tests exercise the shell today; transactional business scenarios are the next test layer.",
     "Current tooling + target integration checks", "Developer workstation / future isolated test environment", [
    node("developer", "Developer workstation", "Deployment node", "pnpm · Justfile", "implemented", 30, 45,
         "Runs local development, builds and checks.", ["Current dev command uses portless; dev:port uses port 8000.", "No production deployment, CI workflow or infrastructure-as-code configuration was found."], ["package.json:6–18", "Justfile"]),
    node("next", "Local Next.js app", "Container instance", "Development or production build", "implemented", 430, 45,
         "Serves UI/HTTP over localhost with mock stores.", ["Playwright starts a build/start server. No real identity provider or database is required for current examples."], ["playwright.config.ts:14–26", "next.config.mjs"]),
    node("unit", "Vitest", "Test process", "Money + logic-heavy UI", "implemented", 30, 305,
         "Two test files; 16 unit/component examples passed during exploration.", ["These tests do not prove production financial workflows or authorization."], ["vitest.config.ts", "lib/money.test.ts", "components/vehicles/vehicles-columns.test.tsx"]),
    node("http", "Playwright API / E2E", "Test process", "Real HTTP + Chromium", "implemented", 430, 305,
         "API examples and browser navigation run against the local app.", ["Gated /api/test/reset restores fixtures; auth setup currently writes empty browser state.", "Current global reset is not isolation for parallel mutating business tests."], ["playwright.config.ts", "tests/", "app/api/test/reset/route.ts"]),
    node("scenarios", "Transactional scenarios", "Proposed test process", "Isolated database + role fixtures", "recommended", 230, 565,
         "Validate real business invariants when persistence is implemented.", ["Double sale, repeat request, stale approval, forced audit failure, expired reservation race, buy-back profit, partial refund and trade-in cash.", "Check both HTTP and server-only read authorization, uploads/downloads and immutable invoice versions.", "Production cannot expose destructive test reset; keep explicit disposable DB/credential separation."], [".planning/research/c4-business-findings.md §9", ".planning/research/c4-infrastructure-findings.md §8"]),
], [edge("developer","next","Starts app"),edge("developer","unit","Runs checks"),
    edge("http","next","HTTP + browser"),edge("developer","http","Runs API / E2E"),
    edge("scenarios","http","Extends test coverage")],height=735)

view("flow-tradein", "Flows", "Trade-in: sale + new acquisition",
     "Example: sale 1,500 = cash 1,000 + traded vehicle 500. Cash received is only 1,000.",
     "Target · dynamic view", "Scenario: add a traded vehicle to stock", [
    node("sale", "Sales operation", "Component instance", "Original cycle · buyer · terms", "planned", 30, 45,
         "Completes the original vehicle sale at the full agreed price.", ["Trade-in is a noncash consideration component. The UI can retain its familiar TradeIn category.", "This does not confirm combined finance-plus-trade-in as v1 scope."], [SPEC+" §13", ".planning/REQUIREMENTS.md:88–92"]),
    node("inventory", "Acquisition operation", "Component instance", "Traded identity + new cycle", "recommended", 430, 45,
         "If the vehicle is entering stock, reuse/create its identity and open its purchase cycle.", ["Match engine/chassis; reject a duplicate currently owned cycle.", "Purchase basis = agreed trade-in value. Store tradeInSourceSaleId and a valid customer-as-seller reference, not a Customer ID in a Supplier-only FK.", "This is conditional: a description/value may be recorded without adding the traded vehicle to stock."], [SPEC+":1071–1106", ".planning/research/c4-business-findings.md §5.G"]),
    node("finance", "Finance rules", "Component instance", "Cash vs noncash split", "recommended", 30, 335,
         "Records residual cash only; preserves noncash asset consideration separately.", ["No 500 cash inflow or 500 cash purchase outflow is invented in this example.", "Original vehicle profit = full sale price minus original cycle cost."], [SPEC+" §7.2", ".planning/research/c4-business-findings.md §8.2"]),
    node("db", "PostgreSQL", "Data-store instance", "One transaction / retry key", "planned", 430, 335,
         "Commits original sale + new acquisition + money facts + audit together.", ["Use consistent lock ordering when touching two physical vehicles.", "Repeating the same command cannot create another traded vehicle acquisition."], [ARCH+":365–391", ".planning/research/c4-business-findings.md §8.3"]),
], [edge("sale","inventory","1. Conditional acquisition"),edge("sale","finance","2. Split consideration"),
    edge("inventory","db","3. Same transaction"),edge("finance","db","3. Same transaction")],height=515)

DECISIONS = []


def decision(title, status, summary, detail, sources):
    DECISIONS.append(dict(title=title, status=status, summary=summary, detail=detail, sources=sources))


decision("Keep one monolith", "Documented decision", "No extra backend, microservices or message broker.",
         "Next.js renders pages and exposes Route Handlers. Domain modules remain ordinary in-process TypeScript. PostgreSQL and object storage are the only persistent data stores.", [PROJECT+":73–94", "docs/03-tech-and-infra-stack.md:14–42"])
decision("Separate stock from brokerage", "Documented decision", "Brokerage vehicles do not become purchases automatically.",
         "The newer customer feedback adds brokerage as a separate workflow sharing customers, finance companies, documents and reconciliation. This extends the earlier dealership-only specification.", [FEEDBACK+":8–45", ROADMAP+" §Phase 8–9"])
decision("Preserve payment history", "Recommended clarification", "Workflow status is not cash movement.",
         "Keep dated receipt/disbursement/refund facts on source transactions, even after cancellation or expiry. Count an advance once, then only the final balance; trade-in value is non-cash. Keep the user's computed-report/no-general-ledger decision.", [SPEC+":816–830", SPEC+" §11 cash-flow report"])
decision("Bind sale to purchase cycle", "Recommended correction", "Re-purchasing must not change historical profit.",
         "Add SaleRecord.purchaseRecordId and enforce sale uniqueness for that cycle. Repair/cost scoping already exists in the specification. Historical reports must never use the vehicle's current activePurchaseId.", [SPEC+":130–149,290–311,778–814"])
decision("Atomic, retry-safe business commands", "Recommended correction", "A sale, its state change and its audit commit together.",
         "Use one explicit transaction owner with idempotency and database concurrency constraints. Bind an approval to the exact payload/version and revalidate before applying. An audit extension is optional implementation detail, not the guarantee of atomicity.", [ARCH+":351–359,365–398", SPEC+" §8–9"])
decision("One authorization seam", "Recommended clarification", "HTTP and server-rendered reads enforce the same record permissions.",
         "Keep Better Auth and CASL. Load current rules once per request. Domain entry points receive actor context and enforce resource-level access; UI visibility is not authorization. This resolves conflicting research advice about session-cached versus fresh permissions.", [ARCH+":254–284,400–418", ".planning/research/PITFALLS.md:84–106"])
decision("Lifecycle by business action", "Recommended correction", "Cash sales, cancellations and re-purchases need explicit paths.",
         "Do not implement the example map literally: it omits IN_STOCK → SOLD and a buy-back path. Preserve ten-status compatibility and availability, but drive transitions through business commands. The customer requires simultaneous handover and sale: recommend delivery as the completion event/timestamp, not a separately mutable Delivered step. Re-purchase opens a new cycle. Automatic expiry flags leave the final decision to staff.", [ARCH+":286–318", "docs/01-requirements-questionnaire.md:156–162", SPEC+" §4–6"])
decision("Controls precede go-live", "Recommended sequencing", "Approval and audit enforcement ship with the action they protect.",
         "UI viewers can arrive later. Sale edits, refunds, discounts and write-offs must enforce approvals and mandatory reasons from their first production implementation. Add integration tests for rollback, double submission, simultaneous sale, buy-back profit and cross-role access.", [ROADMAP+" §Phase 1–7"])

decision("Production hosting is unresolved", "BLOCKED · budget/policy conflict", "Vercel Hobby is not eligible for this commercial dealership application.",
         "Official Hobby/fair-use terms restrict commercial use to eligible paid plans unless Vercel grants an exception. Keep the Next.js design, but do not claim the documented $0 Vercel deployment is viable. No spend or alternate host has been approved. Current Fluid-compute duration limits also supersede the old universal 10-second assumption; verify actual account/runtime settings before deploying.", ["vercel-policy", "vercel-limits", ".planning/research/c4-infrastructure-findings.md §1"])
decision("Private, versioned documents", "Required + recommended implementation", "Invoices retain immutable versions; files need permission checks in both directions.",
         "The specification already requires immutable PDF versions. Store each issued PDF under a new private R2 key and retain issuance metadata. Recommended: verify staged uploads, copy into server-only final keys, then link; PostgreSQL and R2 do not share atomic commit. Downloads use short-lived authorized GET capabilities. General vehicle galleries are deferred; brokerage inspection evidence is v1.", [SPEC+":888–892", ".planning/REQUIREMENTS.md:180–191,229–241", "r2-presign"])
decision("Wide integer money", "Recommended correction", "Minor units remain integers—but not limited to a 32-bit database Int.",
         "Use PostgreSQL bigint money columns. At two decimals, 32-bit Int tops out at 21,474,836.47 major units. Enforce safe-integer bounds before numeric JSON conversion, arithmetic and aggregates; use integer strings if those bounds are exceeded. Fix currency scale for stored history and define percentage rounding explicitly.", ["postgres-integers", ".planning/research/c4-infrastructure-findings.md §5"])
decision("Recovery is part of the architecture", "Recommended operational baseline", "Primary storage alone is not a backup.",
         "Daily encrypted database exports and final-object copies to independent storage, plus pre-import/migration backups and monthly restore drills. This is an operator procedure, not a new application service. Owner, capacity and restore time are unverified; one-day recovery-point target only holds if daily backups succeed. Free-tier capacity cannot promise indefinite growth.", ["neon-backup", "neon-plans", ".planning/research/c4-infrastructure-findings.md §6"])
decision("Resolve business ambiguities explicitly", "Recommended assumptions", "Use customer intent instead of copying conflicting technical examples.",
         "Advance validity: prefer the BRS's listed-price-at-placement basis; retain agreed price separately. Proposed tier endpoints: ≤5%=7 days, ≤10%=14, ≤15%=21, >15%=31-day assumption; snapshot the rule and dealership timezone. Active extensions stay deferred. Rates use supplied cards, not invented interest math. If a facility fee is withheld, net payout = gross − deductions − fee; the catalog's plus-fee wording is not cash paid to the customer.", [BRS+":561–573", ".planning/REQUIREMENTS.md:71–78,176,235–239", FEEDBACK+":9–11,29,37", ".planning/research/c4-business-findings.md §8.6"])
decision("Evidence and scope precedence", "Interpretation, not signed approval", "Later customer feedback and current requirements extend the older specifications.",
         "Code determines what exists today. Phase context explains intentional mocks. Current REQUIREMENTS and later customer feedback govern target scope; PROJECT/infra replace older NestJS/RabbitMQ proposals. Earlier research snippets do not override business intent. No signed acceptance was found. This model makes recommendations visible rather than silently treating them as prior decisions. No app behavior changed.", [".planning/REQUIREMENTS.md", FEEDBACK, PROJECT+":83–94", ".planning/research/c4-business-findings.md §2"])


def build():
    model = dict(title="VA Motors · C4 architecture", subtitle="One system. Two business workflows. Explore one layer at a time.",
                 views=VIEWS, decisions=DECISIONS, sources=[
                     dict(id="business",title="Business requirements",path=BRS),
                     dict(id="spec",title="Detailed specification",path=SPEC),
                     dict(id="feedback",title="Customer feedback — brokerage extension",path=FEEDBACK),
                     dict(id="project",title="Project constraints and decisions",path=PROJECT),
                     dict(id="architecture",title="Existing architecture research",path=ARCH),
                     dict(id="roadmap",title="Delivery roadmap",path=ROADMAP),
                     dict(id="current",title="Code exploration findings",path=".planning/research/c4-current-findings.md"),
                     dict(id="domain",title="Business exploration findings",path=".planning/research/c4-business-findings.md"),
                     dict(id="infra",title="Verified infrastructure research",path=".planning/research/c4-infrastructure-findings.md"),
                     dict(id="requirements",title="Current feature catalog / deferred scope",path=".planning/REQUIREMENTS.md"),
                     dict(id="vercel-policy",title="Vercel commercial-use restriction",path="Official policy · checked 2026-10-25",url="https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage"),
                     dict(id="vercel-limits",title="Vercel function limits",path="Official documentation · account settings unverified",url="https://vercel.com/docs/functions/limitations"),
                     dict(id="vercel-cron",title="Vercel scheduler limits",path="Official documentation",url="https://vercel.com/docs/cron-jobs/usage-and-pricing"),
                     dict(id="neon-plans",title="Neon capacity and recovery allowances",path="Official documentation · account entitlement unverified",url="https://neon.com/docs/introduction/plans"),
                     dict(id="neon-prisma",title="Neon Prisma adapter / connection guidance",path="Official documentation · version selection deferred",url="https://neon.com/docs/guides/prisma"),
                     dict(id="neon-backup",title="Neon independent backups",path="Official documentation",url="https://neon.com/docs/manage/backup-pg-dump"),
                     dict(id="r2-presign",title="R2 signed file access",path="Official documentation",url="https://developers.cloudflare.com/r2/api/s3/presigned-urls/"),
                     dict(id="r2-pricing",title="R2 allowances and billable excess",path="Official documentation",url="https://developers.cloudflare.com/r2/pricing/"),
                     dict(id="postgres-integers",title="PostgreSQL integer ranges",path="Official documentation",url="https://www.postgresql.org/docs/current/datatype-numeric.html#DATATYPE-INT"),
                 ])
    ids = set()
    for v in VIEWS:
        assert v["id"] not in ids, v["id"]
        ids.add(v["id"])
        nodes = {n["id"] for n in v["nodes"]}
        assert len(nodes) == len(v["nodes"]), v["id"]
        for n in v["nodes"]:
            assert n["sources"], (v["id"], n["id"], "missing evidence")
            assert n["x"] >= 0 and n["y"] >= 0
            assert n["x"] + n["w"] <= v["width"], (v["id"], n["id"])
            assert n["y"] + n["h"] <= v["height"], (v["id"], n["id"])
        for e in v["edges"]:
            assert e["from"] in nodes and e["to"] in nodes, (v["id"], e)
    text = json.dumps(model, indent=2, ensure_ascii=False)
    (HERE / "c4-model.json").write_text(text + "\n")
    viewer = HERE / "c4-viewer.html"
    if viewer.exists():
        html = viewer.read_text()
        pattern = r'(<script\b(?=[^>]*\bid=[\"\']architecture-data[\"\'])[^>]*>).*?(</script>)'
        html, count = re.subn(pattern, lambda m: m[1]+"\n"+text.replace("<", "\\u003c")+"\n"+m[2], html, flags=re.S)
        assert count == 1, "Expected one architecture-data script in viewer"
        viewer.write_text(html)
    print(f"Validated {len(VIEWS)} views, {sum(len(v['nodes']) for v in VIEWS)} nodes, {len(DECISIONS)} decisions")


if __name__ == "__main__":
    build()
