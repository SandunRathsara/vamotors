# Vehicle Sale Management System (VSMS)

## What This Is

A web-based business operations platform for VA Motors — a vehicle dealership dealing in secondhand and brand-new vehicles. The system manages the full lifecycle of a vehicle from purchase through repair and sale, tracks financial positions per vehicle and across the business, enforces dynamic role-based permissions, and produces operational and financial reports. It replaces physical document-based processes with a centralized, auditable digital system.

## Core Value

Every vehicle's complete financial story — purchase cost, repairs, additional costs, sale price, and profit — must be accurate, traceable, and instantly available.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Vehicle purchase recording (cash, lease settlement, brand-new from supplier)
- [ ] Supplier management (individuals and companies with contact points)
- [ ] Vehicle repair management with vendor tracking and cost recording
- [ ] Vehicle write-off and disposal workflow with manager approval
- [ ] Vehicle status lifecycle management (10-state machine with availability flag)
- [ ] Vehicle sale recording (cash immediate, cash with advance/reservation, lease/finance, trade-in)
- [ ] Advance payment system with tiered validity periods and expiry handling
- [ ] Customer management
- [ ] Invoice generation as printable PDF
- [ ] User management with dynamic CASL-based roles and permissions
- [ ] Manager approval workflows (discounts, write-offs, refunds, sale edits)
- [ ] Full audit trail with field-level change history and mandatory edit reasons
- [ ] In-app notification system linked to specific records
- [ ] Seven standard business reports with date filtering and CSV/PDF export
- [ ] Per-vehicle financial tracking (cost basis and profit calculation)
- [ ] Business cash position tracking (money in vs money out)
- [ ] Mileage history tracking with dates and remarks
- [ ] Additional vehicle costs tracking (transport, inspection, taxes)
- [ ] One-time historical data import from spreadsheets
- [ ] PWA capabilities (installable, responsive 360px-1920px)
- [ ] Vehicle listed price management (separate from cost basis)

### Out of Scope

- Native iOS/Android mobile apps — web PWA is sufficient
- SMS, email, or push notifications — in-app only
- Third-party integrations (banks, government registries, accounting software) — not needed yet
- Tax calculation or regulatory compliance reporting — not applicable currently
- Multi-currency support — single configurable currency via env var
- Multi-branch or multi-company support — single dealership
- Customer-facing portal or online listings — internal system only
- Vehicle valuation tools or market price feeds — manual pricing
- Document scanning/OCR — manual data entry
- Real-time chat or messaging — not needed
- OAuth or social login — credentials-based auth only

## Context

- **Current state:** All operations run on physical documents. Historical data needs one-time import.
- **Primary user:** Cashier (daily use). Managers and sales persons log in occasionally.
- **Currency:** Single currency, configurable via `APP_CURRENCY` env var. All monetary values stored as integers (smallest unit).
- **Vehicle identity:** A vehicle is uniquely identified by engine number + chassis number. Same vehicle can be re-purchased — linked to existing record, not duplicated.
- **Advance rules:** Tiered validity (0-5% = 1 week, 5-10% = 2 weeks, 10-15% = 3 weeks, 15%+ = 1 month max). Expiry handled manually by staff.
- **Lease sales:** Always require a down payment. DO document upload is mandatory. Finance date = DO issue date.
- **Trade-ins:** Customer's old vehicle value deducted from sale price. Traded-in vehicle can be added to inventory.
- **Audit:** Every change logged with who, when, what changed (before/after). Purchase and sale edits require a mandatory reason.
- **Data retention:** Indefinite. No automatic deletion or archiving.
- **Existing docs:** Detailed requirements in `docs/01-requirements-questionnaire.md`, `docs/02-1-business-requirements-specification.md`, `docs/02-2-requirements-specification.md`, `docs/03-tech-and-infra-stack.md`.

## Constraints

- **Hosting cost:** $0/month — must use free tiers (Vercel Hobby, Neon free, Cloudflare R2 free)
- **Tech stack:** Next.js 15+ (App Router), TypeScript, shadcn/ui, Tailwind CSS, Prisma, Neon PostgreSQL, Better Auth, TanStack Query/Table/Form, Cloudflare R2, @react-pdf/renderer
- **Architecture:** Monolithic Next.js — API Route Handlers replace separate backend. No NestJS, no RabbitMQ.
- **Storage limits:** Neon 0.5GB (sufficient for ~50K records), R2 10GB (sufficient for ~2-3K vehicles with photos)
- **Serverless timeout:** Vercel 10s function timeout — all operations must complete within this limit
- **Package manager:** pnpm
- **Validation:** Zod for runtime type validation

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js monolith over NestJS+React | Zero hosting cost, single deployment, simpler architecture | -- Pending |
| Better Auth over NextAuth | More actively maintained, cleaner API, first-class TypeScript | -- Pending |
| Neon PostgreSQL over other DBs | Serverless, Prisma compatible, free tier sufficient | -- Pending |
| CASL for authorization | Dynamic roles and permissions configurable at runtime without code changes | -- Pending |
| Integer currency storage | Avoid floating-point errors in financial calculations | -- Pending |
| Two-field vehicle status (primaryStatus + isAvailableForSale) | Cleanly separates lifecycle state from sale availability, handles complex scenarios | -- Pending |
| TanStack Form over React Hook Form | Type-safe, pairs well with TanStack ecosystem already in use | -- Pending |
| Pre-signed URL uploads to R2 | No file bytes through Vercel serverless functions, direct client-to-storage | -- Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-21 after initialization*
