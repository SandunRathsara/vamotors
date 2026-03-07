# Vehicle Sale Management System — Requirements Questionnaire

**Project:** Core System for Vehicle Sale Company
**Date:** 2026-03-07
**Purpose:** Clarify business requirements and define project scope before system design begins.

> Please answer each question below. If a question is not applicable, write "N/A" with a brief reason. Sections marked with **(HIGH PRIORITY)** are critical for us to begin work — please prioritize those.

---

## Section A — General & System Context **(HIGH PRIORITY)**

**A1.** How many users will access the system simultaneously, and across how many physical locations or branches?

> Answer: Most of the time only the cashier will be logging into the system but occationally, few managers and sales persons will log into the system.

**A2.** Will this be a web application, a desktop application, or both? Is mobile access (phone or tablet) required for any workflow?

> Answer: This has to be a web application with pwa capabilities. mobile app is not required at all but the web app has to be mobile and tablet responsive.

**A3.** Is there an existing system currently in use (spreadsheets, accounting software, another platform)? If so, does historical data need to be migrated?

> Answer: Current data are being stored in physical documents, yes I do need to import those historical data into the system.

**A4.** What currency does the business operate in? Is multi-currency handling required at any point (e.g., purchasing imported vehicles in a foreign currency)?

> Answer: When deployed, only one currency will be used, but make the currency configurable via environment variable so we can use whatever the currency when needed.

**A5.** Are there any regulatory, tax, or legal reporting obligations this system must support (e.g., generating tax invoices, VAT/GST calculations, government vehicle transfer records)?

> Answer: Not at the moment.

**A6.** Does the system need to integrate with any external software (accounting packages like QuickBooks or Xero, SMS/email gateways, government vehicle registration databases)?

> Answer: Not at the moment.

---

## Section B — Vehicle Purchase

**B1.** When a secondhand vehicle is purchased by settling an existing lease: who is the lease owed to — a bank, a finance company, or a private party? Does the system need to record the institution name and settlement reference?

> Answer: a bank or a finance company or may be a private party. yes the system need to record the institution name and settlement reference

**B2.** Can you confirm the exact financial structure for a lease-settlement purchase? For example: Vehicle total price is $10,000. Finance settlement amount is $6,000 (paid to the finance company). Cash to seller is $4,000. Is that the correct interpretation?

> Answer: Yes that is the correct interpretation

**B3.** For brand-new vehicles that enter the system without a registration number — what is the trigger for adding the registration number later? Should the system prevent a vehicle from being sold until a registration number is present?

> Answer: Editing vehicle must be able to set a vehicle number. system should not have any restriction with unregistered vehicles being sold.

**B4.** Do you need to record who you purchased each vehicle from (seller/supplier details such as name, contact number, NIC/business number)? Or is only the purchase amount relevant?

> Answer: Yes I do need to record seller/supplier details. There can be some supplier's who will be continuosly I will be working with. There can be individuals as well as companies, for companies, there can be individual contact points or company hotlines also.

**B5.** Are there additional costs incurred after purchase but before sale that need to be tracked per vehicle — for example, transport costs, inspection fees, import duties, or valeting? These would affect the profit calculation per unit.

> Answer: Yes. There can be various different costs related to specific vehicles.

**B6.** What vehicle details need to be recorded at the point of purchase? Please mark which of the following are required:

- [x] Make (e.g., Toyota) - Required
- [x] Model (e.g., Corolla) - Required
- [x] Year of manufacture - Required
- [x] Colour - Required
- [x] Engine number - Required
- [x] Chassis number - Required
- [x] Mileage / Odometer reading - Required - must be able to update with date and remark and maintain history
- [x] Fuel type (Petrol / Diesel / Hybrid / Electric) - Required
- [x] Transmission type (Auto / Manual) - Required
- [x] Condition grade or notes - Not Required
- [x] Photos - Not Required
- [x] Other: RegistrationNumber (in the vehicle registration document) - Required, Vehicle Number (VIN) - Not Required for unregistered.

> Additional notes:

**B7.** Can a purchase entry be edited or deleted after it has been saved, or should it be immutable once recorded?

> Answer: Anything must be edittable and an audit record must be kept. but for a purchase or sales entry change, a reason must be entered to edit and shown in the audit records.

---

## Section C — Vehicle Repairing

**C1.** When repair details are recorded, is the amount entered an estimate (before repair begins) or the actual invoice amount (after repair is complete)? Do you need to record both?

> Answer: Tha actual invoice should be able to enter after repair is completed. no estimates are reqired right now.

**C2.** Do you need to track which repair shop or vendor the vehicle was sent to? If yes, should the system maintain a list of approved repair vendors?

> Answer: Yes maintain a list of repair vendors with their contact details, same as supplier companies.

**C3.** Why are "vehicle is back from repair" and "mark as available for sale" two separate steps? Is there an inspection, cost finalisation, or quality check that happens between these two events?

> Answer: Mark as available for sale can be initiated from several status. vehicle is back from repair is one status, and a vehicle was advanced first and the advance time period is exipired is another status, vehicle is on the way for a inspection is another status, vehicle is not yet in the show room is another exception, how ever, there can be vehicles in the inventory just not yet for sale for various reasons. how this is manged is not yet finalized. just must be able to handle when a vehicle is just in the inventory and available for sale seperately. suggest the best way.

**C4.** Do you need a full repair history per vehicle (all past repairs and their costs), or only the current/most recent repair record?

> Answer: I need all.

**C5.** Should repair costs be automatically added to the vehicle's total cost basis for the purpose of calculating profit on sale?

> Answer: when the vehicle is veiwed, show the cost breakdown and total cost. show the for sale value separetely and once sold, show the sold value seperately.

**C6.** What happens if a vehicle is assessed after repair and deemed unfit for sale or a total loss? Is there a write-off or disposal workflow required?

> Answer: Yes.

---

## Section D — Vehicle Sale **(HIGH PRIORITY — D1 to D3)**

**D1.** For the cash advance process: are the four percentage tiers (5%, 10%, 15%, 20%) the only valid options, or can a customer pay any custom percentage? What happens if a customer wants to pay more than 20%?

> Answer: the four percentage tiers are for just reference. anyone can pay upto 20% and from there and upwards, advance validity period must doesn't exceed validity period.

**D2.** What happens when the advance waiting period expires and the customer has not paid the balance? Does the system automatically cancel the sale and re-list the vehicle, offer a grace period, or leave it to manual staff decision?

> Answer: Leave it to the manual staff decision.

**D3.** If an advance sale is cancelled (by customer or by the business), is the advance payment refunded? Does the system need to record the refund transaction?

> Answer: It will mostly not refunded. but there can be instances of refund. so record if it is refunded or not.

**D4.** What is the minimum customer information required to record a sale? Please mark which are required:

- [x] Full name
- [x] NIC / Passport number
- [x] Address
- [x] Phone number
- [x] Email address (Optional)
- [x] Driving licence number (Optional)
- [x] Other: Calling Name

> Additional notes:

**D5.** What fields must appear on the invoice? Must it be printable as a PDF? Does it need to conform to a specific legal or tax invoice format in your jurisdiction?

> Answer:

Seller & Buyer Information: Full names, NIC/Passport numbers, and addresses of both parties.
Vehicle Details: Make, model, year of manufacture, chassis number, engine number, vehicle number, and current mileage.
Transaction Details: Total sale price, payment method (cash, cheque, bank transfer), and date of sale.
Legal Declarations: A statement confirming the seller is the legal owner, the vehicle is free from encumbrances, and that the purchaser takes responsibility for all liabilities (accidents, taxes, fines) after the transfer date.
Signatures: Both parties must sign to finalize the transfer.

**D6.** In the lease sale flow, what does "finance date" refer to — the date the application was submitted to the finance company, or the date the finance was approved / DO was issued?

> Answer: The date DO was issued.

**D7.** Does the delivery order (DO) document from the finance company need to be uploaded and stored in the system, or is a simple status flag ("DO received: Yes/No") sufficient?

> Answer: DO document must be uploaded to the system.

**D8.** Is "customer takes the vehicle" (step 2.5) a distinct event that needs to be logged with a date, or does it happen simultaneously with recording the final sale (step 2.6)?

> Answer: It will happen simultaneously with recording the final sale.

**D9.** Can a single vehicle ever be sold on a part-cash, part-lease arrangement? Or are the two payment methods always mutually exclusive?

> Answer: In all the occations, any finance company or bank never agrees to pay the full amount as the lease for any vehicle. so a lease sale will always have a sum of cash paid by the buyer which is called down paymnt as the advance. if you're asking by part-cash and part-lease to record two sale payment methods, lease will always be lease with down payment amount recorded in there. but for cash sales, and down payment sales, payment method can be recorded as cash or bank transfer.

**D10.** Is there a trade-in concept where a customer brings their existing vehicle as part-payment toward a purchase?

> Answer: Yes. it can be there. so payment must be recorded accordingly for those sales.

---

## Section E — Users, Roles & Permissions **(HIGH PRIORITY)**

**E1.** How many staff members will use the system? What are their roles (e.g., sales agent, finance clerk, manager, administrator)?

> Answer: Roles cannot be defined specifically because employees will join and leave occationally and each of them will bear different roles and permissions from each other. So Let's go with dynamic casl roles. so roles can be configured after production release dynamically.

**E2.** Should different roles have different levels of access? For example: should a sales agent be able to see purchase costs and profit margins, or only the sale price?

> Answer: must be able to grant specific permissions to specific roles and assign those to users on live production system.

**E3.** Should certain actions require manager approval before being committed (e.g., cancelling an advance sale, writing off a vehicle, applying a discount)?

> Answer: yes.

**E4.** Is there an administrator role that manages user accounts, or will that be handled externally?

> Answer: There must be an administrator role to manage user accounts.

---

## Section F — Reporting & Financial Visibility

**F1.** What reports are essential at launch? Please mark which are needed:

- [x] Current vehicle inventory list
- [x] Vehicles sold per period (daily / weekly / monthly)
- [x] Profit per vehicle sold
- [x] Outstanding advance payments
- [x] Vehicles currently in repair
- [x] Total cash flow summary (money in vs. money out)
- [ ] Other: _______________

> Additional notes:

**F2.** Do you need a profit-per-vehicle calculation? If yes, should it factor in: purchase cost + repair costs + any other expenses vs. final sale price?

> Answer: yes & yes

**F3.** Do you need to track overall business cash position (money in from sales, money out for purchases and repairs) within this system, or is that handled separately in accounting software?

> Answer: I do need to track overall business cash position.

**F4.** Should the system send any automated notifications — for example, alerting staff when an advance payment waiting period is about to expire, or when an estimated repair completion date is approaching?

> Answer: no need to send notifications via any method such as sms, email or push notifications, but the notificaiton system must be there. there should be a notification panel that shows all those notifications linked to specific records, such as vehicle, buyer, seller, or supplier, etc...

---

## Section G — Data & Business Rules

**G1.** Can the same vehicle (identified by chassis number or engine number) appear in the system more than once — for example, if it is purchased, sold, and then re-purchased later?

> Answer: yes

**G2.** Should every change to a vehicle's status be logged with a timestamp and the user who made the change (full audit trail), or is only the current state important?

> Answer: full audit trail must be there.

**G3.** What is your data retention requirement? How long must sale, purchase, and repair records be kept in the system?

> Answer: indefinitely

**G4.** Should vehicles without a complete set of required documents be automatically excluded from sale availability?

> Answer: No

---

**Thank you for taking the time to answer these questions. Your responses will directly shape the system design and ensure we build exactly what your business needs.**

*Please return this completed document at your earliest convenience. If any question is unclear, feel free to add a comment and we can discuss it further.*
