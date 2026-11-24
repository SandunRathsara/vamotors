# Historical import

Open **Historical imports** as an administrator. Give the batch a stable namespace for the source system, choose its record types and download the matching templates. Replace the sample rows and supply one finalized CSV or Excel attachment per selected type. Dates use the template format, and money columns use major currency units unless the column description specifies minor units. Use source keys within the namespace or an existing record UUID for references.

A batch can have up to 24 data rows, 40 weighted operations and 1 MiB across its selected files. Split longer histories into batches with prerequisites first. Validation shows row and field errors, normalized source rows and cash and consideration totals. Upload a corrected file and select it in place of the previous file. Validation of a batch can be repeated before confirmation. Any intervening business command requires a fresh preview.

Confirmation links an immutable source row to a version from the domain command that wrote the record. Repeat confirmation with the same idempotency key recovers the original receipt. An exact file already committed or a repeated source key in its namespace conflicts. Normal identity and cycle rules also apply. Follow the **Imported** link on a record to see its batch when source access is authorized.

## Supported records

- Suppliers, customers, repair vendors and finance companies.
- Vehicle purchases and their receipt, mileage, costs and payments. Supported states include Purchased, In Stock, In Repair, Sold and the states produced by companion advance and lease rows. A historical Delivered cycle requires a completed sale in the same batch. Its source status is retained in provenance and its operational status is Sold. Supplier acquisition follows the existing full-payment model. Settlement components must use the purchase date and one payment method.
- Repairs, returns and unreversed repair payments. Source rows for an available or sold cycle release the specific hold created by a repair return.
- Completed immediate cash sales and trade-ins. Sale basis components must match the cycle. Trade-in intake can reference its sale from another vehicle row. Imported sales appear in period reports and support invoice issuance from sale details.
- Advances with their dated receipts, source validity policy and active or expired status. For conversions, use the same sale case key in both files, link both rows and put the balance payment on the sale. For refunds and forfeitures, supply the retained amount, resolution date and stock disposition. Put a refund payment on the advance row.
- Pending leases, delivery-order receipt and completed handover. Record down payment and any direct lender receipts on the sale. The issue date is required at and after delivery-order receipt. Leave the attachment blank when the original is unavailable.
- Below-list sales and advances when the source identifies the historical approver. Fill `legacyApproverName` and, when available, `legacyApprovalReference`.
- Per-deal bank remittances and dated allocations to a sale or brokerage commission entitlement. Record each bank transfer once. Direct lender receipts and allocations share the same outstanding principal.
- Brokerage intake tied to a currently usable quote and an existing or imported customer.

## Coverage gaps

The source requirements call for historical field coverage. Write-offs still need an imported-evidence path in the disposal domain. The current write-off service requires a live approval, so an operator cannot import legacy disposal evidence through it. Split or partial acquisitions and historical payment reversals still need domain support for the source cash pattern. Brokerage import currently ends at intake. Applications, referrals, dispatch and their commission entitlements still need adapters for the later workflow states. Period-notice remittances still require the domain's linked notice document and are outside the per-deal template. Inactive party history still needs a lifecycle import path.

Adapters are registered in `lib/server/import-adapters.ts`. An adapter declares additional source keys, references, a work estimate and how it calls its domain commands inside the batch transaction. The workflow owns source validation, confirmation and provenance. Domain constraints run at each command savepoint. The outer transaction owns rollback for the entire batch.
