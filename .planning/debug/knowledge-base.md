# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## table-row-default-actions — DataTable and DataTableShell missing onRowClick prop; TableRow had no onClick handler
- **Date:** 2026-04-14
- **Error patterns:** table, row click, onRowClick, click handler, default action, DataTable, DataTableShell, TableRow, navigate, router.push
- **Root cause:** DataTable and DataTableShell had no onRowClick prop or onClick handler on TableRow elements. Each table consumer also had no mechanism to trigger row-level actions.
- **Fix:** Added onRowClick?: (row: TData) => void to DataTableProps; wired TableRow onClick with a button/link/input guard and cursor-pointer class; added onRowClick to DataTableShellProps and passed it through; wired 9 applicable tables with their correct actions (navigation, modal trigger, or sheet open). CustomersTable intentionally left without onRowClick per requirements.
- **Files changed:** components/data-table/data-table.tsx, components/shared/data-table-shell.tsx, components/vehicles/vehicles-table.tsx, components/purchases/purchases-table.tsx, components/sales/sales-table.tsx, components/repairs/repairs-table.tsx, components/third-parties/third-parties-table.tsx, components/approvals/approvals-table.tsx, components/lease/reconciliation-table.tsx, components/lease/lease-deals-table.tsx, components/lease/dispatch-tables.tsx
---

## data-table-scroll-ux — whole page scrolls instead of table at narrow viewports
- **Date:** 2026-04-14
- **Error patterns:** page scroll, whole page scrolls, action buttons hidden, overflow-auto not activating, table scroll, horizontal scroll, min-h-svh, overflow-hidden, viewport height, SidebarProvider
- **Root cause:** SidebarProvider uses `min-h-svh` instead of `h-svh`, so the wrapper grows beyond viewport height with content. No ancestor of the app layout's `<main overflow-auto>` has a fixed height, so overflow-auto never activates and the browser's document scroll is used instead. DataTable also wraps the Table in `overflow-hidden`, preventing the Table's own `overflow-x-auto` from working for horizontal scroll.
- **Fix:** (1) Change `min-h-svh` to `h-svh` in SidebarProvider so the layout is viewport-bounded. (2) Change `overflow-hidden` to `overflow-x-auto` in the DataTable table wrapper div so horizontal scroll works at that level.
- **Files changed:** components/ui/sidebar.tsx, components/data-table/data-table.tsx
---

