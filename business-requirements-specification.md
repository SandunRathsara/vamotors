# Business Requirements Specification
# Vehicle Sale Management System (VSMS)

---

| Field | Details |
|---|---|
| Document Title | Business Requirements Specification — Vehicle Sale Management System |
| Version | 1.0 |
| Date | 2026-03-07 |
| Status | Pending Client Sign-Off |
| Prepared By | Development Team |
| Prepared For | VA Motors |
| Document Purpose | To formally document the agreed business requirements for the Vehicle Sale Management System and obtain client authorisation to proceed with design and development. |

---

## Table of Contents

1. Project Overview
2. Scope Statement
3. Business Requirements
4. Business Rules
5. User Roles and Access
6. Reporting Requirements
7. Non-Functional Requirements
8. Assumptions and Constraints
9. Out of Scope
10. Acceptance and Sign-Off

---

## 1. Project Overview

### 1.1 Background

The client operates a vehicle dealership dealing in both secondhand and brand-new vehicles. Currently, business operations — including vehicle purchases, sales, repairs, and financial tracking — are managed through physical documents and manual processes. This creates challenges in tracking profitability per vehicle, managing customer records, maintaining repair histories, and producing timely business reports.

### 1.2 Project Objective

The objective of this project is to deliver a Vehicle Sale Management System (VSMS): a centralised, web-based software system that digitises and manages the full lifecycle of vehicle transactions — from purchase through to sale — while providing financial visibility, operational controls, and historical record-keeping.

### 1.3 Key Business Goals

- Eliminate reliance on physical documents for day-to-day operations.
- Maintain a complete and auditable history of every vehicle, transaction, and business decision.
- Provide real-time visibility into vehicle inventory, repair status, and business profitability.
- Enforce approval controls to protect against unauthorised discounts, write-offs, and financial adjustments.
- Enable staff across roles to work from any device — desktop, tablet, or mobile — through a single web-based platform.

### 1.4 System Summary

The VSMS will be a responsive web application accessible from any modern web browser on any device. It will be installable on mobile and tablet devices for a native-app-like experience without requiring a separate mobile application to be built or distributed. All data will be stored centrally and accessed securely based on each user's assigned role and permissions.

---

## 2. Scope Statement

### 2.1 In Scope

The following capabilities are included in the initial delivery of the VSMS:

- Vehicle purchase recording across three purchase channels (cash, lease settlement, and brand-new from supplier)
- Supplier management for individuals and companies
- Vehicle repair management with vendor tracking and cost recording
- Vehicle write-off and disposal workflow with manager approval
- Vehicle status and availability management throughout the vehicle lifecycle
- Vehicle sale recording across four sale types (cash buy-now, cash with advance/reservation, lease/finance, and trade-in)
- Customer management
- Invoice generation as a printable PDF document
- User management with dynamic, configurable roles and permissions
- Manager approval workflows for discounts, write-offs, advance refunds, and sale record edits
- Full audit trail of all system activity with field-level change history
- In-app notification system
- Seven standard business reports with date range filtering and export to CSV and PDF
- Per-vehicle financial tracking (cost basis and profit calculation)
- One-time historical data import from structured spreadsheets
- Indefinite data retention

### 2.2 Out of Scope

The following items are explicitly excluded from the initial delivery and will not be built:

- Native iOS or Android mobile applications
- SMS, email, or push notification services
- Integration with any third-party system (banks, finance companies, government registries, accounting software, etc.)
- Tax calculation or regulatory compliance reporting
- Multi-currency support
- Multi-branch or multi-company support
- Customer-facing portal or online vehicle listings
- Vehicle valuation tools or market price feeds
- Document scanning or OCR (optical character recognition) for data import

---

## 3. Business Requirements

Requirements are categorised by priority:
- **Must Have** — Core to the system; delivery is not acceptable without these.
- **Should Have** — Important; significant business impact if excluded.
- **Nice to Have** — Beneficial but acceptable to defer if required.

---

### Category: Vehicle Purchase

**BR-001**
| Field | Detail |
|---|---|
| ID | BR-001 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | The system must allow staff to record the purchase of a secondhand vehicle bought for cash. The record must capture the vehicle details, supplier information, the total purchase amount paid, and the date of purchase. |
| Acceptance Criteria | A staff member can open a new purchase record, select "Cash Purchase" as the purchase type, enter all required vehicle and supplier details, enter the purchase amount, save the record, and view it in the vehicle list. The vehicle appears in inventory with status "In Stock." |

---

**BR-002**
| Field | Detail |
|---|---|
| ID | BR-002 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | The system must allow staff to record the purchase of a secondhand vehicle through a lease settlement. The record must capture the lending institution name (bank, finance company, or private party), a settlement reference number, the settlement amount paid to the institution, and the cash amount paid directly to the seller. The total purchase cost must be displayed as the sum of these two amounts. |
| Acceptance Criteria | A staff member can select "Lease Settlement Purchase," enter institution details, settlement reference, settlement amount, and cash-to-seller amount. The system calculates and displays the total purchase cost as settlement amount plus cash-to-seller. The record saves successfully and the vehicle appears in inventory. |

---

**BR-003**
| Field | Detail |
|---|---|
| ID | BR-003 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | The system must allow staff to record the purchase of a brand-new vehicle from a company supplier at the full purchase price. A registration number is not required at the time of purchase and can be added to the vehicle record at a later date. The absence of a registration number must not prevent the vehicle from being listed or sold. |
| Acceptance Criteria | A staff member can create a new vehicle purchase record for a brand-new vehicle without entering a registration number. The record saves successfully. The vehicle can subsequently be offered for sale without a registration number. A registration number can be added to the vehicle record via an edit at any later point. |

---

**BR-004**
| Field | Detail |
|---|---|
| ID | BR-004 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | The system must record the following details for every vehicle: make, model, year of manufacture, colour, engine number, chassis number, registration number (where available), mileage at purchase, fuel type, and transmission type. |
| Acceptance Criteria | All listed fields are present on the vehicle purchase form. Engine number and chassis number are required fields. Registration number is optional. A vehicle record cannot be saved without the required fields. |

---

**BR-005**
| Field | Detail |
|---|---|
| ID | BR-005 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | The system must maintain a mileage history for each vehicle. Every mileage update must record the new mileage reading, the date of the update, and an optional remark (e.g., "Mileage at repair intake" or "Mileage at handover"). |
| Acceptance Criteria | A vehicle record displays a mileage history section showing all past readings in chronological order with dates and remarks. Adding a new mileage reading appends to the history without overwriting previous entries. |

---

**BR-006**
| Field | Detail |
|---|---|
| ID | BR-006 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | Each vehicle must have an editable listed price — the price at which the vehicle is displayed and offered for sale. This listed price is separate from the vehicle's cost basis and can be updated by authorised staff at any time. |
| Acceptance Criteria | An authorised staff member can set and update the listed price of any vehicle. The listed price is visible on the vehicle record. Changes to the listed price are captured in the audit trail. |

---

**BR-007**
| Field | Detail |
|---|---|
| ID | BR-007 |
| Category | Vehicle Purchase |
| Priority | Must Have |
| Requirement | The system must allow tracking of additional costs associated with a vehicle beyond the purchase price. These costs may include, but are not limited to, transport, inspection, and taxes. Each cost entry must record a description, amount, and date. All additional costs must be automatically included in the vehicle's total cost basis for profit calculation purposes. |
| Acceptance Criteria | Staff can add one or more additional cost entries to any vehicle record. Each entry requires a description and an amount. The vehicle's total cost basis displayed in the system equals the purchase price plus the sum of all additional costs plus all repair costs. |

---

**BR-008**
| Field | Detail |
|---|---|
| ID | BR-008 |
| Category | Supplier Management |
| Priority | Must Have |
| Requirement | The system must maintain a supplier directory covering both individual sellers and company suppliers. Company suppliers must support the recording of multiple contact persons under a single company record. Staff must be able to select from existing suppliers when recording a purchase, or create a new supplier record during the purchase process. |
| Acceptance Criteria | The supplier directory lists all suppliers. An individual supplier record stores name and contact details. A company supplier record stores the company name, and allows one or more contacts to be added with names and contact details. When recording a purchase, staff can search and select an existing supplier. |

---

### Category: Vehicle Repair Management

**BR-009**
| Field | Detail |
|---|---|
| ID | BR-009 |
| Category | Repair Management |
| Priority | Must Have |
| Requirement | The system must allow staff to send a vehicle to a repair vendor and record this action. The system must maintain a directory of repair vendors with their contact details. When a vehicle is sent for repair, its status must automatically update to reflect this. |
| Acceptance Criteria | Staff can select a vehicle and initiate a "Send for Repair" action by selecting a vendor from the vendor directory and recording the date sent. The vehicle status changes to "Sent for Repair." The vendor directory can be maintained (add, edit vendors) by authorised staff. |

---

**BR-010**
| Field | Detail |
|---|---|
| ID | BR-010 |
| Category | Repair Management |
| Priority | Must Have |
| Requirement | When a vehicle is returned from repair, staff must record the actual repair invoice amount. The system does not require estimates or quotes — only the final invoiced amount. The repair record must include the vendor, the date sent, the date returned, and the final cost. |
| Acceptance Criteria | Staff can mark a vehicle as returned from repair and enter the final invoice amount. The repair record is saved with vendor details, date sent, date returned, and cost. The repair cost is automatically added to the vehicle's total cost basis. |

---

**BR-011**
| Field | Detail |
|---|---|
| ID | BR-011 |
| Category | Repair Management |
| Priority | Must Have |
| Requirement | Each vehicle must maintain a complete repair history, showing all past repair events in chronological order including the vendor, dates, and costs. |
| Acceptance Criteria | The vehicle detail view includes a repair history section listing all repair records for that vehicle. Each entry shows the vendor name, date sent, date returned, and invoice amount. |

---

**BR-012**
| Field | Detail |
|---|---|
| ID | BR-012 |
| Category | Repair Management |
| Priority | Must Have |
| Requirement | If a vehicle is determined to be unfit for sale, an authorised staff member must be able to initiate a write-off and disposal workflow. This workflow requires manager approval before the vehicle is marked as written off. Upon completion, the disposal proceeds received (if any) must be recorded against the vehicle. |
| Acceptance Criteria | A staff member can submit a write-off request for a vehicle with a mandatory reason. A manager receives a notification and can approve or reject the request. Upon approval, the vehicle status changes to "Written Off." The disposal proceeds amount (which may be zero) is recorded. Upon rejection, the vehicle returns to its previous status. |

---

### Category: Vehicle Status and Availability

**BR-013**
| Field | Detail |
|---|---|
| ID | BR-013 |
| Category | Vehicle Status |
| Priority | Must Have |
| Requirement | Every vehicle in the system must have a clearly defined status that reflects its current position in the business lifecycle. The defined statuses are: Purchased, In Stock, Sent for Repair, In Repair, Advance Placed, Advance Expired, Finance Pending, Delivery Order Received, Sold, and Written Off. |
| Acceptance Criteria | Every vehicle record displays its current status prominently. The status is updated automatically when relevant actions are taken (e.g., sending for repair, recording an advance, finalising a sale). Staff cannot manually set a status to a state that does not reflect an actual recorded transaction. |

---

**BR-014**
| Field | Detail |
|---|---|
| ID | BR-014 |
| Category | Vehicle Status |
| Priority | Must Have |
| Requirement | In addition to its lifecycle status, each in-stock vehicle must have a separate availability flag indicating whether it is currently available for sale to customers. Staff must be able to mark a vehicle as "Not Available for Sale" and record a reason (for example, "Not yet in showroom" or "Out for inspection"). Vehicles in repair, under an active advance, or in the finance process must be automatically flagged as unavailable. |
| Acceptance Criteria | In-stock vehicles display an availability indicator. An authorised staff member can toggle a vehicle's availability and must enter a reason when marking it as unavailable. Vehicles with status "Sent for Repair," "In Repair," "Advance Placed," "Finance Pending," or "Delivery Order Received" are automatically shown as unavailable and this cannot be manually overridden to "available" while in those states. |

---

### Category: Vehicle Sale — Cash (Immediate)

**BR-015**
| Field | Detail |
|---|---|
| ID | BR-015 |
| Category | Vehicle Sale |
| Priority | Must Have |
| Requirement | The system must allow staff to record a completed cash sale where the customer pays the full sale amount immediately, whether by physical cash or bank transfer. The record must capture the customer details, the agreed sale price, the payment method, the date of sale, and the vehicle's mileage at the time of handover. |
| Acceptance Criteria | Staff can create a sale record of type "Cash — Immediate," select or create a customer, enter the sale price, select cash or bank transfer as the payment method, enter the sale date and handover mileage. The vehicle status changes to "Sold" upon saving. The record is retrievable and an invoice can be generated from it. |

---

### Category: Vehicle Sale — Cash with Advance/Reservation

**BR-016**
| Field | Detail |
|---|---|
| ID | BR-016 |
| Category | Vehicle Sale |
| Priority | Must Have |
| Requirement | The system must allow staff to record an advance (reservation) payment from a customer who wishes to reserve a vehicle before full payment. The advance amount and payment method (cash or bank transfer) must be recorded. The system must automatically calculate the reservation validity period based on the advance percentage of the listed price, in accordance with the defined business rules (see Section 4 — Business Rules). |
| Acceptance Criteria | Staff can create an advance record for a vehicle, enter the advance amount, and select the payment method. The system calculates the advance percentage and displays the expiry date. The vehicle status changes to "Advance Placed." The advance expiry date is visible on the vehicle and advance records. |

---

**BR-017**
| Field | Detail |
|---|---|
| ID | BR-017 |
| Category | Vehicle Sale |
| Priority | Must Have |
| Requirement | When an advance reservation expires, the system must automatically flag it as expired. Staff must then manually decide one of three outcomes: (a) convert to a completed sale, (b) cancel the reservation with a refund, or (c) cancel the reservation without a refund. Extending an expired advance requires manager approval. If a refund is issued, the refund amount must be recorded. |
| Acceptance Criteria | Expired advances appear in a clearly flagged state. Staff can select a resolution action. Selecting "Cancel with Refund" requires manager approval and prompts for a refund amount to be recorded. Selecting "Cancel without Refund" cancels the reservation and returns the vehicle to available inventory. Converting to sale triggers the standard sale completion flow. |

---

### Category: Vehicle Sale — Lease/Finance

**BR-018**
| Field | Detail |
|---|---|
| ID | BR-018 |
| Category | Vehicle Sale |
| Priority | Must Have |
| Requirement | The system must support recording a vehicle sale where the customer finances the purchase through a third-party finance company. The record must capture the customer's down payment amount, the name of the finance company, the finance amount, and the finance term. A down payment is always required for lease sales. |
| Acceptance Criteria | Staff can create a sale record of type "Lease/Finance," enter the customer's down payment, and enter the finance company name, finance amount, and term. The vehicle status changes to "Finance Pending." |

---

**BR-019**
| Field | Detail |
|---|---|
| ID | BR-019 |
| Category | Vehicle Sale |
| Priority | Must Have |
| Requirement | When a Delivery Order (DO) is received from the finance company, staff must be able to record this event against the sale. Recording a DO requires uploading a copy of the DO document and entering the DO issue date. Upon DO confirmation, the sale is finalised and the vehicle handover is recorded simultaneously. |
| Acceptance Criteria | An authorised staff member can update a "Finance Pending" sale to "Delivery Order Received" by uploading a document file and entering the DO issue date. Saving this update changes the vehicle status to "Delivery Order Received." Finalising the sale changes the vehicle status to "Sold." The uploaded DO document is accessible from the sale record. |

---

### Category: Vehicle Sale — Trade-In

**BR-020**
| Field | Detail |
|---|---|
| ID | BR-020 |
| Category | Vehicle Sale |
| Priority | Must Have |
| Requirement | The system must support recording a sale where a customer offers an existing vehicle as part-payment (trade-in). The agreed trade-in value must be recorded. The total sale price must be broken down as: trade-in value plus the remaining balance paid by the customer in cash or bank transfer. |
| Acceptance Criteria | Staff can create a sale record with a trade-in component, enter the trade-in vehicle details, and enter the agreed trade-in value. The system calculates and displays the cash balance due from the customer (sale price minus trade-in value). The sale record clearly shows the full payment breakdown. |

---

**BR-021**
| Field | Detail |
|---|---|
| ID | BR-021 |
| Category | Vehicle Sale |
| Priority | Should Have |
| Requirement | When a traded-in vehicle is intended to be resold by the dealership, staff must be able to create a new vehicle purchase record for the traded-in vehicle directly from the trade-in sale record. |
| Acceptance Criteria | From a completed trade-in sale, staff have the option to "Add traded-in vehicle to inventory." Selecting this option opens a new vehicle purchase form pre-populated with the trade-in vehicle details where available. Saving creates a new vehicle record in inventory. |

---

### Category: Invoice

**BR-022**
| Field | Detail |
|---|---|
| ID | BR-022 |
| Category | Invoice |
| Priority | Must Have |
| Requirement | The system must generate a printable invoice in PDF format for every completed vehicle sale. The invoice must contain all information required to serve as a formal document of sale between the dealership and the customer. |
| Acceptance Criteria | A PDF invoice can be generated from any completed sale record. The invoice contains: full names, NIC or passport numbers, and addresses for both seller (dealership) and buyer; vehicle make, model, year, chassis number, engine number, registration number, and mileage; total sale price, payment method, and date of sale; a declaration of legal ownership and encumbrance-free status with transfer of liability to the buyer; and signature lines for both parties. The PDF is formatted for standard paper sizes and is suitable for printing. |

---

### Category: Customer Management

**BR-023**
| Field | Detail |
|---|---|
| ID | BR-023 |
| Category | Customer Management |
| Priority | Must Have |
| Requirement | The system must maintain a customer directory. Each customer record must store the customer's full name, calling name, NIC or passport number, address, and phone number. Email address and driving licence number are optional fields. Staff must be able to search for and select existing customers when recording a sale, or create a new customer record during the sale process. |
| Acceptance Criteria | The customer directory is searchable by name, NIC/passport number, or phone number. All required fields are enforced when creating a customer record. Optional fields can be left blank. A customer record can be created without leaving the sale entry flow. Customer records can be edited by authorised staff, with changes recorded in the audit trail. |

---

### Category: User Management

**BR-024**
| Field | Detail |
|---|---|
| ID | BR-024 |
| Category | User Management |
| Priority | Must Have |
| Requirement | The system must support multiple user accounts, each with login credentials. Each user can be assigned one or more roles. Roles define what actions a user is permitted to take within the system. |
| Acceptance Criteria | An administrator can create user accounts, assign usernames and passwords, and assign one or more roles to each user. A user with multiple roles inherits the combined permissions of all assigned roles. Removing a role from a user immediately removes those permissions. |

---

**BR-025**
| Field | Detail |
|---|---|
| ID | BR-025 |
| Category | User Management |
| Priority | Must Have |
| Requirement | Roles and permissions must be configurable after the system is deployed — they must not be fixed or hardcoded. An administrator must be able to create custom roles and assign specific permissions to them (e.g., ability to create a sale, view a purchase record, approve a write-off). Permissions can be granted or revoked per role without requiring any changes to the system software. |
| Acceptance Criteria | The administrator interface includes a role management section where roles can be created, named, and have permissions assigned. Changes to role permissions take effect immediately for all users holding that role. No software deployment or code change is required to modify roles or permissions. |

---

**BR-026**
| Field | Detail |
|---|---|
| ID | BR-026 |
| Category | User Management |
| Priority | Must Have |
| Requirement | The system must include a built-in Administrator role that cannot be deleted. The last remaining active administrator account must not be able to be deactivated or deleted, ensuring the system always has at least one active administrator. |
| Acceptance Criteria | Attempting to delete the Administrator role produces an error and the action is blocked. Attempting to deactivate or delete the last active administrator account produces an error and the action is blocked. There must always be at least one active administrator in the system. |

---

### Category: Approval Workflows

**BR-027**
| Field | Detail |
|---|---|
| ID | BR-027 |
| Category | Approval Workflows |
| Priority | Must Have |
| Requirement | Selling a vehicle below its listed price (applying a discount) must require approval from a user with manager-level authority before the sale can be finalised. Staff initiating the sale must be able to submit a discount request with a stated reason. |
| Acceptance Criteria | When a staff member enters a sale price below the vehicle's listed price, the system requires a reason and submits the sale for manager approval. The vehicle cannot be marked as sold until approval is granted. The approving manager and timestamp are recorded on the sale record. Rejecting the discount returns the sale to draft status for amendment. |

---

**BR-028**
| Field | Detail |
|---|---|
| ID | BR-028 |
| Category | Approval Workflows |
| Priority | Must Have |
| Requirement | Editing any completed purchase or sale record must require a mandatory written reason for the change. This reason is recorded in the audit trail alongside the field-level changes made. Editing a completed sale additionally requires manager approval. |
| Acceptance Criteria | When an authorised user edits a purchase record, they must enter a reason before saving. The reason appears in the audit trail. When an authorised user initiates an edit of a completed sale record, the edit is submitted for manager approval. The sale record is not updated until approval is granted. |

---

### Category: Audit Trail

**BR-029**
| Field | Detail |
|---|---|
| ID | BR-029 |
| Category | Audit Trail |
| Priority | Must Have |
| Requirement | The system must maintain a complete, tamper-proof audit trail of all activity. Every time a record is created, modified, or deleted — and every time a status changes — the system must log the action, the user who performed it, the date and time, and the specific fields that changed (showing the value before and after). |
| Acceptance Criteria | An audit log exists for every entity in the system. Authorised users can view the audit history of any record. Each log entry shows: action type (created/updated/deleted/status changed), user, timestamp, and for updates, the previous and new values of each changed field. Audit log entries cannot be edited or deleted by any user including administrators. |

---

### Category: Notifications

**BR-030**
| Field | Detail |
|---|---|
| ID | BR-030 |
| Category | Notifications |
| Priority | Must Have |
| Requirement | The system must include an in-application notification centre accessible to all users. Notifications must be delivered within the system only — no SMS, email, or push notifications are required. Each notification must link directly to the relevant record (vehicle, sale, customer, etc.) so the user can navigate to it immediately. |
| Acceptance Criteria | A notification bell icon is visible in the main navigation for all logged-in users. The icon displays a count of unread notifications. Clicking the icon opens a notification panel. Each notification displays a short message, a timestamp, and a link to the relevant record. Notifications can be marked as read individually or all at once. |

---

**BR-031**
| Field | Detail |
|---|---|
| ID | BR-031 |
| Category | Notifications |
| Priority | Must Have |
| Requirement | The system must automatically generate notifications for the following business events: an advance reservation is approaching its expiry date; an advance reservation has expired; a vehicle has been returned from repair; an approval request (discount, write-off, refund, sale edit) has been submitted and is awaiting a manager's decision; an approval request has been approved or rejected. |
| Acceptance Criteria | Each of the listed events triggers a notification to the relevant user(s). Advance expiry warnings are sent with sufficient notice for staff to act. Notifications for approval requests are directed to users with approval authority. Approval outcome notifications are sent to the user who submitted the request. |

---

### Category: Data Import

**BR-032**
| Field | Detail |
|---|---|
| ID | BR-032 |
| Category | Data Import |
| Priority | Must Have |
| Requirement | The system must provide a one-time data import facility to allow historical records currently held in physical documents to be migrated into the system. The import must accept structured spreadsheet files and must support importing all primary record types: suppliers, customers, repair vendors, vehicles, vehicle sales, repair records, and advance records. |
| Acceptance Criteria | An administrator can upload a structured spreadsheet file for each record type. The system validates the uploaded data and produces a report identifying any rows that contain errors, specifying the error for each row, before any data is committed to the system. The administrator must confirm the import after reviewing the validation report. |

---

**BR-033**
| Field | Detail |
|---|---|
| ID | BR-033 |
| Category | Data Import |
| Priority | Must Have |
| Requirement | The data import process must be all-or-nothing for each batch. If any record in a batch fails validation, none of the records in that batch are imported. All successfully imported historical records must be clearly marked within the system as imported data, distinguishable from records created directly in the system. |
| Acceptance Criteria | Uploading a file with one or more validation errors results in zero records being saved. Only a file that passes full validation is committed. Imported records display a visible indicator (e.g., "Imported Record") within the system. The import process can be performed independently for each record type. |

---

### Category: Financial Tracking

**BR-034**
| Field | Detail |
|---|---|
| ID | BR-034 |
| Category | Financial Tracking |
| Priority | Must Have |
| Requirement | The system must calculate and display the total cost basis for every vehicle. The total cost basis is the sum of: the purchase price (as recorded under the applicable purchase channel), all repair costs, and all additional costs recorded against the vehicle. This figure must update automatically whenever a new cost is added. |
| Acceptance Criteria | Each vehicle record displays a financial summary showing: purchase price, total repair costs, total additional costs, and the overall cost basis (sum of all three). Adding a new repair or additional cost record automatically updates the cost basis without requiring manual recalculation. |

---

**BR-035**
| Field | Detail |
|---|---|
| ID | BR-035 |
| Category | Financial Tracking |
| Priority | Must Have |
| Requirement | For every sold vehicle, the system must calculate and display the gross profit or loss. Gross profit is the difference between the final sale price and the vehicle's total cost basis at the time of sale. |
| Acceptance Criteria | Each completed sale record displays the gross profit or loss figure. If the sale price exceeds the cost basis, a profit is shown. If the cost basis exceeds the sale price, a loss is shown. The calculation is traceable to the individual cost components. |

---

**BR-036**
| Field | Detail |
|---|---|
| ID | BR-036 |
| Category | Financial Tracking |
| Priority | Should Have |
| Requirement | The system must provide an overall business cash position view, summarising money received by the business (from sales and advance payments) against money paid out (for vehicle purchases, repairs, additional costs, and refunds) within any selected date range. |
| Acceptance Criteria | An authorised user can access a cash flow summary view, select a date range, and see total money in, total money out, and the net cash position for that period. The figures are derived from records in the system and are consistent with the Cash Flow Summary report. |

---

### Category: Data Retention

**BR-037**
| Field | Detail |
|---|---|
| ID | BR-037 |
| Category | Data Retention |
| Priority | Must Have |
| Requirement | All records in the system must be retained indefinitely. No records are to be automatically deleted or archived after any period of time. |
| Acceptance Criteria | Records created at the time of system launch remain accessible without restriction at any point in the future. No automated deletion or archiving process exists within the system. |

---

**BR-038**
| Field | Detail |
|---|---|
| ID | BR-038 |
| Category | Data Retention |
| Priority | Must Have |
| Requirement | The same vehicle (identified by chassis number or engine number) may appear in the system more than once if the dealership purchases it again after a previous sale. Each purchase instance must be treated as a separate, independent vehicle record with its own cost basis, repair history, and sale record. |
| Acceptance Criteria | The system permits creation of a new vehicle purchase record with a chassis or engine number that already exists in the system for a previously sold vehicle. Both records coexist and are independently accessible. The system does not block or warn about duplicate chassis/engine numbers in this context. |

---

## 4. Business Rules

Business rules define the specific logic and constraints the system must enforce automatically.

---

**BRL-001 — Advance Reservation Validity Periods**

The validity period of an advance reservation is determined by the advance amount as a percentage of the vehicle's listed price at the time the advance is placed:

| Advance as % of Listed Price | Validity Period |
|---|---|
| Greater than 0% up to and including 5% | 1 week from the advance date |
| Greater than 5% up to and including 10% | 2 weeks from the advance date |
| Greater than 10% up to and including 15% | 3 weeks from the advance date |
| Greater than 15% up to and including 20% | 1 month from the advance date |
| Greater than 20% | 1 month from the advance date (maximum; does not extend further) |

The expiry date is calculated automatically by the system when the advance is recorded.

---

**BRL-002 — Automatic Unavailability**

Vehicles in the following statuses must be automatically marked as unavailable for sale and cannot be manually overridden to "available" while in these states:

- Sent for Repair
- In Repair
- Advance Placed
- Finance Pending
- Delivery Order Received

---

**BRL-003 — Manager Approval Requirements**

The following actions require approval from a user with manager-level authority before they are processed:

| Action | Trigger Condition |
|---|---|
| Discount on a sale | Sale price entered is below the vehicle's listed price |
| Vehicle write-off | A write-off request is submitted for any vehicle |
| Advance refund | A cancelled advance reservation is to be refunded to the customer |
| Sale record edit | Any edit is initiated on a completed sale record |

The action is suspended pending approval. The original record is not modified until approval is granted.

---

**BRL-004 — Edit Reason Mandatory**

Editing any purchase record or sale record (whether completed or in progress) requires the user to provide a written reason for the change. This reason is recorded in the audit trail alongside the specific changes made.

---

**BRL-005 — Advance Expiry Handling**

When an advance reservation reaches or passes its expiry date without conversion to a full sale, the system automatically flags it as expired. Staff must manually select one of three resolution actions:

- Convert the advance to a completed sale (standard sale process continues)
- Cancel the reservation with a full or partial refund to the customer (requires manager approval; refund amount recorded)
- Cancel the reservation without a refund (no approval required; advance amount retained)

---

**BRL-006 — Lease Sales Down Payment**

Every vehicle sale processed under the lease/finance channel must include a customer down payment. A lease sale record cannot be created without a down payment amount greater than zero.

---

**BRL-007 — Delivery Order Document Mandatory**

Recording the receipt of a Delivery Order from a finance company requires uploading a copy of the DO document. The status cannot be updated to "Delivery Order Received" without a document being attached.

---

**BRL-008 — Administrator Role Protection**

The built-in Administrator role cannot be deleted. The system must always retain at least one active administrator account. Any action that would result in zero active administrators (deactivating or deleting the last active administrator) is blocked by the system.

---

**BRL-009 — Total Purchase Cost for Lease Settlement**

For lease settlement purchases, the total purchase cost recorded is the sum of the settlement amount paid to the lending institution plus the cash amount paid directly to the seller. This combined figure forms the base purchase price in the vehicle's cost basis.

---

**BRL-010 — Vehicle Lifecycle Status Transitions**

Vehicle statuses follow defined transitions. The following transitions are valid:

| From Status | Valid Next Status(es) |
|---|---|
| Purchased | In Stock |
| In Stock | Sent for Repair, Advance Placed, Finance Pending, Sold, Written Off |
| Sent for Repair | In Repair |
| In Repair | In Stock |
| Advance Placed | Sold, Advance Expired |
| Advance Expired | In Stock (on cancellation), Sold (on conversion) |
| Finance Pending | Delivery Order Received |
| Delivery Order Received | Sold |
| Sold | (Terminal — no further transitions) |
| Written Off | (Terminal — no further transitions) |

Manual status changes that do not follow these transitions are not permitted.

---

## 5. User Roles and Access

### 5.1 Permission Model

The VSMS uses a flexible, configurable role-based access control system. Permissions are not fixed in the software — they are configured by the administrator after the system is deployed and can be adjusted at any time without software changes.

The permission model works as follows:

- **Roles** are named groups of permissions (e.g., "Sales Executive," "Workshop Coordinator," "Branch Manager").
- **Permissions** are specific capabilities that can be granted to a role, such as the ability to create a sale record, view a purchase record, approve a discount, or export a report.
- **Users** are assigned one or more roles. A user with multiple roles inherits the combined permissions of all their roles.
- Permissions can be granted or revoked per role at any time, and the change takes immediate effect.

### 5.2 Built-In Administrator Role

One role — the Administrator — is built into the system and cannot be deleted. The Administrator has authority over user account management, role configuration, and permission assignment. The system enforces that at least one active Administrator account always exists.

### 5.3 Approval Authority

Certain actions require approval from a user who holds a role with the relevant approval permission. The specific roles granted approval authority are determined by the administrator during system setup. By default, approval authority for discounts, write-offs, refunds, and sale edits is expected to be held by manager-level roles.

### 5.4 Role Configuration at Launch

The exact set of roles, their names, and their assigned permissions will be defined and configured during the system setup and onboarding phase, prior to go-live. The development team will provide guidance and a recommended starting configuration. The client retains full control over role and permission configuration post-deployment.

---

## 6. Reporting Requirements

The following reports must be available at the time of system launch. All reports support filtering by a user-specified date range and can be exported in both CSV and PDF formats.

---

**RPT-001 — Current Vehicle Inventory**

Provides a snapshot of all vehicles currently in the system with their lifecycle status, availability status, cost basis, and listed price. Used to understand what vehicles are on hand and at what value.

- Filters: Status, Availability, Make, Model
- Export: CSV, PDF

---

**RPT-002 — Vehicles Sold per Period**

Lists all vehicles sold within the selected date range. Shows sale price, cost basis, and gross profit or loss per vehicle, with summary totals for the period.

- Filters: Date range, Sale type (cash, lease, trade-in)
- Export: CSV, PDF

---

**RPT-003 — Profit per Vehicle**

Detailed financial breakdown for a single vehicle or a group of vehicles: purchase price, repair costs, additional costs, total cost basis, sale price, and gross profit or loss.

- Filters: Date range, Make, Model, Status
- Export: CSV, PDF

---

**RPT-004 — Outstanding Advance Payments**

Lists all active advance reservations and expired advances that have not yet been resolved. Shows the vehicle, customer, advance amount, listed price, advance percentage, expiry date, and days outstanding or overdue.

- Filters: Status (active, expired), Date range
- Export: CSV, PDF

---

**RPT-005 — Vehicles Currently in Repair**

Lists all vehicles currently with a repair vendor. Shows the vendor name, date sent, and the number of days the vehicle has been in repair.

- Filters: Vendor, Date sent
- Export: CSV, PDF

---

**RPT-006 — Cash Flow Summary**

Summarises the business's cash position within the selected date range. Money in includes sale proceeds and advance payments received. Money out includes vehicle purchase payments, repair costs, additional vehicle costs, and advance refunds paid. Displays the net cash position for the period.

- Filters: Date range
- Export: CSV, PDF

---

**RPT-007 — Write-Off and Disposal Report**

Lists all vehicles that have been written off, including the write-off reason, the approving manager, the date of write-off, the vehicle's total cost at the time of write-off, and the disposal proceeds received (if any).

- Filters: Date range
- Export: CSV, PDF

---

## 7. Non-Functional Requirements

### NFR-001 — Platform

The VSMS must be a web-based application accessible through any modern web browser (including Chrome, Firefox, Safari, and Edge) on desktop computers, laptops, tablets, and smartphones. No separate installation of software is required to use the system.

### NFR-002 — Responsive Design

The system interface must adapt appropriately to different screen sizes. All functions must be usable on both large desktop screens and smaller tablet or mobile screens without loss of functionality.

### NFR-003 — Progressive Web App (PWA)

The system must be installable on mobile and tablet devices as a Progressive Web App. This allows users to add the application to their device home screen and use it in a manner similar to a native application, without requiring download from an app store.

### NFR-004 — Single Currency

The system operates in a single currency. The currency symbol and code are configured once during system setup and apply uniformly throughout the application. Currency configuration does not require software changes.

### NFR-005 — Data Retention

All business records are retained indefinitely within the system. No automatic deletion, expiry, or archiving of records is permitted.

### NFR-006 — Audit Trail Integrity

The audit trail is append-only. No user, including administrators, can modify or delete audit log entries. This ensures a trustworthy and complete history of all system activity.

### NFR-007 — Data Security

All user access to the system requires authentication with a valid username and password. All data transmitted between the user's device and the system must be encrypted. Access to records and functions is governed by the user's assigned roles and permissions.

### NFR-008 — System Availability

The system is expected to be available during the client's normal business hours. The specific availability targets and hosting arrangements will be defined in the service agreement.

---

## 8. Assumptions and Constraints

### 8.1 Assumptions

The following assumptions have been made in preparing this specification. If any of these assumptions are incorrect, the relevant requirements may need to be revised.

| # | Assumption | Impact if Incorrect |
|---|---|---|
| A-001 | The dealership operates as a single business entity with a single set of users and records. There is no requirement to support multiple branches or companies within the same system instance. | Multi-branch support would require significant changes to data architecture and user management. |
| A-002 | All monetary values in the system are in a single currency, configured once at setup. | Multi-currency support would require redesign of all financial calculations and display. |
| A-003 | The system will be hosted on a server or cloud infrastructure managed by or on behalf of the client. Hosting arrangements are outside the scope of this specification. | The development team assumes suitable hosting is arranged by the client or separately specified. |
| A-004 | The historical data to be imported is available in a format that can be structured into spreadsheets (CSV or Excel). If data exists only in paper format, the client is responsible for manual data entry into the import templates. | If data is not structurable, the import process timeline and effort will be affected. |
| A-005 | User training will be provided to staff by the client's own management or through a separate training engagement. | If formal training is required from the development team, this should be scoped separately. |
| A-006 | Internet connectivity is available at the point of use. The system does not need to operate fully offline. | Offline operation would require significant additional development. |
| A-007 | The listed price of a vehicle is always the reference point for advance percentage calculations, at the price set at the time the advance is placed. | If a different reference price is required, the advance validity calculation logic will need to be revised. |

### 8.2 Constraints

| # | Constraint | Description |
|---|---|---|
| C-001 | No external system integrations at launch | The system will not connect to or exchange data with any third-party systems (banks, finance institutions, government registries, accounting software) at the time of initial delivery. |
| C-002 | No regulatory or tax compliance features | The system is not required to produce tax-compliant documents or perform regulatory reporting at launch. |
| C-003 | Notifications are in-app only | No external notification delivery channels (SMS, email, push notifications) are to be built at launch. |
| C-004 | No native mobile applications | The system will not include iOS or Android native applications. Mobile access is provided through the responsive web application and PWA installation. |

---

## 9. Out of Scope

The following items are explicitly not included in this project. Any future addition of these capabilities would be subject to a separate scoping and estimation process.

1. Native iOS or Android mobile applications
2. SMS, email, or push notification services
3. Integration with banks, finance companies, or government vehicle registries
4. Integration with accounting or ERP software
5. Tax calculation, VAT reporting, or any other regulatory compliance functionality
6. Multi-currency support
7. Multi-branch or multi-company support within a single system instance
8. A customer-facing website or portal for browsing vehicle inventory
9. Online sales, enquiry forms, or lead management
10. Vehicle market valuation tools or external price feed integrations
11. Document scanning, photograph management, or OCR capabilities
12. Automated reminders delivered outside the in-app notification system
13. Loan or instalment tracking after a finance sale is completed (post-handover finance management)
14. Inventory forecasting or purchasing recommendation tools
15. Staff performance tracking or commission management

---

## 10. Acceptance and Sign-Off

### Statement of Agreement

This Business Requirements Specification documents the agreed business requirements for the Vehicle Sale Management System (VSMS) as understood by the development team following consultation with the client. It represents the basis upon which the system will be designed, built, and delivered.

By signing below, I confirm that:

1. The requirements documented in this specification accurately and completely represent the business needs of the organisation for this system.
2. I have reviewed and understood the scope statement, including what is in scope and what is explicitly out of scope.
3. I authorise the development team to proceed with system design and implementation based on the requirements contained herein.
4. I understand that any changes to requirements after this document is signed may result in adjustments to the agreed timeline and cost, which will be communicated and agreed upon separately.

---

**Client Organisation:** _______________________________________________

&nbsp;

**Authorised Signatory Name:** _______________________________________________

&nbsp;

**Designation / Title:** _______________________________________________

&nbsp;

**Date:** _______________________________________________

&nbsp;

**Signature:** _______________________________________________

---

&nbsp;

**Received and acknowledged on behalf of the Development Team:**

&nbsp;

**Name:** _______________________________________________

&nbsp;

**Designation:** _______________________________________________

&nbsp;

**Date:** _______________________________________________

&nbsp;

**Signature:** _______________________________________________

---

*End of Document*

*Document Version 1.0 — Vehicle Sale Management System Business Requirements Specification — 2026-03-07*
