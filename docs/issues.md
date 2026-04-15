# Issues - Changes need to be done found on manual testing.

## 1. Default action of tables.

Every table created in this application must perform a default action on click on the row. The default action for most of the tables are view action. but for some it changes. following are tables and their default actions.

**Following is the format**

0. Table Name -> Action

**List**
1. Vehicles Table - View the vehicle
2. Purchases Table - View the Purchase
3. Sales Table - View the Sale
4. Repairs Table - View the Repair
5. Customers Table - No Action
6. Third Parties Table - View the Third party
7. Approvals Table - Pop up a modal with approve or reject form
8. Reconcilliation Table - Reconcile
9. Lease Deals Table - View Deal
10. Dispatch Table - Mark as Dispatched

## 2. Data-table user experience.

When the screen become small but not small enough to trigger mobile or tablet resposiveness, pages that has data tables becomes scrollable. which makes the action buttons hidden and need to scroll to see the action buttons.
solution -> Instead scrolling the whole page, just make the table scrollable. it's supported in diceui.
