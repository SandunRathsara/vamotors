---
type: quick
description: "Restructure purchases page to list all purchases in a data table with a Record Purchase button that opens the existing purchase form in a Sheet"
files_modified:
  - app/api/purchases/route.ts
  - app/(app)/purchases/page.tsx
  - components/purchases/purchases-table.tsx
  - components/purchases/purchases-columns.tsx
  - components/purchases/record-purchase-sheet.tsx
---

<objective>
Restructure the purchases page from a form-only view into a data table listing all purchases, matching the established pattern from sales and repairs pages. Add a "+ Record Purchase" button in the PageHeader that opens the existing tabbed purchase form inside a Sheet (side panel) — because the form has 3 tabs with substantial content that would be too cramped in a Dialog.

Purpose: Consistency across all entity pages (sales, repairs, purchases) and ability to view/search/filter all purchase records.
Output: Purchases page with DataTableShell, pagination, search, filtering, and a Sheet-based "Record Purchase" action.
</objective>

<execution_context>
@/Users/alpha/Developer/personal/va/.claude/get-shit-done/workflows/execute-plan.md
</execution_context>

<context>
@app/(app)/sales/page.tsx (reference pattern for page structure)
@components/sales/sales-table.tsx (reference pattern for table with nuqs + useEntityQuery)
@components/sales/sales-columns.tsx (reference pattern for column definitions)
@components/sales/record-sale-dialog.tsx (reference pattern for create dialog — we use Sheet instead)
@app/api/sales/route.ts (reference pattern for paginated GET endpoint)
@app/api/purchases/route.ts (current purchases API — needs pagination)
@app/(app)/purchases/page.tsx (current page — form only, needs restructure)
@components/purchases/purchase-form.tsx (existing tabbed form to wrap in Sheet)
@components/shared/data-table-shell.tsx (shared DataTableShell component)
@hooks/use-entity-query.ts (shared query hook)
@hooks/use-entity-mutation.ts (shared mutation hook)
@lib/mock-store.ts (MockStore with query method for pagination)
@lib/mock-data/schemas.ts (Vehicle type, PaginatedResponse)
@components/ui/sheet.tsx (Sheet component — use for the purchase form)

<interfaces>
<!-- Key types and contracts the executor needs -->

From lib/mock-data/schemas.ts:
```typescript
export type Vehicle = {
  id: string; make: string; model: string; year: number; colour: string;
  engineNumber: string; chassisNumber: string; vin?: string; crNumber?: string;
  fuelType: "Petrol" | "Diesel" | "Hybrid" | "Electric";
  transmission: "Manual" | "Automatic";
  status: "Purchased" | "InStock" | "InRepair" | "AdvancePlaced" | "AdvanceExpired" | "FinancePending" | "DOReceived" | "Delivered" | "Sold" | "WrittenOff";
  isAvailableForSale: boolean; purchasePrice: number; listedPrice: number; costBasis: number;
  purchaseDate: string; purchaseType: "Cash" | "LeaseSettlement" | "BrandNew";
  supplierId: string; /* ... */ createdAt: string; updatedAt: string;
}
export type PaginatedResponse<T> = { data: T[]; total: number; page: number; pageSize: number; }
```

From lib/mock-store.ts:
```typescript
export const vehiclesStore = new MockStore<Vehicle>(vehicleFixtures)
// vehiclesStore.query({ page, pageSize, sortBy, sortDir, q, filters }) => PaginatedResponse<Vehicle>
```

From hooks/use-entity-query.ts:
```typescript
export function useEntityQuery<T>(entityKey: string, endpoint: string, params: Record<string, string | number | undefined | null>): UseQueryResult<T>
```

From hooks/use-entity-mutation.ts:
```typescript
export function useEntityMutation(opts: { entityKey: string; endpoint: string; method: string; successMessage: string }): UseMutationResult
```

From components/ui/sheet.tsx:
```typescript
export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription }
// SheetContent accepts side?: "top" | "right" | "bottom" | "left" and className for overrides
// Default max-width is sm:max-w-sm — MUST override to sm:max-w-2xl for purchase form
```

From lib/mock-data/third-parties.ts:
```typescript
// thirdPartiesFixtures contains suppliers with id "tp-001", "tp-002", etc.
// Vehicles reference suppliers via supplierId field
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update purchases API GET to support pagination, search, and filtering</name>
  <files>app/api/purchases/route.ts</files>
  <action>
Rewrite the GET handler in `app/api/purchases/route.ts` to match the pattern in `app/api/sales/route.ts`:

1. Accept `NextRequest` parameter (currently GET takes no params).
2. Parse URL search params: `page` (default 1), `pageSize` (default 20), `sortBy`, `sortDir` (default "desc"), `q`, `purchaseType`, `status`.
3. Use `vehiclesStore.query()` with the parsed params instead of `vehiclesStore.getAll()`. Pass `purchaseType` and `status` as `filters` record.
4. The `sortBy` default should sort by `purchaseDate` descending when no sortBy is specified — achieve this by defaulting sortBy to "purchaseDate" and sortDir to "desc".
5. Return the paginated response: `{ data, total, page, pageSize }`.

Keep the existing POST handler unchanged.

Important: The vehicles store contains ALL vehicles (InStock, Sold, InRepair, etc.), not just purchases. Since every vehicle was purchased, the table should show all vehicles as purchase records — this is correct behavior. The `q` search will search across all string fields of Vehicle, and `purchaseType` and `status` filters allow narrowing down.
  </action>
  <verify>
    <automated>curl -s "http://localhost:3000/api/purchases?page=1&pageSize=5" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('page:', d.page, 'pageSize:', d.pageSize, 'total:', d.total, 'dataLen:', d.data.length); process.exit(d.page===1 && d.pageSize===5 && d.total>0 && d.data.length<=5 ? 0 : 1)"</automated>
  </verify>
  <done>GET /api/purchases returns paginated response with page, pageSize, total, and data array. Supports q, purchaseType, status, sortBy, sortDir query params.</done>
</task>

<task type="auto">
  <name>Task 2: Create purchases table, columns, and record-purchase Sheet; restructure page</name>
  <files>
    components/purchases/purchases-columns.tsx
    components/purchases/purchases-table.tsx
    components/purchases/record-purchase-sheet.tsx
    app/(app)/purchases/page.tsx
  </files>
  <action>
**Create `components/purchases/purchases-columns.tsx`** — follow `components/sales/sales-columns.tsx` pattern:

Define `purchasesColumns: ColumnDef<Vehicle>[]` with these columns:
1. `index` — row number (#), no sorting, size 48
2. `purchaseDate` — formatted with `format(new Date(row.original.purchaseDate), "dd MMM yyyy")`, enable sorting
3. `vehicle` — display `{make} {model} {year}` as a Link to `/vehicles/{id}`, enable sorting, accessorFn concatenates make+model
4. `purchaseType` — Badge display. Use label map: `{ Cash: "Cash", LeaseSettlement: "Lease Settlement", BrandNew: "Brand-New" }`. Use variant map: `{ Cash: "default", LeaseSettlement: "secondary", BrandNew: "outline" }`. No sorting.
5. `purchasePrice` — use `<CurrencyDisplay amount={row.original.purchasePrice} />`, enable sorting
6. `costBasis` — use `<CurrencyDisplay amount={row.original.costBasis} />`, enable sorting
7. `status` — use `<StatusBadge status={row.original.status} />`, no sorting
8. `actions` — DropdownMenu with "View" linking to `/vehicles/{id}`, size 48

Import from: `@tanstack/react-table` (ColumnDef), `date-fns` (format), `next/link` (Link), `lucide-react` (MoreHorizontal), `@/lib/mock-data/schemas` (Vehicle), `@/components/shared/status-badge`, `@/components/shared/currency-display`, `@/components/ui/badge`, `@/components/ui/button`, `@/components/ui/dropdown-menu`.

**Create `components/purchases/purchases-table.tsx`** — follow `components/sales/sales-table.tsx` pattern:

1. "use client" directive
2. Use `useQueryStates` from nuqs with: `page` (parseAsInteger default 1), `pageSize` (parseAsInteger default 20), `q` (parseAsString default ""), `purchaseType` (parseAsString default ""), `status` (parseAsString default ""), `sortBy` (parseAsString default ""), `sortDir` (parseAsString default "desc")
3. Use `useEntityQuery<PaginatedResponse<Vehicle>>("purchases", "/api/purchases", { page, pageSize, q, purchaseType, status, sortBy, sortDir })` — map empty strings to undefined
4. Compute `vehicles`, `total`, `pageCount`, `isFiltered`
5. `handleClearFilters` resets q, purchaseType, status, page to defaults
6. Loading state: if isLoading and no data, show "Loading purchases..." centered placeholder
7. Return `<DataTableShell columns={purchasesColumns} data={vehicles} pageCount={pageCount} searchPlaceholder="Search purchases..." emptyState={{ heading: "No purchases recorded", body: "Record a purchase to add vehicles to inventory." }} isFiltered={isFiltered} onClearFilters={handleClearFilters} />`

**Create `components/purchases/record-purchase-sheet.tsx`**:

1. "use client" directive
2. Accept props: `{ open: boolean; onOpenChange: (open: boolean) => void }`
3. Import Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription from `@/components/ui/sheet`
4. Import PurchaseForm from `./purchase-form`
5. Render:
```tsx
<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" className="sm:max-w-2xl w-full overflow-y-auto">
    <SheetHeader>
      <SheetTitle>Record Purchase</SheetTitle>
      <SheetDescription>Add a new vehicle purchase to inventory</SheetDescription>
    </SheetHeader>
    <div className="px-4 pb-4">
      <PurchaseForm />
    </div>
  </SheetContent>
</Sheet>
```
The key override is `className="sm:max-w-2xl w-full overflow-y-auto"` on SheetContent to make it wide enough for the tabbed form (the default sm:max-w-sm is too narrow). `overflow-y-auto` ensures the long form is scrollable within the sheet.

**Update `app/(app)/purchases/page.tsx`** — match `app/(app)/sales/page.tsx` pattern:

1. Add "use client" directive at top
2. Import React, PageHeader, Button, PurchasesTable, RecordPurchaseSheet
3. Add `const [sheetOpen, setSheetOpen] = React.useState(false)` state
4. Render:
```tsx
<div className="space-y-6">
  <PageHeader
    title="Purchases"
    description="Track all vehicle purchases"
    actions={
      <Button onClick={() => setSheetOpen(true)}>Record Purchase</Button>
    }
  />
  <PurchasesTable />
  <RecordPurchaseSheet open={sheetOpen} onOpenChange={setSheetOpen} />
</div>
```
  </action>
  <verify>
    <automated>cd /Users/alpha/Developer/personal/va && npx tsc --noEmit --pretty 2>&1 | head -30</automated>
  </verify>
  <done>Purchases page shows a data table listing all purchases with pagination. The PageHeader has a "Record Purchase" button that opens the existing tabbed form in a Sheet side panel. Columns show purchase date, vehicle, purchase type, purchase price, cost basis, status, and actions. The table supports search and filtering via URL params.</done>
</task>

</tasks>

<verification>
1. Navigate to /purchases — should see a data table with all vehicle purchase records
2. Table shows columns: #, Purchase Date, Vehicle, Purchase Type, Purchase Price, Cost Basis, Status, Actions
3. Clicking "Record Purchase" opens a Sheet from the right with the existing 3-tab purchase form
4. The Sheet is wide enough (max-w-2xl) to comfortably display the form with its Cards and grid layouts
5. The form inside the Sheet is scrollable for long content
6. Table pagination works (page through records)
7. Search filters across vehicle fields
8. TypeScript compiles without errors
</verification>

<success_criteria>
- Purchases page displays all vehicle records in a DataTableShell with pagination
- "+ Record Purchase" button opens existing PurchaseForm in a right-side Sheet
- Sheet width is sm:max-w-2xl (not default sm:max-w-sm) to accommodate the tabbed form
- API GET /api/purchases supports page, pageSize, q, purchaseType, status, sortBy, sortDir params
- Pattern matches sales/repairs page structure: "use client" page, PageHeader with actions, Table, Sheet/Dialog
- No TypeScript errors
</success_criteria>
