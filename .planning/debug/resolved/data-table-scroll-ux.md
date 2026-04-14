---
status: resolved
trigger: "data-table-scroll-ux — whole page scrolls instead of just the table at intermediate screen sizes"
created: 2026-04-13T00:00:00Z
updated: 2026-04-14T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — SidebarProvider uses `min-h-svh` which allows the wrapper to grow beyond the viewport, so no fixed height bounds the flex children. The app layout `<main className="flex-1 overflow-auto">` never activates scroll because its parent (SidebarInset) can grow unboundedly.
test: Fix by changing `min-h-svh` to `h-svh` in SidebarProvider so the wrapper has a fixed viewport height, bounding child flex elements.
expecting: Once the sidebar wrapper has a fixed height, `overflow-auto` on the inner main activates, keeping the page header fixed and only the main content area scrolling.
next_action: Apply fix to sidebar.tsx and verify layout chain.

## Symptoms

expected: When the viewport is narrow, the data table should scroll horizontally (or have its own scroll container) while action buttons and page header remain visible without scrolling.
actual: The entire page becomes scrollable, making action buttons hidden — user needs to scroll to see them.
errors: No errors — this is a UX/layout issue.
reproduction: Resize the browser window to a smaller width (but not mobile breakpoint). Observe that the page scrolls instead of just the table.
started: Found during manual testing.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-04-13
  checked: components/ui/sidebar.tsx — SidebarProvider wrapper
  found: Uses `min-h-svh` — allows the wrapper div to grow beyond 100vh when content overflows
  implication: Children (SidebarInset) have no fixed height bound, so `flex-1` on children means "grow to content" not "fill bounded space"

- timestamp: 2026-04-13
  checked: app/(app)/layout.tsx
  found: `<main className="flex-1 overflow-auto p-6">{children}</main>` inside SidebarInset
  implication: `overflow-auto` only activates when this element's height is bounded by a fixed-height parent — but SidebarInset (flex-1 of unbounded SidebarProvider) can grow, so overflow never triggers

- timestamp: 2026-04-13
  checked: components/data-table/data-table.tsx
  found: Outer div has `overflow-auto` but no height constraint. Inner table wrapper has `overflow-hidden` which prevents the table-container (which has `overflow-x-auto`) from scrolling horizontally.
  implication: Two compounding issues: (1) page-level scroll not bounded, (2) inner table wrapper clips overflow

- timestamp: 2026-04-13
  checked: components/ui/table.tsx
  found: Table component wraps `<table>` in `<div className="relative w-full overflow-x-auto">` — correct horizontal scroll setup
  implication: The horizontal scroll is in place but neutralized by the parent `overflow-hidden` div in DataTable

## Resolution

root_cause: SidebarProvider wrapper uses `min-h-svh` instead of `h-svh`, so it grows beyond viewport height with content. This means no ancestor of the app layout's `<main overflow-auto>` has a fixed height, so overflow-auto never activates — the browser's document scroll is used instead. Additionally, DataTable wraps the Table in `overflow-hidden`, preventing the Table's own `overflow-x-auto` from working for horizontal scroll.
fix: (1) Change `min-h-svh` to `h-svh` in SidebarProvider so the layout is viewport-bounded. (2) Change `overflow-hidden` to `overflow-x-auto` in the DataTable table wrapper div so horizontal scroll works at that level.
verification: Confirmed by user — page no longer scrolls as a whole; table area scrolls correctly and page header and action buttons remain visible.
files_changed: [components/ui/sidebar.tsx, components/data-table/data-table.tsx]
