# T05b490f7d3 — recovered FINAL FAIL and parent rejection

2026-10-30. Parent rejects exact `490f7d3f960bafa604839fe8009f3a99272ba661`, based on recovered original independent FINAL FAIL. **Do not integrate this candidate.** This record attributes existing evidence; ledger performed no runtime/reproducer/authentication campaign and changes no application source.

## Binding and source

- Dispatched parent: `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`; bounded receiveStock/holdStock/releaseStock only.
- Recovery verifier: `ses_e74ecf74cffeByaNSGYMFb7uoU`; original independent reviewer: `245230c4`.
- Read-only recovery handoff: `/Users/alpha/.config/vamotors/t05b-verdict-recovery-490f7d3-jPMrJNco/HANDOFF.md`; accompanying `authentication.json` is the recovery's generated authentication inventory, not executed by ledger.
- Original report: `/Users/alpha/.config/vamotors/t05b-independent-245230c4/independent-review.json`, SHA256 `f86a9054f322e1ee16249cad3d23c1c3da1dbae92b16e1dbaffeafdb0b5c7949` as authenticated by recovery. Local unsigned artifacts are tied to immutable Git source, **not cryptographic reviewer-identity/model attestation**.

## Acceptance blockers / remaining evidence gaps

**R1 P2 field-security FAIL:** stock `holdReason` is also stored as top-level `AuditEntry.reason` for both PurchaseRecord and Vehicle. Detail and audit field diffs correctly redact denied holdReason, but AuditLog.read alone reveals its duplicated reason value. Original independent real HTTP/session probes reproduced disclosure on **both roots, fresh and genuine upgraded installs at exact490f7d3**. Relevant committed paths: `lib/server/purchases.ts:791–796,861–867,988–995`; accepted A1/A1F source-field boundary and T05b production projection are violated.

Original evidence parent `/Users/alpha/.config/vamotors/t05b-independent-245230c4/` contains `audit-probe.ts:340–360`, `fresh/reviewer-audit-leak-e109b16b.json`, `upgrade/reviewer-audit-leak-2e0d7c68.json`, `audit-probe-final.log` and `audit-probe-upgrade.log`. These are pointers from the recovery handoff, not freshly opened or rerun by ledger. Receive HOLD was runtime-probed; holdStock shares the traced path but was not separately runtime-probed in recovery.

Two further gaps stay explicit:

- **Owned formatting NOT passed:** `owned-format.log` flags changed `tests/security/purchase-acquisition-check.ts`; passing selected new-source formatting does not erase it.
- **Nonempty upgrade fixture NOT proved:** FinanceCompany, FinanceContact, FinancePolicyVersion, SupplierContact and Customer snapshots were empty. Settings/history, real acquisitions and grant/audit/receipt/version retention passed for actual retained populations; empty-array comparisons do not prove policy/contact/customer preservation. Corrected-candidate verification must seed nonempty exact-parent fixtures on its own root, without mutating old reviewer data.

## Preserved historical independent positives — attributed, not blanket acceptance

The recovery authenticates retained source copies/changed-file hashes, nine unchanged parent migrations and all ten candidate migration checksums. Fresh16 and genuine-upgrade16, real stock UI/HTTP/DB/multiactor/restart, tested inputs/scope/current authority, CAS/race/replay, rollback/sequence and unchanged money/identity evidence remain **partial independent PASS contributions**. The redaction subgroup missed duplicated audit metadata; its PASS is not a full output/source-field authorization PASS.

Prior independent acquisition15/finance15/Settings16/party17/customer15/retry6/admin10/portal15/delegated14/mobile12/redacted7/separate DB10, units124/build/typecheck/spec19/strict compile/roundtrips5+3/owned ESLint/diff checks stay attributed to retained original execution. Recovery did not rerun them. Full lint baseline3 errors/40 warnings and the owned-format failure remain; author lint0/39 for a **different T17a candidate** neither erases these records nor accepts integrated lint. Earlier failed attempts/corrected reruns remain in the original report's validationNotes.

## Active correction / model authority

Parent reports correction author **`ses_e74e88a0bffebSzNViA9MzSLKw` running from490f7d3**. Replacement branch/path/head and distinct corrected-head reviewer are not supplied. Required correction: source-aware stock audit-reason projection without rewriting immutable stored history; denied/allowed regressions for receive HOLD **and** holdStock, **both roots**, later release/changed current state and current grant removal; owned-format repair and nonempty genuine-parent upgrade fixture proof. Require independent replacement-head PASS, explicit parent acceptance and integration instruction. No duplicate worker.

Current user explicitly overrides historical exact gpt-6.1-sol with **`openai/gpt-6.1-sol-fast#xhigh`**; parent verified availability and variant via live catalog. This resolves the old exact-model authorization mismatch for current work, not original execution-model attestation. The demonstrated recovered FAIL remains FAIL.

No whole-ID promotion: VSTS-01/02/03/04 and foundation/audit contributions remain partial; stock audit source-field projection is FAIL for AUDT-04 at490f7d3. T05/G2/full lifecycle and all134 whole IDs remain unaccepted. T06a adapter acceptance is unaffected; deployment deferred/not passed. No source edits, services, credentials, cloud, push/PR/deploy, merge/ref promotion or delegation by ledger.
