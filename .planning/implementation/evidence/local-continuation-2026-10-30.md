# Local continuation — integration hold and provenance

2026-10-30; sole integration/ledger owner. **Records-only checkpoint, not a feature verification or integration acceptance.** User now selects **`openai/gpt-6.1-sol-fast#xhigh`**, overriding historical exact gpt-6.1-sol; availability/variant verified in the parent's live catalog, not rechecked by ledger. This is current authority, not retrospective execution-model attestation. GSD was previously unavailable; no GSD execution is invented.

## Observed lineage / supplied active state

| Artifact | Exact binding / state |
| --- | --- |
| Shared root / `integration/full-v1` | `/Users/alpha/Developer/Personal/vamotors`, clean at `ddd69fb617b4790b3cd64cbf09cb10112d19c281`; `main` remains `233249f6e874796df9ee80cd58c6d40040e1f84c` |
| Accepted continuation base | `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`, direct parent accepted T05a `def32caa482cffa794b98037e24b937dbff58b7d`; ddd69fb is an ancestor. db2580dd readiness reviewed PASS by original `82021a25`; accepted base supplied by parent. |
| Own records branch / checkout | `integration/local-v1-ledger-20261030`, `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/vamotors-local-v1-ledger-20261030`, created exactly at db2580dd; containing head returned in handback |
| T05b candidate, **REJECTED** | `490f7d3f960bafa604839fe8009f3a99272ba661`, six commits above db2580dd on `t3/recover-vehicle-availability` at `/Users/alpha/.t3/worktrees/vamotors/t3-96ced5a0`; parent rejects after recovered original FINAL FAIL |
| T05b verdict recovery completed | `ses_e74ecf74cffeByaNSGYMFb7uoU` recovered original independent245230c4 FINAL FAIL; [R1 audit-reason leak/format/nonempty upgrade gaps and preserved positives](T05b-rejection-attributed.md). Not a new runtime campaign or model attestation. |
| T05b correction running | Author `ses_e74e88a0bffebSzNViA9MzSLKw`, base490f7d3; replacement head/checkout/branch/reviewer not supplied. Do not duplicate or integrate rejected490f7d3. |
| T06a separately accepted adapter | `3cc43b3b89fd52038a8e0339c3eafdb40f966f52`, one commit directly above db2580dd; [original independent verdict and parent acceptance](T06a-acceptance-attributed.md) |
| T06a2 rejected; correction running | Candidate `25da9d81e1c7158b84f4151ec90d817a33f5a56a`, base3cc43b3; independent `ses_e74d500a7ffeo065r9u4jlVqxr` FAIL and parent rejection. [Five findings/retained16+101 positives](T06a2-rejection-attributed.md). Same author `ses_e74ec4a83ffe256FD01xFxgSJf` correcting all5; sole private-files/package writer; no replacement head. |
| T17a accepted lint only | Exact `68ee0d8bcb1c6b699fbb23e2bec0232247d96a22`, basedb2580dd; author `ses_e74ec9276ffeDlsFSk7sjpE04U`, independent `ses_e74e7ac0affe0PE24lnzmmgx5m` PASS + explicit parent acceptance. [Source-bound0 errors/39 preexisting warnings,121+5=126 tests/types/privacy and limits](T17a-acceptance-attributed.md); not combined here, no T17/G6. |
| T17b PWA registration running | Author `ses_e74d46cf8ffeQ0rJu31V7qc7a6`, basedb2580dd; root-layout/public registration only/no schema; head/reviewer/acceptance not supplied |
| CONTRACT staged-file discovery running | Author `ses_e74eb118dffeZNNg6r22584Xri`, basedb2580dd; proposed importBatches/importBatchFiles current staged-file discovery missing in original DTO for true G2 restart UI; parent review required, no head/contract/runtime acceptance |

Rejected T05b sequence from base: `d7186fa` → `e17dce9` → `7357d07` → `313ef49` → `a2b720b` → `490f7d3`. That candidate and accepted T06a have exact merge-base db2580dd and disjoint changed paths, as previously checked; this is not acceptance or replacement/lint conflict verification. T05b adds no `.planning` changes; T06a adds only its five declared paths. No source combination or accepted-ref move performed here. Initial review-pending state/conditional490f7d3 merge plan at records commit53dcd84 is superseded by this rejection and corrected-source plan.

Author-only T05b evidence pointer: `/Users/alpha/.config/vamotors/t05b-recovery-96ced5a0-evidence/HANDOFF.md` (reported by original completion message; contents not consumed here). It is not an independent verdict. Original candidate/worktree remains preserved, not replaced by the recovery branch.

## Preserved user/worktree boundary

All existing worktrees, including prunable registrations, remain untouched. In particular `/Users/alpha/.t3/worktrees/vamotors/t3-9e9619b8` remains detached at `fd4d6f3cbfdcb0f19ff22cf0b0bba3b3492307b0`, with three modified tracked files and untracked `docs/operations/T05b-stock-receipt.md`. No staging/reset/clean/prune/rebase/checkouts or edits there.

Read-only preservation fingerprints recorded before ledger changes:

| Protected observation | SHA256 |
| --- | --- |
| Porcelain v1 status, all untracked paths | `b27a1ed41c66f4dad9063fe76388bbe031dd449043e686b0c1d8168cb1389bb0` |
| `git diff --binary HEAD` | `fa6c8dddfd9893d1b535dcad11d823d10a2645ce726a3aed3c734d17752d9ad1` |
| Untracked operations handoff bytes | `511b67e11eeeb2b8c9b800918210ba826582fcd104899b9de1fde1f2144abc06` |

No credentials, service configuration values, signed URLs, browser states or private byte contents are copied into records. Only named review reports/messages, supplemental test source/type diagnostics, Git metadata and planning/runbook sources were read. No app/DB/storage service or test run, package install/generation, migration, schema/grants/registry/package modification, cloud/resource/secret operation, push/PR/deploy or recursive delegation.

## Revised conditional local merge plan — NOT executed

1. **Never merge rejected490f7d3 as the accepted result.** Correction must return a replacement exact SHA; require distinct independent PASS addressing R1, owned-format and nonempty genuine-parent-upgrade proof, explicit parent acceptance and an integration instruction. Do not substitute a guessed SHA or author tests.
2. On this isolated branch only, reconfirm clean records/shared refs and reviewed exact sources, then preserve ancestry in this order: **corrected accepted T05b → separately accepted T06a `3cc43b3b89fd52038a8e0339c3eafdb40f966f52` → accepted lint `68ee0d8bcb1c6b699fbb23e2bec0232247d96a22`**. Still wait for corrected T05b independent PASS/parent acceptance and explicit integration instruction. Use no-ff local merges only when instructed. Replacement/lint path overlap/conflicts must be assessed then; no source fixes/schema/grant/package changes are authorized here.
3. Rejected T06a225da9d8 and its active correction are **not included**; sole private-files/package owner returns replacement for separate review/decision. T17b PWA and discovery CONTRACT are also unaccepted, not automatically included. No competing writer/duplicate worker or accepted-contract edits by ledger.
4. Record resulting actual SHA and parent decisions; obtain **fresh independent exact-combined-SHA review**, including preservation, relevant stock/adapter/lint regressions and full-project typecheck with an appropriate generated client in the verifier's own environment. Old branch passes do not certify combination; no automatic whole-ID/gate promotion.
5. **No merge/ref promotion now.** Keep root integration/full-v1, main, remotes and all existing checkouts unchanged unless parent later explicitly authorizes separate promotion. No push/PR/deploy/cloud work.

## Next lawful work / unchanged gates

Current active owners are T05b correction, T06a2 correction, T17b PWA registration and staged-file discovery CONTRACT; T17a review is finished/accepted. Do not duplicate them. Corrected-stock acceptance precedes T05b2 using the existing [bounded continuation](../T05b-next-slice.md#explicit-split-after-t05b-all-required-not-done). True G2 restart UI also needs the proposed real staged-file discovery contract reviewed and implemented, plus actual referenced-byte proof; no contract/runtime/G2 acceptance from this proposal. Full F06 still requires lawful target/workflow, metadata/config/permissions and HTTP/UI, not just validators.

G0/G1, bounded T04a–d/T05a, separate T06a adapter and T17a lint stay accepted. Whole T02/T04/T05/T06/T17, G2–G6 and all134 whole IDs remain unaccepted; original matrix bytes/owners/scenarios/results unchanged. G2 URL/private human handoff/referenced-file restart gaps remain; G3/full restore are not invented literal G2 prerequisites. Historical full lint3/40 remains bound to earlier sources; independent0/39 is accepted **only at68ee0d8**, not current uncombined records or a future merge. Local-only supersedes old hosted runbooks; deployment deferred/not passed.

## Initial records-only checks at53dcd84 — retained historical results

Executed before this rejection/status update; preserved as history, not a claim those checks ran on a different final tree:

| Check | Result |
| --- | --- |
| Exact change allowlist | **PASS:** only HANDOFF, ledger, evidence index and these two new evidence records |
| Base preservation | **PASS:** all **675** other tracked base entries byte-identical, including application/tests/schema/grants/registry/packages/contracts, matrix and prior evidence |
| Requirement catalog/matrix | **PASS:** exact134 unique v1 IDs, all result cells U; matrix byte-identical to base |
| File-link targets across the five records | **PASS:**171 existing relative file targets; heading anchors not checked |
| Branch ancestry / change-path overlap | **PASS:** common db2580dd; zero T05b/T06a/record path overlaps; no merges run |
| Protected dirty checkout | **PASS:** exact HEAD, status/diff/untracked-handoff fingerprints above unchanged |
| Shared refs/root | **PASS:** integration/full-v1 and main unchanged; root clean |
| Original T06a type diagnostics | **PASS byte equality only:** parent/candidate files identical; not a typecheck rerun |
| `git diff --check` | **PASS** |

No application, DB, HTTP, browser, adapter or build/typecheck/lint suite was executed by this ledger owner. The existing three-error full-lint debt and T06a full-project typecheck caveat remain attributed, not cleared.

## Rejection/status update at03cb3d3 — retained check results

Read the supplied recovery HANDOFF only; original reports/probes/data remain untouched and their results attributed. Fresh records-only checks **PASS**: exact five-file status/evidence allowlist; **676** other previous-checkpoint tracked entries byte-identical (including source, matrix, accepted contracts and unchanged T06a attribution); exact134 unique U rows; **175** existing file-link targets across the five updated records (heading anchors not checked); model/active-session identifiers present; rejected-SHA merge command absent; no merge commits since db2580dd; shared refs/root and protected dirty-worktree fingerprints unchanged; `git diff --check` clean. No runtime tests or model-catalog lookup by ledger.

## Current bounded-lane update checks

Read only the supplied T17a REVIEW.md and T06a2 result.json; their source-bound execution is attributed, not rerun. Records-only checks **PASS**: exact six-record allowlist; **677** other previous-checkpoint entries byte-identical, including source, matrix, accepted contracts and prior attribution files; exact134 unique U rows; **183** existing file-link targets (heading anchors not checked); current source/session/model identifiers present; no merge commits since db2580dd; shared refs/root and protected dirty-worktree fingerprints unchanged; `git diff --check` clean. No source integration, application/package/schema/contract edits, services, model lookup or duplicate workers.
