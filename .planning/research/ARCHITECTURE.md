# Architecture Research

**Domain:** Vehicle dealership management system (single-tenant, monolithic Next.js)
**Researched:** 2026-03-21
**Confidence:** HIGH (stack is fully defined; patterns verified against official docs and community sources)

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Browser (PWA)                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  React UI    │  │ TanStack     │  │ TanStack     │  │ TanStack     │     │
│  │ (App Router  │  │   Query      │  │   Table      │  │   Form+Zod   │     │
│  │  RSC + CC)   │  │  (cache)     │  │  (grids)     │  │ (mutations)  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘  └──────┬───────┘     │
│         │                │                                     │             │
│         └────────────────┴─────────────────────────────────────┘             │
│                               HTTPS                                          │
└─────────────────────────────────┬────────────────────────────────────────────┘
                                  │ (same origin)
┌─────────────────────────────────▼────────────────────────────────────────────┐
│                           Vercel (Next.js 15+)                               │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                       /app  (React Server Components)                  │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐  │  │
│  │  │ /vehicles  │  │  /sales    │  │ /repairs   │  │ /settings/users  │  │  │
│  │  │ /purchases │  │ /advances  │  │ /reports   │  │ /roles           │  │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └──────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                  /app/api  (Route Handler layer)                        │  │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │  │
│  │  │ Auth guard → CASL check → Service call → Audit write → Response  │  │  │
│  │  └──────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  /api/vehicles    /api/sales      /api/repairs   /api/uploads          │  │
│  │  /api/purchases   /api/advances   /api/reports   /api/notifications     │  │
│  │  /api/customers   /api/suppliers  /api/users     /api/approvals         │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │                        lib/  (Domain services)                         │  │
│  │  vehicles.service   sales.service   repairs.service   reports.service  │  │
│  │  auth.service       casl.factory    audit.service     pdf.service       │  │
│  └─────────────┬──────────────────────────────────────────────────────────┘  │
│                │  Prisma Client (Neon serverless driver)                     │
└────────────────┼─────────────────────────────────────────────────────────────┘
                 │
     ┌───────────┴──────────┐
     │                      │
┌────▼────┐          ┌──────▼──────┐
│  Neon   │          │ Cloudflare  │
│  Neon   │          │     R2      │
│PostgreSQL│          │  (uploads) │
└─────────┘          └─────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| React UI (RSC + Client) | Page layout, data display, form rendering | Server Components for data fetching; Client Components for interactivity |
| TanStack Query | Server state cache, background refetch, optimistic updates | `useQuery` / `useMutation` wrapping fetch calls to `/api/*` |
| TanStack Table | Sortable/filterable/paginated data grids | Headless; rows sourced from TanStack Query |
| TanStack Form + Zod | Form state, validation, submission | Schema validated on client and re-validated on server |
| Route Handlers (`/api`) | HTTP API surface, auth gate, CASL check, response shaping | Thin orchestration; no business logic inline |
| Domain Services (`lib/`) | Business logic, state-machine transitions, financial calculations | Pure functions + Prisma calls; testable in isolation |
| CASL Factory | Build `AppAbility` from user's DB permissions at request time | `createAbilityForUser(userId)` called once per request |
| Audit Service | Write `AuditLog` entry for every mutation | Invoked by services after successful writes, never skipped |
| PDF Service | Generate invoice PDF as Buffer using `@react-pdf/renderer` | Called inside API route; returns Buffer streamed to client |
| Prisma Client | Database access, schema enforcement | Neon serverless driver; singleton via module-level instance |

---

## Recommended Project Structure

```
src/
├── app/
│   ├── (auth)/
│   │   └── login/
│   │       └── page.tsx               # Login page (public route group)
│   ├── (dashboard)/
│   │   ├── layout.tsx                 # Dashboard shell — nav, notifications bell, auth guard
│   │   ├── vehicles/
│   │   │   ├── page.tsx               # Inventory list (RSC)
│   │   │   ├── new/page.tsx           # Purchase form
│   │   │   └── [id]/
│   │   │       ├── page.tsx           # Vehicle detail (RSC)
│   │   │       ├── edit/page.tsx      # Edit form
│   │   │       ├── repairs/page.tsx   # Repair history + new repair
│   │   │       └── costs/page.tsx     # Additional costs
│   │   ├── sales/
│   │   │   ├── page.tsx               # Sales list
│   │   │   └── [id]/page.tsx          # Sale detail + invoice trigger
│   │   ├── advances/
│   │   │   ├── page.tsx               # Active/expired advances list
│   │   │   └── [id]/page.tsx          # Advance detail + decision actions
│   │   ├── customers/
│   │   │   └── ...
│   │   ├── suppliers/
│   │   │   └── ...
│   │   ├── reports/
│   │   │   └── page.tsx               # Report runner with date filters
│   │   └── settings/
│   │       ├── users/page.tsx
│   │       └── roles/page.tsx         # Role + permission management
│   ├── api/
│   │   ├── auth/
│   │   │   └── [...better-auth]/
│   │   │       └── route.ts           # Better Auth handler (catch-all)
│   │   ├── vehicles/
│   │   │   ├── route.ts               # GET /api/vehicles, POST /api/vehicles
│   │   │   └── [id]/
│   │   │       ├── route.ts           # GET, PATCH /api/vehicles/:id
│   │   │       ├── status/route.ts    # PATCH /api/vehicles/:id/status
│   │   │       ├── repairs/route.ts   # GET, POST /api/vehicles/:id/repairs
│   │   │       ├── costs/route.ts     # GET, POST /api/vehicles/:id/costs
│   │   │       └── mileage/route.ts   # GET, POST /api/vehicles/:id/mileage
│   │   ├── purchases/
│   │   │   └── [id]/route.ts          # PATCH /api/purchases/:id (edit with reason)
│   │   ├── sales/
│   │   │   ├── route.ts               # POST /api/sales
│   │   │   └── [id]/
│   │   │       ├── route.ts           # GET, PATCH /api/sales/:id
│   │   │       └── invoice/route.ts   # POST /api/sales/:id/invoice (PDF)
│   │   ├── advances/
│   │   │   ├── route.ts               # POST /api/advances
│   │   │   └── [id]/
│   │   │       ├── route.ts           # GET, PATCH /api/advances/:id
│   │   │       └── decision/route.ts  # POST /api/advances/:id/decision
│   │   ├── customers/route.ts
│   │   ├── customers/[id]/route.ts
│   │   ├── suppliers/route.ts
│   │   ├── suppliers/[id]/route.ts
│   │   ├── users/route.ts
│   │   ├── users/[id]/route.ts
│   │   ├── roles/route.ts
│   │   ├── roles/[id]/route.ts
│   │   ├── approvals/
│   │   │   ├── route.ts               # GET pending approvals
│   │   │   └── [id]/route.ts          # POST approve/reject
│   │   ├── notifications/route.ts     # GET (SSE stream or polling)
│   │   ├── reports/[reportId]/route.ts # GET with ?from=&to=&format=csv|json
│   │   ├── uploads/presign/route.ts   # POST → returns R2 presigned PUT URL
│   │   └── cron/
│   │       └── advance-expiry/route.ts # GET (Vercel cron job, protected by CRON_SECRET)
│   └── layout.tsx                     # Root layout
├── lib/
│   ├── db.ts                          # Prisma client singleton (Neon serverless adapter)
│   ├── auth.ts                        # Better Auth server instance
│   ├── casl/
│   │   ├── ability.ts                 # AppAbility type + createAbilityForUser()
│   │   └── subjects.ts                # Subject type union
│   ├── services/
│   │   ├── vehicles.service.ts        # Vehicle CRUD + status machine logic
│   │   ├── purchases.service.ts       # Purchase record management
│   │   ├── sales.service.ts           # Sale creation + trade-in orchestration
│   │   ├── advances.service.ts        # Advance payment + expiry decisions
│   │   ├── repairs.service.ts         # Repair record lifecycle
│   │   ├── reports.service.ts         # Report aggregation queries
│   │   ├── audit.service.ts           # AuditLog write helper
│   │   ├── pdf.service.ts             # Invoice PDF generation
│   │   └── notifications.service.ts   # In-app notification creation
│   ├── validations/
│   │   ├── vehicle.schema.ts          # Zod schemas for vehicle inputs
│   │   ├── sale.schema.ts
│   │   ├── advance.schema.ts
│   │   └── ...                        # One schema file per domain entity
│   └── utils/
│       ├── currency.ts                # Format integers as currency strings
│       ├── status-machine.ts          # Valid transition map + guard function
│       └── advance-validity.ts        # Tier-based validity date computation
├── components/
│   ├── ui/                            # shadcn/ui generated components (untouched)
│   ├── forms/                         # Domain-specific form components
│   │   ├── VehiclePurchaseForm.tsx
│   │   ├── SaleForm.tsx
│   │   └── ...
│   ├── tables/                        # TanStack Table instances per domain
│   │   ├── VehicleTable.tsx
│   │   ├── SalesTable.tsx
│   │   └── ...
│   └── shared/                        # Shared UI atoms (StatusBadge, CurrencyDisplay, etc.)
├── hooks/
│   ├── useVehicles.ts                 # TanStack Query hooks for vehicles API
│   ├── useSales.ts
│   ├── useAbility.ts                  # CASL ability context hook (client)
│   └── ...
├── types/
│   └── index.ts                       # Re-exports Prisma generated types + domain types
└── prisma/
    ├── schema.prisma
    └── migrations/
```

### Structure Rationale

- **`app/api/` flat-but-nested by domain:** Route Handlers stay close to the App Router's file-system contract. Sub-routes like `/vehicles/[id]/status` keep domain semantics visible in the URL and keep handlers small.
- **`lib/services/` domain services:** Business logic is isolated from HTTP. Services can be called by Route Handlers and by cron routes without duplication. This is the correct place for state-machine checks, financial calculations, and audit writes.
- **`lib/casl/`:** Centralizes permission building. `createAbilityForUser(userId)` is called once at the top of every Route Handler and passed down — never called inside services.
- **`lib/validations/`:** Zod schemas are co-located as a separate concern, reused by both TanStack Form (client) and Route Handler input parsing (server).
- **`components/`:** Separating `ui/` (shadcn primitives), `forms/` (domain-specific), `tables/`, and `shared/` prevents the flat "200 files in components/" anti-pattern.

---

## Architectural Patterns

### Pattern 1: Route Handler Pipeline

**What:** Every Route Handler follows a fixed execution pipeline: authenticate → authorize → validate → service → audit → respond.

**When to use:** All mutation routes (POST, PATCH, DELETE). Read routes skip audit write but still auth/authz/validate.

**Trade-offs:** Adds a few lines of boilerplate per handler but makes the security contract explicit and consistent. Avoids forgetting an auth check.

**Example:**
```typescript
// app/api/vehicles/[id]/status/route.ts
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  // 1. Authenticate
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // 2. Authorize
  const ability = await createAbilityForUser(session.user.id);
  if (ability.cannot('update', 'Vehicle')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 3. Validate
  const body = await req.json();
  const result = vehicleStatusSchema.safeParse(body);
  if (!result.success) return Response.json({ error: result.error }, { status: 400 });

  // 4. Service (contains state-machine guard + DB write)
  const updated = await vehiclesService.transitionStatus(params.id, result.data, session.user.id);

  // 5. Audit (written inside service, but called explicitly to keep it visible)
  // audit.service is called inside vehiclesService.transitionStatus

  // 6. Respond
  return Response.json(updated);
}
```

### Pattern 2: CASL Ability Built Per Request from DB

**What:** On every authenticated request, load the user's permissions from DB and construct an `AppAbility` instance. Cache is not used — permissions are always fresh from the session's database row.

**When to use:** Every Route Handler. Permissions must reflect runtime role changes immediately (no stale cache).

**Trade-offs:** One extra DB query (permissions join) per request. Acceptable for a small team single-tenant app with Neon's 0.5ms serverless connection overhead. If permission reads become a bottleneck (unlikely), add a short-lived in-memory cache keyed on `userId`.

**Example:**
```typescript
// lib/casl/ability.ts
import { AbilityBuilder, createMongoAbility } from '@casl/ability';

export async function createAbilityForUser(userId: string): Promise<AppAbility> {
  const userPermissions = await prisma.permission.findMany({
    where: {
      roles: { some: { role: { users: { some: { userId } } } } }
    }
  });

  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

  for (const perm of userPermissions) {
    can(perm.action as Action, perm.subject as Subject, perm.conditions ?? undefined);
  }

  return build();
}
```

The same `AppAbility` type is used on the client via React Context — populated by a `/api/auth/permissions` endpoint that returns the serialized rule set after login.

### Pattern 3: Vehicle Status Machine as Pure Function

**What:** The 10-state machine is implemented as a pure validation function in `lib/utils/status-machine.ts`. Service methods call `assertValidTransition(from, to)` before any DB write.

**When to use:** Every status-changing service call. The function is also called on the client to drive UI affordances (which buttons are available).

**Trade-offs:** Centralizing transitions in one file means state changes can be audited by reading a single map. No distributed `if/switch` blocks across services.

**Example:**
```typescript
// lib/utils/status-machine.ts
const VALID_TRANSITIONS: Record<VehiclePrimaryStatus, VehiclePrimaryStatus[]> = {
  PURCHASED:       ['IN_STOCK'],
  IN_STOCK:        ['IN_REPAIR', 'ADVANCE_PLACED', 'FINANCE_PENDING', 'WRITTEN_OFF'],
  IN_REPAIR:       ['IN_STOCK'],
  ADVANCE_PLACED:  ['ADVANCE_EXPIRED', 'SOLD'],
  ADVANCE_EXPIRED: ['IN_STOCK', 'SOLD', 'WRITTEN_OFF'],
  FINANCE_PENDING: ['DO_RECEIVED'],
  DO_RECEIVED:     ['SOLD'],
  DELIVERED:       ['SOLD'],
  SOLD:            [],
  WRITTEN_OFF:     [],
};

export function assertValidTransition(
  from: VehiclePrimaryStatus,
  to: VehiclePrimaryStatus
): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}
```

### Pattern 4: Presigned URL File Upload (No Bytes Through Vercel)

**What:** Client requests a presigned PUT URL from `/api/uploads/presign`. Client uploads directly to R2. Client confirms the upload path by submitting the final object key in the subsequent record-creation API call.

**When to use:** All file uploads — DO documents for lease sales, any future vehicle photos. Never stream file bytes through the Next.js function.

**Trade-offs:** Two-step process (get URL, then upload). Eliminates any risk of hitting Vercel's 4.5MB request body limit and keeps serverless function payload tiny.

**Example:**
```typescript
// app/api/uploads/presign/route.ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { filename, contentType } = await req.json();
  const key = `uploads/${session.user.id}/${Date.now()}-${filename}`;

  const url = await getSignedUrl(
    r2Client,
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 300 } // 5 minutes
  );

  return Response.json({ url, key });
}
```

### Pattern 5: Prisma Extension for Transparent Audit Logging

**What:** Rather than calling `auditService.log(...)` manually inside every service function, a Prisma extension intercepts `create`, `update`, and `delete` operations on audited models and writes the AuditLog entry in the same transaction.

**When to use:** All audited entities (Vehicle, SaleRecord, AdvancePayment, etc. per Section 8.1 of spec).

**Trade-offs:** Reduces risk of forgetting to log a mutation. The extension requires passing a `context` object (userId, reason, ipAddress) via Prisma's `$extends` client method or a per-request context wrapper. Slightly more complex setup than manual calls but much safer.

**Note:** For mutations that require a mandatory `reason` (purchase price edits, sale edits, refunds), the Route Handler validates that `reason` is present in the body before calling the service. The service passes it to the audit context.

---

## Data Flow

### Mutation Request Flow (Example: Record a Vehicle Sale)

```
User submits sale form (TanStack Form)
    ↓ Zod validation (client — early feedback)
    ↓
POST /api/sales
    ↓
Better Auth: getSession()         ← validates HTTP-only session cookie
    ↓ (401 if no session)
createAbilityForUser(userId)      ← DB: load permissions for user's roles
    ↓ (403 if cannot('create', 'SaleRecord'))
Zod.safeParse(body)               ← re-validate on server (never trust client)
    ↓ (400 if invalid)
sales.service.createSale(data)
    ↓
    ├─ assertValidTransition(IN_STOCK → SOLD)       ← state machine guard
    ├─ Check: salePrice < vehicle.listedPrice?      ← approval gate check
    │   └─ YES → create ApprovalRequest, return 202 PENDING
    │   └─ NO  → continue
    ├─ prisma.$transaction([
    │   createSaleRecord,
    │   updateVehicleStatus(SOLD),
    │   createMileageHistory,
    │   createAuditLog (via Prisma extension)
    │  ])
    └─ create Notification(s) for relevant users
    ↓
Response 201 { saleRecord }
    ↓
TanStack Query: invalidate ['vehicles', id], ['sales']
    ↓
UI re-fetches and displays updated state
```

### Read Request Flow (Optimized for RSC)

```
User navigates to /vehicles
    ↓
Next.js App Router: renders page.tsx as RSC
    ↓
page.tsx calls service directly (no fetch hop needed for RSC):
    └─ const vehicles = await vehiclesService.list(filters)
       (Prisma query with Neon serverless driver)
    ↓
HTML streamed to browser
    ↓
TanStack Query hydrated with initial data (avoids double-fetch)
    ↓
Background refetch on window focus (TanStack Query default)
```

**Rationale:** React Server Components can call Prisma directly without an HTTP round-trip. This halves latency for initial page loads. TanStack Query is hydrated with the RSC data so client navigation and mutations remain cache-consistent.

### File Upload Flow

```
User selects DO document file
    ↓
Client: POST /api/uploads/presign { filename, contentType }
    ↓
Server returns { url (presigned R2 PUT), key }
    ↓
Client: PUT [url] with file bytes  ←→  Cloudflare R2 (direct, bypasses Vercel)
    ↓
Client: POST /api/sales with { ..., doDocumentPath: key }
    ↓
Server stores key in LeaseFinanceDetail.doDocumentPath
```

### Notification Delivery Flow

```
Service writes to Notification table (DB)
    ↓
Client polls GET /api/notifications every 30s (or SSE stream)
    ↓
Notification bell badge updated via TanStack Query
    ↓
User clicks → linked record navigated to via linkedEntity + linkedId
```

### PDF Invoice Generation Flow

```
Staff clicks "Generate Invoice"
    ↓
POST /api/sales/:id/invoice
    ↓
sales.service fetches SaleRecord + Vehicle + Customer from DB
    ↓
pdf.service.generateInvoice(data) → Buffer
  (using @react-pdf/renderer renderToBuffer())
    ↓
Response streams Buffer with Content-Type: application/pdf
    ↓
Browser opens in new tab / triggers download
    ↓
AuditLog: ACTION=CREATE, entityType=Invoice, invoiceGeneratedAt stamped on SaleRecord
```

**Note on Serverless PDF:** `@react-pdf/renderer`'s `renderToBuffer()` is compatible with Vercel's Node.js runtime (not Edge). Invoice PDFs for a single vehicle record are small-data renders (no embedded images, just text/tables) and complete in under 2 seconds. The 10s Vercel Hobby timeout is not a concern for this workload. Edge Runtime must be explicitly avoided for this route.

---

## Prisma Schema Topology

### Entity Relationship Summary

```
User ──< UserRole >── Role ──< RolePermission >── Permission

Vehicle ──< PurchaseRecord
         │   └── LeasePurchaseDetail (1:1)
         │   └── RepairRecord (many)
         │   └── VehicleCost (many)
         ├── VehicleMileageHistory (many)
         ├── SaleRecord (many)
         │   └── AdvancePayment (0..1 per active reservation)
         │   └── LeaseFinanceDetail (1:1 if lease)
         └── activePurchaseId → PurchaseRecord (FK — current purchase)

Supplier ──< PurchaseRecord
Supplier ──< SupplierContactPoint

Customer ──< SaleRecord
Customer ──< AdvancePayment

RepairVendor ──< RepairRecord
RepairVendor ──< RepairVendorContactPoint

SaleRecord.tradeInVehicleId → Vehicle (self-referential for trade-ins)
PurchaseRecord.tradeInSourceSaleId → SaleRecord (reverse trade-in link)

AuditLog (append-only, no FK constraints — entity references stored as strings)
Notification (polymorphic via linkedEntity: String + linkedId: UUID)
ApprovalRequest (polymorphic via entityType: String + entityId: UUID)
```

### Key Schema Decisions

| Decision | Rationale |
|----------|-----------|
| Polymorphic `AuditLog` (entityType: String) | Avoids schema changes when new entities are added; append-only table benefits from no FK constraints |
| Polymorphic `Notification.linkedEntity` | Same reasoning; notification targets can expand without migration |
| `VehiclePrimaryStatus` as Prisma enum | Static 10-value set; won't change mid-deployment; native PostgreSQL enum enforces DB-level integrity |
| All money as `Int` (smallest currency unit) | Eliminates floating-point accumulation errors; display layer formats |
| `AuditLog.changedFields` as `Json` | `{ fieldName: { from, to } }` — flexible, no separate change-field table needed |
| `ApprovalRequest.payload` as `Json` | Proposed change data varies by `requestType` — polymorphic JSON cleaner than 20 optional columns |
| `Permission.conditions` as `Json` | CASL condition objects are arbitrary JSON; schema cannot be normalized |

---

## Scaling Considerations

This is a single-tenant, single-dealership system on free-tier hosting. Scaling concerns are minimal but worth documenting for future-proofing.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| Current (1 dealership, ~5 users) | Monolith is optimal — zero overhead, zero cost |
| 10x data (500K records) | Add DB indexes on `vehicleId`, `status`, `createdAt` on all transaction tables. Neon still handles it on free tier. |
| Multi-branch (future) | Add `branchId` FK to Vehicle, SaleRecord, User. CASL conditions can scope reads by branch. |
| Performance bottleneck | RSC data fetching already reduces round-trips. TanStack Query client cache reduces redundant API calls. PDF generation is the only CPU-heavy operation — if it times out, move to a dedicated `/api/pdf` function with `maxDuration: 30` (requires Vercel Pro). |

### Scaling Priorities

1. **First bottleneck:** `AuditLog` table growth — add DB index on `(entityType, entityId, performedAt)` and `performedBy` early. Queries for audit history per record stay fast.
2. **Second bottleneck:** Report aggregation queries — reports scan all transactions by date range. Add composite indexes on `(createdAt, vehicleId)` for RepairRecord, SaleRecord, etc. Alternatively, use `MATERIALIZED VIEW` if reports become slow.

---

## Anti-Patterns

### Anti-Pattern 1: Business Logic in Route Handlers

**What people do:** Put state machine checks, profit calculations, and approval logic directly inside `route.ts` files.

**Why it's wrong:** Route Handlers become untestable 200-line files. Same logic gets duplicated across related endpoints (e.g., POST /sales and POST /advances/[id]/decision both modify vehicle status). Cron jobs can't reuse the logic.

**Do this instead:** Route Handlers are thin pipelines: auth → authz → validate → delegate to service → respond. All domain logic lives in `lib/services/`.

### Anti-Pattern 2: Skipping Server-Side Authorization

**What people do:** Check CASL ability only on the client (hiding UI elements) and trust that the client won't call unauthorized endpoints.

**Why it's wrong:** Any authenticated user can call any API route directly with a tool like `curl`. Client-side CASL is a UX convenience, not a security boundary.

**Do this instead:** Call `createAbilityForUser(userId)` in every Route Handler. Client-side ability (via `/api/auth/permissions` response) is used only to show/hide UI elements — the server is the authoritative gate.

### Anti-Pattern 3: Streaming File Bytes Through Vercel

**What people do:** Use `FormData` and parse `multipart/form-data` inside a Next.js API route to receive file uploads.

**Why it's wrong:** Vercel's Hobby tier has a 4.5MB request body limit. Even larger tiers have throughput costs. File bytes don't need to touch the Next.js function.

**Do this instead:** Presigned PUT URL pattern — server generates a signed URL, client uploads directly to R2. Only the final object key is sent to the Next.js API.

### Anti-Pattern 4: Forgetting Audit Writes on Mutations

**What people do:** Call audit service manually in each service function but occasionally forget when adding a new code path.

**Why it's wrong:** Gaps in the audit trail are a compliance failure. The spec requires every CREATE, UPDATE, DELETE, and STATUS_CHANGE to be logged.

**Do this instead:** Use a Prisma extension that intercepts writes automatically on audited models. Manual `auditService.log()` calls are still needed for STATUS_CHANGE (which may not be a distinct DB operation from an UPDATE) but the extension eliminates silent gaps for standard CRUD.

### Anti-Pattern 5: Calling `renderToBuffer` on the Edge Runtime

**What people do:** Forget that `@react-pdf/renderer` uses Node.js APIs and deploy the invoice route without specifying the runtime.

**Why it's wrong:** Vercel's default for App Router is Edge Runtime in some configurations. `@react-pdf/renderer` requires the full Node.js runtime.

**Do this instead:** Explicitly export `export const runtime = 'nodejs'` in the invoice Route Handler, or set it globally in `next.config.ts`. Test PDF generation in CI.

### Anti-Pattern 6: Allowing Direct Status Writes Bypassing the State Machine

**What people do:** PATCH `/api/vehicles/:id` accepts `{ primaryStatus: 'SOLD' }` without validating the transition.

**Why it's wrong:** A vehicle in `PURCHASED` state could jump directly to `SOLD`, bypassing the entire lease/advance/repair lifecycle. Financial records (RepairRecord, AdvancePayment) would be orphaned.

**Do this instead:** The general vehicle PATCH route does NOT accept `primaryStatus` changes. Status transitions use a dedicated `/api/vehicles/:id/status` endpoint that always calls `assertValidTransition()`.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Neon PostgreSQL | Prisma + `@neondatabase/serverless` (HTTP) | Instantiate client once as module singleton; avoid creating new PrismaClient per request |
| Cloudflare R2 | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Use `S3Client` pointed at R2's S3-compatible endpoint. Zero egress fee — R2 serves objects directly to browser |
| Better Auth | Drop-in handler at `/api/auth/[...better-auth]/route.ts` | Session validated server-side via `auth.api.getSession()` in every protected route |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Route Handler → Service | Direct function call (same process) | No HTTP round-trip; services are not independently deployable |
| RSC page → Service | Direct function call (RSC can import `lib/services` directly) | No fetch needed for initial data load; hydrate TanStack Query |
| Client → API | `fetch()` via TanStack Query hooks | All mutations and client-triggered reads go through HTTP |
| Service → Audit | Prisma extension intercept OR explicit `auditService.log()` for status changes | Must not be bypassed |
| CASL (server) → CASL (client) | `/api/auth/permissions` response serializes CASL rules as JSON | Client ability is read-only; only server ability gates access |
| Cron job → Advance expiry | Vercel Cron → `GET /api/cron/advance-expiry` with `CRON_SECRET` header | Daily job; idempotent; sets expired advances and triggers notifications |

---

## Suggested Build Order (Phase Dependencies)

Based on component dependencies, the build sequence should follow this order:

1. **Foundation** — Prisma schema, database migrations, Better Auth setup, CASL factory, base Route Handler pipeline. Nothing else works without this.

2. **Vehicle Lifecycle Core** — Vehicle + PurchaseRecord CRUD, status machine, mileage, VehicleCost, RepairRecord. This is the heart of the system; all other modules reference `vehicleId`.

3. **Suppliers and Customers** — Reference data that purchase and sale records depend on. Relatively simple CRUD; unblock purchase and sale forms.

4. **Sales and Advances** — SaleRecord, AdvancePayment, LeaseFinanceDetail. Depends on Vehicle (must exist), Customer (must exist), and the status machine (transitions are driven by sale actions).

5. **File Uploads** — Presigned URL endpoint + R2 configuration. Required for lease sale DO document upload. Can be built in parallel with sales, but must be complete before lease sale flow is testable end-to-end.

6. **Approval Workflows** — ApprovalRequest + Notification creation for discount/write-off/refund/edit-sale. Depends on SaleRecord, AdvancePayment.

7. **PDF Invoice Generation** — SaleRecord must exist. `@react-pdf/renderer` integration. Can be deferred until sale flow is stable.

8. **Reports** — Aggregation queries over existing data. No new entities. Depends on all transactional data being available. Build last.

9. **User and Role Management** — Admin UI for CASL permission assignment. Can be scaffolded early with hardcoded roles and polished late; does not block other features since default roles are seeded.

10. **Audit Trail Viewer** — AuditLog is written throughout; a read-only UI viewer is low-priority and can be added in any late phase.

---

## Sources

- Next.js App Router project structure: [Makerkit Definitive Guide](https://makerkit.dev/blog/tutorials/nextjs-app-router-project-structure), [Next.js Official Docs](https://nextjs.org/docs/app/getting-started/project-structure)
- CASL persisted permissions: [CASL Roles with Persisted Permissions](https://casl.js.org/v6/en/cookbook/roles-with-persisted-permissions/), [Permit.io CASL tutorial](https://www.permit.io/blog/frontend-authorization-with-nextjs-and-casl-tutorial)
- R2 presigned uploads: [Cloudflare R2 Presigned URL docs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [Build with Matija guide](https://www.buildwithmatija.com/blog/how-to-upload-files-to-cloudflare-r2-nextjs)
- Prisma audit trail: [Prisma Audit Trail Guide (Medium)](https://medium.com/@arjunlall/prisma-audit-trail-guide-for-postgres-5b09aaa9f75a), [Entity Audit Log with Prisma](https://medium.com/@gayanper/implementing-entity-audit-log-with-prisma-9cd3c15f6b8e)
- react-pdf serverless: [NextJS 14 and react-pdf integration](https://benhur-martins.medium.com/nextjs-14-and-react-pdf-integration-ccd38b1fd515), [react-pdf GitHub Discussion #2402](https://github.com/diegomura/react-pdf/discussions/2402)
- Building APIs with Next.js: [Next.js official blog](https://nextjs.org/blog/building-apis-with-nextjs)
- Feature-sliced structure: [The Ultimate Next.js App Router Architecture](https://feature-sliced.design/blog/nextjs-app-router-guide)

---

*Architecture research for: Vehicle dealership management system (VSMS)*
*Researched: 2026-03-21*
