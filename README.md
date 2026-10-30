# VSMS — VA Motors Vehicle Sale Management System

## Current bounded LOCAL implementation

Primary remains accepted **55564b5d25983c8de44980362a4c30d6e0e15cc1**, bounded T05c.1/P3 closed; human G2 http://127.0.0.1:8000/login stays d0. Parent dispatched settlement review **RUNNING on exact52c720d0831a712b98c1b54ed008faec27acb27c/tree24715fe03ac304ddf10953ff56981c22907628c5**, not this docs descendant; no verdict/acceptance, VPRC-02 U/C+1 closure pending. Parent also dispatched **[T07a/T08a WRITE_OFF](.planning/implementation/T07a-T08a-next-slice.md)** sole new writer from accepted555, unique202610310001_approval_disposal and mandatory eventual accepted-settlement rebase/new proof; [repairs/remaining approvals](.planning/implementation/T08-next-slice.md) queued/not dispatched. [Imported full scope/citations](.planning/implementation/evidence/T07a-T08a-prepared-brief-index.md), [current HANDOFF](.planning/implementation/HANDOFF.md). All runtime/schema/16 SQL/contracts/tests/packages/native/PWA/matrix bytes exact52c;26 LOCAL108 U134/VSTS-03 U/G3–G6 limits unchanged. No integration runtime/source edit/primaryFF.

## Historical frontend-shell walkthrough

The demo instructions below describe the original in-memory mock shell, **not** the current authenticated local runtime/run handoff or complete v1 acceptance. Current bounded runtime commands and limits are documented in the [T05c operations record](docs/operations/T05c-cycle-costs.md); no service was started by this documentation update.

## Prerequisites

- Node.js >= 20.9.0
- pnpm >= 9.x

## Quick Start

1. Clone the repository
2. `pnpm install`
3. Copy `.env.local.example` to `.env.local` (or use defaults — the app works without it)
4. `pnpm dev`
5. Open http://localhost:3000
6. Sign in with any email/password

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| MOCK_LATENCY_MS_MIN | 200 | Minimum API response delay (ms) |
| MOCK_LATENCY_MS_MAX | 600 | Maximum API response delay (ms) |

Set both to 0 for instant responses during demo.

## Demo Walkthrough

### Getting Started
1. Visit `/login` — enter any credentials and click "Sign In"
2. You land on the Dashboard with KPI cards, chart, and activity feed
3. Use the sidebar to navigate between sections

### Key Screens
- **Dashboard** — KPI cards, sales chart, quick actions
- **Vehicles** — Full inventory with sorting/filtering, click any row for detail view
- **Purchases** — 3-tab form (Cash, Lease Settlement, Brand-New)
- **Sales** — List + detail with timeline and payment breakdown
- **Lease Deals** — Complex detail with checklists and photo management
- **Reports** — 7 report types accessible from the Reports hub
- **Settings** — Company profile, currency config, advance tiers

### Navigation Features
- **Cmd+K / Ctrl+K** — Quick navigation palette
- **Theme toggle** — Switch between light/dark/system
- **Notification bell** — Mock notifications with mark-as-read
- **Sidebar collapse** — Click hamburger on mobile

## Mock Data

All data is served through Next.js Route Handlers under `/api/*`. Data lives in `lib/mock-data/` as hand-authored TypeScript fixtures.

The in-memory store resets on every dev server restart — this is intentional. Each demo run starts fresh.

### Fixture Scale
- ~150 vehicles across all 10 statuses
- ~80 customers
- ~100 sales (cash, advance, lease, trade-in)
- ~40 repairs
- ~30 approval requests
- ~20 lease deals
- ~30 third parties (suppliers, garages, finance companies)

## Tech Stack

- Next.js 15 (App Router)
- React 19
- Tailwind CSS v4
- shadcn/ui
- TanStack Query v5 + Table v8 + Form v1
- nuqs (URL state)
- sonner (toasts)
