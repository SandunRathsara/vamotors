<!-- GSD:project-start source:PROJECT.md -->
## Project

**Vehicle Sale Management System (VSMS)**

A web-based business operations platform for VA Motors — a vehicle dealership dealing in secondhand and brand-new vehicles. The system manages the full lifecycle of a vehicle from purchase through repair and sale, tracks financial positions per vehicle and across the business, enforces dynamic role-based permissions, and produces operational and financial reports. It replaces physical document-based processes with a centralized, auditable digital system.

**Core Value:** Every vehicle's complete financial story — purchase cost, repairs, additional costs, sale price, and profit — must be accurate, traceable, and instantly available.

### Constraints

- **Hosting cost:** $0/month — must use free tiers (Vercel Hobby, Neon free, Cloudflare R2 free)
- **Tech stack:** Next.js 15+ (App Router), TypeScript, shadcn/ui, Tailwind CSS, Prisma, Neon PostgreSQL, Better Auth, TanStack Query/Table/Form, Cloudflare R2, @react-pdf/renderer
- **Architecture:** Monolithic Next.js — API Route Handlers replace separate backend. No NestJS, no RabbitMQ.
- **Storage limits:** Neon 0.5GB (sufficient for ~50K records), R2 10GB (sufficient for ~2-3K vehicles with photos)
- **Serverless timeout:** Vercel 10s function timeout — all operations must complete within this limit
- **Package manager:** pnpm
- **Validation:** Zod for runtime type validation
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | 15.x (latest) | Full-stack framework — App Router for UI + Route Handlers for API | Monolithic deployment to Vercel; zero extra hosting cost; server components reduce client JS; App Router is stable and production-ready |
| TypeScript | 5.x | End-to-end type safety | Required by shadcn/ui and TanStack; catches contract errors between API and UI at build time |
| React | 19.x | UI runtime | Required by Next.js 15; Next.js 15 App Router targets React 19 |
| pnpm | 9.x | Package manager | Strict dependency resolution; faster installs; symlink-based node_modules avoids phantom deps; no special flags needed for React 19 peer dep resolution unlike npm |
| Zod | 3.x | Runtime schema validation | Pairs with TanStack Form via `@tanstack/zod-form-adapter`; validates API route inputs; shared schemas between client and server |
### Database & ORM
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Prisma ORM | 6.x | Type-safe database access, migrations | Schema-first with full TypeScript types; `prisma generate` produces query builder; migration history is version-controlled |
| `@prisma/adapter-neon` | 6.x (matches Prisma) | Neon HTTP/WebSocket adapter for Prisma | Eliminates TCP connection overhead in serverless; uses Neon's message pipelining for efficiency |
| `@neondatabase/serverless` | latest | Neon's serverless driver (peer dep for adapter) | Required by `@prisma/adapter-neon` |
| Neon PostgreSQL | Free tier | Serverless PostgreSQL | 0.5 GB free storage; pgBouncer connection pooling up to 10,000 connections; scale-to-zero; branching for dev/staging |
### Authentication & Authorization
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Better Auth | latest (1.x) | Session-based authentication | More actively maintained than NextAuth v4; first-class TypeScript; cleaner API; `toNextJsHandler` adapter for App Router; built-in admin plugin for role management |
| `@casl/ability` | 6.8.0 | Isomorphic authorization rules engine | Defines abilities once, enforces on both server (API routes) and client (UI rendering); dynamic rule loading from DB without code changes; isomorphic = same `@casl/ability` package on server and client |
| `@casl/react` | 5.0.1 | React bindings for CASL | `<Can>` component and `useAbility` hook for conditional UI rendering; triggers re-render only when ability rules change |
### Data Fetching & State
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| TanStack Query | v5 | Server state — caching, background refetch, loading/error states | Standard for client-driven data fetching in Next.js; `QueryClient` instance created once at module level; integrates with Next.js Suspense and streaming |
| TanStack Table | v8 | Headless table engine | Server-side pagination/sorting via `manualPagination` + `manualSorting`; pairs with TanStack Query for data loading; fully typed via TypeScript generics |
| TanStack Form | v1 (stable) | Type-safe form state management | First stable release (May 2025); Server Actions support via `@tanstack/react-form-nextjs`; signals-based fine-grain reactivity prevents unnecessary re-renders; replaces React Hook Form in this stack |
### UI & Styling
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| shadcn/ui | latest | Accessible component library | Copy-paste into project — no external lock-in; built on Radix UI primitives; fully supports Tailwind v4; all components updated for React 19 and `data-slot` attribute styling |
| Tailwind CSS | v4 | Utility-first styling | Required by shadcn/ui; v4 uses `@theme` directive (no `tailwind.config.ts` needed); OKLCH colors replace HSL; use `@tailwindcss/postcss` plugin |
| Lucide React | latest | Icon set | Default icons shipped with shadcn/ui; consistent SVG size and style |
### Storage & Files
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Cloudflare R2 | (service) | Object storage for vehicle images and DO documents | Zero egress fees; S3-compatible API; accessed via `@aws-sdk/client-s3` |
| `@aws-sdk/client-s3` | v3 | R2 SDK | Official AWS SDK v3; supports pre-signed PUT URL generation; R2 is S3-compatible so no custom client needed |
| `@aws-sdk/s3-request-presigner` | v3 | Pre-signed URL generation | Generates short-lived PUT URLs so client uploads directly to R2 — file bytes never touch Vercel function |
### PDF Generation
| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `@react-pdf/renderer` | 4.3.x | React-based invoice PDF generation | React-style component API for PDF layout; v4.1.0+ supports React 19; runs server-side inside API Route Handler |
## Supporting Libraries
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/zod-form-adapter` | v1 | Bridge Zod validators to TanStack Form | When using Zod schemas for form field validation; Zod v4.0.6+ works natively without the adapter, but adapter provides ergonomic integration |
| `ws` | 8.x | WebSocket polyfill for Neon driver | Required by `@neondatabase/serverless` for local development outside edge runtime |
| `server-only` | latest | Mark modules as server-only | Prevents accidental import of DB or secret-touching code into client bundles |
| `date-fns` | 3.x | Date manipulation | Format dates for reports, advance expiry calculations; tree-shakeable |
| `nuqs` | 2.x | URL search params state management | Sync table filters/pagination to URL; enables shareable/bookmarkable list views |
## Development Tools
| Tool | Purpose | Notes |
|------|---------|-------|
| ESLint | Linting | Use `eslint-config-next` (includes `jsx-a11y` and React hooks rules) |
| Prettier | Code formatting | Pair with `prettier-plugin-tailwindcss` to auto-sort Tailwind class names |
| Prisma CLI | DB migrations | Run `prisma migrate dev` and `prisma db push` via `DIRECT_URL` (non-pooled connection) |
| `@next/bundle-analyzer` | Bundle analysis | Identify large client-side JS chunks; flag heavy imports accidentally placed in client components |
## Installation
# Core framework
# Database
# Auth & Authorization
# Data fetching & forms
# UI
# (shadcn/ui components are copied via CLI, not installed as a package)
# Storage
# PDF
# Supporting
# Dev tools
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Better Auth | Auth.js (NextAuth v5) | Auth.js when OAuth providers (Google, GitHub, etc.) are primary and you prefer the established ecosystem; Better Auth when credentials-only and clean API matters more |
| TanStack Form | React Hook Form | React Hook Form when migrating existing projects heavily invested in RHF + Yup/Zod adapters; TanStack Form for greenfield projects needing Server Actions support |
| Prisma | Drizzle ORM | Drizzle when you prefer raw SQL-like syntax and lighter bundle size; Prisma when schema-first migrations and generated client types are higher priority |
| `@react-pdf/renderer` | Puppeteer/headless Chrome | Puppeteer when you need pixel-perfect HTML-to-PDF; `@react-pdf/renderer` when React component model is preferable and serverless constraints rule out headless Chrome |
| Neon PostgreSQL | Supabase (PostgreSQL) | Supabase when you need built-in realtime subscriptions, auth, or storage; Neon when all you need is serverless PostgreSQL and you're bringing your own auth |
| TanStack Table | AG Grid | AG Grid for enterprise-grade pivot tables and Excel export; TanStack Table for custom headless implementation without licensing costs |
| Cloudflare R2 | Vercel Blob | R2 for zero egress fees (important for images); Vercel Blob for simpler setup if egress cost is not a concern |
## What NOT to Use
| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `next-auth` (v4) / Auth.js v4 | Deprecated; `next-auth` package on npm is now Auth.js v5 with breaking API changes; Better Auth has overtaken it as the modern credentials-auth choice | `better-auth` |
| React Hook Form | Does not integrate natively with Server Actions; TanStack Form v1 is now stable with explicit SSR and Server Action support | TanStack Form v1 |
| `axios` for API calls | Unnecessary dependency when `fetch` (native) + TanStack Query handles caching and retries | Native `fetch` + TanStack Query |
| `moment.js` | Massive bundle size; unmaintained | `date-fns` (tree-shakeable) |
| Prisma without singleton | In development, hot-reloading creates new PrismaClient instances per reload, exhausting the connection pool | Use `globalThis` singleton pattern (see Patterns section) |
| Prisma `DATABASE_URL` as direct connection for app | Direct connections don't pool — cold starts create new TCP connections per function invocation, hitting Neon's connection limit | Use pooled connection string for `DATABASE_URL`, direct connection only for `DIRECT_URL` (CLI migrations) |
| `PDFDownloadLink` from `@react-pdf/renderer` in SSR | Client-only component; importing without `ssr: false` in dynamic import causes server crash | Use `dynamic(() => import(...), { ssr: false })` or render PDF in API Route Handler using `renderToBuffer()` |
| `tailwindcss-animate` plugin (v4) | Removed in Tailwind v4; shadcn/ui now recommends `tw-animate-css` | `tw-animate-css` imported in `globals.css` |
| `floating-point` numbers for currency | IEEE 754 floating-point errors cause incorrect financial calculations (e.g., 0.1 + 0.2 !== 0.3) | Store all monetary values as integers (smallest currency unit); divide by 100 only for display |
| Server Actions for ALL mutations | Server Actions are excellent for simple forms but TanStack Query mutations provide better optimistic update, retry, and cache invalidation control | Use TanStack Query `useMutation` for complex UI interactions; Server Actions for simpler form submissions |
## Key Patterns for This Stack
### Pattern 1: Prisma Singleton with Neon Adapter
### Pattern 2: Better Auth — Server Action Cookie Handling
### Pattern 3: CASL Ability Loader from Session
### Pattern 4: TanStack Query — QueryClient Setup
### Pattern 5: TanStack Table — Server-Side Pagination + Sorting
### Pattern 6: R2 Pre-signed Upload
### Pattern 7: @react-pdf/renderer — API Route Rendering
### Pattern 8: next.config.ts — Required External Packages
## Version Compatibility
| Package | Compatible With | Notes |
|---------|-----------------|-------|
| Next.js 15.x | React 19.x | React 19 is the minimum for Next.js 15 App Router; React 18 supported only in Pages Router |
| `@react-pdf/renderer` 4.3.x | React 19.x | React 19 support added in v4.1.0; versions below 4.1.0 will crash with Next.js 15 |
| `@react-pdf/renderer` 4.x | Next.js 15.x | Requires `serverExternalPackages: ["@react-pdf/renderer"]` in next.config; add `dynamic(..., { ssr: false })` for `PDFDownloadLink` |
| Prisma 6.x | `@prisma/adapter-neon` 6.x | Adapter version must match Prisma client version exactly |
| TanStack Form v1 | Next.js 15.x App Router | Use `@tanstack/react-form-nextjs` package for Server Actions; standard `@tanstack/react-form` for client-only forms |
| Zod 4.0.6+ | TanStack Form v1 | Zod v4.0.6+ works natively with TanStack Form without `@tanstack/zod-form-adapter`; adapter still works for ergonomics |
| `@casl/ability` 6.8.0 | `@casl/react` 5.0.1 | Latest versions as of January 2026; released together |
| shadcn/ui (latest CLI) | Tailwind CSS v4 | shadcn/ui CLI now initializes with Tailwind v4 by default; components updated for React 19 |
| Tailwind CSS v4 | shadcn/ui latest | Remove `tailwindcss-animate` plugin; use `tw-animate-css` imported in `globals.css` instead |
| Better Auth 1.x | Prisma 6.x | Better Auth has a Prisma adapter; use `@better-auth/prisma-adapter` |
## Environment Variables
# .env.local
# Neon PostgreSQL — two connections required
# Better Auth
# Cloudflare R2
# App Config
## Constraints That Affect Stack Usage
| Constraint | Impact | Mitigation |
|------------|--------|------------|
| Vercel Hobby 10s function timeout | PDF generation + complex DB queries must complete in <10s | `@react-pdf/renderer` runs in ~1-3s for typical invoices; keep DB queries indexed; avoid N+1 queries in reports |
| Neon 0.5 GB storage | Cannot store large blobs in Postgres | All images go to R2; Postgres stores only metadata (R2 key, content type, size) |
| Neon free tier: 5-minute scale-to-zero idle timeout | First request after idle may be slow (cold start) | Add `connect_timeout=15` to connection string; show loading states via Suspense boundaries |
| Neon free tier: 100 CU-hours/month | Sustained heavy load would exhaust compute | Single-user internal system; 100 CU-hours is ~400 hours of 0.25 CU — far more than needed |
| R2 10 GB free storage | ~2,000-3,000 vehicles at 5-6 photos each | Enforce image size limits on upload (max 2MB per photo); compress on client before upload |
| `@react-pdf/renderer` client-side issues | `PDFDownloadLink` crashes in SSR | Always use `dynamic(..., { ssr: false })` or render server-side only via API route |
## Sources
- [Next.js App Router Docs — Production Checklist](https://nextjs.org/docs/app/guides/production-checklist) — verified 2026-03-10 (Next.js version 16.2.1 docs)
- [Next.js serverExternalPackages Docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — stable config, renamed from `serverComponentsExternalPackages`
- [Better Auth — Next.js Integration Docs](https://better-auth.com/docs/integrations/next) — cookie handling gotcha, `nextCookies` plugin requirement
- [Better Auth — Admin Plugin](https://better-auth.com/docs/plugins/admin) — role and permission management built-in
- [Prisma + Neon Guide](https://neon.com/docs/guides/prisma) — two-connection-string pattern verified
- [Prisma + Next.js Guide](https://www.prisma.io/docs/guides/nextjs) — singleton pattern with Neon adapter code example
- [CASL GitHub Releases](https://github.com/stalniy/casl/releases) — `@casl/ability@6.8.0`, `@casl/react@5.0.1` latest as of 2026-01-18
- [@react-pdf/renderer GitHub Issue #2912](https://github.com/diegomura/react-pdf/issues/2912) — React 19 support confirmed in v4.1.0
- [TanStack Form v1 Announcement](https://tanstack.com/blog/announcing-tanstack-form-v1) — stable May 2025
- [TanStack Table v8 — Pagination Guide](https://tanstack.com/table/v8/docs/guide/pagination) — `manualPagination` pattern
- [Cloudflare R2 Pre-signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) — presign pattern confirmed
- [shadcn/ui Tailwind v4 Docs](https://ui.shadcn.com/docs/tailwind-v4) — v4 setup, `tw-animate-css` replacement
- [Neon Plans](https://neon.com/docs/introduction/plans) — free tier limits: 0.5 GB, 100 CU-hours/month
- [Vercel Hobby Plan Limits](https://vercel.com/docs/plans/hobby) — 10s function timeout confirmed
- [WebSearch] TanStack Form + Zod v4 native compatibility — MEDIUM confidence (GitHub issue #1529 + community confirmation)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
