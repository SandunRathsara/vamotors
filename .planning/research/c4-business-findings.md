# C4 business architecture findings

Research date: 2026-10-25. Scope: repository evidence, business requirements, decisions, and conceptual domain design; no application code changes. This is the requested research artifact within the existing `.planning/research` workflow, not a new implementation phase or an approved ADR.

## 1. Read this first

**The application implements a clickable, mutable mock frontend. It does not yet implement the dealership's transactional business system.** Do not draw production authentication, a database, approvals, cash accounting, imports, or document storage as implemented merely because their screens exist.

Evidence: `.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:7-13,76-92,180-193`; `lib/mock-store.ts:32-72,149-164`; `app/api/purchases/route.ts:27-65`; `app/api/sales/route.ts:52-67`.

Use three labels throughout the eventual architecture:

- **Implemented (I):** observable code behavior, usually mock behavior.
- **Documented target (T):** explicit requirements or recorded decisions; not necessarily built, approved, or internally consistent.
- **Recommendation (R):** a resolution/new design proposed by this research. Not a customer decision.

Most important recommended corrections:

1. Link every sale, reservation, repair, expense, write-off, and related approval to its **purchase cycle**, not just vehicle identity.
2. Separate real money movements from business statuses, revenue, trade-in consideration, and commission expectations.
3. Have business commands own transitions and atomic multi-record writes. Generic status PATCH is not a workflow.
4. Implement approval enforcement before enabling any approval-gated sale/refund action, even if approval UI lands later.
5. Keep brokerage separate from inventory ownership while sharing customers, finance companies, documents, and commission reconciliation.

## 2. Source precedence and decision evidence

No signed customer acceptance was found in the business specification: its header says “Pending Client Sign-Off,” and its acceptance section is an unsigned template (`docs/02-1-business-requirements-specification.md:6-14,844-874`). PROJECT decision outcomes still say pending (`.planning/PROJECT.md:83-94`). Therefore distinguish recorded direction from legally signed acceptance.

### Precedence method

1. Explicit later customer feedback overrides earlier scope **where it changes that scope**.
2. Current `.planning/REQUIREMENTS.md` incorporates that feedback and cross-module decisions; use it as the current v1 feature catalog.
3. Phase CONTEXT decisions govern the relevant phase, especially the intentional mock-only implementation. They do not silently redesign long-term business rules.
4. PROJECT/ROADMAP establish deployment direction and sequencing, but stale completion counters are weaker evidence than code and completed plan summaries.
5. Business specification and questionnaire govern business intent where the current catalog is silent; technical specification provides detail but contains contradictions.
6. Prior research, fixture values, UI labels, and generated agent choices are not additional customer decisions. Resolve remaining contradictions explicitly as recommendations below.

| Topic | Evidence and precedence | Architecture consequence |
|---|---|---|
| Primary actor | Questionnaire says cashier most of the time, occasional managers/sales (`docs/01-requirements-questionnaire.md:13-19`); current PROJECT repeats this (`.planning/PROJECT.md:62-64`) | Small multi-user internal system, **not** single-account software despite infrastructure document wording |
| Dynamic permissions | Customer explicitly requests configurable CASL roles (`docs/01-requirements-questionnaire.md:170-186`); multiple roles and immediate changes required (`.planning/REQUIREMENTS.md:107-113`) | Fixed role names in mock `UserSchema` are not target roles |
| Monolith | Old technical specification says NestJS/JWT/RabbitMQ (`docs/02-2-requirements-specification.md:58-70`); infrastructure plan explicitly collapses backend (`docs/03-tech-and-infra-stack.md:12-27`); PROJECT prohibits NestJS/RabbitMQ (`.planning/PROJECT.md:73-81`) | One Next.js application, in-process domain modules; no separate backend, broker, or microservices |
| Actual shell stack | Later recorded preset decision establishes Next.js 16.1.7 and radix-vega (`.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:22-47`) | Do not label current implementation Next.js 15 merely because old research says 15 |
| Local mock sign-off | Explicit later decision: Route Handler mocks, process-memory mutation, static login, local review (`00.1-CONTEXT.md:76-92`, full directory as above) | Screen coverage proves UI coverage, not production business capability |
| Customer feedback expands product | Brokerage is explicitly **not a purchase**, and sale/customer detail and third-party reference are requested (`docs/round_1_customer_feedback.md:1-16`) | Two commercial workflows: owned-vehicle sales and external-vehicle brokerage |
| Shared finance directory | Current catalog adds shared finance company entity, contacts, commission rate, processing path (`.planning/REQUIREMENTS.md:34-43`) | Inventory finance and brokerage must reference the same finance company identity |
| Shared reconciliation | Current catalog explicitly covers both vehicle sales and brokerage, Finance navigation (`.planning/REQUIREMENTS.md:201-207`) | Reconciliation is a cross-commercial finance module, not brokerage-only |
| Vehicle identity | Customer permits repeat purchase (`docs/01-requirements-questionnaire.md:218-226`); BRS specifies one identity, independent purchase cycles (`docs/02-1-business-requirements-specification.md:544-551`) | One physical vehicle, many acquisitions; never use active purchase as historic sale linkage |
| Optional registration | Earlier questionnaire ambiguously requires CR (`docs/01-requirements-questionnaire.md:61-74`); later BRS v1.1 explicitly makes VIN and CR optional (`docs/02-1-business-requirements-specification.md:140-147`) | Missing VIN/CR cannot block inventory or sale; chassis/engine remain required for normal entry |
| Lifecycle vs availability | Customer asks for separation (`docs/01-requirements-questionnaire.md:94-104`); current catalog adopts it (`.planning/REQUIREMENTS.md:53-58`) | Operational state and staff hold are separate; not every in-stock vehicle is saleable |
| Advance expiry | Customer insists manual decision (`docs/01-requirements-questionnaire.md:114-124`); catalog distinguishes automatic flagging from manual resolution (`.planning/REQUIREMENTS.md:71-78`) | Expiry never silently cancels, refunds, or releases inventory |
| Handover timing | Explicit customer answer: handover and final sale simultaneous (`docs/01-requirements-questionnaire.md:156-162`); current requirement repeats (`.planning/REQUIREMENTS.md:82-86`) | Separate persisted Delivered stage conflicts with intent; see resolution below |
| Photos and offline | General vehicle photos/offline reads deferred in current catalog (`.planning/REQUIREMENTS.md:229-241`); brokerage inspection photos explicitly v1 (`.planning/REQUIREMENTS.md:180-191`) | Required inspection evidence is not the deferred showroom gallery; installable PWA does not imply offline business writes |
| Audit | Every change, purchase/sale reason, indefinite retention are customer requirements (`docs/01-requirements-questionnaire.md:78-80,224-230`) | Append-only audit and retained history are first-class from first business mutation |

**History cautions:** `.planning/STATE.md:74-90` includes implementation choices (e.g. sale enum has no Delivered; discrepancy sign is expected minus received), not all customer decisions. `.planning/ROADMAP.md:15-27,248-262` has stale completion entries; `.planning/PROJECT.md:62` and actual code establish shell completion. The purchases quick task intentionally displayed vehicle rows as purchase rows for the mock (`.planning/quick/260413-eeq-restructure-purchases-page-to-list-all-p/260413-eeq-PLAN.md:90-104`); it does **not** revoke independent purchase-cycle requirements. The later table migration changes infrastructure only (`.planning/phases/00.2-migrate-data-table-to-diceui/00.2-CONTEXT.md:7-11,18-31`). Testing direction explicitly separates extracted pure logic from HTTP tests (`.planning/phases/00.3-testing-strategy/00.3-CONTEXT.md:24-28,39-56`).

## 3. Actors, business context, and external interactions (C1 input)

| Actor | Relationship to VSMS | Status |
|---|---|---|
| Cashier / operational staff | Records purchases, receipts, advances, repairs, sales, documents, dispatch, reconciliation | T; cashier primary |
| Sales staff / brokerage operator | Customer entry, comparison, reservations, brokerage case processing and inquiries | T; actual permissions configured dynamically |
| Manager / authorized approver | Discounts, write-offs, refunds, completed-sale edits; financial visibility | T; authority is permission-based, not a hardcoded job title |
| Administrator | Accounts, runtime roles/permissions, protected administrator, imports, configuration | T |
| Customer / buyer / borrower | Purchases, reserves, trades vehicle, requests brokerage/cash facility, supplies evidence | External business actor; **no customer portal** |
| Guarantor | Supplies identity/contact/evidence, eligibility checked by finance company | External business actor; no direct login |
| Supplier / individual seller / company contacts | Supplies owned inventory; receives seller payment | External business actor |
| Repair vendor / contacts | Receives vehicle, returns it with final invoice | External business actor |
| Finance company / bank / private settlement lender | Lease settlement recipient; finance company issues DO/file reference, confirms eligibility, remits funds/commissions | External business actor; not an integrated system |
| Courier | Receives daily document batches; tracking/handover recorded by staff | External business actor; no courier integration |

Evidence: `docs/01-requirements-questionnaire.md:13-35,41-59,90-104,126-162,170-214`; `docs/round_1_customer_feedback.md:13-45`; `.planning/REQUIREMENTS.md:94-122,161-215`.

**C1 drawing rule:** phone calls, WhatsApp, physical vehicle/document handover, bank notices, and finance decisions are manual interactions mediated by staff. Do not draw WhatsApp, banking, government, accounting, SMS, email, or a finance-company API as integrated software (`docs/round_1_customer_feedback.md:16,27-31`; `.planning/PROJECT.md:46-58`). Browser/PWA is the staff interface. Neon and R2 are target technical dependencies at C2, not external business decision makers.

## 4. Implemented domain surface versus target

| Surface | Implemented evidence | Not implemented by that evidence |
|---|---|---|
| Purchases / vehicle | Vehicle shape embeds price, purchase type/date/supplier, costs, mileage (`lib/mock-data/schemas.ts:18-50`); POST always creates a new Vehicle (`app/api/purchases/route.ts:35-65`) | Distinct purchases, deduplication, re-purchase cycles, settlement breakdown persistence |
| Sales | Four UI categories and optional advance/lease/trade-in fields (`lib/mock-data/schemas.ts:73-100`); POST writes one store (`app/api/sales/route.ts:52-67`) | Atomic vehicle update, customer validation, receipts, approval gating, profit calculation, handover |
| Sale detail | Type-specific display and timeline (`components/sales/sale-detail-view.tsx:104-251`); advance next steps are text; invoice disabled (`:159-168,207-211`) | Functional advance conversion, complete finance flow, actual PDF issuance |
| Repairs | Create/update repair store (`app/api/repairs/route.ts:27-61`) | Updating vehicle state/cost basis with repair atomically |
| Approvals | Updates approval status, hardcodes reviewer (`app/api/approvals/route.ts:31-59`) | Applying proposed business action, live authorization, pending-only review, concurrency control |
| Brokerage | Mock deal fields with guarantors/checklists/photos (`lib/mock-data/schemas.ts:164-202`); unrestricted patch (`app/api/lease-deals/[id]/route.ts:21-33`) | Command guards, comprehensive verification/contact history, blocker and inquiry records, real evidence storage |
| Comparison | Approximate nearby loan-card match, period lookup (`app/api/lease-comparison/route.ts:20-65,70-83`) | Installment-to-period inversion, enforced max loan, versioned rates, finance-approved quotation |
| Dispatch | Sets dispatch row only (`app/api/lease-dispatch/route.ts:15-35`) | Atomic deal progression, batch checklist validation, immutable handover evidence |
| Reconciliation | Overwrites received value and marks reconciled (`app/api/lease-reconciliation/route.ts:23-44`) | Notice/remittance batch, allocations, partial settlement, matching finance company, duplicate prevention |
| Cash flow | Reads independently seeded cash entries and sums signed amounts (`app/api/cash-flow/route.ts:20-41`; `lib/mock-store.ts:160`) | Transaction-derived complete cash history, opening balance, integration with sales or brokerage |
| Users | One hardcoded role per mock user (`lib/mock-data/schemas.ts:223-232`) | Multiple configurable roles, permission rules, protected last admin |

The mock's broad `PATCH` and Map update do not demonstrate target validation (`app/api/vehicles/[id]/route.ts:21-32`; `lib/mock-store.ts:62-72`). This is an intentional phase limitation, not evidence production requirements were dropped.

## 5. Full business workflow inventory

### A. Third parties and customers (T)

Maintain searchable customers with full/calling name, NIC/passport, address, phone; email/licence optional. Create inline during sale. Show customer history and linked records. Maintain individual/company suppliers and repair vendors with multiple contacts; finance companies are shared across finance purchases/sales, brokerage and reconciliation. Finance companies define commission rate, Application/Referral default, active status and reconciliation method. Keep archived parties available in historical records, excluded from normal new selections.

Evidence: `.planning/REQUIREMENTS.md:24-43,94-113,201-207`; `docs/02-2-requirements-specification.md:197-268`.

### B. Acquisition, inventory, re-purchase (T; R where noted)

1. Select supplier or create inline. Capture vehicle identity/details, date, initial mileage and listed price separately from acquisition cost.
2. Cash: record purchase price; lease settlement: institution/type/reference plus settlement and seller amounts; brand-new: company supplier, registration optional.
3. Match engine+chassis; create identity only if new, otherwise create another acquisition linked to existing identity. Preserve earlier purchases/sales/repairs.
4. Create cycle in Purchased, unavailable. Receive physically/verify to InStock; staff explicitly sets sale availability or reason for hold.
5. Record further mileage with date/remark, additional dated costs, asking-price changes with audit.
6. **R:** re-purchase opens a new cycle, not an illegal Sold→InStock reversal of the old cycle. Only one open owned acquisition per physical vehicle. WrittenOff cycles stay closed; reuse of a physically scrapped identity must not be a casual re-purchase path.

Evidence: `docs/02-2-requirements-specification.md:89-195,550-609`; `.planning/REQUIREMENTS.md:22-32`; BRS immediate InStock wording (`docs/02-1-business-requirements-specification.md:107-136`) conflicts with technical receipt step; current ten-state requirement includes Purchased, so prefer explicit receipt command (R).

### C. Repair and costs (T)

InStock → send to active vendor with request and sent date → InRepair/unavailable. Return with actual invoice amount/date, return date and actual work summary → InStock but still unavailable until explicitly released. Retain every repair; estimates not required. Costs attach to acquisition cycle and recalculate that cycle's basis. **R:** invoice amount/date nullable until return (the technical entity says required even though dispatch occurs first). Distinguish invoiced cost from actual vendor payment date for cash flow.

Evidence: `docs/02-2-requirements-specification.md:270-288,613-643`; `.planning/REQUIREMENTS.md:45-58`.

### D. Immediate sale and invoice (T)

Select available owned stock and existing/new customer; record agreed price, cash/transfer, sale date and handover mileage; optional external reference. Detect below-listed-price discount before finalization. After required approval, complete sale + handover + mileage entry + vehicle Sold/unavailable + payment evidence + audit together. Generate printable PDF with dealership/buyer identities, vehicle identifiers/mileage, full price/payment breakdown, declarations and signature lines. On-demand generation is an assumption, not an automatic issuance requirement; generated versions are retained.

Evidence: `.planning/REQUIREMENTS.md:60-69,101-105,115-121`; `docs/02-2-requirements-specification.md:649-663,712-726,888-892`; BRS invoice detail `docs/02-1-business-requirements-specification.md:352-359`.

### E. Reservation advance (T; ambiguous calculation resolved in §8)

Available InStock → receive positive advance, agree sale price, snapshot validity inputs → AdvancePlaced/unavailable. Calculate tiers (≤5%=7 days, ≤10%=14, ≤15%=21, >15%=one month maximum). Job flags elapsed reservation and vehicle as expired; warns staff, but does not release vehicle or alter money received. Staff converts to sale with only remaining balance recorded, cancels with no refund (retains receipt), or requests full/partial refund approval. Approved refund records outflow and cancellation; unresolved expired advance blocks another buyer. Live reservation and expiry job may race; commands must check current state atomically.

Evidence: `docs/02-1-business-requirements-specification.md:280-298,561-615`; `docs/02-2-requirements-specification.md:665-687,730-772`; `.planning/REQUIREMENTS.md:71-78`.

Do not confuse a **customer reservation advance received by the dealership** with a **brokerage cash facility disbursed by the dealership**: opposite money direction and different business purpose.

### F. Owned-vehicle lease sale (T)

Select customer/available owned vehicle; agree total price and mandatory positive down payment; choose shared finance company, finance amount and terms, optional file/reference. Move to FinancePending/unavailable. Receive DO: upload actual document and capture issue date (= finance date); record DOReceived. Finalize/handover simultaneously once DO/evidence and any discount approval are valid. Record finance-company money receipt independently of DO issuance; DO is not proof of bank settlement (R). Commission expectation then participates in unified reconciliation. **R:** capture a separate commission eligibility/sent date for vehicle-sale leases because overdue reconciliation needs that date although inventory-sale requirements do not define courier dispatch.

Evidence: `.planning/REQUIREMENTS.md:41-43,80-86,201-207`; `docs/01-requirements-questionnaire.md:148-162`; `docs/02-2-requirements-specification.md:689-708`.

### G. Trade-in (T)

Capture traded vehicle description/value, use full agreed sale price for revenue; customer pays only residual cash/transfer. If intended for resale, create/reuse the traded physical identity and a new acquisition at agreed trade-in value, linked back to source sale; customer is seller of traded vehicle. Separate noncash consideration from actual cash. **R:** model trade-in as a payment component rather than an exclusive settlement channel internally; retain four familiar UI categories. Do not invent combined trade-in-plus-finance functionality as confirmed scope. Creating inventory from the same trade-in must be idempotent.

Evidence: `.planning/REQUIREMENTS.md:88-92`; `docs/02-2-requirements-specification.md:1071-1106`. Its Customer-as-supplier instruction (`:1091-1100`) needs an explicit seller-customer reference, not an invalid Customer ID in Supplier FK.

### H. Write-off and disposal (T)

Capture date, mandatory reason, disposal method, explicit proceeds (zero allowed); resolve any outstanding customer reservation obligation first; request approval with proposed details; only approval closes acquisition as WrittenOff/unavailable. Record cost snapshot and disposal recovery cash evidence; rejection leaves original state unchanged. **R:** make WriteOff cycle-owned history, not solely mutable fields on lifetime Vehicle; require finance obligations and open repairs to be resolved/explicitly accounted for, not silently abandoned.

Evidence: `.planning/REQUIREMENTS.md:123-134`; `docs/02-2-requirements-specification.md:1110-1143`; BRS `docs/02-1-business-requirements-specification.md:230-237`.

### I. Brokerage comparison and common intake (T)

Enter externally owned vehicle details **without acquisition/inventory ownership**. Lookup maximum loan by finance company/model/year. Enter requested loan and either term or installment; derive the other using rate cards and compare companies side by side. Select quote, add document/government charges. Enter customer and one-or-more guarantors; record eligibility, finance contact and requested cash facility. Company configuration selects mutually exclusive Application/Referral path per deal. Rejected deals remain retained and can be specifically requested but are hidden by default.

Evidence: `docs/round_1_customer_feedback.md:6-21`; `.planning/REQUIREMENTS.md:161-182,193-199`.

### J. Brokerage Application path (T)

After customer/guarantor eligibility: inspect vehicle with nine evidence categories (front/back/left/right/chassis/engine/meter/dealer with vehicle/customer with vehicle); record finance approval or reject; adjust loan from feedback. Collect customer/guarantor/vehicle and processing documents; some items conditional, affidavit optional, extra key is a checklist object not a file upload. Processing fee defaults but overridable. Record verification whether issues exist or not, including confirming finance contact and issue resolution. Notify company manually, capture file number. Complete pre-dispatch checklist; batch courier handover each evening, timestamp sender/tracking. Record optional processing blockers and resolutions, customer delay inquiries and finance feedback. Complete operational processing independently of later commission reconciliation (R).

Evidence: `docs/round_1_customer_feedback.md:18-31`; `.planning/REQUIREMENTS.md:180-191`.

### K. Brokerage Referral path and optional cash facility (T)

After eligibility, send customer's contacts to finance agent manually; record referred date/contact. Record rejection if informed; record non-remittance complaints and company feedback. Cash facility may be selected in either path: dealership disburses loan proceeds before finance settlement, net of deductions and facility fee, with evidence. Track recovery/remittance separately so funds advanced do not look like brokerage expense or commission revenue (R).

Evidence: `docs/round_1_customer_feedback.md:29,33-45`; `.planning/REQUIREMENTS.md:170-178,193-199`.

### L. Unified commission reconciliation (T)

Finance company has configured reconciliation method. Capture bank remittance and notice for a period or individual referral. Match notice lines to commissions from **both** inventory-sale leases and brokerage. Record expected, received, and discrepancy (expected−received). Surface remaining pending commissions whose sent date is at least two days before reconciliation date **or** earlier than the last reconciled lease's sent date. Preserve source links. **R:** amount allocation to notice lines supports shortfall/overpayment; “reconciled with discrepancy” is an explicit resolution, not proof paid-in-full. Store reconciliation-run cutoff to make overdue results reproducible. Referral date substitutes for sent date on referral path.

Evidence: `docs/round_1_customer_feedback.md:39-45`; `.planning/REQUIREMENTS.md:201-207`; `.planning/STATE.md:89-90`; mock limitation `app/api/lease-reconciliation/route.ts:23-42`.

### M. Approval, audit, notification, reporting and import (T)

- Approval: discount, write-off, customer advance refund, completed sale edit; original values unchanged until approved. Purchase/sale edits require reason; approval records requestor/reviewer/times/review note and field changes in audit.
- Audit: all creates/updates/deactivations/deletes/status changes, append-only, field-level before/after; immutable invoices versioned. Credentials/secrets must not be copied into audit diffs (R).
- Notifications: linked in-app records only, unread count, individual/all read; advance warning/expiry, repair return, approval request/outcome; route by current relevant authority rather than role-name strings (R).
- Reports: inventory, sold per period, profit per vehicle, outstanding advances, current repairs, cash flow, write-off/disposal; date filters, CSV/PDF. Brokerage analytics deferred. Shell currently has purchase/audit reports instead of a direct matching seven-report set; current route inventory is not the acceptance definition.
- Import: admin uploads manually transcribed CSV/Excel, all entity fields supported, row validation/preview then explicit confirmation; atomic per batch, imported indicator/batch provenance, auditable import identity, no OCR. Directories precede linked transactions; approvals can be bypassed for historical import but structural/financial integrity cannot (R).

Evidence: `.planning/REQUIREMENTS.md:115-159,209-215,235-241`; `docs/02-2-requirements-specification.md:834-892,939-1067`; report-set mismatch `.planning/phases/00.1-frontend-shell-migration-html-css-wireframes-to-next-js-shadcn-ui/00.1-CONTEXT.md:63-65`; BRS seven definitions `docs/02-1-business-requirements-specification.md:690-755`.

## 6. Target C3 domain modules (R, grounded in T)

These are logical modules **inside the single Next.js deployment**, not independently deployed services. One database transaction may span modules. Group by business ownership and invariants, not one module per screen/table. Interfaces below are conceptual business command/query surfaces, not claims that functions already exist.

| Module | Owns | Small interface / relationships |
|---|---|---|
| Identity & Access | Staff identity, roles, permissions, assignments, permission revision, protected admin | Authenticate; authorize action/record/fields; administer roles/accounts. Every command/query uses actor context; approval rechecks current authority |
| Parties | Customer, Supplier, RepairVendor, FinanceCompany, contacts, active/archive state | Find/create/update party, finance-company policy. Shared by inventory, sales, brokerage, finance; unified Third Parties UI need not force one nullable mega-table |
| Vehicle & Acquisition | Physical vehicle, purchase cycles, settlement detail, mileage, inventory status/availability, asking price, write-off | Record acquisition, receive stock, hold/release stock, record mileage/cost, request write-off. Other transaction modules call cycle guards within same transaction |
| Repairs | Repair dispatch/return, vendor, request/summary, invoice cost | Send for repair; record return. Updates cycle condition and contributes costs atomically |
| Sales & Reservations | Sale case, reservation, lease details, trade-in consideration, handover | Reserve, expire, resolve, initiate finance, receive DO, finalize, propose edit. Coordinates cycle, approval, money movements, mileage, trade-in acquisition and audit |
| Brokerage | External-vehicle subject, selected quote, guarantors, eligibility, inspection, checklist verification, application/referral, blockers/inquiries, cash facility | Compare offers; open deal; confirm eligibility; verify evidence; dispatch/refer; record issue/resolution; disburse facility; complete/reject. Does not create owned inventory |
| Finance & Reconciliation | Actual money movements, commission entitlements, bank remittances/notices, allocation/reconciliation | Record receipt/disbursement/reversal; reconcile remittance; cash-position query. Both sales and brokerage supply commission sources |
| Approvals | Versioned proposed actions and review decisions | Request; approve/reject; consume approval against exact proposed command. Domain owner applies approved action; module is not a generic unvalidated JSON patch executor |
| Documents & Invoices | Evidence metadata/access, upload completion, immutable invoice versions | Authorize upload/read; attach verified object; generate invoice from transaction snapshot. Consumed by sale, brokerage, dispatch and reporting |
| Audit & Notifications | Append-only audit entries, recipient notifications/read state | Append mutation evidence in same transaction; deliver linked in-app notifications idempotently. No edit/delete audit interface |
| Reporting & Dashboard | Read models and export formatting | Query permission-filtered business projections, no separate mutable financial truth. Reuses cycle cost, receipt and commission semantics |
| Historical Import | Import batch, staged rows/errors, mapping, provenance, confirmation | Validate/preview; commit bounded atomic batch. Uses explicit historical intake path with normal integrity rules |

Module justification: business scope `.planning/REQUIREMENTS.md:22-227`; single deployment `.planning/PROJECT.md:73-81`; target thin HTTP/rich business implementation `.planning/research/ARCHITECTURE.md:65-78,204-209`. Existing root `app/`, `lib/`, `components/`, `hooks/` structure is real; old research's proposed `src/` tree is not implemented (`.planning/research/ARCHITECTURE.md:82-202`). No folder reorganization is required by this conceptual map.

### Command transaction contract (R)

`actor + command + expectedRevision + idempotencyKey → applied result | pending approval | conflict | rejection`.

Authenticate/authorize → validate → load current cycle and obligations → validate business command/approval → atomically persist domain changes, actual payments, audit and essential notification records → return. No real network file upload or PDF rendering inside the business transaction. Chronological jobs call the same commands. Reads never infer historic ownership or cash from mutable current status.

## 7. C4 Level 4 conceptual domain structure (R unless marked T)

This is a conceptual entity/function design for future code-level diagrams, **not** an implemented class diagram, Prisma schema, or a requirement to introduce classes. `1—*` means one-to-many. T names often originate in the technical specification; added links/types below are recommendations.

### Identity, parties, owned inventory

```text
User 1—* UserRole *—1 Role 1—* RolePermission *—1 Permission                 [T]
Customer; Supplier 1—* Contact; RepairVendor 1—* Contact; FinanceCompany 1—* Contact [T]
FinanceCompany {processingPathDefault, commissionPolicy, reconciliationMethod}   [T]

VehicleIdentity {id, engineNumber, chassisNumber, optional VIN/CR, make/model/...} [T]
  1—* PurchaseCycle {id, vehicleId, channel, sellerRef, acquiredAt, purchasePrice,
                    status, availabilityHold, listedPrice, revision, closedAt}  [R shape]
  1—* MileageReading {observedAt, reading, remark, actor}                       [T]
PurchaseCycle 0..1—1 LeasePurchaseDetail {institution, reference, settlement, sellerCash} [T]
PurchaseCycle 1—* AdditionalCost {incurredAt, amount, description/category}        [T]
PurchaseCycle 1—* Repair {vendorId, request, sentAt, returnedAt?, summary?, invoice?} [T]
PurchaseCycle 0..1—1 WriteOff {reason, method, costSnapshot, proceeds, approvalId}  [R]
```

Target sources: `docs/02-2-requirements-specification.md:89-195,270-288,356-413,1110-1143`; shared finance policy `.planning/REQUIREMENTS.md:34-43,201-207`. `Vehicle.activePurchaseId` may remain a convenience pointer but is never a historical transaction join key. Keep cycle operational state on cycle (R); expose latest state through vehicle view. `sellerRef` is a validated Supplier-or-trade-in-Customer alternative, not an unrestricted polymorphic string.

### Sale lifecycle and payment composition

```text
PurchaseCycle 1—* SaleCase {purchaseRecordId REQUIRED, vehicleId, customerId,
                          agreedPrice, listedPriceSnapshot, state, revision,
                          thirdPartyReference?, completedAt?, handoverMileage?}
SaleCase 0..1—1 Reservation {receivedAmount, priceBasisSnapshot, percentage,
                           receivedAt, validUntil, resolution, convertedSaleId?}
SaleCase 0..1—1 LeaseFinanceDetail {financeCompanyId, downPayment, financeAmount,
                                  term?, doIssueDate?, doDocumentId?}
SaleCase 1—* PaymentAllocation → MoneyMovement
SaleCase 0..1—1 TradeInConsideration {value, vehicleDescription, vehicleId?,
                                     createdPurchaseId?}
SaleCase 0..1—1 SaleCompletion {purchaseRecordId, salePrice, costBasisSnapshot,
                               completedAt, mileage, approvalEvidence}
SaleCompletion 1—* InvoiceVersion {snapshot, version, generatedBy/At, objectKey}
```

Multiple sale attempts per cycle are allowed (cancelled reservations), but at most one completed sale per cycle. A `SaleCase` unifies the shell's in-progress sale view with the technical specification's completed SaleRecord language; physical tables may retain existing names. Required direct cycle linkage and snapshots are R; documented sale/reservation fields are `docs/02-2-requirements-specification.md:290-354`. No engine/chassis duplication is needed for a sale invoice: snapshot relevant data to preserve document history after identity edits.

### Brokerage, dispatch and evidence

```text
FinanceCompany 1—* RateSheetVersion {model, manufactureYear, maxLoan, effectiveDates}
RateSheetVersion 1—* RateCardEntry {principal, months, installment}
BrokerageDeal {customerId, financeCompanyId, pathSnapshot, vehicleSubject,
               quoteSnapshot, requested/approvedLoan, operationalState, revision}
  1—* GuarantorParticipation {identity/contact snapshot, eligibility}
  1—* EligibilityCheck {subject, result, financeContact, checkedAt, notes}
  1—* InspectionEvidence {requiredPhotoCategory, documentId}
  1—* ChecklistItem {kind, applicability, collected, verified, verifier, verifiedAt}
  1—* VerificationEvent {issues, financeContact, outcome, timestamp}
  1—* ProcessingIssue {blocker|delayInquiry|nonRemittance, openedAt, feedback, resolvedAt?}
  0..1—1 CashFacility {grossPrincipal, deductions[], facilityFee, netDisbursed, recoveryState}
  1—* DealEvent {eligibility, loanAdjustment, fileReference, referred, completed/rejected}
DispatchBatch {courier, handedOverAt, handedOverBy, tracking?}
  1—* DispatchItem {brokerageDealId, checklistSnapshot, sentAt}
Document {objectKey, contentType, size, uploadedBy/At, attachedEntity, version}
```

Requirements define these concepts, but not the above normalized storage shape: `.planning/REQUIREMENTS.md:161-199`; feedback `docs/round_1_customer_feedback.md:9-37`. VehicleSubject contains vehicle details and optional link to an existing physical VehicleIdentity, **never an automatic PurchaseCycle**. Path/quote/commission policy snapshots prevent later company/rate edits from rewriting deals. Default all nine inspection categories required for Application; no mandatory Application photo/checklist constraints on Referral (R).

### Finance, governance and import

```text
MoneyMovement {id, occurredAt, recordedAt, direction, amount, currency, method,
               sourceType/id, purchaseRecordId?, reference?, reversalOf?, key}
CommissionEntitlement {financeCompanyId, sourceSaleId XOR brokerageDealId,
                        policySnapshot, expectedAmount, eligibleSentAt, state}
BankRemittance {financeCompanyId, receivedAt, amount, bankRef, noticeDocumentId?}
ReconciliationRun {financeCompanyId, cutoffDate, methodSnapshot, completedAt}
  1—* CommissionAllocation {entitlementId, remittanceId, receivedAmount,
                            discrepancy, resolution, reviewer}
ApprovalRequest {type, entity/cycleId, payload, baseRevision, payloadHash,
                 requestedBy/At, state, reviewedBy/At, note, consumedAt?}
AuditEntry {actor, approver?, entity, commandId, before/after, reason, recordedAt}
Notification {recipientUserId, eventKey, entityLink, createdAt, readAt?}
ImportBatch {fileHash, type, actor, stagedVersion, state, validatedAt, committedAt?}
  1—* ImportRow {rowNumber, sourceKey, mappedValues, validationErrors}
Imported entity → {importedFromLegacy, importBatchId, sourceRowKey}
```

MoneyMovement is a minimal operational cash evidence table, **not** a general ledger, double-entry accounting package, bank integration or new general accounting scope. It intentionally changes the old “no dedicated ledger required” recommendation because status-based sums cannot meet trustworthy history (see §8). Remaining sources: `docs/02-2-requirements-specification.md:414-460,1032-1067`; `.planning/REQUIREMENTS.md:129-159,201-215`.

## 8. Ambiguity resolutions and investigation of prior-review concerns

The specifically described earlier review was not found as a standalone artifact. The following findings were independently verified against source; do not attribute invented quotations or approvals to an absent review.

### 8.1 Missing sale-to-purchase-cycle FK — confirmed target defect

Technical PurchaseRecord scopes repairs/expenses per purchase, but SaleRecord has `vehicleId` only (`docs/02-2-requirements-specification.md:127-149,290-311`). Old research topology repeats it (`.planning/research/ARCHITECTURE.md:475-498`). Mock Sale also lacks purchase ID (`lib/mock-data/schemas.ts:73-100`). Worse, prior pitfalls advises joining costs through **activePurchaseId** (`.planning/research/PITFALLS.md:244-250`), which works for current stock but fails for historical sale after re-purchase.

**R:** add mandatory `SaleCase/SaleRecord.purchaseRecordId`, Reservation.purchaseRecordId, and all cycle-owned records; enforce vehicle/cycle consistency. Bind sale at creation, never recalculate binding from current vehicle pointer. Persist completion cost snapshot with component references; subsequent approved corrections are explicitly versioned/restated, not silently rewritten profit. Validate with buy 100 + repair 10 → sell 140 (profit 30), re-buy same identity 120 + repair 5 → sell 150 (profit 25); first profit must remain 30.

### 8.2 Cash history based on mutable statuses — confirmed specification defect, not current cash route behavior

Technical cash aggregation counts advances in ACTIVE/CONVERTED states only and final sale payments without explicit durable payment decomposition (`docs/02-2-requirements-specification.md:816-830`). Cancelling a retained 100 advance would erase that historic 100 inflow; refunding 60 must leave +100 at receipt date and −60 at refund date. Conversion must not count advance 100 plus full sale 1000 as 1100. Lease DO date is not payment receipt; repair invoice date need not be payment date.

**I:** current cash-flow route sums separate fixtures; it does not actually implement that flawed status calculation (`app/api/cash-flow/route.ts:20-41`). **R:** append operational MoneyMovement per actual receipt/payment with actual dates; corrections reverse then replace; aggregate by occurred date, never current reservation/sale state. Separate cash and bank channels if needed in display, but both count as monetary flow. For period view show net movement; call it absolute cash balance only when opening balance is supplied.

Trade-in conflict: technical spec calls noncash trade-in “cash inflow equivalent” (`docs/02-2-requirements-specification.md:1016-1019,1102-1106`), but BRS defines actual money received/paid (`docs/02-1-business-requirements-specification.md:520-527,741-743`). **R:** show noncash consideration separately, exclude from cash totals and exclude matching noncash trade-in acquisition outflow. Keep full agreed sale price for profit. Example: 1500 sale with 500 trade-in = 1000 cash received, 1500 sales consideration, acquired asset basis 500; not 1500 cash inflow. Commission receipt, disposal proceeds, cash-facility disbursement/recovery are money flows too, separate from core vehicle gross profit.

### 8.3 Concurrency — missing target guarantee

Small user count does not remove double-click, browser retry, cron/manual conversion, double-manager-review or concurrent buyer risk. In-memory Map CRUD has no business revision/transaction (`lib/mock-store.ts:56-72`); mock POSTs trust body and lack idempotency (`app/api/sales/route.ts:52-67`); approval review overwrites any existing status (`app/api/approvals/route.ts:47-56`). Technical spec assumes one ACTIVE advance (`docs/02-2-requirements-specification.md:1171-1178`) but does not address expired unresolved reservations.

**R:** database transaction + cycle row locking or revision compare-and-set; enforce unique normalized vehicle identity, one open cycle per vehicle, one unresolved reservation/sale commitment per cycle, one completed sale per cycle, one commission entitlement per qualifying source, and unique mutation keys. EXPIRED still reserves cycle until resolved. Lock sources in consistent order for trade-in writes. Approval PENDING→decision and decision consumption happen once. Expiry only updates still-active reservation for same cycle; skip converted/cancelled cases. Return conflict on stale revision, not last-writer-wins success. A transaction without isolation/guards alone is insufficient.

### 8.4 Inconsistent transitions — confirmed across specifications and old research

| Conflict | Evidence | R resolution |
|---|---|---|
| Immediate cash sale missing from technical transition map | Process permits InStock→Sold (`docs/02-2-requirements-specification.md:649-663`), map omits it (`:494-527`); BRS permits (`docs/02-1-business-requirements-specification.md:643-659`) | Include command FinalizeImmediateSale from available InStock |
| Delivered enum but simultaneous handover | Enum includes Delivered (`docs/02-2-requirements-specification.md:479-492`), customer says simultaneous (`docs/01-requirements-questionnaire.md:156-158`); current catalog still lists ten (`.planning/REQUIREMENTS.md:55`) | Retain compatibility/read mapping if necessary; delivery is completion timestamp/event, not a normal independently mutable operational stage |
| Sold terminal vs re-purchase | BRS terminal map (`docs/02-1-business-requirements-specification.md:656-657`) plus multiple independent acquisitions (`:544-551`) | Terminal **cycle**; new purchase starts next cycle on same identity |
| Cancellation before expiry missing edge | Refund explicitly possible ACTIVE or EXPIRED (`docs/02-2-requirements-specification.md:767-772`), map only expiry/cancellation path | ResolveReservation supports both active and expired; approved refund before cancellation side effects |
| Write-off from any nonterminal vs narrow map | `docs/02-2-requirements-specification.md:1112-1126` versus `:494-527` | Allow authorized request from held/nonterminal stock; apply only after obligations resolved and state/revision revalidated |
| Availability at expiry | BRS automatic list omits AdvanceExpired (`docs/02-1-business-requirements-specification.md:577-584`), technical table explicitly forces false (`docs/02-2-requirements-specification.md:529-544`) | Effective availability requires InStock, no live commitment, no staff hold; expiry alone never releases |
| Extension workflow creates replacement advance without clear receipt handling | BRS requires approval for expired extension (`docs/02-1-business-requirements-specification.md:291-298`); technical suggests new record (`docs/02-2-requirements-specification.md:754-765`); active extension v2 (`.planning/REQUIREMENTS.md:235-239`) | Do not expose active extension in v1. If expired extension retained, require explicit approval and amend validity history without inventing a second cash receipt; otherwise keep only current catalog's three resolutions |

**R canonical command states:** Purchase→Purchased; ReceiveStock→InStock; SendRepair→InRepair; ReturnRepair→InStock/held; Reserve→AdvancePlaced; Expire→AdvanceExpired; ResolveCancel→InStock/explicit availability decision; ConvertAdvance→Sold; InitiateFinance→FinancePending; RecordDO→DOReceived; FinalizeLease→Sold; ApproveWriteOff→WrittenOff. No general “set Sold” or bulk-status operation. Staff hold is preserved explicitly, not guessed after repair/cancellation.

### 8.5 Late approvals — confirmed sequencing risk

Approval-before-effect is explicit (`docs/02-1-business-requirements-specification.md:413-431,588-605`; `docs/02-2-requirements-specification.md:867-886`). Roadmap enables sales in Phase 3 but generic gates in Phase 4, and mandatory reason enforcement is partly described under Phase 6 (`.planning/ROADMAP.md:114-148,163-174`). Old research likewise sequences approval after sales (`.planning/research/ARCHITECTURE.md:622-634`). That sequencing must not become a temporary production bypass.

**R:** foundations define gate contract and atomic audit/reason handling; sales Phase 3 refuses gated finalization unless valid approval exists (or records pending proposal); Phase 4 adds review UI/notifications, not first enforcement. No handover, refund payment, completed-sale mutation or write-off before approval. Stale proposal captures base revision, asking-price snapshot, financial payload and cycle; reviewer authorization and current obligations rechecked at decision/application. Changed proposal requires new review; approved payload cannot be substituted. Self-approval policy unspecified: recommend separate requester/reviewer for financial gates; explicitly configure any exceptional override with audit rather than assume admin can bypass.

### 8.6 Other necessary best-judgment resolutions

- **Advance denominator:** BRS explicitly uses listed-price-at-placement (`docs/02-1-business-requirements-specification.md:561-573,809`); technical entity/formula says agreed price (`docs/02-2-requirements-specification.md:319-325,744-746`); current catalog does not resolve denominator. **R:** prefer explicit BRS business rule: snapshot listed price as validity basis, agreed price separately, discount approval independent; require positive price basis. “One month” use documented 31-calendar-day assumption, label it assumption not customer-approved calendar arithmetic (`:1173-1178`). Configure single business timezone; clearly show inclusive end-date/exclusive expiry instant.
- **Loan repayment math:** feedback wants either installment or term input but does not authorize an interest formula (`docs/round_1_customer_feedback.md:9-11`). **R:** lookup finance-provided rate cards exactly; return supported choices/no rate when unmatched. Do not silently use mock ±20% nearby principal approximation as financial truth (`app/api/lease-comparison/route.ts:44-65`). Version selected rates and amount/term/charges in quote.
- **Cash facility fee sign:** feedback says loan amount deducting charges/fee (`docs/round_1_customer_feedback.md:29,37`), catalog says minus deductibles “plus facility fee” (`.planning/REQUIREMENTS.md:176`). **R:** net disbursed = gross principal − deductions − facility fee when fee withheld; show gross, each deduction, fee, net and any separately paid fee. Validate nonnegative net. Do not add a customer charge to money handed to customer.
- **Finance composition:** technical spec leaves price-vs-finance total open (`docs/02-2-requirements-specification.md:1150-1155`). **R:** enforce agreed vehicle price = customer consideration + finance principal consideration; fees/commission/cash-facility charges are separate. Actual finance receipt timing/deductions may differ; record settlement/recoverable differences explicitly, not silently change vehicle price.
- **Commission policy:** rate percentage exists, but base/eligibility/partial settlement behavior is unspecified (`.planning/REQUIREMENTS.md:41-42,201-207`). **R:** per-company effective-dated policy with explicit basis and rounding; snapshot expectation. Do not hardcode principal×rate as customer-approved calculation.
- **Integer range:** integer-money requirement does not require a 32-bit DB Int. **R:** use a safe minor-unit range sufficient for vehicle values and lifetime aggregates; validate safe integer conversion and currency precision. Existing `lib/money.ts:11-40,55-63` is two-decimal-specific, not a complete configurable-currency policy.
- **Import identity:** technical import quality mentions missing engine numbers but normal schema requires engine/chassis (`docs/02-2-requirements-specification.md:93-123,1064-1067`). **R:** missing required identity goes to preview errors/quarantine for manual correction; no fabricated IDs, no silent duplicate import. Null optional fields remain accepted. Reuse known vehicle and create proper cycle after reviewed duplicate mapping.
- **Atomic import vs chunking:** BRS requires all-or-nothing (`docs/02-1-business-requirements-specification.md:485-492`); roadmap mentions chunked createMany + full rollback (`.planning/ROADMAP.md:237-239`); old pitfalls suggests chunking to avoid transaction timeout (`.planning/research/PITFALLS.md:218-226`). **R:** bounded batches whose chunks remain inside **one** commit transaction, or staging with one atomic publication; never independently commit chunks under one promised atomic batch. Validate schema/version and recheck conflicts on confirmation; provenance plus file/batch keys makes retries safe.
- **Retention vs deletion:** indefinite retention conflicts with unrestricted destructive CRUD (`docs/02-1-business-requirements-specification.md:533-540`; `lib/mock-store.ts:70-72`). **R:** business-record “delete” means archive/void/correct with audit, not erasing history; retain inactive references and old invoice/evidence versions. Test-reset is isolated test infrastructure, never production cleanup.

## 9. Key invariants for implementation and tests (R, derived from T)

1. One normalized engine+chassis physical identity; identifier corrections are audited and cannot merge two vehicles silently.
2. One open owned purchase cycle per vehicle; brokerage presence alone never creates ownership or purchase cost.
3. Every sale/reservation/repair/cost/write-off belongs to correct cycle; historical queries use stored cycle ID, never current active pointer.
4. At most one unresolved buyer commitment and one completed sale per cycle; expired unresolved advances still block new commitment.
5. Effective sale availability implies InStock, no active repair/commitment, and no staff hold; availability never overrides lifecycle guards.
6. All required state/financial changes, actual payment evidence and audit commit together or not at all; retry produces no second transaction.
7. Settlement purchase cost = institution settlement + cash to seller. Cycle basis = purchase + actual repair costs + additional costs. Profit = full agreed sale consideration − completion basis, independent of cash timing.
8. Monetary amounts are validated nonnegative where appropriate, exact minor units; sums/rates have explicit range/rounding. Advance/down payment positive; refund ≤ received not already refunded (R bound).
9. Historical cash receipt is retained through cancellation/refund/conversion; final balance receipt excludes prior advances; trade-in is not cash; DO is not payment.
10. Required approval covers exact action/payload/revision and is applied at most once; rejection has no business mutation; requester/reviewer/approver evidence retained.
11. Completed sale and handover are one business event with required mileage; lease completion requires real authorized DO evidence and issue date, not user-supplied arbitrary URL.
12. Every purchase/sale edit has a reason from the first real mutation; every mutation has actor/time/before-after; no user can edit/delete audit entries.
13. Last active administrator cannot be removed/deactivated or stripped of protected admin membership; permission changes effective at next protected request, including reviewer actions.
14. Application and Referral are mutually exclusive per deal with path snapshot; only Application requires inspection/checklist/dispatch gates; rejection retained, hidden by default.
15. Commission source is exactly one inventory lease sale or brokerage deal; matching allocations belong to same finance company and cannot double-spend a remittance. Overdue selection uses explicit eligible/sent date and reconciliation cutoff.
16. Import validation/confirmation has zero partial business writes; batch replays do not duplicate entities/cycles/payments; historical bypass cannot evade referential/currency/identity invariants.

Evidence anchors for these invariants: `.planning/REQUIREMENTS.md:24-32,47-58,68-92,109-159,163-215`; `docs/02-1-business-requirements-specification.md:504-551,588-639`; `docs/02-2-requirements-specification.md:1038-1067`.

### Highest-value acceptance scenarios

- Repeat purchase with two independent costs/profits; display first historical invoice unchanged.
- Two buyers reserve/sell same cycle concurrently: one succeeds, other conflicts without receipt or audit residue.
- Expiry job races conversion: one coherent outcome, no orphan reservation or Sold→Expired overwrite.
- Advance +100, cancellation without refund: cash stays +100; partial refund 60 creates −60 at refund date; conversion to price 1000 creates remaining +900 only.
- Trade-in sale 1500/asset 500: cash +1000, sold-vehicle revenue 1500, new acquired basis 500, no fictitious cash outflow.
- Discount pending then listed price/cycle changes: stale approval cannot finalize; two reviewers cannot apply twice.
- Finance DO uploaded but not remitted: sale/handover and outstanding finance settlement separately intelligible.
- Brokerage vehicle never appears as purchased stock; referral bypasses Application-only gates; nine required Application photos enforced.
- Shared remittance allocates to both source types; shortfall explained, duplicates rejected; remaining overdue list obeys OR rule.
- Invalid imported row or new conflicting record after preview: entire confirmed batch fails with no partial business writes.

## 10. Guidance for the eventual ADHD-friendly interactive architecture

This research does not produce the HTML itself. Recommended content structure:

- Default to one short “What exists now” view, with persistent I/T/R legend and toggle between current/target; never mix visually without labels.
- C1 actors → C2 one app + target database/storage → C3 grouped modules → L4 selected entity/command view. Show one level at a time, breadcrumb/back/reset, keyboard-operable controls.
- Offer two primary workflow lanes: **Owned stock → sale** and **Brokerage → commission**. Finance/reconciliation is shared; customer reservation advance and brokerage cash facility visually distinct.
- Progressive disclosure: each selected node has purpose, owned data, commands, invariants, status, exact evidence links; keep long source notes collapsed.
- Focus modes for Purchase cycle, Money movement, Approval, and Brokerage. A repeat-purchase timeline and advance/refund money timeline explain the dangerous cases better than a giant ERD.
- Use plain labels, whitespace, short summaries and redundant icons/text (not color-only), reduced-motion support, readable contrast, search by business term, and no animated background or all-edges-at-once diagram.
- Include unresolved-document-conflict badges with this report's explicit recommendations. Do not present recommendations as signed decisions or current code.

## 11. Research coverage and limitations

Read comprehensively: questionnaire (240 lines), business requirements (through acceptance template), technical requirements (1–1184), round-one customer feedback (1–45), infrastructure document (1–134), `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`; prior domain architecture/features/pitfalls/summary; relevant frontend/table/testing CONTEXT and purchase/design quick-task history; current schemas/store and representative workflow handlers/UI.

No external framework/API claims were researched or changed: this is repository-grounded business/design analysis, not verification of current vendor free-tier limits. The $0/month and 10-second budget are **documented project constraints**, not freshly validated October 2026 platform facts. Do not repeat old research's infrastructure estimates as independently verified guarantees.

The two presentation files under `docs/sharables/` were inventoried, not treated as newer authoritative requirements. No signed acceptance or separate prior-review artifact was established. No application code or pre-existing package changes were modified by this research.
