# Roadmap: Vehicle Sale Management System (VSMS)

## Overview

VSMS delivers VA Motors a complete digital operations platform across ten phases. Phases 1-3 build the vehicle and sales core (the central financial story). Phases 4-7 layer in governance, compliance, and reporting. Phases 8-9 add the lease brokerage module — a self-contained second system sharing the same foundation. Phase 10 closes the loop with historical data import so the system can go live with existing records.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Project scaffold, auth, CASL permissions, audit infrastructure, layout shell, dashboard, user management, PWA
- [ ] **Phase 2: Vehicle Lifecycle** - Vehicle purchase (3 channels), 10-state status machine, repairs, suppliers, mileage, additional costs, cost basis
- [ ] **Phase 3: Vehicle Sales** - All four sale types (cash, advance, lease/finance, trade-in), customer management, R2 file upload, advance expiry cron, profit calculation
- [ ] **Phase 4: Approvals, Notifications, and Write-Offs** - Approval gates (discount, write-off, refund, sale edit), in-app notification bell, write-off workflow
- [ ] **Phase 5: Invoice Generation** - PDF invoice for every completed sale using @react-pdf/renderer, cold-start-safe implementation
- [ ] **Phase 6: Audit Trail Viewer** - Read-only field-level audit history UI on all entity pages
- [ ] **Phase 7: Reports and Financial Tracking** - Seven standard reports, cash flow view, CSV and PDF export
- [ ] **Phase 8: Lease Brokerage — Setup and Comparison** - Finance company directory, rate sheets, rate card calculator, side-by-side comparison tool
- [ ] **Phase 9: Lease Brokerage — Deal Flow** - Common deal flow, Application Processing path, Referral path, commission reconciliation
- [ ] **Phase 10: Historical Data Import** - One-time CSV/Excel import for all entity types, validation-first, atomic per batch

## Phase Details

### Phase 1: Foundation
**Goal**: A working, deployable application skeleton that every subsequent phase builds on — with authentication, permission enforcement, audit infrastructure, currency utilities, and a navigable UI shell
**Depends on**: Nothing (first phase)
**Requirements**: FNDN-01, FNDN-02, FNDN-03, FNDN-04, FNDN-05, FNDN-06, FNDN-07, FNDN-08, FNDN-09, USER-01, USER-02, USER-03, USER-04, USER-05, DASH-01, DASH-02, NFNL-01, NFNL-02, NFNL-03, NFNL-04
**Success Criteria** (what must be TRUE):
  1. Staff can log in with credentials, land on a dashboard showing key business metric placeholders, and log out from any page
  2. Administrator can create user accounts, assign roles, and permission changes take immediate effect without redeployment
  3. The app is installable as a PWA on mobile and renders correctly from 360px to 1920px
  4. All API routes reject unauthenticated and unauthorized requests with correct HTTP status codes
  5. The audit log table exists with composite indexes, and the currency utility formats and parses values correctly before any form is live
**Plans**: TBD

Plans:
- [ ] 01-01: Project scaffold, Prisma schema, Neon connection, Better Auth, CASL factory
- [ ] 01-02: Route Handler pipeline, currency utility, status machine, audit Prisma extension
- [ ] 01-03: Responsive layout shell, PWA manifest, navigation, notification bell placeholder
- [ ] 01-04: User management UI (create accounts, assign roles, permission management)
- [ ] 01-05: Dashboard home screen with metric cards and quick action buttons

### Phase 2: Vehicle Lifecycle
**Goal**: Staff can record every vehicle from first purchase through its full repair and cost history, with the status machine enforced at every step and cost basis always accurate
**Depends on**: Phase 1
**Requirements**: VPRC-01, VPRC-02, VPRC-03, VPRC-04, VPRC-05, VPRC-06, VPRC-07, VPRC-08, VPRC-09, SUPL-01, SUPL-02, SUPL-03, REPR-01, REPR-02, REPR-03, REPR-04, REPR-05, VSTS-01, VSTS-02, VSTS-03, VSTS-04, FINT-01, FINT-03
**Success Criteria** (what must be TRUE):
  1. Staff can record a vehicle purchase via cash, lease settlement, or brand-new supplier channel — each with correct cost capture and audit trail
  2. The vehicle detail page shows the full cost breakdown (purchase + repairs + additional costs = cost basis) in real time
  3. Status transitions are enforced: invalid transitions are blocked, and automatic unavailability activates for In Repair, Advance Placed, Finance Pending, and DO Received
  4. Re-purchasing a vehicle links to the existing record by engine+chassis number rather than creating a duplicate
  5. Staff can add a vendor to the repair directory and send a vehicle for repair with the full cost recorded on return
**Plans**: TBD

Plans:
- [ ] 02-01: Supplier directory (individuals and companies with contact persons), inline creation
- [ ] 02-02: Vehicle purchase recording (all 3 channels), vehicle identity matching, listed price
- [ ] 02-03: Vehicle inventory list, vehicle detail page, status badge, mileage history, additional costs
- [ ] 02-04: Repair vendor directory, send-for-repair flow, repair return with cost, repair history view
- [ ] 02-05: Cost basis auto-calculation (FINT-01, FINT-03), status machine enforcement, availability flag

### Phase 3: Vehicle Sales
**Goal**: Staff can record every sale type end-to-end — from first advance through handover — with customers managed inline, DO documents uploaded directly to R2, and advance expiry handled automatically
**Depends on**: Phase 2
**Requirements**: SLGN-01, SLGN-02, SLGN-03, SLCS-01, SLCS-02, SLAD-01, SLAD-02, SLAD-03, SLAD-04, SLAD-05, SLAD-06, SLLS-01, SLLS-02, SLLS-03, SLLS-04, SLLS-05, SLTI-01, SLTI-02, SLTI-03, CUST-01, CUST-02, CUST-03, CUST-04, FINT-02
**Success Criteria** (what must be TRUE):
  1. Staff can record a cash sale, and the vehicle status changes to Sold with mileage added to history
  2. Staff can record an advance, the system calculates the correct validity period per tier rules, and expired advances are flagged automatically by cron
  3. Staff can complete a lease/finance sale end-to-end: down payment recorded, DO document uploaded to R2, sale finalized on DO confirmation
  4. Staff can record a trade-in sale with trade-in value deducted from sale price, and add the traded-in vehicle to inventory
  5. The View Sale screen shows the correct payment breakdown and timeline for each sale type; the View Customer screen shows that customer's full history
**Plans**: TBD

Plans:
- [ ] 03-01: Customer directory, View Customer screen, inline customer creation from sale forms
- [ ] 03-02: Cash sale and View Sale screen foundation (third-party reference number, status timeline)
- [ ] 03-03: Advance/reservation sale, tiered expiry calculation, Vercel cron job for expiry flagging
- [ ] 03-04: Cloudflare R2 setup (CORS, presigned PUT), lease/finance sale with DO upload and finalization
- [ ] 03-05: Trade-in sale, trade-in-to-inventory conversion, gross profit calculation (FINT-02)

### Phase 4: Approvals, Notifications, and Write-Offs
**Goal**: Managers receive and act on approval requests for discounts, refunds, write-offs, and sale edits, and all staff see relevant in-app notifications linked to affected records
**Depends on**: Phase 3
**Requirements**: APRV-01, APRV-02, APRV-03, APRV-04, APRV-05, NOTF-01, NOTF-02, NOTF-03, NOTF-04, WROF-01, WROF-02, WROF-03
**Success Criteria** (what must be TRUE):
  1. Selling below listed price, initiating a write-off, requesting a refund, or editing a completed sale creates an approval request visible in the notification panel
  2. Manager can approve or reject any pending request; the approver identity and timestamp are recorded permanently
  3. The notification bell shows an unread count and each notification links directly to the affected record
  4. Staff can mark notifications as read individually or clear all at once
  5. An approved write-off marks the vehicle as Written Off with disposal proceeds recorded
**Plans**: TBD

Plans:
- [ ] 04-01: ApprovalRequest model, approval creation for all 4 gates, manager approval/reject flow
- [ ] 04-02: Notification panel (bell icon, unread count, linked records, mark read), notification triggers
- [ ] 04-03: Write-off initiation, manager approval, Written Off status, disposal proceeds

### Phase 5: Invoice Generation
**Goal**: Every completed sale has a downloadable PDF invoice formatted for printing, generated without timing out on cold Vercel starts
**Depends on**: Phase 3
**Requirements**: INVC-01, INVC-02, INVC-03
**Success Criteria** (what must be TRUE):
  1. Staff can download a PDF invoice from any completed sale's detail page
  2. The invoice contains seller and buyer information, vehicle details, transaction details, legal declarations, and signature lines
  3. Invoice generation completes within Vercel's 10-second function timeout even after a Neon cold start
**Plans**: TBD

Plans:
- [ ] 05-01: PDF invoice Route Handler with @react-pdf/renderer (nodejs runtime, pre-fetched data, renderToBuffer), download link on View Sale screen

### Phase 6: Audit Trail Viewer
**Goal**: Authorised users can inspect the complete field-level change history of any record, knowing the log is append-only and tamper-proof
**Depends on**: Phase 4
**Requirements**: AUDT-01, AUDT-02, AUDT-03, AUDT-04
**Success Criteria** (what must be TRUE):
  1. Every vehicle, sale, customer, and repair record has an audit history tab showing who changed what, when, and the before/after values
  2. Audit entries are present for every create, update, delete, and status change performed since Phase 1
  3. No UI control exists for modifying or deleting audit entries, including for administrators
**Plans**: TBD

Plans:
- [ ] 06-01: Audit history viewer component, integration on vehicle detail, sale detail, customer detail, and repair detail pages; mandatory reason enforcement on purchase/sale edits

### Phase 7: Reports and Financial Tracking
**Goal**: Management can run any of the seven standard reports with date filtering, view the business cash position, and export results to CSV or PDF
**Depends on**: Phase 4
**Requirements**: REPT-01, REPT-02, REPT-03, REPT-04, REPT-05, REPT-06, REPT-07, REPT-08, FINT-04
**Success Criteria** (what must be TRUE):
  1. Each of the seven reports returns accurate data filtered by the selected date range, status, or other applicable criteria
  2. Every report can be exported to both CSV and PDF without error
  3. The business cash flow view shows money in vs money out with a net position for any selected date range
  4. The profit-per-vehicle report shows the full cost breakdown matching the vehicle detail cost basis
**Plans**: TBD

Plans:
- [ ] 07-01: Report infrastructure (server-side query services, TanStack Table pagination), inventory and repair reports (REPT-01, REPT-05)
- [ ] 07-02: Sales, profit, and advance reports (REPT-02, REPT-03, REPT-04)
- [ ] 07-03: Cash flow and write-off reports (REPT-06, REPT-07, FINT-04), CSV and PDF export (REPT-08)

### Phase 8: Lease Brokerage — Setup and Comparison
**Goal**: Staff can maintain finance company rate sheets and produce an instant side-by-side installment comparison for any vehicle and loan scenario
**Depends on**: Phase 1
**Requirements**: LBRK-01, LBRK-02, LBRK-03, LBRK-04, LBRK-05, LBRK-06
**Success Criteria** (what must be TRUE):
  1. Staff can create and update finance company rate sheets defining maximum loan amounts per vehicle model and year
  2. Staff can enter a vehicle and loan scenario and see a side-by-side comparison of installment amounts and periods across all finance companies
  3. Entering a lease amount auto-calculates the installment or period from the rate card, and vice versa
  4. Staff can select a comparison result and add document fees and government fees to produce a total cost figure to proceed with
**Plans**: TBD

Plans:
- [ ] 08-01: Finance company directory, rate sheet management (max loan amounts per model/year), rate cards (installment by amount and period)
- [ ] 08-02: Lease comparison calculator (auto-calculate installment or period), side-by-side comparison view, proceed with additional charges

### Phase 9: Lease Brokerage — Deal Flow
**Goal**: Staff can manage a lease deal from eligibility confirmation through either the Application Processing or Referral path to commission reconciliation, with every step and document tracked
**Depends on**: Phase 8
**Requirements**: LBRK-07, LBRK-08, LBRK-09, LBRK-10, LBRK-11, LBRK-12, LBRK-13, LBRK-14, LBRK-15, LBRK-16, LBRK-17, LBRK-18, LBRK-19, LBRK-20, LBRK-21, LBRK-22, LBRK-23, LBRK-24, LBRK-26, LBRK-27, LBRK-28, LBRK-29
**Success Criteria** (what must be TRUE):
  1. Staff can open a lease deal, enter customer and guarantor details, record eligibility outcomes, and the deal correctly routes to either Application Processing or Referral path based on the finance company configuration
  2. Application Processing path: vehicle inspection photos uploaded, document checklists completed, loan adjustment recorded, documents dispatched via pre-dispatch checklist
  3. Referral path: deal marked as referred, rejection outcome recordable, non-remittance complaint recordable with finance company feedback
  4. Staff can record cash advance disbursement, processing blockers, and customer delay inquiries against any deal
  5. Commission reconciliation screen shows unreconciled overdue deals after each reconciliation run, for both Application Processing and Referral lease types
**Plans**: TBD

Plans:
- [ ] 09-01: Lease deal model, common flow (customer/guarantor entry, eligibility, cash advance facility, rejected deal, blockers, delay inquiries)
- [ ] 09-02: Application Processing path (vehicle inspection with R2 photo uploads, document checklists, loan adjustment, processing fee, document verification, file number)
- [ ] 09-03: Documents dispatch flow (pre-dispatch checklist, batch courier marking)
- [ ] 09-04: Referral path (referred marking, rejection, non-remittance recording)
- [ ] 09-05: Commission reconciliation (per-finance-company method config, reconcile against remittances, overdue unreconciled surfacing, referral reconciliation)

### Phase 10: Historical Data Import
**Goal**: All historical vehicle, sale, customer, supplier, repair, and advance records from spreadsheets are imported into the live system with full validation and no partial commits
**Depends on**: Phase 9
**Requirements**: IMPT-01, IMPT-02, IMPT-03, IMPT-04, IMPT-05
**Success Criteria** (what must be TRUE):
  1. Staff can upload a CSV or Excel file and receive a per-row validation report before any data is committed
  2. If any row fails validation, the entire batch is rejected — no partial imports
  3. Successfully imported records are visibly marked as imported data throughout the system
  4. Import supports all primary entity types: suppliers, customers, repair vendors, vehicles, sales, repairs, and advances
**Plans**: TBD

Plans:
- [ ] 10-01: Import facility UI, CSV/Excel parsing, per-row validation engine with error report
- [ ] 10-02: Atomic batch commit (chunked createMany, full rollback on any failure), imported-record flag, all entity type support

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

Note: Phase 5 (Invoice) and Phase 6 (Audit Viewer) both depend on Phase 3/4 and can be sequenced flexibly. Phase 8 depends only on Phase 1 and can begin in parallel with Phase 4-7 if desired.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/5 | Not started | - |
| 2. Vehicle Lifecycle | 0/5 | Not started | - |
| 3. Vehicle Sales | 0/5 | Not started | - |
| 4. Approvals, Notifications, Write-Offs | 0/3 | Not started | - |
| 5. Invoice Generation | 0/1 | Not started | - |
| 6. Audit Trail Viewer | 0/1 | Not started | - |
| 7. Reports and Financial Tracking | 0/3 | Not started | - |
| 8. Lease Brokerage — Setup and Comparison | 0/2 | Not started | - |
| 9. Lease Brokerage — Deal Flow | 0/5 | Not started | - |
| 10. Historical Data Import | 0/2 | Not started | - |
