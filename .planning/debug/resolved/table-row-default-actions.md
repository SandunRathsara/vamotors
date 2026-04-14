---
status: resolved
trigger: "Every table in the application must perform a default action when a row is clicked. Currently tables don't have row click handlers."
created: 2026-04-13T00:00:00Z
updated: 2026-04-14T00:00:00Z
---

## Current Focus

hypothesis: RESOLVED - all 10 tables now have row click handlers
test: TypeScript check passed (tsc --noEmit, zero errors)
expecting: User verification that clicking rows triggers the correct actions
next_action: Awaiting human verification

## Symptoms

expected: Clicking a table row should trigger a default action specific to that table:
1. Vehicles Table - View the vehicle (navigate to vehicle detail)
2. Purchases Table - View the Purchase
3. Sales Table - View the Sale
4. Repairs Table - View the Repair
5. Customers Table - No Action
6. Third Parties Table - View the Third party
7. Approvals Table - Pop up a modal with approve or reject form
8. Reconciliation Table - Reconcile
9. Lease Deals Table - View Deal
10. Dispatch Table - Mark as Dispatched

actual: Table rows don't have click handlers / default actions on row click.
errors: No errors — this is a missing feature/behavior.
reproduction: Click any row in any data table — nothing happens (or only column-specific actions work).
started: Found during manual testing.

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-04-13T00:05:00Z
  checked: components/data-table/data-table.tsx
  found: DataTableProps has no onRowClick prop; TableRow renders with only key + data-state props
  implication: Need to add onRowClick to DataTableProps and wire it to TableRow onClick

- timestamp: 2026-04-13T00:05:00Z
  checked: components/shared/data-table-shell.tsx
  found: DataTableShellProps has no onRowClick prop; wraps DataTable without any row click logic
  implication: Need to add onRowClick to DataTableShellProps and pass it through to DataTable

- timestamp: 2026-04-13T00:05:00Z
  checked: All 10 table components and their columns
  found: |
    1. Vehicles - uses DataTableShell; Detail page exists at /vehicles/[id]; row.original.id available
    2. Purchases - uses DataTableShell; NO separate /purchases/[id] page; links to /vehicles/[id] (purchases are vehicle records)
    3. Sales - uses DataTableShell; Detail page at /sales/[id]; row.original.id available
    4. Repairs - uses DataTableShell; NO /repairs/[id] page; links to /vehicles/[vehicleId] (repair belongs to vehicle)
    5. Customers - uses DataTableShell; Detail page at /customers/[id]; customer table says "No Action" per requirements
    6. Third Parties - uses DataTableShell; Detail page at /third-parties/[id]; row.original.id available
    7. Approvals - uses DataTableShell; needs modal (ApprovalActionDialog) - onAction callback already handled via columns
    8. Reconciliation - uses DataTableShell; needs sheet (ReconciliationTable manages its own state via handleReconcile)
    9. Lease Deals - uses DataTableShell; Detail page at /lease-deals/[id]; row.original.id available
    10. Dispatch - uses raw <Table> NOT DataTableShell; already has "Mark Dispatched" button per row
  implication: Each table needs different handling; Dispatch table is a special case

- timestamp: 2026-04-13T00:05:00Z
  checked: Purchases and Repairs routing
  found: /app/(app)/purchases has no [id] subdir; /app/(app)/repairs has no [id] subdir
  implication: "View the Purchase" = navigate to /vehicles/[id] (vehicle IS the purchase record); "View the Repair" = navigate to /vehicles/[vehicleId]

- timestamp: 2026-04-13T00:05:00Z
  checked: Approvals table - onAction callback mechanism
  found: ApprovalsTable already has onAction prop passed from the page; action buttons in columns already call onAction; handleAction in page ignores "view" action
  implication: Row click for Approvals should call onAction({approval, action:"approve"}) for Pending OR trigger "view" for non-Pending - simplest: row click opens the action dialog (treat as "view"/"approve")

- timestamp: 2026-04-13T00:05:00Z
  checked: ReconciliationTable - handleReconcile mechanism
  found: ReconciliationTable manages its own Sheet state; buildColumns takes onReconcile callback; "Reconcile" button in actions column calls onReconcile(row.original)
  implication: Row click should call handleReconcile(row.original) - only if status !== "Reconciled"

- timestamp: 2026-04-13T00:05:00Z
  checked: DispatchTables component
  found: Uses raw <Table> (not DataTableShell); already has "Mark Dispatched" button in pending table rows; dispatched table has no action column
  implication: Add onClick to TableRow in pending table; dispatched rows have no action so no row click needed

## Resolution

root_cause: DataTable and DataTableShell had no onRowClick prop or onClick handler on TableRow elements. Each table consumer also had no mechanism to trigger row-level actions.

fix: |
  1. Added onRowClick?: (row: TData) => void to DataTableProps in data-table.tsx
  2. Wired TableRow onClick in data-table.tsx — skips clicks on buttons/links/inputs via closest() guard; adds cursor-pointer class when handler present
  3. Added onRowClick to DataTableShellProps and passed it through to DataTable
  4. Wired each of 9 applicable tables:
     - VehiclesTable: router.push('/vehicles/{id}')
     - PurchasesTable: router.push('/vehicles/{id}') — purchases are vehicle records, no /purchases/[id] route
     - SalesTable: router.push('/sales/{id}')
     - RepairsTable: router.push('/vehicles/{vehicleId}') — no /repairs/[id] route
     - ThirdPartiesTable: router.push('/third-parties/{id}')
     - ApprovalsTable: onAction({approval, action:'approve'}) for Pending rows; 'view' (no-op) for others
     - ReconciliationTable: handleReconcile(item) for non-Reconciled rows; no-op for Reconciled
     - LeaseDealsTable: router.push('/lease-deals/{id}')
     - DispatchTables (pending rows): TableRow onClick opens Mark Dispatched sheet — same guard for buttons
  5. CustomersTable: no onRowClick added per requirements ("No Action")

verification: tsc --noEmit passes with zero errors; user confirmed all applicable tables trigger correct row click actions in production workflow
files_changed:
  - components/data-table/data-table.tsx
  - components/shared/data-table-shell.tsx
  - components/vehicles/vehicles-table.tsx
  - components/purchases/purchases-table.tsx
  - components/sales/sales-table.tsx
  - components/repairs/repairs-table.tsx
  - components/third-parties/third-parties-table.tsx
  - components/approvals/approvals-table.tsx
  - components/lease/reconciliation-table.tsx
  - components/lease/lease-deals-table.tsx
  - components/lease/dispatch-tables.tsx
