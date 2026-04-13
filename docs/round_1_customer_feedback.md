# Customer reviewed the UI design sent to him and gave following feedback.
1. After recording an advance payment or down payment, The rest of the process of selling that vehicle is not there in the UI design and View a sale screen is not there. It should include details based on the sale type.
2. View customer screen is not there.
3. Per sale there must be an option to record a reference number from a third party, for example there is a reference number called file number for all vehicles sold on lease given by the finance company.

# New Feature Request addtion to previous 4 features. Process 4 - Customer requests a lease for a Vehicle

## Lease Amount Comparison Generation
- Enter vehicle details to the system that came for the lease. this is not a purchase, just vehicle details are entered to facilitate a lease service as a broker.
- According to the vehicle and model and manufactured year, Maximum loan amount should appear by finance company. For this functionality, a rate sheet is there per finance company for bike model and manufactured year.
- Enter the Lease amount requested by customer and, then one of installment amount or lease period by month must be entered, according to the entered field the other should auto populate. Ex: if period is entered as 12 months, installment amount should be shown, if installment amount is entered, installment period in months should show up. for this functionality also there is a rate card by value (request amount) and number of months. Now this will be a comparison between finance companies for lease amount, installment amount and number of months (installment period)

## 0. Common procedure (starting the record in the system)
- Select one option out of the comparison along with other charges such as document fees charged by finance company, and government fees and proceed for the lease.
- Enter customer details & Guaranters (1 or many) details to the system. (Attachment Reloan/Lease Form)
- Send for checking eligibility of customer & guaranters by finance Company (Mostly by phone or whatsapp). In this step, in addition to these details, if the customer reuqest cash advance facility (Company giving away money before finance company approve the lease for a additional fee) it is also informed to the finance company.

## 1. Processing the Lease
- Once customer & guaranters eligibility is confirmed, Send for Checking eligibility of vehicle by a Vehicle Inspection (Front, Back, Left, Right, Chassis Number, Engine Number, Meter, Photo of the Dealer/Agent with Vehicle, Photo of the Customer with Vehicle).
- With approval for the vehicle, If required, adjust loan amount depending the feedback of the finance company.
- There can be instances where the vehicle is not eligible for a lease. in those cases, lease must be marked as rejected deal. those doesn't required be shown anywhere other than requested specifically to view in somewhere in the system.
- Collect & verify the documents for loan processing. following are the documents required.
    - Documents (ID copies of Customer, & guaranters, 4 passport size photos of customer, Photo of the bank passbook, Govenment issued document with address to prove residence, relationship proof if required, Optional affidavit)
    - Vehilcle (Registration book, deletion letter if required, revenue license, extra key, transfer paper, id of the previous owner)
    - Processing fee (Most of the time fixed amount, must be able to overridde)
    - Lease processing documents (As required)
in this case, there can be instances where some documents might have questionable cases that need clarification from the finance company. in those cases, a phone call will be made to the finance company and confirmed. Regardless whethere of any issues identified or all good, the verification process must be recorded in the system along with contact person from the finance company.
- Call finance company and inform about the lease. In this case all the details will be informed to the finance company and finance company will give us a reference number (most of the case this is called file number).
- Cash advance facility: Company will give the loan amount deducting all the deductables along with additional charge for providing that facility. should be able to mark this step.
- Mark the lease sale as documents sent. Everyday at the evening a set of files will be sent to courier office. there should be a screen to double check the documents (lease files) before sending out the documents. Once those are handed over to the courier, mostly documents will be delivered to the finance company by next day morning half.
- Optional Setp: When finance company receive the documents, they will start processing the lease. if there is a blocker for them, they will inform us. We should be able to mark the blocker and once it's resolved, resolve it in the system. There might be instances where the loan processing is delayed, and customer is asking about the delay. those must be able to record also with feed back of the finance company.

## 2. Referral Lease
- Once customer & guaranters eligibility is confirmed, Inform the finance company by sending customer contact details with finance company agent and mark the lease as refered to finance company in the system.
- If the lease is not processing due to any reason finance company will inform then it should be marked as rejected same as in process 1.
- If the customer informs the lease amount is not remitted, we should be able record that in the system along with finance company feedback.
- Cash advance facility: If this is selected by customer, same as processing the lease, loan amount will be disbursed by company by marking all the deductables and additional fee for providing the facility. it must be able to mark in the system.

## Common procedure after the specialized procedure.
- Reconcile the broker fee for the leases according to the finance company.

## NOTE
- For every finance company ther must be reconcilliation method.
- There can be instances where the finance company will process the commission once a month (or time period). In that case, commission will be remitted to the bank with a reconcislliation notice. There must be a way to reconcile all the records by finance company. and those leases which not reconciled but ideal should must be shown after finishing the reconcilliation. condition is lease is pending reconcilliation & date of marked as sent to finance company is 2 days before the reconcilliation date or the sent date is before the sent of last reconciled lease.
- There can be instances where after a certain period of time of refering the lease to the finance company, relevant amount will be transfered to the bank with a reconcilliation note. there must be a way to reconcile that in the system.
