# Technical Specification: Vehicle Sale Management System
**Version:** 1.1
**Date:** 2026-03-07
**Status:** Final Draft
**Author:** Requirements-to-Specs Agent

---

## Executive Summary

The Vehicle Sale Management System (VSMS) is a web-based business operations platform for a secondhand and new vehicle dealership. It manages the full lifecycle of a vehicle from purchase through repair and sale, tracks financial positions per vehicle and across the business, enforces a dynamic CASL-based role/permission model, and produces operational and financial reports. The system is designed as a single-tenant deployment (one business) with a responsive web PWA frontend and a NestJS + PostgreSQL backend.

---

## Table of Contents

1. Project Overview
2. System Architecture Requirements
3. Entity Definitions
4. Vehicle Status / Lifecycle State Machine
5. Process Specifications
6. Advance Payment Rules
7. Financial Tracking
8. Audit and Edit Rules
9. Authorization Model
10. Notification System
11. Reporting Requirements
12. Data Import
13. Trade-in Handling
14. Write-off / Disposal Workflow
15. Open Items and Assumptions

---

## 1. Project Overview

| Attribute         | Value                                                  |
|-------------------|--------------------------------------------------------|
| System Name       | Vehicle Sale Management System (VSMS)                  |
| Deployment Model  | Single-tenant (one dealership)                         |
| Primary Users     | Cashier (primary), Sales Persons, Managers, Admin      |
| Platform          | Responsive Web App with PWA capabilities               |
| Native Mobile App | Not required                                           |
| Currency          | Single currency, configurable via environment variable  |
| Integrations      | None at this time                                      |
| Regulatory        | None at this time                                      |
| Data Origin       | Physical documents — historical import required        |

**Core Business Processes:**
- Vehicle Purchase (cash, lease settlement, brand new)
- Vehicle Repair Management
- Vehicle Sale (cash with optional advance, lease with DO workflow)
- Trade-in handling (a sale that also creates a purchase)
- Write-off / Disposal

---

## 2. System Architecture Requirements

### 2.1 Platform

| Requirement       | Detail                                                       |
|-------------------|--------------------------------------------------------------|
| Frontend          | React / Next.js — responsive, mobile/tablet/desktop          |
| PWA               | Service worker, installable on mobile/tablet, offline-capable for read-heavy views |
| Backend           | NestJS (REST API)                                            |
| Database          | PostgreSQL with Prisma ORM                                   |
| File Storage      | Document/image uploads (DO documents) — local or S3-compatible object store |
| Auth              | JWT-based session, CASL for authorization                    |
| Async             | RabbitMQ for notification delivery and async audit writes    |

### 2.2 Currency Configuration

- Currency code (e.g., LKR, USD) stored in environment variable `APP_CURRENCY`
- All monetary values stored as integers (smallest unit, e.g., cents/paise) to avoid floating-point errors
- Display layer applies currency formatting based on env config

### 2.3 Responsive / PWA Requirements

- All pages must render correctly on screens from 360px (mobile) to 1920px (desktop)
- PWA manifest and service worker required
- Critical read views (inventory list, vehicle detail) must function in offline/degraded mode using cached data
- Offline writes (edits, new records) are NOT required — show appropriate offline state messaging

---

## 3. Entity Definitions

### 3.1 Vehicle

The core entity of the system. A vehicle can appear multiple times across its lifetime (re-purchased after prior sale). Each purchase creates a new `VehicleRecord` linked to the same physical vehicle identity via chassis/engine number.

| Field                  | Type        | Required | Notes                                                             |
|------------------------|-------------|----------|-------------------------------------------------------------------|
| id                     | UUID        | Yes      | Primary key                                                       |
| make                   | String      | Yes      | Manufacturer (e.g., Toyota)                                       |
| model                  | String      | Yes      | Model name                                                        |
| year                   | Integer     | Yes      | Manufacture year                                                  |
| colour                 | String      | Yes      |                                                                   |
| engineNumber           | String      | Yes      | Unique per physical vehicle                                       |
| chassisNumber          | String      | Yes      | Unique per physical vehicle                                       |
| registrationNumber     | String      | No       | Required for registered vehicles; nullable for unregistered       |
| fuelType               | Enum        | Yes      | PETROL, DIESEL, HYBRID, ELECTRIC, OTHER                           |
| transmission           | Enum        | Yes      | MANUAL, AUTOMATIC, CVT, OTHER                                     |
| purchaseType           | Enum        | Yes      | CASH, LEASE_SETTLEMENT, BRAND_NEW                                 |
| primaryStatus          | Enum        | Yes      | See Section 4 — lifecycle state machine                           |
| isAvailableForSale     | Boolean     | Yes      | Secondary availability flag — see Section 4                       |
| unavailabilityReason   | String      | No       | Free text when isAvailableForSale = false                         |
| supplierId             | UUID        | No       | FK to Supplier (nullable for brand new from company)              |
| purchaseDate           | Date        | Yes      |                                                                   |
| purchasePrice          | Integer     | Yes      | Total purchase cost (smallest currency unit)                      |
| listedPrice            | Integer     | No       | Current asking/listed sale price (smallest currency unit); editable at any time before sale |
| notes                  | Text        | No       | General notes                                                     |
| isWrittenOff           | Boolean     | Yes      | Default false                                                     |
| writeOffDate           | Date        | No       |                                                                   |
| writeOffReason         | Text        | No       |                                                                   |
| createdAt              | DateTime    | Yes      |                                                                   |
| updatedAt              | DateTime    | Yes      |                                                                   |
| createdByUserId        | UUID        | Yes      |                                                                   |

**Notes:**
- VIN is not required.
- Condition rating and photos are not required.
- A vehicle with no registration number may still be sold.
- The same chassis/engine number can exist in multiple Vehicle records (re-purchase scenario). No unique constraint on these fields across the table; uniqueness is enforced at the application layer only within active (non-sold, non-written-off) records.
- `listedPrice` is optional and independent of `purchasePrice`. It represents the price displayed/advertised to customers and may be updated freely by authorised staff while the vehicle is unsold. A sale at below `listedPrice` constitutes a discount and requires manager approval (see Section 8.3).

### 3.2 VehicleMileageHistory

Tracks mileage at each recorded point in time.

| Field       | Type     | Required | Notes                          |
|-------------|----------|----------|--------------------------------|
| id          | UUID     | Yes      |                                |
| vehicleId   | UUID     | Yes      | FK to Vehicle                  |
| mileage     | Integer  | Yes      | In kilometres                  |
| recordedAt  | Date     | Yes      | Date of this mileage reading   |
| remark      | String   | No       | Context for this reading       |
| recordedBy  | UUID     | Yes      | FK to User                     |
| createdAt   | DateTime | Yes      |                                |

### 3.3 VehicleCost

Additional costs associated with a vehicle beyond the purchase price (e.g., transport, taxes, inspections).

| Field       | Type     | Required | Notes                                          |
|-------------|----------|----------|------------------------------------------------|
| id          | UUID     | Yes      |                                                |
| vehicleId   | UUID     | Yes      | FK to Vehicle                                  |
| category    | String   | Yes      | e.g., "Transport", "Tax", "Inspection"         |
| amount      | Integer  | Yes      | Smallest currency unit                         |
| description | Text     | No       |                                                |
| incurredAt  | Date     | Yes      |                                                |
| createdBy   | UUID     | Yes      | FK to User                                     |
| createdAt   | DateTime | Yes      |                                                |

### 3.4 LeasePurchaseDetail

Supplementary record for vehicles bought via lease settlement.

| Field               | Type    | Required | Notes                                             |
|---------------------|---------|----------|---------------------------------------------------|
| id                  | UUID    | Yes      |                                                   |
| vehicleId           | UUID    | Yes      | FK to Vehicle (1:1)                               |
| institutionType     | Enum    | Yes      | BANK, FINANCE_COMPANY, PRIVATE_PARTY              |
| institutionName     | String  | Yes      |                                                   |
| settlementReference | String  | Yes      | Loan/agreement reference number                   |
| settlementAmount    | Integer | Yes      | Amount paid to institution to clear the lease     |
| cashToSeller        | Integer | Yes      | Amount paid directly to the seller                |

Note: `settlementAmount + cashToSeller` should equal `Vehicle.purchasePrice`. Validation enforced at application layer.

### 3.5 Supplier

Suppliers from whom secondhand vehicles are purchased (individuals or companies). Can be recurring.

| Field           | Type     | Required | Notes                                                  |
|-----------------|----------|----------|--------------------------------------------------------|
| id              | UUID     | Yes      |                                                        |
| supplierType    | Enum     | Yes      | INDIVIDUAL, COMPANY                                    |
| name            | String   | Yes      | Full name or company name                              |
| nicOrRegNumber  | String   | No       | NIC for individuals, registration number for companies |
| address         | Text     | No       |                                                        |
| primaryPhone    | String   | No       |                                                        |
| hotline         | String   | No       | Company hotline (companies only)                       |
| isRecurring     | Boolean  | Yes      | Default false — flag for known recurring suppliers     |
| notes           | Text     | No       |                                                        |
| isActive        | Boolean  | Yes      | Soft delete flag                                       |
| createdAt       | DateTime | Yes      |                                                        |
| updatedAt       | DateTime | Yes      |                                                        |

### 3.6 SupplierContactPoint

Contact persons for company suppliers.

| Field       | Type    | Required | Notes                      |
|-------------|---------|----------|----------------------------|
| id          | UUID    | Yes      |                            |
| supplierId  | UUID    | Yes      | FK to Supplier             |
| name        | String  | Yes      |                            |
| phone       | String  | No       |                            |
| email       | String  | No       |                            |
| role        | String  | No       | e.g., "Sales Manager"      |
| isPrimary   | Boolean | Yes      | Default false              |

### 3.7 Customer

Buyers of vehicles.

| Field              | Type     | Required | Notes                                             |
|--------------------|----------|----------|---------------------------------------------------|
| id                 | UUID     | Yes      |                                                   |
| fullName           | String   | Yes      |                                                   |
| callingName        | String   | Yes      | Name used in day-to-day interaction               |
| nicOrPassport      | String   | Yes      |                                                   |
| address            | Text     | Yes      |                                                   |
| phone              | String   | Yes      |                                                   |
| email              | String   | No       |                                                   |
| drivingLicence     | String   | No       |                                                   |
| notes              | Text     | No       |                                                   |
| isActive           | Boolean  | Yes      | Soft delete                                       |
| createdAt          | DateTime | Yes      |                                                   |
| updatedAt          | DateTime | Yes      |                                                   |

### 3.8 RepairVendor

Repair shops and service providers. Mirrors Supplier structure.

| Field           | Type     | Required | Notes                                        |
|-----------------|----------|----------|----------------------------------------------|
| id              | UUID     | Yes      |                                              |
| vendorType      | Enum     | Yes      | INDIVIDUAL, COMPANY                          |
| name            | String   | Yes      |                                              |
| address         | Text     | No       |                                              |
| primaryPhone    | String   | No       |                                              |
| hotline         | String   | No       |                                              |
| specialisation  | String   | No       | e.g., "Body Work", "Mechanical"              |
| isActive        | Boolean  | Yes      | Soft delete                                  |
| createdAt       | DateTime | Yes      |                                              |
| updatedAt       | DateTime | Yes      |                                              |

### 3.9 RepairVendorContactPoint

Contact persons for company repair vendors (same structure as SupplierContactPoint referencing RepairVendor).

### 3.10 RepairRecord

One repair event per vehicle. Multiple repairs allowed over the vehicle's lifetime.

| Field          | Type     | Required | Notes                                             |
|----------------|----------|----------|---------------------------------------------------|
| id             | UUID     | Yes      |                                                   |
| vehicleId      | UUID     | Yes      | FK to Vehicle                                     |
| vendorId       | UUID     | Yes      | FK to RepairVendor                                |
| description    | Text     | Yes      | Nature of repair                                  |
| invoiceAmount  | Integer  | Yes      | Actual invoice amount (no estimates stored)       |
| invoiceDate    | Date     | Yes      |                                                   |
| sentForRepairAt| Date     | Yes      | Date vehicle left the showroom                    |
| returnedAt     | Date     | No       | Populated when vehicle returns                    |
| createdBy      | UUID     | Yes      | FK to User                                        |
| createdAt      | DateTime | Yes      |                                                   |
| updatedAt      | DateTime | Yes      |                                                   |

### 3.11 SaleRecord

Records a completed vehicle sale.

| Field             | Type     | Required | Notes                                                         |
|-------------------|----------|----------|---------------------------------------------------------------|
| id                | UUID     | Yes      |                                                               |
| vehicleId         | UUID     | Yes      | FK to Vehicle                                                 |
| customerId        | UUID     | Yes      | FK to Customer                                                |
| saleType          | Enum     | Yes      | CASH, ADVANCE_CASH, LEASE                                     |
| salePrice         | Integer  | Yes      | Final agreed sale price                                       |
| paymentMethod     | Enum     | No       | CASH, BANK_TRANSFER, CHEQUE (for non-lease sales)             |
| saleDate          | Date     | Yes      | Date of final sale / vehicle handover                         |
| mileageAtSale     | Integer  | Yes      | Recorded at handover                                          |
| invoiceGenerated  | Boolean  | Yes      | Default false                                                 |
| invoiceGeneratedAt| DateTime | No       |                                                               |
| tradeInVehicleId  | UUID     | No       | FK to Vehicle — populated if trade-in occurred                |
| tradeInValue      | Integer  | No       | Agreed value of the traded-in vehicle                         |
| notes             | Text     | No       |                                                               |
| createdBy         | UUID     | Yes      | FK to User                                                    |
| createdAt         | DateTime | Yes      |                                                               |
| updatedAt         | DateTime | Yes      |                                                               |

### 3.12 AdvancePayment

Records advance payment(s) against a vehicle before final sale.

| Field              | Type     | Required | Notes                                                                |
|--------------------|----------|----------|----------------------------------------------------------------------|
| id                 | UUID     | Yes      |                                                                      |
| vehicleId          | UUID     | Yes      | FK to Vehicle                                                        |
| customerId         | UUID     | Yes      | FK to Customer who placed the advance                                |
| advanceAmount      | Integer  | Yes      | Amount paid as advance                                               |
| agreedSalePrice    | Integer  | Yes      | Sale price agreed at advance time                                    |
| advancePercentage  | Decimal  | Yes      | Computed: advanceAmount / agreedSalePrice * 100                      |
| validUntil         | Date     | Yes      | Computed expiry date — see Section 6                                 |
| status             | Enum     | Yes      | ACTIVE, EXPIRED, CONVERTED_TO_SALE, REFUNDED, CANCELLED              |
| paymentMethod      | Enum     | Yes      | CASH, BANK_TRANSFER                                                  |
| refundAmount       | Integer  | No       | Populated if refunded                                                |
| refundDate         | Date     | No       |                                                                      |
| refundProcessedBy  | UUID     | No       | FK to User                                                           |
| expiredActionBy    | UUID     | No       | FK to User who acted on expiry (manual decision)                     |
| expiredActionNote  | Text     | No       | What was decided when advance expired                                |
| saleRecordId       | UUID     | No       | FK to SaleRecord when converted                                      |
| createdBy          | UUID     | Yes      | FK to User                                                           |
| createdAt          | DateTime | Yes      |                                                                      |
| updatedAt          | DateTime | Yes      |                                                                      |

### 3.13 LeaseFinanceDetail

Supplementary record for lease sales.

| Field            | Type     | Required | Notes                                              |
|------------------|----------|----------|----------------------------------------------------|
| id               | UUID     | Yes      |                                                    |
| saleRecordId     | UUID     | Yes      | FK to SaleRecord (1:1)                             |
| financeCompany   | String   | Yes      | Name of the leasing/finance company                |
| downPayment      | Integer  | Yes      | Cash portion paid by buyer                         |
| financeAmount    | Integer  | Yes      | Amount financed by the company                     |
| doIssuedDate     | Date     | Yes      | Date DO was issued (= Finance Date per D6)         |
| doDocumentPath   | String   | Yes      | Path/URL to uploaded DO document                   |
| doUploadedAt     | DateTime | Yes      |                                                    |
| doUploadedBy     | UUID     | Yes      | FK to User                                         |
| deliveryDate     | Date     | Yes      | Date vehicle was handed over to buyer              |
| leaseStatus      | Enum     | Yes      | DOWN_PAYMENT_RECEIVED, FINANCE_PENDING, DO_RECEIVED, DELIVERED, COMPLETED |

### 3.14 User

A user may hold multiple roles simultaneously. Role assignment is managed via the `UserRole` junction table; the `roleId` single-FK column is removed.

| Field          | Type     | Required | Notes                        |
|----------------|----------|----------|------------------------------|
| id             | UUID     | Yes      |                              |
| fullName       | String   | Yes      |                              |
| email          | String   | Yes      | Unique, used as login        |
| passwordHash   | String   | Yes      |                              |
| isActive       | Boolean  | Yes      | Default true                 |
| createdAt      | DateTime | Yes      |                              |
| updatedAt      | DateTime | Yes      |                              |
| createdBy      | UUID     | No       | FK to User (admin who created)|

### 3.14a UserRole

Junction table linking Users to Roles. A single user may be assigned to any number of roles; the union of all permissions across all assigned roles is the effective permission set presented to CASL.

| Field     | Type | Required | Notes                                       |
|-----------|------|----------|---------------------------------------------|
| userId    | UUID | Yes      | FK to User                                  |
| roleId    | UUID | Yes      | FK to Role                                  |
| assignedAt| DateTime | Yes  | Timestamp of assignment                     |
| assignedBy| UUID | Yes      | FK to User (admin who made the assignment)  |

Composite primary key: `(userId, roleId)`.

### 3.15 Role

| Field       | Type     | Required | Notes                                      |
|-------------|----------|----------|--------------------------------------------|
| id          | UUID     | Yes      |                                            |
| name        | String   | Yes      | Unique — e.g., "Cashier", "Manager"        |
| description | String   | No       |                                            |
| isSystem    | Boolean  | Yes      | True for built-in roles (Admin) — non-deletable |
| createdAt   | DateTime | Yes      |                                            |
| updatedAt   | DateTime | Yes      |                                            |

### 3.16 Permission

| Field       | Type   | Required | Notes                                                              |
|-------------|--------|----------|--------------------------------------------------------------------|
| id          | UUID   | Yes      |                                                                    |
| action      | String | Yes      | e.g., "create", "read", "update", "delete", "approve"             |
| subject     | String | Yes      | e.g., "Vehicle", "SaleRecord", "AdvancePayment", "User"            |
| conditions  | JSON   | No       | CASL condition object for field/attribute-level restrictions       |
| description | String | No       | Human-readable description                                         |

### 3.17 RolePermission

Junction table linking Roles to Permissions.

| Field        | Type | Required |
|--------------|------|----------|
| roleId       | UUID | Yes      |
| permissionId | UUID | Yes      |

### 3.18 AuditLog

| Field        | Type     | Required | Notes                                                         |
|--------------|----------|----------|---------------------------------------------------------------|
| id           | UUID     | Yes      |                                                               |
| entityType   | String   | Yes      | e.g., "Vehicle", "SaleRecord"                                 |
| entityId     | UUID     | Yes      |                                                               |
| action       | Enum     | Yes      | CREATE, UPDATE, DELETE, STATUS_CHANGE, APPROVE                |
| changedFields| JSON     | No       | { field: { from, to } } snapshot                              |
| reason       | Text     | No       | Required for purchase/sale edits — see Section 8              |
| performedBy  | UUID     | Yes      | FK to User                                                    |
| approvedBy   | UUID     | No       | FK to User — populated when an approval step is involved      |
| performedAt  | DateTime | Yes      |                                                               |
| ipAddress    | String   | No       |                                                               |

### 3.19 Notification

| Field        | Type     | Required | Notes                                                          |
|--------------|----------|----------|----------------------------------------------------------------|
| id           | UUID     | Yes      |                                                                |
| userId       | UUID     | Yes      | FK to User — target recipient                                  |
| title        | String   | Yes      |                                                                |
| body         | Text     | Yes      |                                                                |
| type         | Enum     | Yes      | ADVANCE_EXPIRING, ADVANCE_EXPIRED, REPAIR_RETURNED, APPROVAL_REQUIRED, GENERAL |
| linkedEntity | String   | No       | Entity type: "Vehicle", "Customer", etc.                       |
| linkedId     | UUID     | No       | FK to the related record                                       |
| isRead       | Boolean  | Yes      | Default false                                                  |
| createdAt    | DateTime | Yes      |                                                                |

### 3.20 ApprovalRequest

For actions requiring manager approval.

| Field         | Type     | Required | Notes                                                  |
|---------------|----------|----------|--------------------------------------------------------|
| id            | UUID     | Yes      |                                                        |
| requestType   | String   | Yes      | e.g., "APPLY_DISCOUNT", "WRITE_OFF", "REFUND_ADVANCE", "EDIT_SALE" |
| entityType    | String   | Yes      |                                                        |
| entityId      | UUID     | Yes      |                                                        |
| requestedBy   | UUID     | Yes      | FK to User                                             |
| requestedAt   | DateTime | Yes      |                                                        |
| payload       | JSON     | Yes      | The proposed change or action details                  |
| reason        | Text     | Yes      | Reason provided by requester                           |
| status        | Enum     | Yes      | PENDING, APPROVED, REJECTED                            |
| reviewedBy    | UUID     | No       | FK to User (manager)                                   |
| reviewedAt    | DateTime | No       |                                                        |
| reviewNote    | Text     | No       |                                                        |

---

## 4. Vehicle Status / Lifecycle State Machine

### 4.1 Design Recommendation (Response to C3)

The client asked for a suggestion on handling complex status scenarios. The recommended approach uses two independent fields:

**Field 1: `primaryStatus`** — tracks where the vehicle is in its operational lifecycle (cannot be overridden by availability).

**Field 2: `isAvailableForSale`** — a boolean flag controlled independently by staff, reflecting whether the vehicle is currently being shown or offered to buyers.

This separation cleanly handles cases like:
- A vehicle that is in stock but the owner hasn't decided to display it yet (`primaryStatus: IN_STOCK`, `isAvailableForSale: false`)
- A vehicle whose advance expired and is pending a decision (`primaryStatus: ADVANCE_EXPIRED`, `isAvailableForSale: false`)
- A vehicle on its way for inspection (`primaryStatus: IN_STOCK`, `isAvailableForSale: false`, `unavailabilityReason: "Out for inspection"`)

### 4.2 Primary Status Values

| Status              | Description                                                                 |
|---------------------|-----------------------------------------------------------------------------|
| PURCHASED           | Vehicle just entered the system via a purchase record                       |
| IN_STOCK            | Vehicle is physically present and available to be managed                   |
| SENT_FOR_REPAIR     | Vehicle has been sent to a repair vendor                                     |
| IN_REPAIR           | Vehicle is actively with a repair vendor                                     |
| ADVANCE_PLACED      | A customer has placed an advance payment on the vehicle                     |
| ADVANCE_EXPIRED     | The advance period has elapsed — awaiting staff decision                    |
| FINANCE_PENDING     | Lease sale initiated — waiting for finance company approval                 |
| DO_RECEIVED         | Delivery Order received from finance company                                |
| DELIVERED           | Vehicle physically handed over to the buyer (pre-final-recording if needed) |
| SOLD                | Sale fully completed and recorded                                           |
| WRITTEN_OFF         | Vehicle deemed unsellable and disposed of                                   |

### 4.3 Valid Status Transitions

```
PURCHASED
  └─► IN_STOCK

IN_STOCK
  ├─► SENT_FOR_REPAIR
  ├─► ADVANCE_PLACED
  └─► FINANCE_PENDING (lease sale initiated)

SENT_FOR_REPAIR
  └─► IN_REPAIR

IN_REPAIR
  └─► IN_STOCK (returned from repair)

ADVANCE_PLACED
  ├─► ADVANCE_EXPIRED (system-flagged when validUntil passes)
  └─► SOLD (advance converted to full sale)

ADVANCE_EXPIRED
  ├─► IN_STOCK (advance cancelled/refunded, vehicle back to stock)
  └─► SOLD (staff decides to complete the sale despite expiry)

FINANCE_PENDING
  └─► DO_RECEIVED

DO_RECEIVED
  └─► SOLD (vehicle delivered + sale recorded simultaneously per D8)

IN_STOCK
  └─► WRITTEN_OFF

ADVANCE_EXPIRED
  └─► WRITTEN_OFF (edge case)
```

### 4.4 Availability Flag Rules

| primaryStatus      | isAvailableForSale | Business Rule                                              |
|--------------------|--------------------|------------------------------------------------------------|
| PURCHASED          | false (default)    | Not yet processed into stock                               |
| IN_STOCK           | Editable by staff  | Staff can toggle with a reason                             |
| SENT_FOR_REPAIR    | false (forced)     | System sets false; staff cannot override                   |
| IN_REPAIR          | false (forced)     | System sets false; staff cannot override                   |
| ADVANCE_PLACED     | false (forced)     | Reserved for a customer                                    |
| ADVANCE_EXPIRED    | false (forced)     | Pending decision — staff cannot mark available until decision |
| FINANCE_PENDING    | false (forced)     | Reserved                                                   |
| DO_RECEIVED        | false (forced)     | Reserved                                                   |
| DELIVERED          | false (forced)     | Reserved                                                   |
| SOLD               | false (forced)     | Not applicable                                             |
| WRITTEN_OFF        | false (forced)     | Not applicable                                             |

When staff sets `isAvailableForSale = false` on an IN_STOCK vehicle, an `unavailabilityReason` (free text) must be provided and is stored on the Vehicle record.

---

## 5. Process Specifications

### 5.1 Vehicle Purchase Process

#### 5.1.1 Process Type: Cash Purchase

**Trigger:** Staff creates a new vehicle record and selects purchase type CASH.

**Required inputs:**
- All vehicle core fields (make, model, year, colour, engine number, chassis number, registration number, fuel type, transmission)
- Mileage (initial entry into mileage history)
- Supplier (select existing or create new)
- Purchase date
- Purchase price (cash paid)

**Outcome:** Vehicle record created with `primaryStatus = PURCHASED`. Staff must manually transition to `IN_STOCK` once vehicle is physically received and verified.

**Business Rules:**
- Registration number is required (see B6) but there is no restriction on selling unregistered vehicles — system stores null and allows the sale process to proceed.
- Supplier field is required for secondhand cash purchases.

#### 5.1.2 Process Type: Lease Settlement Purchase

**Trigger:** Staff creates a new vehicle record and selects purchase type LEASE_SETTLEMENT.

**Required inputs:**
- All vehicle core fields (same as cash)
- Supplier details
- Lease settlement detail:
  - Institution type (Bank / Finance Company / Private Party)
  - Institution name
  - Settlement reference
  - Settlement amount (paid to institution)
  - Cash to seller (paid directly to seller)
- Total purchase price = settlement amount + cash to seller (system computes and validates)

**Outcome:** Vehicle record + LeasePurchaseDetail record created. Status = PURCHASED.

#### 5.1.3 Process Type: Brand New Vehicle

**Trigger:** Staff creates a new vehicle record and selects purchase type BRAND_NEW.

**Required inputs:**
- All vehicle core fields except registration number (nullable)
- Supplier is the company/dealer — required (create if not exists)
- Purchase price (invoice price)

**Outcome:** Vehicle record created without registration number. Registration number can be added later via an edit. Status = PURCHASED.

**Business Rules:**
- No VIN required.
- No restriction on selling an unregistered brand-new vehicle.

#### 5.1.4 Additional Costs

At any point in the vehicle's lifecycle (before sale), staff may attach additional cost records:
- Category (transport, tax, inspection, other — free text or predefined list)
- Amount
- Description
- Date incurred

These costs feed into the profit calculation (see Section 7).

---

### 5.2 Vehicle Repair Process

**States involved:** IN_STOCK → SENT_FOR_REPAIR → IN_REPAIR → IN_STOCK

#### Step 1: Mark as Sent for Repair

- Staff selects a vehicle in IN_STOCK status.
- Staff selects a repair vendor (from vendor list; create if not exists).
- Staff provides a description of the repair required.
- Staff records the date the vehicle is being sent.
- System sets `primaryStatus = SENT_FOR_REPAIR`, `isAvailableForSale = false`.
- RepairRecord created with `sentForRepairAt` populated.

#### Step 2: Mark as In Repair (optional intermediate step)

- System or staff can mark transition to `IN_REPAIR` once vendor confirms receipt.
- This step may be combined with Step 1 in the UI (configurable).

#### Step 3: Mark as Returned from Repair

- Staff records the return:
  - Actual invoice amount
  - Invoice date
  - `returnedAt` date
- System sets `primaryStatus = IN_STOCK`.
- `isAvailableForSale` remains false until staff explicitly marks the vehicle available.
- Repair cost is automatically included in total cost calculation.

#### Step 4: Mark Available for Sale

- Staff sets `isAvailableForSale = true` (no reason required when setting to true).
- Vehicle appears in the available inventory list.

**Business Rules:**
- Full repair history is retained — multiple RepairRecords per vehicle are supported.
- No estimate amount is stored; only actual invoice amounts.

---

### 5.3 Vehicle Sale Process

#### 5.3.1 Sale Type: Buy Now (Immediate Cash/Transfer Sale)

**Trigger:** Customer pays full price immediately; no advance.

**Steps:**
1. Staff selects vehicle from available inventory.
2. Staff creates or selects a customer record.
3. Staff records: sale price, payment method (CASH or BANK_TRANSFER), sale date, mileage at handover.
4. System creates SaleRecord with `saleType = CASH`.
5. System sets `primaryStatus = SOLD`, `isAvailableForSale = false`.
6. Staff generates invoice (system populates from template — see Section 5.4).

**Business Rules:**
- Vehicle handover is simultaneous with sale recording.
- Mileage at sale is recorded and added to mileage history automatically.

#### 5.3.2 Sale Type: Advance Payment (Reservation)

**Trigger:** Customer pays a portion upfront to reserve the vehicle.

**Steps:**
1. Staff selects vehicle from available inventory.
2. Staff creates or selects a customer record.
3. Staff records: advance amount, agreed sale price, payment method (CASH or BANK_TRANSFER).
4. System computes `advancePercentage` and `validUntil` per rules in Section 6.
5. System creates AdvancePayment record with `status = ACTIVE`.
6. System sets vehicle `primaryStatus = ADVANCE_PLACED`, `isAvailableForSale = false`.

**On Advance Expiry:**
- System automatically flags AdvancePayment as `EXPIRED` and sets vehicle `primaryStatus = ADVANCE_EXPIRED`.
- Notification sent to relevant staff (see Section 10).
- Staff manually decides outcome (see Section 6.3).

**On Conversion to Sale:**
- Staff initiates final sale from the advance record.
- Remaining balance (sale price − advance amount) must be recorded with payment method.
- SaleRecord created referencing the AdvancePayment.
- AdvancePayment `status = CONVERTED_TO_SALE`.
- Vehicle `primaryStatus = SOLD`.

#### 5.3.3 Sale Type: Lease Sale

**Trigger:** Customer purchases via a finance/leasing company.

**Steps:**

| Step | Action | Status Transition |
|------|--------|-------------------|
| 1 | Record customer and agreed sale price | — |
| 2 | Record down payment amount (cash paid by buyer) and finance company name | IN_STOCK → FINANCE_PENDING |
| 3 | Finance company approves — DO issued | FINANCE_PENDING → DO_RECEIVED |
| 4 | Upload DO document to system | Remains DO_RECEIVED |
| 5 | Record DO issued date, vehicle delivery, and finalize sale | DO_RECEIVED → SOLD |

**Business Rules:**
- Every lease sale must include a down payment (mandatory cash portion from buyer).
- Finance date = date DO was issued (per D6).
- DO document upload is mandatory before sale can be finalized (per D7).
- Vehicle handover is simultaneous with final sale recording (per D8).
- Mileage at delivery is recorded.

---

### 5.4 Invoice Generation

Invoices are generated in-system from a template populated with the following fields:

**Seller Information:** Business name, address (from system config)
**Buyer Information:** Full name, NIC/Passport number, address
**Vehicle Details:** Make, model, year, chassis number, engine number, registration number, mileage at sale
**Transaction Details:** Sale price, payment method (CASH / CHEQUE / BANK_TRANSFER), sale date
**Legal Declarations:**
- Seller declares ownership of the vehicle
- Seller declares vehicle is encumbrance-free
- Liability transfer clause (responsibility passes to buyer upon handover)
**Signature blocks:** Seller and buyer signature areas

Invoices are generated as PDF. Once generated, the invoice cannot be edited — it is stamped with the generation timestamp and user.

---

## 6. Advance Payment Rules

### 6.1 Validity Period Logic

The advance percentage determines the maximum validity period. The tiers below are reference points only — any percentage is valid; the validity caps are applied based on thresholds.

| Advance Percentage       | Validity Period   |
|--------------------------|-------------------|
| > 0% and ≤ 5%            | 1 week            |
| > 5% and ≤ 10%           | 2 weeks           |
| > 10% and ≤ 15%          | 3 weeks           |
| > 15% and ≤ 20%          | 1 month (31 days) |
| > 20%                    | 1 month (31 days) — capped, does not exceed |

**Computation:**
- `advancePercentage = (advanceAmount / agreedSalePrice) * 100`
- `validUntil = advancePlacedDate + validityPeriod` (computed at creation, not re-computed on edits)

### 6.2 Expiry Handling

- A scheduled background job runs daily to identify AdvancePayments where `validUntil < today` and `status = ACTIVE`.
- Job sets `status = EXPIRED` and vehicle `primaryStatus = ADVANCE_EXPIRED`.
- Notification triggered to assigned staff (see Section 10).

### 6.3 Expired Advance Decisions (Manual — per D2)

Staff must manually select one of the following outcomes for an expired advance:

| Decision              | Action                                                                  |
|-----------------------|-------------------------------------------------------------------------|
| Convert to Sale       | Proceed with the sale anyway — full sale recorded, AdvancePayment linked |
| Cancel and Refund     | AdvancePayment status = REFUNDED. Refund amount and date recorded. Vehicle returns to IN_STOCK |
| Cancel No Refund      | AdvancePayment status = CANCELLED. No refund. Vehicle returns to IN_STOCK |
| Extend Period         | Staff creates a new AdvancePayment record (fresh computation). Old record marked CANCELLED |

All decisions require the acting staff member to be recorded (`expiredActionBy`). A note is optional but recommended.

### 6.4 Refund Handling (per D3)

- Refunds are not automatic — a refund is a deliberate staff action.
- Refund is possible on ACTIVE or EXPIRED advances (e.g., a customer changes their mind before expiry).
- Fields: refund amount (may be partial or full — no business rule constraint stated), refund date, processed by.
- Refund amount and status are stored against AdvancePayment for reporting.

---

## 7. Financial Tracking

### 7.1 Per-Vehicle Cost Basis

Total cost of a vehicle = sum of:
1. `Vehicle.purchasePrice`
2. Sum of all `RepairRecord.invoiceAmount` for the vehicle
3. Sum of all `VehicleCost.amount` for the vehicle

### 7.2 Profit Calculation

```
Profit = SaleRecord.salePrice - TotalCostBasis
```

Where `TotalCostBasis` is computed as defined in 7.1.

For lease sales:
- Sale price is the full vehicle price agreed (not just the down payment)
- Down payment is one payment channel; financed amount is the other

For trade-in sales:
- The `tradeInValue` is treated as part of the payment received
- `effectiveSalePrice = saleRecord.salePrice` (the trade-in value is already factored into the agreed price)
- The traded-in vehicle enters the system as a new purchase record (see Section 13)

### 7.3 Vehicle Financial Summary View (per C5)

Per vehicle, the system must display:

| Line Item            | Source                                  |
|----------------------|-----------------------------------------|
| Purchase Price       | Vehicle.purchasePrice                   |
| Repair Costs         | Sum of RepairRecord.invoiceAmount        |
| Other Costs          | Sum of VehicleCost.amount               |
| Total Cost Basis     | Computed sum                            |
| Listed Sale Price    | Vehicle.listedPrice (if set)            |
| Sold Price           | SaleRecord.salePrice (if sold)          |
| Gross Profit / Loss  | Sold Price − Total Cost Basis           |

### 7.4 Business Cash Position Tracking (per F3)

The system must maintain a running business cash position view. This is a computed dashboard value, not a dedicated ledger table. It aggregates:

**Cash Inflows:**
- Advance payments received (ACTIVE, CONVERTED_TO_SALE)
- Final sale payments received (CASH, BANK_TRANSFER, down payments)

**Cash Outflows:**
- Vehicle purchase payments (cash to seller, lease settlements)
- Repair invoice amounts
- Other vehicle costs
- Advance refunds

**Implementation Note:** This is computed from existing transactional records filtered by date range. No separate ledger entity is required unless a future requirement introduces general accounting. A dedicated report/dashboard endpoint aggregates these values on demand.

---

## 8. Audit and Edit Rules

### 8.1 Audit Trail Coverage

Every CREATE, UPDATE, DELETE, and STATUS_CHANGE on the following entities is logged to AuditLog:
- Vehicle (all fields)
- LeasePurchaseDetail
- VehicleCost
- RepairRecord
- SaleRecord
- AdvancePayment
- LeaseFinanceDetail
- Supplier
- Customer
- RepairVendor
- User, Role, RolePermission, UserRole

The `changedFields` JSON stores `{ fieldName: { from: oldValue, to: newValue } }` for each modified field.

### 8.2 Edit-with-Reason Requirement

For the following entities and actions, a `reason` field is mandatory and stored in AuditLog:

| Entity / Action                  | Reason Required |
|----------------------------------|-----------------|
| Edit any field on a SaleRecord   | Yes             |
| Edit purchase price on a Vehicle | Yes             |
| Edit LeasePurchaseDetail amounts | Yes             |
| Refund an AdvancePayment         | Yes             |
| Cancel an AdvancePayment         | Yes             |

For all other edits, reason is optional but the audit log entry is still created.

### 8.3 Approval-Gated Actions

The following actions require manager approval before taking effect. Each triggers the creation of an `ApprovalRequest` record; the action is not applied until the request is APPROVED.

**Confirmed approval-required actions:**

| Action | requestType value | Notes |
|--------|-------------------|-------|
| Applying a discount on a sale (selling below `Vehicle.listedPrice`) | `APPLY_DISCOUNT` | Triggered when `SaleRecord.salePrice < Vehicle.listedPrice` at the time of sale creation |
| Write-off / disposal of a vehicle | `WRITE_OFF` | See Section 14 |
| Refund of an advance payment | `REFUND_ADVANCE` | Covers both ACTIVE and EXPIRED advance refunds |
| Editing a completed sale record | `EDIT_SALE` | Any field change on a SaleRecord after the sale is finalised |

**Approval workflow:**

1. Staff submits the action → ApprovalRequest record created with `status = PENDING`, proposed change in `payload`.
2. Notification sent to users with `approve:<EntityType>` permission.
3. Manager reviews → APPROVED or REJECTED.
4. If APPROVED: action is applied and AuditLog entry records both the requestor and approver.
5. If REJECTED: ApprovalRequest closed with rejection note, no change applied.

### 8.4 Immutable Records

The following are append-only and cannot be edited or deleted once created:
- AuditLog entries
- Generated invoice PDFs (re-generation creates a new version; old version is retained)

---

## 9. Authorization Model

### 9.1 Architecture

- CASL (Capability-based authorization) implemented on both backend (NestJS guard/interceptor layer) and frontend (UI element visibility).
- Permissions are stored in the database and loaded at login into the user's JWT claims or session.
- Permission cache is invalidated when a role's permissions are modified.

### 9.2 Permission Structure

Each Permission record defines:
- `action`: create | read | update | delete | approve | export
- `subject`: Vehicle | SaleRecord | AdvancePayment | RepairRecord | Supplier | Customer | RepairVendor | User | Role | Report | AuditLog
- `conditions`: optional CASL condition JSON (e.g., restrict update to own-created records only)

### 9.3 Role Structure

| Concept        | Detail                                                                            |
|----------------|-----------------------------------------------------------------------------------|
| Roles          | Named groups of permissions. Created and managed post-deployment via Admin UI     |
| System Roles   | `Admin` role is a system role — cannot be deleted, has all permissions by default |
| User Assignment| Multiple roles per user — a user's effective permissions are the union of all assigned roles |
| Granularity    | Permissions are individually assignable to roles                                  |

### 9.4 Suggested Default Roles

These are starting-point roles; client configures actual permissions post-deployment.

| Role         | Typical Permissions                                                                         |
|--------------|---------------------------------------------------------------------------------------------|
| Admin        | All permissions including user management                                                   |
| Manager      | All operational permissions + approve actions                                               |
| Sales Person | Read inventory, create customers, create advances, initiate sales — no approval, no reports |
| Cashier      | Full operational access except user management and role management                          |

### 9.5 User Management

- Only users with the appropriate permission on subject `User` can create/edit/deactivate users.
- Deactivation is soft-delete (`isActive = false`); deactivated users cannot log in.
- Admin role cannot deactivate the last active admin.

---

## 10. Notification System

### 10.1 Architecture

- In-app notification panel only (no SMS, email, or push notifications per F4).
- Notifications are stored in the `Notification` table and delivered via polling or WebSocket (SSE recommended for PWA compatibility).
- Each notification links to a specific record (`linkedEntity` + `linkedId`) — clicking opens the relevant detail page.

### 10.2 Notification Triggers

| Trigger Event                         | Recipient(s)                        | Type                  | Linked Record      |
|---------------------------------------|-------------------------------------|-----------------------|--------------------|
| Advance payment is about to expire (3 days prior) | Sales persons, Managers  | ADVANCE_EXPIRING      | AdvancePayment     |
| Advance payment expires               | Sales persons, Managers             | ADVANCE_EXPIRED       | AdvancePayment     |
| Vehicle returned from repair          | Relevant staff (configurable)       | REPAIR_RETURNED       | Vehicle            |
| Approval request submitted            | Users with approve permission       | APPROVAL_REQUIRED     | ApprovalRequest    |
| Approval request resolved             | Requesting user                     | GENERAL               | ApprovalRequest    |
| New vehicle purchase recorded         | Managers                            | GENERAL               | Vehicle            |

### 10.3 Notification Panel Requirements

- Bell icon in the navigation bar with unread count badge.
- Dropdown/drawer panel listing recent notifications (paginated).
- Mark as read (individual) and mark all as read actions.
- Filter by type.
- Clicking a notification navigates to the linked record.

---

## 11. Reporting Requirements

All reports must support date range filtering. Export to CSV/PDF where applicable.

### 11.1 Inventory Report

**Purpose:** Current state of all vehicles in the system.

**Columns:** Vehicle ID, Make, Model, Year, Colour, Registration, Primary Status, Available for Sale, Days in Inventory, Total Cost Basis, Listed Price

**Filters:** Status, Available for Sale, Make, Model, Date range (purchase date)

### 11.2 Sales Report (per Period)

**Purpose:** All completed sales within a date range.

**Columns:** Sale Date, Vehicle (make/model/reg), Customer Name, Sale Type, Sale Price, Payment Method, Gross Profit

**Filters:** Date range, Sale Type, Payment Method

### 11.3 Profit per Vehicle Report

**Purpose:** Detailed financial breakdown per sold vehicle.

**Columns:** Vehicle, Purchase Price, Repair Costs, Other Costs, Total Cost, Sale Price, Gross Profit, Profit Margin %

**Filters:** Date range (sale date), Profit/Loss only toggle

### 11.4 Outstanding Advances Report

**Purpose:** All active or expired advance payments awaiting resolution.

**Columns:** Vehicle, Customer, Advance Amount, Advance %, Agreed Sale Price, Valid Until, Days Overdue (if expired), Status

**Filters:** Status (ACTIVE / EXPIRED), Date range

### 11.5 Vehicles in Repair Report

**Purpose:** All vehicles currently with repair vendors.

**Columns:** Vehicle, Vendor, Description, Sent Date, Days in Repair

**Filters:** Vendor, Date range

### 11.6 Cash Flow Report

**Purpose:** Business cash position over a period.

**Sections:**
- Inflows: advances received, final payments received (by payment method), trade-in offset values
- Outflows: purchases (cash), lease settlements, repair invoices, other costs, refunds issued
- Net position for period
- Running balance (if prior periods are included)

**Filters:** Date range

### 11.7 Write-off / Disposal Report

**Purpose:** All written-off vehicles and their cost impact.

**Columns:** Vehicle, Write-off Date, Reason, Disposal Method, Disposal Proceeds Received, Total Cost at Write-off, Net Loss

---

## 12. Data Import

### 12.1 Scope

Historical data exists in physical documents. A one-time import process is required to seed the system with historical records.

### 12.2 Import Strategy

**Recommended approach:** Structured CSV/spreadsheet import via an admin-only import tool, not direct database seeding.

**Import modules required:**

| Module           | Notes                                                                      |
|------------------|----------------------------------------------------------------------------|
| Suppliers        | Import supplier list first (referenced by vehicles)                        |
| Customers        | Import customer list                                                        |
| Repair Vendors   | Import vendor list                                                          |
| Vehicles         | Bulk import with purchase details; status set based on historical state     |
| Sales Records    | Historical sales linked to imported vehicles and customers                  |
| Repair Records   | Historical repair records linked to imported vehicles                       |
| Advance Payments | Historical advances (mostly CONVERTED or EXPIRED status)                   |

**Field coverage:** The import tool supports all fields defined for each entity in Section 3. There is no subset restriction — any field that exists on the entity schema may be provided in the import file. Optional fields may be left blank without blocking the import of other fields.

### 12.3 Import Rules

- All imported records should be flagged with `importedFromLegacy = true` and an `importBatchId`.
- Imported records bypass the normal approval/reason workflows during import.
- Validation errors surface per-row with row number and error description before committing.
- Import is transactional — full batch succeeds or rolls back.
- Audit log entries for imported records should reflect `performedBy = system-import-user` with the import batch timestamp.

### 12.4 Data Quality Considerations

- Physical documents may have incomplete data (e.g., missing engine numbers). The import tool must allow nullable fields to be blank without blocking import of other fields.
- Duplicate detection: chassis + engine number combination should be flagged for human review before import, not auto-rejected.

---

## 13. Trade-in Handling

### 13.1 Process Overview

A trade-in occurs when a customer exchanges their existing vehicle as part of or full payment for a vehicle being purchased from the dealership.

### 13.2 Sale Side (Vehicle Being Sold by Dealership)

When recording a sale, staff can mark it as including a trade-in:
- Record the trade-in vehicle details (description sufficient — does not need to be a full Vehicle record at sale time unless the dealership intends to resell it)
- Record the agreed trade-in value
- Record additional cash/transfer payment if the trade-in does not cover the full sale price

The `SaleRecord.tradeInValue` field stores the value attributed to the trade-in.

**Payment breakdown example:**
- Sale price: 1,500,000
- Trade-in value: 500,000
- Cash/transfer from buyer: 1,000,000

### 13.3 Purchase Side (Vehicle Being Acquired via Trade-in)

If the dealership intends to resell the traded-in vehicle:
- A new Vehicle record is created (purchase type: CASH, purchase price = trade-in value agreed)
- Supplier = the customer from the trade-in sale (link to Customer record, not Supplier)
- The trade-in vehicle enters the standard vehicle lifecycle from PURCHASED status

**Implementation note:** A `tradeInSourceSaleId` field on the Vehicle record links the new purchase back to the originating sale for audit and reporting purposes.

### 13.4 Financial Impact

- Trade-in value is treated as cash inflow equivalent in the cash flow report.
- The profit calculation on the sold vehicle uses the full agreed sale price (trade-in value + cash received) as revenue.
- The acquired trade-in vehicle starts its own cost basis at the agreed trade-in value.

---

## 14. Write-off / Disposal Workflow

### 14.1 Trigger

A vehicle in any non-terminal status (except SOLD) may be written off by authorised staff.

### 14.2 Steps

1. Staff selects the vehicle and initiates write-off.
2. Staff provides:
   - Write-off date (required)
   - Reason (free text, required)
   - Disposal method (required): SCRAPPED, AUCTIONED, DONATED, OTHER
   - **Disposal proceeds** (required field, Integer, smallest currency unit): the monetary amount recovered from the disposal. Enter 0 if nothing was recovered. This value directly offsets the net loss in financial reporting and must always be recorded explicitly.
3. If the vehicle has an ACTIVE advance, the advance must be resolved (refunded or cancelled) before write-off can proceed.
4. **Manager approval is required** (via ApprovalRequest workflow, `requestType = WRITE_OFF`) before write-off is finalised. This is a confirmed business rule, not configurable.
5. On approval: `Vehicle.isWrittenOff = true`, `primaryStatus = WRITTEN_OFF`, `isAvailableForSale = false`, and `disposalProceeds` is persisted on the Vehicle record.
6. AuditLog entry created.
7. The `disposalProceeds` amount is factored into the Write-off Report and Cash Flow Report as a partial recovery inflow.

**Vehicle entity additions for write-off:**

| Field             | Type    | Required | Notes                                                              |
|-------------------|---------|----------|--------------------------------------------------------------------|
| disposalMethod    | Enum    | No       | SCRAPPED, AUCTIONED, DONATED, OTHER — set on write-off            |
| disposalProceeds  | Integer | No       | Amount recovered from disposal (smallest currency unit); 0 if none |

These fields are null until a write-off is performed.

### 14.3 Financial Reporting Impact

- Written-off vehicles appear in the Write-off Report.
- Net loss = Total Cost Basis − `disposalProceeds`.
- `disposalProceeds` appears as a cash inflow in the Cash Flow Report under "Disposal Recoveries".
- These losses are surfaced in the cash flow and profit reports.

---

## 15. Open Items and Assumptions

### 15.1 Blocking (Resolve Before Development Starts)

| # | Question | Impact |
|---|----------|--------|
| 1 | What is the currency? (Needed for env config and formatting) | Currency symbol and decimal precision in all monetary displays |
| 2 | For lease sales, is the full sale price (financed amount + down payment) always equal to `SaleRecord.salePrice`, or does the financed amount come from the finance company at a potentially different value? | LeaseFinanceDetail schema and profit calculation accuracy |

### 15.2 Non-Blocking (Can Resolve During Development)

| # | Question | Impact |
|---|----------|--------|
| 3 | What file storage mechanism is preferred for DO document uploads? Local filesystem, AWS S3, or other? | Infrastructure decision, not schema-blocking |
| 4 | Should the invoice PDF be generated server-side (e.g., Puppeteer/PDFKit) or client-side? | Frontend vs. backend implementation choice |
| 5 | Are there predefined vehicle make/model lists or is it free-text entry? | UX improvement: autocomplete vs. open text |
| 6 | Should the VehicleCost categories be a configurable list (admin-managed) or free text only? | Minor schema addition (CostCategory table) |
| 7 | For the "3 days before expiry" advance notification — is 3 days the correct threshold or does the client want to configure this? | Notification job configuration |
| 8 | Should historical import records be visible in audit logs, or excluded from audit trail queries by default? | Import flag usage in audit log queries |
| 9 | Is there a requirement to record the specific bank account or cheque number for bank transfer or cheque payments? | Additional field on AdvancePayment and SaleRecord |

### 15.3 Assumptions Made

| # | Assumption | If Incorrect: Impact |
|---|------------|----------------------|
| A1 | A vehicle can only have one ACTIVE advance at a time (a second advance cannot be placed while one is active) | AdvancePayment unique constraint must be reconsidered |
| A2 | Invoice generation is on-demand (staff triggers it); it is not automatically generated at sale | Invoice workflow logic changes |
| A3 | The advance period computation uses calendar days (not business days) | Period calculation logic changes |
| A4 | "1 month" validity = 31 calendar days (not end-of-next-month) | Period boundary calculations |
| A5 | All monetary amounts in the system are stored in the smallest indivisible unit of the configured currency (e.g., cents) | All monetary inputs and outputs need to account for this |
| A6 | The system operates in a single timezone configured via environment variable; no multi-timezone support | Date/time storage and display logic |
| A7 | Trade-in vehicle details at the point of sale are captured as free text if not intended for resale; a full Vehicle record is only created when the dealership plans to resell the traded-in vehicle | If all trade-ins must be fully recorded, schema must be adjusted |

---

*End of Requirements Specification Document*
*Next recommended step: Database schema design (Prisma schema) based on Section 3 and Section 4 of this document.*
