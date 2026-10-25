# Money, dates and lifecycle

## M1: representation, bounds and exact rounding

* One environment currency, default LKR scale 2, fixed at first business write. Initial currency is configurable as a validated supported ISO-4217 uppercase code with scale2 (not multiple concurrent currencies). Store `currency`/`scale` on policy and financial snapshots. Currency/scale changes after any business write return `409 IMMUTABLE_CURRENCY`; formatting settings never reinterpret values. Default timezone Asia/Colombo; new timezone policy cannot change existing reservation instants.
* Every monetary **wire value** is a canonical base-10 integer minor-unit **string** (including aggregates and audit JSON). No number-or-string union. `"0"`, `"12345"`, derived `"-12345"` are valid; `"01"`, `"-0"`, exponent, plus sign, commas, decimal minor strings are invalid. Amount inputs are nonnegative; positive required as specified per command. Signed values only for computed profit/net/discrepancy or explicit reversal direction, never a negative payment amount.
* Single entered amount maximum `A = 99999999999999` minor (LKR 999,999,999,999.99). Cost-basis/consideration/source cumulative totals maximum `C = 9999999999999999` minor. PostgreSQL signed bigint storage max `B = 9223372036854775807`; all stored signed derived values absolute <= B. Each bound is inclusive; overflow is an error, never clamp/wrap. Monetary columns use bigint, NOT 32-bit Int or float. Nonnegative CHECK plus A/C-specific CHECK where relevant.
* Parse decimal form input as text: trim surrounding whitespace; grammar `-?digits[.1-or-2-digits]`; no localization separators/exponent. Digit arithmetic only; normalize leading/negative zero; check A and command sign before returning canonical minor string. Excess decimals are rejected, NOT rounded. `21474836.48` → `2147483648` demonstrates exceeding DB Int. Existing `lib/money.ts` is unsafe beyond Number safe bounds and is not authoritative for new lanes.
* All calculation operands/intermediates in JS bigint; SQL `sum(bigint)`/products use numeric integer intermediates. Check final and each persisted subtotal against C/B before cast. Query aggregates use B, including separate inflow and outflow sums, not just small net. If either exceeds B return `422 MONEY_OVERFLOW`, even if subtraction would cancel. No conversion to JS Number anywhere in money path, CSV, PDF or Intl formatting; split integer/fraction strings for display. Never JSON.stringify raw bigint. JSON serializers explicitly stringify monetary fields only, not indiscriminately converting arbitrary objects.
* Integer rate basis points 0..10000 (`100` = 1%); computed fee `roundHalfAwayFromZero(basisMinor * bps / 10000)` once per entitlement, not sum of individually rounded fragments. Signed exact rational rounding: sign × floor((abs(numerator)*2 + denominator)/(2*denominator)); denominator positive. `1 minor × 50% = 1`, `-1 × 50% = -1`, `101 × 5% = 5`, `110 × 5% = 6`. No banker rounding/truncation. Percentage DISPLAY hundredths = round(advance * 10000 / listed), formatted as percent with two decimals; displayed percentage never selects tier. Margin uses same rule; zero revenue yields null, not division by zero.
* Tier comparisons cross-multiply exact integers: advance*100 <= listed*5/10/15. Positive advance <= agreedPrice, listed>0 required. Listed and agreed may differ; discount gate independent. Listed=10000 minor: 500→7,501→14,1000→14,1001→21,1500→21,1501→31 days. Never infer tier from rounded 5.00%. Settings tiers require strictly increasing inclusive upper bps bounds and a final unbounded tier, days 1..31; snapshot version, bounds, days, denominator, advance, timezone and expiry on placement.

## M2: financial identities

Cost basis = purchase + all returned actual repair invoices + additional incurred costs for **same purchaseRecordId**. Costs/payments are different; unpaid invoice10 raises basis10 but cash0. Sale completion freezes component IDs, amounts and basis; closed-cycle cost edits append reasoned restatement versions, never overwrite original profit. Original/revised basis and profit both observable. Paying old vendor liability after close is allowed, changes cash not basis. Repurchase adds new cycle only.

Cash100/repair10/sale140 → profit30; repurchase120/repair5/sale150 → profit25 (major units). Purchase100+repair10+extra5=115; asking price edits have no effect. Final agreed price includes discount already.

Reservation100/agreed1000 → conversion adds receipt900, cumulative1000. Refund60 leaves original +100 and -60 on their actual dates; retained40 is explicit cancellation disposition, not a later sale credit. Trade-in1500/value500 → receipt1000, optional acquisition basis500, no cash purchase500. Pure trade-in value=price has zero monetary balance/no zero payment row; value>price fails `OVERALLOWANCE`. Lease price1000/down100/finance900; initiation receipt100, DO0, handover0, actual lender receipt900 later. Financier shortfall is explicit outstanding, not reduced agreed revenue. No combined lease+trade-in assumed.

Source payment reversals append exact opposite-direction fact referencing original (same amount/currency/source; unique reversalOf); replacement is a distinct fact with reason. Actual customer refunds are distinct from correction reversals. Parent-state cancellation never hides historic cash. Forbid reversing an allocated remittance until allocations are reversed in same transaction.

## M3: dates

`Date` = validated Gregorian `YYYY-MM-DD`, not free text; business dates use Colombo calendar, instants UTC RFC3339 with milliseconds. Runtime commands reject future actual payment/handover/return dates; planned future dates belong to terms, not completed facts. Chronology: purchase<=repairSent<=returned; invoiceDate<=returned; DOissue<=handover; advanceDate<=conversion/refund; finance initiation<=DO receipt. Backdated entries remain distinguishable from server recordedAt. Historical imports may be past, never future actual events.

Reservation `validThrough = placedDate + tierDays` (calendar days); remains valid that whole day; `expiresAt = next day 00:00 in snapshot timezone`. Placed 2026-12-25, seven days → validThrough2027-01-01, expiry2027-01-01T18:30:00.000Z (Jan2 Colombo). Due iff now>=expiresAt. Approaching warning starts leadDays before validThrough at local midnight; default3, configurable0..7 and snapshotted. Late job emits expiry only, not obsolete approaching warning. Queries expose effective EXPIRED and `expiryFlagPending` if due but stored ACTIVE. Mutation locks evaluate due time even if cron is late.

Report date range is inclusive local dates translated to [start00:00, day-after-end00:00); calendar-day differences for repair/overdue, not floor elapsed milliseconds. T02 schedule should run at/after Colombo midnight; no host-timezone assumption.

## S1: ten-state command/action map

Canonical DB/wire states below. UI labels retain Purchased, In Stock, In Repair, Advance Placed, Advance Expired, Finance Pending, DO Received, Delivered, Sold, Written Off. Every successful edge writes status history + field audit in transaction. All unspecified edges forbidden (`409 INVALID_STATE`); no public setter.

| From | Action | To / guard and evidence |
| --- | --- | --- |
| none | recordPurchase / tradeInIntake | PURCHASED; new open cycle, identity lock, unavailable |
| PURCHASED | receiveStock | IN_STOCK; receivedDate recorded; explicit available or hold reason |
| IN_STOCK | holdStock / releaseStock | same; hold requires reason, release checks no commitment/repair |
| IN_STOCK | sendRepair | IN_REPAIR; active vendor/request/date, no buyer commitment; can start from held stock |
| IN_REPAIR | returnRepair | IN_STOCK held `RETURNED_AWAITING_RELEASE`; actual invoice/date/summary |
| IN_STOCK | placeReservation | ADVANCE_PLACED; available, positive advance receipt, discount approval if needed |
| ADVANCE_PLACED | expireReservation | ADVANCE_EXPIRED; due, same open commitment; never release |
| ADVANCE_PLACED or ADVANCE_EXPIRED | convertReservation | SOLD; same customer, balance receipt, handover+mileage+completion atomically |
| ADVANCE_PLACED or ADVANCE_EXPIRED | cancelRetained / approvedRefundCancel | IN_STOCK; explicit RELEASE or HOLD(reason), retained remainder recorded; refund approval |
| IN_STOCK | startFinance | FINANCE_PENDING; available, positive down/finance, balanced terms and receipt |
| FINANCE_PENDING | recordDO | DO_RECEIVED; verified private DO, issued date; NO handover, receipt or completed sale |
| DO_RECEIVED | confirmDOAndHandover | SOLD; same transaction completion/handover/mileage; DO current, price approval valid |
| FINANCE_PENDING or DO_RECEIVED | approvedFinanceCorrection | IN_STOCK; W10C exact approved erroneous-entry reversal or actual dated refund, all obligations resolved, explicit disposition |
| IN_STOCK | completeImmediate (CASH / TRADE_IN) | SOLD; available, exact consideration, optional linked acquisition atomic |
| PURCHASED or IN_STOCK | approvedWriteOff | WRITTEN_OFF; no open repair/buyer commitment, explicit proceeds/method/date, cost snapshot |
| DELIVERED | normalizeDelivered | SOLD; only legacy compatibility reconciliation described below |
| SOLD | recordPurchase | old cycle unchanged; NEW cycle PURCHASED on same identity |

Written-off physical identity cannot be ordinarily repurchased (`IDENTITY_WRITTEN_OFF`); policy for genuine recovery is live-launch escalation, not a new-cycle shortcut. Write-off may be requested in any nonterminal state but cannot apply until open repair returned and reservation/finance obligations resolved; changes make proposal stale. EXPIRED direct write-off cannot bypass reservation cancellation. Finance cancellation is not one of the three reservation resolutions: no status reset endpoint; correction of erroneously entered finance requires explicit approved historical correction and reversal of its receipts/commitment, not abandoning obligations.

### S2: Delivered compatibility and availability

Normal handover **always** creates completion and ends SOLD in one commit. DO receipt and DO confirmation are separate user actions: “Record DO” holds stock, “Confirm DO & hand over” completes it. If UI combines them, both edges are in ONE transaction, ending SOLD. `DELIVERED` is supported for retained historical compatibility, never a new independently deliverable state. Import of Delivered must include complete sale/handover/basis/payment evidence and closed cycle; display historical Delivered badge plus completed-sale link. `normalizeDelivered` changes only display state/history, not another receipt/completion; unique sale-per-cycle still holds. Missing completion evidence → import row error `DELIVERED_WITHOUT_COMPLETION`. This is the explicit VSTS-01/SLLS-05 evidence path.

Effective available iff IN_STOCK + open cycle + no repair + no unresolved SaleCase commitment + explicit staff available flag. All other nine states force false with system reason. DB check `available implies IN_STOCK`; hold reason required when IN_STOCK unavailable. Active/expired reservation stays committed; pending approval alone never reserves stock. Never use availability to bypass state guards. Vehicle view uses active cycle if present else last terminal cycle; historical sale queries always stored cycle FK.
