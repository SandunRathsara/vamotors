# Stack Research

**Domain:** Vehicle Dealership Management System (VSMS)
**Researched:** 2026-03-21
**Confidence:** HIGH (all libraries verified via official docs and WebSearch)

---

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

---

## Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/zod-form-adapter` | v1 | Bridge Zod validators to TanStack Form | When using Zod schemas for form field validation; Zod v4.0.6+ works natively without the adapter, but adapter provides ergonomic integration |
| `ws` | 8.x | WebSocket polyfill for Neon driver | Required by `@neondatabase/serverless` for local development outside edge runtime |
| `server-only` | latest | Mark modules as server-only | Prevents accidental import of DB or secret-touching code into client bundles |
| `date-fns` | 3.x | Date manipulation | Format dates for reports, advance expiry calculations; tree-shakeable |
| `nuqs` | 2.x | URL search params state management | Sync table filters/pagination to URL; enables shareable/bookmarkable list views |

---

## Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| ESLint | Linting | Use `eslint-config-next` (includes `jsx-a11y` and React hooks rules) |
| Prettier | Code formatting | Pair with `prettier-plugin-tailwindcss` to auto-sort Tailwind class names |
| Prisma CLI | DB migrations | Run `prisma migrate dev` and `prisma db push` via `DIRECT_URL` (non-pooled connection) |
| `@next/bundle-analyzer` | Bundle analysis | Identify large client-side JS chunks; flag heavy imports accidentally placed in client components |

---

## Installation

```bash
# Core framework
pnpm add next react react-dom typescript

# Database
pnpm add prisma @prisma/client @prisma/adapter-neon @neondatabase/serverless
pnpm add -D prisma

# Auth & Authorization
pnpm add better-auth @casl/ability @casl/react

# Data fetching & forms
pnpm add @tanstack/react-query @tanstack/react-table @tanstack/react-form
pnpm add @tanstack/zod-form-adapter @tanstack/react-form-nextjs
pnpm add zod

# UI
pnpm add tailwindcss @tailwindcss/postcss lucide-react
# (shadcn/ui components are copied via CLI, not installed as a package)

# Storage
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

# PDF
pnpm add @react-pdf/renderer

# Supporting
pnpm add server-only date-fns nuqs ws

# Dev tools
pnpm add -D eslint prettier prettier-plugin-tailwindcss @next/bundle-analyzer
```

---

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

---

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

---

## Key Patterns for This Stack

### Pattern 1: Prisma Singleton with Neon Adapter

Always use the singleton pattern. Without it, dev hot-reload creates multiple PrismaClient instances and exhausts the Neon free-tier connection pool.

```typescript
// lib/prisma.ts
import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"

const globalForPrisma = global as unknown as { prisma: PrismaClient }

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
```

### Pattern 2: Better Auth — Server Action Cookie Handling

By default, calling `auth.api.signInEmail()` inside a Server Action does NOT set cookies because RSCs cannot set cookies. Install the `nextCookies` plugin to fix this.

```typescript
// lib/auth.ts
import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"

export const auth = betterAuth({
  database: { /* prisma adapter */ },
  plugins: [nextCookies()], // REQUIRED for Server Action cookie setting
  emailAndPassword: { enabled: true },
})
```

### Pattern 3: CASL Ability Loader from Session

Load the user's CASL ability server-side from their role/permissions record, pass it to the client via context. The isomorphic `@casl/ability` package runs the same permission checks on both server (API routes) and client (UI rendering).

```typescript
// lib/abilities.ts
import { AbilityBuilder, createMongoAbility } from "@casl/ability"

export function defineAbilityForUser(userRole: string, permissions: string[]) {
  const { can, cannot, build } = new AbilityBuilder(createMongoAbility)
  // load rules from DB-stored permissions array
  permissions.forEach((rule) => {
    const [action, subject] = rule.split(":")
    can(action, subject)
  })
  return build()
}
```

Server-side guard in API Route Handler:
```typescript
import { ForbiddenError } from "@casl/ability"
ForbiddenError.from(ability).throwUnlessCan("update", "Vehicle")
```

### Pattern 4: TanStack Query — QueryClient Setup

Create `QueryClient` at module level in the provider, not inside a component. Use `@tanstack/react-query-next-experimental` only if streaming is needed; otherwise standard setup is sufficient.

```typescript
// providers/query-provider.tsx
"use client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 60 * 1000 } }
  }))
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
```

### Pattern 5: TanStack Table — Server-Side Pagination + Sorting

Use `manualPagination` and `manualSorting` with TanStack Query to keep the full dataset on the server.

```typescript
const table = useReactTable({
  data,
  columns,
  manualPagination: true,
  manualSorting: true,
  rowCount: totalCount, // from API response
  state: { pagination, sorting },
  onPaginationChange: setPagination,
  onSortingChange: setSorting,
  getCoreRowModel: getCoreRowModel(),
})
```

### Pattern 6: R2 Pre-signed Upload

Never send file bytes through a Vercel function. Generate a pre-signed PUT URL in an API Route, return it to the client, client uploads directly to R2.

```typescript
// API Route: POST /api/uploads/presign
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
})

const url = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: fileKey, ContentType: contentType }),
  { expiresIn: 300 } // 5 minutes
)
```

### Pattern 7: @react-pdf/renderer — API Route Rendering

Always render PDFs server-side inside a Route Handler, never in a Server Component or with PDFDownloadLink on the server.

```typescript
// app/api/invoices/[id]/route.ts
import { renderToBuffer } from "@react-pdf/renderer"
import { InvoiceDocument } from "@/components/pdf/invoice-document"

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const data = await getInvoiceData(params.id)
  const buffer = await renderToBuffer(<InvoiceDocument data={data} />)
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="invoice-${params.id}.pdf"`,
    },
  })
}
```

For `PDFDownloadLink` on the client, always use dynamic import with `ssr: false`:
```typescript
const PDFDownloadLink = dynamic(
  () => import("@react-pdf/renderer").then((m) => m.PDFDownloadLink),
  { ssr: false }
)
```

### Pattern 8: next.config.ts — Required External Packages

Add `@react-pdf/renderer` to `serverExternalPackages` to prevent bundling issues with its internal Node.js dependencies.

```typescript
// next.config.ts
const nextConfig = {
  serverExternalPackages: ["@react-pdf/renderer"],
}
export default nextConfig
```

Note: `@prisma/client` and `@aws-sdk/client-s3` are already automatically opted out by Next.js.

---

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

---

## Environment Variables

```bash
# .env.local

# Neon PostgreSQL — two connections required
DATABASE_URL="postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require"
DIRECT_URL="postgresql://user:pass@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"

# Better Auth
BETTER_AUTH_SECRET="<32+ character random string>"
BETTER_AUTH_URL="http://localhost:3000"  # production: https://yourdomain.com

# Cloudflare R2
CF_ACCOUNT_ID="<cloudflare account id>"
R2_ACCESS_KEY_ID="<r2 access key>"
R2_SECRET_ACCESS_KEY="<r2 secret>"
R2_BUCKET="<bucket name>"
R2_PUBLIC_URL="https://pub-xxx.r2.dev"  # if using public bucket for reads

# App Config
APP_CURRENCY="PHP"  # or MYR, USD etc — configurable per environment
```

---

## Constraints That Affect Stack Usage

| Constraint | Impact | Mitigation |
|------------|--------|------------|
| Vercel Hobby 10s function timeout | PDF generation + complex DB queries must complete in <10s | `@react-pdf/renderer` runs in ~1-3s for typical invoices; keep DB queries indexed; avoid N+1 queries in reports |
| Neon 0.5 GB storage | Cannot store large blobs in Postgres | All images go to R2; Postgres stores only metadata (R2 key, content type, size) |
| Neon free tier: 5-minute scale-to-zero idle timeout | First request after idle may be slow (cold start) | Add `connect_timeout=15` to connection string; show loading states via Suspense boundaries |
| Neon free tier: 100 CU-hours/month | Sustained heavy load would exhaust compute | Single-user internal system; 100 CU-hours is ~400 hours of 0.25 CU — far more than needed |
| R2 10 GB free storage | ~2,000-3,000 vehicles at 5-6 photos each | Enforce image size limits on upload (max 2MB per photo); compress on client before upload |
| `@react-pdf/renderer` client-side issues | `PDFDownloadLink` crashes in SSR | Always use `dynamic(..., { ssr: false })` or render server-side only via API route |

---

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

---

*Stack research for: Vehicle Dealership Management System (VSMS)*
*Researched: 2026-03-21*
