# VSMS — VA Motors Vehicle Sale Management System

## Current bounded LOCAL implementation

[Current HANDOFF](.planning/implementation/HANDOFF.md) owns current dispatch and ownership. **[236 remains the exact final settlement REVIEW target](.planning/implementation/evidence/T05c2-fc-ui-eaa567f-review-assembly.md)**, not this records descendant or acceptance; no new results/closure/ID promotion inferred. Source/tests/schema/operations/matrix/scopes/gates/history exact236; primary555/humanG2d0/26 LOCAL108 U134/G3–G6 pending unchanged. No integration runtime/primary FF.

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
