# Individual v1 requirement → T01 seam index

Exactly134 IDs, not grouped ranges. Integration retains ownership/acceptance in its matrix; these links add contract coverage only. API shapes apply across every row and access/transaction rules apply to all commands/queries. Validation of links/count is automated; meaning of seams requires independent review. UI/PWA/nonfunctional rows retain observable acceptance obligations even where no new domain table is needed.

| ID | Relevant normative seam |
| --- | --- |
| FNDN-01 | [E6 stack/migration sequence](entities.md#e6-serialized-migration-order--deploy-requirements) |
| FNDN-02 | [R02 credentials](files-runtime.md#r02-names-and-least-privilege-deployment-contract-for-concurrent-t02), [E6](entities.md) |
| FNDN-03 | [A1 actor](access-transactions.md), [R02 bootstrap](files-runtime.md) |
| FNDN-04 | [A1/A1Q current actor/authz fingerprint and field grants](access-transactions.md), [CurrentActorDTO](api.ts) |
| FNDN-05 | [M1 exact money](money-state.md), [reference](reference.mjs) |
| FNDN-06 | [S1/S2 state map](money-state.md), [E2 constraints](entities.md) |
| FNDN-07 | [A2 atomic audit](access-transactions.md), [E1 indexes](entities.md) |
| FNDN-08 | [A3R exhaustive command/child revision ownership](access-transactions.md), [commandRevisionRules](api.ts) |
| FNDN-09 | [W14/W15 navigation/actions/notifications](workflows.md), [R02 no private cache](files-runtime.md) |
| VPRC-01 | [W05 acquisition and purchase detail](workflows.md), [PurchaseInput/PurchaseCycleDTO](api.ts) |
| VPRC-02 | [W05 settlement full read/edit roundtrip](workflows.md), [PurchaseCycleDTO/Settlement](api.ts), [E2](entities.md) |
| VPRC-03 | [W05 brand-new company](workflows.md), [VehicleInput](api.ts) |
| VPRC-04 | [VehicleInput](api.ts), [E2 identity enums](entities.md) |
| VPRC-05 | [Mileage](api.ts), [W05 dated zero reading](workflows.md) |
| VPRC-06 | [setListedPrice](api.ts), [M2 independence](money-state.md) |
| VPRC-07 | [PurchaseCycleDTO itemized costs/source payment IDs](api.ts), [E2 cost ownership](entities.md) |
| VPRC-08 | [E2 normalized identity/cycles](entities.md), [M2 two cycles](money-state.md) |
| VPRC-09 | [editPurchase channel/seller/settlement correction](api.ts), [W05 reasoned restatement/roundtrip](workflows.md) |
| TPRT-01 | [W04 typed tab union](workflows.md), [parties query](api.ts) |
| TPRT-02 | [DirectoryInput](api.ts), [E1 supplier](entities.md) |
| TPRT-03 | [Contact](api.ts), [E1 contact cardinality](entities.md) |
| TPRT-04 | [W04 inline persisted selection](workflows.md), [createDirectoryParty](api.ts) |
| TPRT-05 | [W04 vendor directory](workflows.md), [A1 authorization](access-transactions.md) |
| TPRT-06 | [E1 FinanceCompany shared references](entities.md), [W13](workflows.md) |
| TPRT-07 | [FinancePolicy](api.ts), [E1 immutable policy](entities.md) |
| TPRT-08 | [StartFinance.companyId](api.ts), [W09/W10 active selection](workflows.md) |
| REPR-01 | [sendRepair](api.ts), [W08 dispatch](workflows.md) |
| REPR-02 | [returnRepair](api.ts), [W08 actual invoice](workflows.md) |
| REPR-03 | [M2 basis vs cash](money-state.md), [E2](entities.md) |
| REPR-04 | [W08 chronological history](workflows.md), [vehicle query](api.ts) |
| REPR-05 | [W08 vendor FK](workflows.md), [E2](entities.md) |
| VSTS-01 | [S1 ten states/S2 Delivered evidence](money-state.md), [State](api.ts) |
| VSTS-02 | [S1 action transitions](money-state.md), [reference](reference.mjs) |
| VSTS-03 | [S2 effective availability](money-state.md), [Disposition](api.ts) |
| VSTS-04 | [S2 forced unavailable](money-state.md), [E2 checks](entities.md) |
| SLGN-01 | [reference in sale inputs/DTO](api.ts), [W09/W10](workflows.md) |
| SLGN-02 | [SaleDTO timeline/payment/linked cycle](api.ts), [W09/W10](workflows.md) |
| SLGN-03 | [SaleDTO.nextActions](api.ts), [W09/W10 completion commands](workflows.md) |
| SLCS-01 | [ImmediateSale](api.ts), [W09/W10 full receipt](workflows.md) |
| SLCS-02 | [S1 simultaneous handover](money-state.md), [A2 atomicity](access-transactions.md) |
| SLAD-01 | [Reserve](api.ts), [W09/W10 placement](workflows.md) |
| SLAD-02 | [M1 exact tier/M3 expiry snapshot](money-state.md), [reference](reference.mjs) |
| SLAD-03 | [S1 reserve/unavailable](money-state.md), [E2 unique commitment](entities.md) |
| SLAD-04 | [J10 due flag](files-runtime.md), [M3 effective expiry](money-state.md) |
| SLAD-05 | [SaleDTO.reservation ID/revision and conversion/cancel](api.ts), [A3R/A4 revisions/refund](access-transactions.md) |
| SLAD-06 | [J10 scheduler/catch-up/dedup](files-runtime.md), [JobResult](api.ts) |
| SLLS-01 | [StartFinance](api.ts), [W09/W10 composition](workflows.md) |
| SLLS-02 | [M2 positive down/finance](money-state.md), [E2 checks](entities.md) |
| SLLS-03 | [recordDO](api.ts), [F06 verified DO](files-runtime.md) |
| SLLS-04 | [F06 staging/PUT/final/download](files-runtime.md), [UploadReady](api.ts) |
| SLLS-05 | [S1/S2 confirmation/handover](money-state.md), [confirmDOAndHandover](api.ts) |
| SLTI-01 | [TradeIn](api.ts), [M2 noncash](money-state.md) |
| SLTI-02 | [M2 exact residual/overallowance](money-state.md), [W09/W10](workflows.md) |
| SLTI-03 | [E2 customer-as-seller](entities.md), [intakeTradeIn](api.ts) |
| CUST-01 | [CustomerInput](api.ts), [W04](workflows.md) |
| CUST-02 | [W04 normalized search](workflows.md), [customers query](api.ts) |
| CUST-03 | [W04 inline creation](workflows.md), [createCustomer](api.ts) |
| CUST-04 | [CustomerDTO links](api.ts), [E2 trade-in seller](entities.md) |
| INVC-01 | [F14 durable PDF lifecycle](files-runtime.md), [issueInvoice](api.ts) |
| INVC-02 | [F14 immutable full snapshot/declarations](files-runtime.md), [W14](workflows.md) |
| INVC-03 | [F14 A4 layout/retained bytes](files-runtime.md) |
| USER-01 | [users/user/roles/role scoped read DTOs and commands](api.ts), [A1Q administrative reads](access-transactions.md) |
| USER-02 | [A1 union grants](access-transactions.md), [E1 junction keys](entities.md) |
| USER-03 | [permissionRegistry/RoleDTO/Grant/saveRole](api.ts), [A1F/A1Q field registry/read scope](access-transactions.md) |
| USER-04 | [A1 last-admin lock/trigger](access-transactions.md), [E1 AdminGuard](entities.md) |
| USER-05 | [A1Q currentActor authzRevision/revocation](access-transactions.md), [A4 reviewer recheck](access-transactions.md) |
| APRV-01 | [A4 exact discount proposal](access-transactions.md), [Proposal](api.ts) |
| APRV-02 | [A4 write-off proposal](access-transactions.md), [WriteOff](api.ts) |
| APRV-03 | [A4 refund proposal/remainder](access-transactions.md), [Refund](api.ts) |
| APRV-04 | [A4 sale-edit snapshots/corrections](access-transactions.md), [SaleEdit](api.ts) |
| APRV-05 | [A2 recipient routing/A4 reviewer/time](access-transactions.md), [ApprovalDTO](api.ts) |
| WROF-01 | [WriteOff mandatory reason](api.ts), [W08](workflows.md) |
| WROF-02 | [S1 approved transition](money-state.md), [A4 no pending effect](access-transactions.md) |
| WROF-03 | [W08 zero/positive proceeds](workflows.md), [E4 DisposalReceipt](entities.md) |
| AUDT-01 | [A2 field-level changes/actor](access-transactions.md), [AuditDTO](api.ts) |
| AUDT-02 | [A2 reason/A4 edit gates](access-transactions.md), [editPurchase/SaleEdit](api.ts) |
| AUDT-03 | [R02 DB grants](files-runtime.md), [E1 append-only audit](entities.md) |
| AUDT-04 | [A1 scoped audit fields](access-transactions.md), [audit query](api.ts) |
| NOTF-01 | [notifications unreadCount](api.ts), [A2 polling](access-transactions.md) |
| NOTF-02 | [NotificationDTO target](api.ts), [A1 fresh link access](access-transactions.md) |
| NOTF-03 | [A2 five transactional events](access-transactions.md), [J10 dedup](files-runtime.md) |
| NOTF-04 | [markNotificationRead/markAll](api.ts), [A2 recipient scope](access-transactions.md) |
| REPT-01 | [W14/W15 INVENTORY](workflows.md), [ReportFilter/ReportRow](api.ts) |
| REPT-02 | [W14/W15 SOLD](workflows.md), [M2 cycle profit](money-state.md) |
| REPT-03 | [W14/W15 PROFIT](workflows.md), [ReportRow](api.ts) |
| REPT-04 | [W14/W15 ADVANCES](workflows.md), [M3 effective status](money-state.md) |
| REPT-05 | [W14/W15 REPAIRS](workflows.md), [M3 calendar days](money-state.md) |
| REPT-06 | [W14/W15 CASH_FLOW](workflows.md), [E4 source facts](entities.md) |
| REPT-07 | [W14/W15 DISPOSALS](workflows.md), [E2 cost snapshot](entities.md) |
| REPT-08 | [W15 full original population chunked export](workflows.md), [E5X temporal cutoff/manifest](entities.md), [ExportManifestDTO](api.ts) |
| FINT-01 | [M2 same-cycle basis](money-state.md), [E2 BasisVersion](entities.md) |
| FINT-02 | [M2 original/restated profit](money-state.md), [FinancialDTO](api.ts) |
| FINT-03 | [FinancialDTO components/vehicle query](api.ts), [W15](workflows.md) |
| FINT-04 | [E4 complete cash union](entities.md), [W14/W15 net movement](workflows.md) |
| LBRK-01 | [E3 versioned sheets](entities.md), [publishRates](api.ts) |
| LBRK-02 | [W11 exact cards](workflows.md), [E3 RateCardEntry](entities.md) |
| LBRK-03 | [loanMaxima/LoanMaximumDTO before terms](api.ts), [W11 max independent of card](workflows.md) |
| LBRK-04 | [W11 both lookup directions](workflows.md), [CompareResult](api.ts) |
| LBRK-05 | [CompareResult per-company options](api.ts), [W11 fixtures](workflows.md) |
| LBRK-06 | [selectQuote/charges](api.ts), [W11 snapshot handoff](workflows.md) |
| LBRK-07 | [Guarantor/openBrokerage](api.ts), [E3 minimum participant](entities.md) |
| LBRK-08 | [recordEligibility](api.ts), [W11 contact/history](workflows.md) |
| LBRK-09 | [requestFacility](api.ts), [W12F request no cash](workflows.md) |
| LBRK-10 | [W11 rejected filtering](workflows.md), [brokerage query](api.ts) |
| LBRK-11 | [W12F disbursement/recovery](workflows.md), [FacilityTerms](api.ts) |
| LBRK-12 | [openIssue/recordIssueFeedback](api.ts), [W12 blockers](workflows.md) |
| LBRK-13 | [W12 inquiries/history](workflows.md), [BrokerageDTO.issues](api.ts) |
| LBRK-14 | [PhotoCategory/recordInspection](api.ts), [W12 all nine](workflows.md) |
| LBRK-15 | [adjustLoan/replaceDealQuote/quoteHistory](api.ts), [W12 safe requote back to dispatch](workflows.md), [DealQuoteSelection](entities.md) |
| LBRK-16 | [ChecklistKind/setChecklist](api.ts), [W12 participant evidence](workflows.md) |
| LBRK-17 | [W12 vehicle checklist/extra key](workflows.md), [F06](files-runtime.md) |
| LBRK-18 | [setProcessingFee](api.ts), [W12 synthetic default/override](workflows.md) |
| LBRK-19 | [verifyDocuments](api.ts), [W12 CLEAN/ISSUES/RESOLVED](workflows.md) |
| LBRK-20 | [informCompany](api.ts), [W12 contact/reference](workflows.md) |
| LBRK-21 | [dispatchPreview/dispatchBatch](api.ts), [W12 atomic batch](workflows.md) |
| LBRK-22 | [referDeal](api.ts), [W12 Referral path guard](workflows.md) |
| LBRK-23 | [rejectDeal](api.ts), [W12 retained rejection](workflows.md) |
| LBRK-24 | [W12 NON_REMITTANCE](workflows.md), [openIssue](api.ts) |
| RCNL-01 | [FinancePolicy.reconciliationMethod](api.ts), [W13 policy snapshot](workflows.md) |
| RCNL-02 | [W13 mixed-source remittance/allocations](workflows.md), [reconcile](api.ts) |
| RCNL-03 | [ReconciliationDTO source](api.ts), [E3 entitlement](entities.md) |
| RCNL-04 | [W13 exact OR cutoff/watermark](workflows.md), [reference overdue](reference.mjs) |
| RCNL-05 | [W13 Finance navigation/access](workflows.md), [A1 independent grants](access-transactions.md) |
| IMPT-01 | [W16 CSV bundle/XLSX sheet graph parity](workflows.md), [previewImport sources](api.ts) |
| IMPT-02 | [ImportType seven kinds/ImportGraphManifest shared case](api.ts), [W16 historical graph](workflows.md) |
| IMPT-03 | [ImportPreview physical-row errors/graph dependencies](api.ts), [W16 revalidation](workflows.md) |
| IMPT-04 | [W16 single commit deferred reciprocal edges](workflows.md), [E5 source claims](entities.md), [reference graph checks](reference.mjs) |
| IMPT-05 | [Provenance contributingRows](api.ts), [E5 many-to-many target/source claims](entities.md) |
| DASH-01 | [dashboard response](api.ts), [W15 date/year populations](workflows.md) |
| DASH-02 | [dashboard.quickActions](api.ts), [W15 authorized live forms](workflows.md) |
| NFNL-01 | [W17 360–1920 keyboard/form boundary](workflows.md), [review acceptance obligations](review-handoff.md) |
| NFNL-02 | [W17 PWA install/offline rules](workflows.md), [R02 no sensitive caching](files-runtime.md) |
| NFNL-03 | [R02 TLS/origins](files-runtime.md), [F06 HTTPS private objects](files-runtime.md) |
| NFNL-04 | [E1 retained audit/E5 provenance](entities.md), [F06/F14/R02 retention/quota/recovery](files-runtime.md) |
