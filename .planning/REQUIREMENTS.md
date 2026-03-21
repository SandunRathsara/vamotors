# Requirements: Vehicle Sale Management System (VSMS)

**Defined:** 2026-03-21
**Core Value:** Every vehicle's complete financial story -- purchase cost, repairs, additional costs, sale price, and profit -- must be accurate, traceable, and instantly available.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FNDN-01**: Project bootstrapped with Next.js 15+ App Router, TypeScript, pnpm, Tailwind v4, shadcn/ui
- [ ] **FNDN-02**: Prisma ORM configured with Neon PostgreSQL (pooled + direct connection strings)
- [ ] **FNDN-03**: Better Auth configured with credentials provider and session management
- [ ] **FNDN-04**: CASL authorization framework integrated with session-cached permissions and version-based invalidation
- [ ] **FNDN-05**: Currency utility (integer storage, formatCurrency/parseCurrencyInput) available before first form
- [ ] **FNDN-06**: Vehicle status machine implemented as pure function with DB check constraints
- [ ] **FNDN-07**: Audit trail infrastructure (Prisma extension for auto-logging, AuditLog table with composite indexes)
- [ ] **FNDN-08**: Base API Route Handler pipeline (authenticate -> authorize -> validate -> service -> audit -> respond)
- [ ] **FNDN-09**: Responsive layout shell with navigation, notification bell placeholder, PWA manifest

### Vehicle Purchase

- [ ] **VPRC-01**: Staff can record a cash purchase with all vehicle details, supplier, purchase amount, and date
- [ ] **VPRC-02**: Staff can record a lease settlement purchase with institution details, settlement reference, settlement amount, and cash-to-seller
- [ ] **VPRC-03**: Staff can record a brand-new vehicle purchase from a company supplier without requiring VIN or CR number
- [ ] **VPRC-04**: All vehicle fields captured: make, model, year, colour, engine number, chassis number, VIN (optional), CR number (optional), fuel type, transmission
- [ ] **VPRC-05**: Mileage history maintained with date, reading, and optional remark for each entry
- [ ] **VPRC-06**: Listed price (asking price) editable independently of cost basis, changes captured in audit trail
- [ ] **VPRC-07**: Additional costs (transport, inspection, taxes) tracked per vehicle with description, amount, and date
- [ ] **VPRC-08**: Vehicle identity matched by engine+chassis number -- re-purchased vehicles link to existing record, not duplicated
- [ ] **VPRC-09**: Purchase records editable with mandatory reason recorded in audit trail

### Supplier Management

- [ ] **SUPL-01**: Supplier directory supporting both individual sellers and company suppliers
- [ ] **SUPL-02**: Company suppliers support multiple contact persons with name, phone, email, and role
- [ ] **SUPL-03**: Staff can search and select existing suppliers during purchase, or create new inline

### Vehicle Repair

- [ ] **REPR-01**: Staff can send a vehicle for repair by selecting a vendor, entering a repair request describing what needs repair and why, and recording date sent
- [ ] **REPR-02**: Staff can record repair return with actual invoice amount, invoice date, return date, and repair summary of what was done
- [ ] **REPR-03**: Repair costs automatically included in vehicle's total cost basis
- [ ] **REPR-04**: Full repair history per vehicle showing all past repairs chronologically
- [ ] **REPR-05**: Repair vendor directory with contact details maintained by authorised staff

### Vehicle Status

- [ ] **VSTS-01**: Every vehicle displays current status from 10-state lifecycle (Purchased, In Stock, In Repair, Advance Placed, Advance Expired, Finance Pending, DO Received, Delivered, Sold, Written Off)
- [ ] **VSTS-02**: Status transitions enforced per valid transition map -- invalid transitions blocked
- [ ] **VSTS-03**: Separate availability flag (isAvailableForSale) with mandatory reason when marking unavailable
- [ ] **VSTS-04**: Automatic unavailability enforced for In Repair, Advance Placed, Finance Pending, DO Received statuses

### Vehicle Sale -- General

- [ ] **SLGN-01**: Every sale record supports an optional third-party reference number (e.g., finance company file number)
- [ ] **SLGN-02**: View Sale screen shows full sale details based on sale type (cash, advance, lease, trade-in) including payment breakdown, status timeline, and linked records
- [ ] **SLGN-03**: After recording an advance or down payment, the UI provides clear next steps to complete the sale process

### Vehicle Sale -- Cash Immediate

- [ ] **SLCS-01**: Staff can record immediate cash sale with customer, sale price, payment method (cash/bank transfer), date, and mileage at handover
- [ ] **SLCS-02**: Vehicle status changes to Sold upon saving, mileage added to history

### Vehicle Sale -- Advance/Reservation

- [ ] **SLAD-01**: Staff can record advance payment with amount, agreed sale price, and payment method
- [ ] **SLAD-02**: System calculates advance percentage and validity period per tiered rules (0-5%=1wk, 5-10%=2wk, 10-15%=3wk, 15%+=1mo max)
- [ ] **SLAD-03**: Vehicle status changes to Advance Placed, marked unavailable
- [ ] **SLAD-04**: System automatically flags expired advances and changes status to Advance Expired
- [ ] **SLAD-05**: Staff can resolve expired advances: convert to sale, cancel with refund (requires approval), or cancel without refund
- [ ] **SLAD-06**: Advance expiry cron job runs reliably with idempotent per-record processing

### Vehicle Sale -- Lease/Finance

- [ ] **SLLS-01**: Staff can initiate lease sale with customer, agreed sale price, down payment, finance company name, and finance amount
- [ ] **SLLS-02**: Down payment is mandatory for all lease sales
- [ ] **SLLS-03**: Staff can record DO receipt with uploaded document and DO issue date
- [ ] **SLLS-04**: DO document upload via presigned URL to Cloudflare R2
- [ ] **SLLS-05**: Sale finalized and vehicle handed over simultaneously upon DO confirmation

### Vehicle Sale -- Trade-In

- [ ] **SLTI-01**: Staff can record a sale where customer's existing vehicle is accepted as part-payment
- [ ] **SLTI-02**: Trade-in value recorded, cash balance calculated (sale price minus trade-in value)
- [ ] **SLTI-03**: Traded-in vehicle can be added to inventory as a new purchase record

### Customer Management

- [ ] **CUST-01**: Customer directory with full name, calling name, NIC/passport, address, phone (required); email and driving licence (optional)
- [ ] **CUST-02**: Customers searchable by name, NIC/passport, or phone number
- [ ] **CUST-03**: New customer creation possible without leaving sale entry flow
- [ ] **CUST-04**: View Customer screen showing customer details, purchase history, sale history, and linked records

### Invoice

- [ ] **INVC-01**: PDF invoice generated for every completed sale using @react-pdf/renderer
- [ ] **INVC-02**: Invoice contains seller/buyer info, vehicle details, transaction details, legal declarations, signature lines
- [ ] **INVC-03**: Invoice formatted for standard paper sizes and suitable for printing

### User Management

- [ ] **USER-01**: Administrator can create user accounts with credentials and assign one or more roles
- [ ] **USER-02**: Roles define permissions; users with multiple roles inherit combined permissions
- [ ] **USER-03**: Roles and permissions configurable at runtime without code changes (CASL-based)
- [ ] **USER-04**: Built-in Administrator role cannot be deleted; last active admin cannot be deactivated
- [ ] **USER-05**: Permission changes take immediate effect for all users holding the affected role

### Approval Workflows

- [ ] **APRV-01**: Selling below listed price (discount) requires manager approval with stated reason
- [ ] **APRV-02**: Vehicle write-off requires manager approval
- [ ] **APRV-03**: Advance refund requires manager approval with refund amount recorded
- [ ] **APRV-04**: Editing a completed sale record requires manager approval
- [ ] **APRV-05**: Approval requests show in notification panel; approver and timestamp recorded

### Write-Off and Disposal

- [ ] **WROF-01**: Authorised staff can initiate write-off request with mandatory reason
- [ ] **WROF-02**: Manager approves or rejects; approved vehicles marked Written Off
- [ ] **WROF-03**: Disposal proceeds recorded (may be zero)

### Audit Trail

- [ ] **AUDT-01**: Every create, update, delete, and status change logged with user, timestamp, and field-level before/after values
- [ ] **AUDT-02**: Editing purchase or sale records requires mandatory reason recorded in audit
- [ ] **AUDT-03**: Audit log is append-only -- no user including admin can modify or delete entries
- [ ] **AUDT-04**: Authorised users can view audit history of any record

### Notifications

- [ ] **NOTF-01**: In-app notification panel with bell icon showing unread count
- [ ] **NOTF-02**: Notifications link directly to relevant records (vehicle, sale, customer, etc.)
- [ ] **NOTF-03**: Notifications generated for: advance approaching expiry, advance expired, vehicle returned from repair, approval required, approval outcome
- [ ] **NOTF-04**: Notifications markable as read individually or all at once

### Reports

- [ ] **REPT-01**: Current Vehicle Inventory report (status, availability, cost basis, listed price; filterable by status/availability/make/model)
- [ ] **REPT-02**: Vehicles Sold per Period report (sale price, cost basis, profit per vehicle; filterable by date range/sale type)
- [ ] **REPT-03**: Profit per Vehicle report (detailed cost breakdown; filterable by date range/make/model/status)
- [ ] **REPT-04**: Outstanding Advance Payments report (active and expired advances; filterable by status/date range)
- [ ] **REPT-05**: Vehicles Currently in Repair report (vendor, date sent, days in repair; filterable by vendor/date)
- [ ] **REPT-06**: Cash Flow Summary report (money in vs out, net position; filterable by date range)
- [ ] **REPT-07**: Write-Off and Disposal report (reason, approver, costs, proceeds; filterable by date range)
- [ ] **REPT-08**: All reports exportable to CSV and PDF formats

### Financial Tracking

- [ ] **FINT-01**: Vehicle cost basis auto-calculated: purchase price + repair costs + additional costs
- [ ] **FINT-02**: Gross profit/loss calculated for every sold vehicle (sale price minus cost basis)
- [ ] **FINT-03**: Vehicle detail view shows full cost breakdown and totals
- [ ] **FINT-04**: Business cash position view: money in (sales, advances) vs money out (purchases, repairs, costs, refunds) for any date range

### Lease Brokerage -- Rate Sheets and Comparison

- [ ] **LBRK-01**: Finance company directory with rate sheets per vehicle model and manufacture year defining maximum loan amounts
- [ ] **LBRK-02**: Finance company rate cards by loan amount and period (months) defining installment amounts
- [ ] **LBRK-03**: Staff can enter vehicle details (not a purchase -- just for lease facilitation) and see maximum loan amounts per finance company
- [ ] **LBRK-04**: Staff can enter requested lease amount and either installment amount or period; the other auto-calculates per rate card
- [ ] **LBRK-05**: Lease comparison view showing side-by-side comparison across finance companies for lease amount, installment, and period
- [ ] **LBRK-06**: Staff can select a comparison option and add additional charges (document fees, government fees) to proceed

### Lease Brokerage -- Common Flow

- [ ] **LBRK-07**: Staff can enter customer details and one or more guarantor details with the lease application
- [ ] **LBRK-08**: Staff can mark customer and guarantor eligibility as confirmed or rejected by finance company, with contact person recorded
- [ ] **LBRK-09**: Staff can record if customer requests cash advance facility (company advances money before finance company approval, for an additional fee)
- [ ] **LBRK-10**: If lease is not eligible (vehicle or customer rejected), mark as rejected deal (visible only when specifically requested)
- [ ] **LBRK-11**: Cash advance disbursement recorded: loan amount minus all deductibles plus facility fee
- [ ] **LBRK-12**: Finance company processing blockers can be recorded and resolved in the system with feedback tracking
- [ ] **LBRK-13**: Customer delay inquiries recordable with finance company feedback

### Lease Brokerage -- Application Processing Path

Per finance company: used when the finance company works directly with the dealership. Mutually exclusive with Referral path for a given lease.

- [ ] **LBRK-14**: Staff can record vehicle inspection status (photos required: front, back, left, right, chassis number, engine number, meter, dealer with vehicle, customer with vehicle)
- [ ] **LBRK-15**: Staff can adjust loan amount based on finance company feedback after vehicle inspection
- [ ] **LBRK-16**: Document collection checklist: customer ID copies, guarantor ID copies, passport photos, bank passbook photo, address proof, relationship proof (if needed), optional affidavit
- [ ] **LBRK-17**: Vehicle document checklist: registration book, deletion letter (if needed), revenue license, extra key, transfer paper, previous owner ID
- [ ] **LBRK-18**: Processing fee recorded (default fixed amount, overridable)
- [ ] **LBRK-19**: Document verification recorded with any issues noted and finance company contact person who confirmed resolution
- [ ] **LBRK-20**: Finance company informed and file number (reference number) recorded against the lease
- [ ] **LBRK-21**: Documents marked as sent (daily batch to courier); pre-dispatch checklist screen for double-checking lease files before handover

### Lease Brokerage -- Referral Path

Per finance company: used when the finance company handles the customer directly. Mutually exclusive with Application Processing path for a given lease.

- [ ] **LBRK-22**: Staff can mark a lease as referred to finance company (customer contact details sent to finance company agent)
- [ ] **LBRK-23**: Referred leases can be marked as rejected if finance company informs of failure
- [ ] **LBRK-24**: Customer can report non-remittance of lease amount; recordable with finance company feedback

### Lease Brokerage -- Commission Reconciliation

- [ ] **LBRK-26**: Per-finance-company reconciliation method configurable
- [ ] **LBRK-27**: Staff can reconcile broker commissions against finance company remittances (bank transfer with reconciliation notice)
- [ ] **LBRK-28**: After reconciliation, unreconciled leases that are overdue are surfaced (condition: pending reconciliation AND sent date is 2+ days before reconciliation date or before the sent date of the last reconciled lease)
- [ ] **LBRK-29**: Referral lease commission reconciliation supported separately

### Data Import

- [ ] **IMPT-01**: One-time import facility accepting structured spreadsheet files (CSV/Excel)
- [ ] **IMPT-02**: Import supports all primary record types: suppliers, customers, repair vendors, vehicles, sales, repairs, advances
- [ ] **IMPT-03**: Validation report generated before data is committed; errors identified per row
- [ ] **IMPT-04**: All-or-nothing per batch -- if any record fails, none imported
- [ ] **IMPT-05**: Imported records visibly marked as imported data within the system

### Dashboard

- [ ] **DASH-01**: Dashboard home screen with key business metrics (vehicles in stock, vehicles in repair, active advances, recent sales)
- [ ] **DASH-02**: Quick action buttons for common tasks (new purchase, new sale, send for repair)

### Non-Functional

- [ ] **NFNL-01**: Responsive design from 360px mobile to 1920px desktop
- [ ] **NFNL-02**: PWA manifest and service worker; installable on mobile/tablet
- [ ] **NFNL-03**: All data encrypted in transit (HTTPS)
- [ ] **NFNL-04**: Indefinite data retention with no automatic deletion

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Enhanced Features

- **V2-01**: Vehicle photo management (upload, gallery, thumbnail)
- **V2-03**: Self-service password reset (email-based)
- **V2-04**: Active advance extension (before expiry, with approval)
- **V2-05**: Offline-capable read views (cached inventory, vehicle detail)
- **V2-06**: OAuth/social login options
- **V2-07**: Advanced search and filtering across all entities
- **V2-08**: Lease brokerage reporting (commission summaries, rejection rates, processing time analytics)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Native iOS/Android apps | Web PWA sufficient for all use cases |
| SMS/email/push notifications | In-app notifications only; no external messaging dependencies |
| Third-party integrations | No banks, government registries, or accounting software connections needed |
| Tax calculation/regulatory reporting | Not applicable in current jurisdiction |
| Multi-currency support | Single currency configurable via env var |
| Multi-branch/multi-company | Single dealership operation |
| Customer-facing portal | Internal system only |
| Vehicle valuation/market feeds | Manual pricing by staff |
| Document scanning/OCR | Manual data entry; structured import only |
| Real-time chat/messaging | Not needed for business operations |
| Bulk status updates | Bypasses per-vehicle validation rules; anti-feature |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (Populated by roadmapper) | | |

**Coverage:**
- v1 requirements: 128 total
- Mapped to phases: 0
- Unmapped: 128

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after customer feedback integration*
