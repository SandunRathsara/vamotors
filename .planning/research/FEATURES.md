# Feature Research

**Domain:** Vehicle Dealership Management System (used + new car dealer, internal operations)
**Researched:** 2026-03-21
**Confidence:** HIGH (requirements are explicit; industry DMS landscape verified via multiple sources)

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that users assume exist. Missing these = product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Vehicle inventory list with status | Every DMS has this; staff's starting point for any action | LOW | Status badge per vehicle (In Stock, In Repair, etc.) must be visually prominent |
| Vehicle detail page | Central place to see full vehicle history: purchases, repairs, costs, sales, mileage | MEDIUM | Single-vehicle "timeline" view is the mental model users have |
| Quick search across records | Staff look up vehicles by plate, chassis, customer name daily | LOW | Search should span vehicles, customers, suppliers — not siloed per-entity |
| Inline customer/supplier creation | Users hate leaving a sale form to create a customer separately | LOW | Modal or slide-over panel; do not redirect away from current flow |
| Status change reflects in real time | Selling a vehicle, sending to repair — status must update immediately | LOW | No manual refresh required; instant feedback after action |
| PDF invoice generation | Formal document of sale; required for handover | MEDIUM | Must be printable and cover all legal fields per BR-022 |
| Approval request with notification | Manager-level controls exist in every dealership DMS | MEDIUM | Blocked action + in-app alert to approver is the expected pattern |
| Audit trail per record | Needed for financial accountability; expected by any business operator | HIGH | Field-level before/after view, not just "record was edited" |
| Role-based access control | Multi-user dealership; not everyone sees or does everything | MEDIUM | Dynamic CASL-based model exceeds the bare minimum; already designed well |
| Report export (CSV + PDF) | Accountants and managers expect to take data out of any business software | MEDIUM | Per-report export, not global data dump |
| Date-range filtering on reports | Every business report is time-bounded — "show me this month" | LOW | All 7 reports need this; date picker is universal UX |
| Per-vehicle cost breakdown | Dealers need to know if they made or lost money on each car | MEDIUM | Purchase + repairs + additional costs = cost basis; standard in DMS tools like CAMS, Frazer |
| Repair history per vehicle | Mechanics, managers all refer back to what was done previously | LOW | Chronological list; vendor + cost + dates + notes |
| Advance/reservation tracking | Small dealers routinely take deposits; expiry management is critical | MEDIUM | Expiry logic + resolution workflow is specific to this business's rules |
| Mileage history | Audit and valuation; expected by any car-trade business | LOW | Append-only log with date + note |
| Supplier and vendor directories | Reusable records; no one wants to re-enter the same company repeatedly | LOW | Separate from customers; companies with multiple contacts must be supported |
| User management (create, assign roles) | Admin capability expected in any multi-user system | LOW | Admin-only section; includes password management |
| PWA / mobile-responsive interface | Staff use phones and tablets at the lot; not just at desks | MEDIUM | 360px min-width; installable home screen icon |
| In-app notification bell | Approval queues and expiry alerts need surfacing; email/SMS explicitly excluded | LOW | Unread count + panel + link to record |
| One-time historical data import | Replacing paper system; historical data must come in | HIGH | Validation-first, all-or-nothing commit; marked as imported |

---

### Differentiators (Competitive Advantage)

Features that go beyond baseline and align with VA Motors' core value: "every vehicle's complete financial story."

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Single vehicle identity across re-purchases | A vehicle sold and re-bought is the same record, not a duplicate — full lifetime history | HIGH | Engine+chassis as identity key; new purchase links to existing record (BR-038). Most generic DMS tools don't handle this. |
| Tiered advance validity rules | Business-specific logic (0-5%=1wk, 5-10%=2wk, etc.) enforced automatically by the system | LOW | No manual date calculation needed by staff; system enforces it. Differentiating because generic DMS tools require manual management. |
| Two-field vehicle status model | `primaryStatus` + `isAvailableForSale` cleanly separates lifecycle state from sale readiness | MEDIUM | Prevents edge-case bugs (e.g., "In Repair" but visible as available). Sophisticated for a small dealership system. |
| Trade-in linked to new inventory | One-click conversion of a trade-in vehicle into a new inventory record, pre-populated | LOW | Reduces double data entry; avoids errors on traded vehicle details |
| Multi-channel purchase types | Cash, lease settlement, brand-new from supplier — each with unique cost structure | MEDIUM | Lease settlement cost = institution settlement + cash-to-seller. This specificity is rare in generic tools. |
| Multi-channel sale types | Cash immediate, advance/reservation, lease/finance, trade-in — properly modeled | HIGH | Each sale type has different state transitions and financial implications |
| Cost basis auto-update | Any new repair or additional cost instantly recalculates vehicle's cost basis | LOW | No manual refresh or re-entry. Staff trust the number is always current. |
| Approval workflow with audit linkage | Discount/write-off/refund/sale-edit approvals are tied directly to the audit trail | MEDIUM | Every approval decision is permanently recorded with who, when, and why |
| Mandatory edit reasons | Purchase and sale edits require a written reason, captured in the audit trail | LOW | Prevents silent amendments; common in enterprise systems but rare in small DMS |
| Historical data import with per-row validation | Shows which rows fail before committing anything | HIGH | Staff can fix individual rows rather than redo the whole spreadsheet |
| DO document upload for lease finalisation | Mandatory document attachment enforced at the system level, not by convention | LOW | Removes a process gap; finance companies' DO documents are tied directly to the vehicle's sale state |

---

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem valuable but create more problems than they solve in this context.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Email/SMS notifications | "Staff need alerts even when not logged in" | Out of scope and adds external service dependency, cost, deliverability issues, and compliance concerns. Staff can use PWA notification badge. | In-app notification bell with unread count; staff check it on login as part of workflow |
| Automated advance expiry resolution | "The system should auto-cancel expired advances" | Cancellation decision has financial consequences (refund or forfeit) that require human judgment. Auto-cancellation creates disputes and errors. | Flag as expired automatically; require staff to manually pick one of three resolution actions |
| Real-time chat / internal messaging | "Staff want to communicate about vehicles in the system" | Builds a communication product on top of an operations product; scope bloat, maintenance overhead, notification fatigue | Approval workflow notifications cover inter-role communication for decision-driven events |
| Customer purchase history / loyalty view | "Know which customers bought before" | Useful in high-volume retail; in a small dealership, staff know regulars. Adds complexity to customer model with unclear ROI. | Customer record already stores purchase history via linked sales; no separate loyalty module needed |
| Vehicle photo gallery | "Show car images in the system" | R2 storage is 10GB free tier (~2-3K vehicles), photos burn storage fast, upload UX is complex on mobile, and this is an internal ops tool not a showroom | DO document upload (already scoped) covers the only mandatory document attachment. Photos can be deferred to v2. |
| Estimated repair costs / quote tracking | "Track the quote before the repair is done" | Business said they only need the final invoice amount (BR-010). Tracking estimates adds a separate data state that creates confusion when the actual differs. | Record only final invoiced repair cost; note field in repair record handles any context |
| Multi-currency support | "What if we deal in foreign currency sometimes?" | Single-currency system is a stated constraint. Multi-currency requires redesign of all financial calculations, display, and reporting. | Configurable currency via `APP_CURRENCY` env var; all amounts stored as integers in smallest unit |
| Automated market pricing / valuation | "Integrate with a price guide to value trade-ins" | External API dependency, licensing cost, and manual override is always needed anyway for local market conditions | Listed price managed manually; manager judgment sets trade-in value |
| Stock ageing alerts ("this car has been unsold for 60 days") | "Help identify slow-moving inventory" | Nice-to-have at v2; adds alerting complexity and the definition of "too long" is business-specific | RPT-001 (inventory report) with listed price and purchase date covers this via manual review |
| Bulk status updates | "Mark 10 vehicles as available at once" | Status transitions must follow defined rules and may require approval (e.g., write-off). Bulk actions bypass the per-vehicle validation. | Individual status actions enforce integrity; filters in inventory list make it fast to find vehicles needing action |
| Customer-facing portal / online listings | "Put inventory on the website" | Internal system; public-facing is a different product with different security, UX, and SEO concerns | Out of scope; clearly defined boundary in PROJECT.md |

---

## Feature Dependencies

```
Vehicle Purchase (BR-001–BR-007)
    └──enables──> Vehicle Status Lifecycle (BR-013–BR-014)
                     └──enables──> Vehicle Sale (BR-015–BR-021)
                                       └──enables──> Invoice Generation (BR-022)
                                       └──enables──> Per-Vehicle Profit Calculation (BR-035)

Supplier Directory (BR-008)
    └──required-by──> Vehicle Purchase (select supplier at purchase time)

Repair Vendor Directory (BR-009)
    └──required-by──> Repair Management (BR-009–BR-011)
                           └──contributes-to──> Cost Basis (BR-034)

Customer Directory (BR-023)
    └──required-by──> Vehicle Sale (all sale types)
    └──required-by──> Invoice Generation (customer details on invoice)

User + Role Management (BR-024–BR-026)
    └──required-by──> Approval Workflows (BR-027–BR-028)
    └──required-by──> Audit Trail (who made the change)
    └──required-by──> Notifications (who to alert)

Advance/Reservation System (BR-016–BR-017)
    └──depends-on──> Vehicle Status Lifecycle (Advance Placed state)
    └──depends-on──> Customer Directory (who placed the advance)
    └──triggers──> Approval Workflow (refund path)

Lease/Finance Sale (BR-018–BR-019)
    └──depends-on──> Vehicle Status Lifecycle (Finance Pending → DO Received → Sold)
    └──requires──> Document Upload (DO file, via Cloudflare R2)

Trade-In Sale (BR-020–BR-021)
    └──depends-on──> Vehicle Sale system
    └──optionally-creates──> New Vehicle Purchase record

Cost Basis Calculation (BR-034)
    └──aggregates──> Purchase Price + Repair Costs (BR-009–BR-011) + Additional Costs (BR-007)
    └──feeds-into──> Gross Profit Calculation (BR-035)
    └──feeds-into──> Reports (RPT-002, RPT-003, RPT-006)

Audit Trail (BR-029)
    └──depends-on──> User Management (who field)
    └──cross-cuts──> All entities (vehicles, sales, purchases, customers, repairs)

Notifications (BR-030–BR-031)
    └──depends-on──> Approval Workflows (approval request events)
    └──depends-on──> Advance System (expiry events)

Reports (RPT-001–RPT-007)
    └──depend-on──> Vehicle data, sale data, cost basis, repair data, advance data
    └──require──> Date-range filtering
    └──require──> CSV + PDF export capability

Historical Data Import (BR-032–BR-033)
    └──depends-on──> All primary entity schemas being finalised first
    └──note──> Must be done after schema is stable; cannot precede entity definitions
```

### Dependency Notes

- **Vehicle Purchase must precede Vehicle Sale:** A vehicle must exist in inventory before it can be sold. No vehicle = no sale.
- **User management must precede approval workflows:** Approvals require knowing who holds which role. Role configuration must happen before any approval-gated action.
- **Cost basis depends on all cost sources:** Adding a repair or additional cost must auto-update cost basis. These three systems must be built cohesively, not independently.
- **Audit trail is a cross-cutting concern:** It cannot be added as an afterthought. It must be baked into every entity's create/update/delete path from the start.
- **Historical import depends on stable schemas:** The import templates reference entity fields. If schemas change after templates are built, import breaks. Build import last.
- **Document upload (R2) is required by lease sale:** The DO document step (BR-019) is a hard blocker for completing a lease sale. R2 integration must be ready before lease sales are built.

---

## MVP Definition

### Launch With (v1)

Minimum viable product for VA Motors to go live and retire physical documents.

- [x] Vehicle purchase recording (all 3 channels: cash, lease settlement, brand-new)
- [x] Vehicle status lifecycle (10-state machine + availability flag)
- [x] Repair management with vendor directory and cost recording
- [x] Additional costs and cost basis auto-calculation
- [x] Vehicle sale recording (all 4 types: cash, advance/reservation, lease/finance, trade-in)
- [x] Advance expiry logic with tiered validity rules
- [x] Customer directory with inline creation during sale
- [x] Supplier directory with company + contacts support
- [x] Invoice PDF generation (BR-022)
- [x] User management + dynamic role/permission configuration (CASL)
- [x] Manager approval workflows (discount, write-off, refund, sale edit)
- [x] Audit trail — field-level, append-only, covers all entities
- [x] In-app notifications (expiry alerts, approval events)
- [x] Seven standard reports with date filtering + CSV/PDF export
- [x] Per-vehicle profit calculation
- [x] Business cash flow view
- [x] Historical data import (one-time, validation-first)
- [x] PWA capabilities (installable, 360px–1920px responsive)
- [x] Mileage history tracking

### Add After Validation (v1.x)

- [ ] Vehicle photo gallery — add once storage budget is confirmed; deferred because it's internal ops only
- [ ] Stock ageing alerts — once staff signal they want automated "slow-moving" flags vs. using the inventory report manually
- [ ] Email/SMS notification channel — if staff report they miss in-app notifications when away from the system

### Future Consideration (v2+)

- [ ] Multi-branch support — only if VA Motors expands locations
- [ ] Third-party integrations (bank, registry) — if regulatory or workflow pressure justifies it
- [ ] Customer-facing portal / online listings — entirely separate product surface
- [ ] Market price feeds / automated valuation — if trade-in disputes arise frequently

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Vehicle purchase (all channels) | HIGH | MEDIUM | P1 |
| Vehicle status lifecycle | HIGH | MEDIUM | P1 |
| Vehicle sale (all types) | HIGH | HIGH | P1 |
| Cost basis + profit calculation | HIGH | MEDIUM | P1 |
| Invoice PDF | HIGH | MEDIUM | P1 |
| Audit trail | HIGH | HIGH | P1 |
| Role-based access + CASL | HIGH | HIGH | P1 |
| Approval workflows | HIGH | MEDIUM | P1 |
| Repair management | HIGH | MEDIUM | P1 |
| Customer + supplier directories | HIGH | LOW | P1 |
| In-app notifications | MEDIUM | MEDIUM | P1 |
| Reports (7 standard) | HIGH | MEDIUM | P1 |
| Historical data import | HIGH | HIGH | P1 |
| PWA + responsive design | MEDIUM | MEDIUM | P1 |
| Mileage history | LOW | LOW | P1 |
| Advance system + expiry rules | HIGH | MEDIUM | P1 |
| Trade-in linked to new inventory | MEDIUM | LOW | P2 |
| Vehicle photo gallery | LOW | MEDIUM | P3 |
| Stock ageing alerts | LOW | LOW | P3 |
| Email/SMS notifications | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch (all 38 BRs map to P1)
- P2: Should have (BR-021 trade-in to inventory is "Should Have" in the spec)
- P3: Nice to have, future consideration

---

## Gaps Analysis: What the Requirements May Have Missed

Cross-referencing the 38 business requirements against standard DMS feature sets reveals the following potential gaps:

### Addressed Well (No Gap)
- Vehicle lifecycle management — very thoroughly specified (BR-013, BR-014, BRL-010)
- Financial tracking — cost basis, profit, cash flow all explicitly covered
- Audit trail — field-level, tamper-proof, append-only is thorough (BR-029, NFR-006)
- Approval workflows — four distinct approval gates are clearly defined
- Sale types — all four channels are covered including edge cases

### Minor Gaps Worth Noting

| Potential Gap | Assessment | Recommendation |
|---------------|------------|----------------|
| **Vehicle search / filter on inventory list** | RPT-001 covers filters but no explicit search bar requirement exists for the main inventory screen | Add a search-by-plate/chassis/make/model input to the inventory list; this is implicit but should be explicit in implementation |
| **Advance "extend" workflow** | BR-017 says extending an expired advance requires manager approval, but the flow for a still-active advance extension isn't specified | Treat as covered by the general approval rule; confirm with client before implementation |
| **Password reset / forgot password** | NFR-007 requires authentication; no self-service reset flow is specified | Admin-only password reset is the simplest safe default given credentials-based auth with no email |
| **Session management / logout** | Not explicitly specified | Standard session timeout + explicit logout should be implemented; mention in non-functional requirements |
| **Repair vendor deduplication** | Vendor directory exists but no matching logic specified | Basic name-match warning on create is sufficient; avoid silent duplicates |
| **Currency display format** | `APP_CURRENCY` env var covers symbol; format (decimal places, thousand separators) not specified | Default to locale-standard formatting; store as integers as planned |
| **Vehicle listing/available-for-sale count on dashboard** | No home/dashboard screen is specified | A simple dashboard showing key counts (vehicles in stock, in repair, pending advances, pending approvals) is expected by users but not required. Consider as implicit. |

### Explicitly Out of Scope (Confirmed Correct)
- Tax/VAT calculation — correct for current business context
- Bank/registry integrations — correct; adds complexity with no current need
- Customer-facing portal — correct; entirely different product
- Multi-currency — correct; single-currency is sufficient

---

## Competitor Feature Analysis

| Feature | Frazer DMS (used car focused) | DealerCenter | MotorDesk | VA Motors VSMS Approach |
|---------|-------------------------------|--------------|-----------|------------------------|
| Inventory tracking | Yes | Yes | Yes | Yes — with 10-state lifecycle |
| Per-vehicle profit tracking | Yes (basic) | Yes | Yes | Yes — with full cost breakdown |
| Repair cost tracking | Yes | Partial | Yes | Yes — with vendor directory |
| PDF invoice | Yes | Yes | Yes | Yes — custom format per BR-022 |
| Audit trail | Basic | Basic | No | Full field-level, tamper-proof |
| Approval workflows | No | No | No | Yes — 4 approval gates |
| Advance/reservation system | Basic deposit | Basic | No | Full tiered-validity system |
| Dynamic role/permission config | No (fixed roles) | Limited | No | Yes — CASL-based, runtime configurable |
| Multi-purchase-channel | Partial | Partial | Partial | Yes — 3 channels with distinct logic |
| Historical import | CSV only | No | No | Yes — validation-first, atomic per batch |
| Trade-in linked to inventory | Partial | Partial | No | Yes — one-click creation from sale |
| Vehicle identity across re-purchases | No | No | No | Yes — lifetime identity by engine+chassis |

VA Motors' system differentiates primarily on: audit rigor, approval workflows, dynamic permissions, and vehicle lifetime identity. These are enterprise-grade capabilities in a small-dealership form factor.

---

## Sources

- [2026 Dealer Management Software Buyer's Guide — DealerClick](https://dealerclick.com/blog/dealer-management-software-buyers-guide-2026)
- [Next-Gen DMS: 5 Pillars for High-Growth Dealerships — Excellon](https://www.excellonsoft.com/blog/next-gen-dms-pillars-high-growth-dealerships/)
- [Pros and Cons of Dealer Management Systems — WFS360](https://wfs360.com/blog/the-pros-cons-of-dealer-management-systems-what-todays-dealerships-need-to-know/)
- [Used Car Dealership Software — MotorDesk](https://motordesk.com/)
- [Frazer DMS](https://www.frazer.com/)
- [DealerCenter — Dealer Management System](https://www.dealercenter.com/)
- [Used Car Dealership Software: What the Best Dealers Know — Carketa](https://carketa.com/carketa-com-blog-used-car-dealership-software/)
- [Best Auto Dealer Software with Inventory Tracking 2026 — GetApp](https://www.getapp.com/retail-consumer-services-software/auto-dealers/f/inventory-tracking/)
- [DMS Overview — Dealertrack](https://us.dealertrack.com/content/dealertrack/en/dealer-management-solutions.html)
- [10 Things to Consider When Evaluating a DMS — Lightspeed](https://www.lightspeeddms.com/10-things-to-consider-when-evaluating-a-dealer-management-solution-dms-blog/)

---
*Feature research for: Vehicle Dealership Management System (VSMS) — VA Motors*
*Researched: 2026-03-21*
