# T01 corrected candidate — attributed rejection and diagnostic handoff

Recorded 2026-10-25 by the integration/ledger worker from the orchestrator's bounded dispatch. Reviewer results below are attributed, not independently reproduced by this worker. Historical evidence and contracts remain unchanged.

## Revision and verdict

- Latest accepted integration/base: `ec4cfb4c1a52c5112189e037b0a82fadffd1bae8`. PR [#3](https://github.com/SandunRathsara/vamotors/pull/3) merged; its tree equals approved `33624fb`. Browser readiness is accepted **environment-only**. Bounded T02a remains accepted; full T02 is pending.
- Corrected T01 candidate `a0e5eee1426dd91bcc8890d82065d7bad6e4a4b2` was rejected by fresh independent verifier `fa328726-7afd-4846-a7a5-4ad503a30717`. Orchestrator rejects T01/G0; neither implementation nor acceptance is claimed.
- Previous seven findings: **4 PASS, 3 still FAIL**. Semantic coverage: **134 mapped, 128 adequate, 6 blocked** — FNDN-08, RCNL-02, REPT-07, IMPT-02, LBRK-06, LBRK-15. This is contract coverage, not implemented/accepted feature coverage; **0/134 accepted**.

## Three remaining source inconsistencies

1. Reconciliation read DTOs omit mandatory current entitlement/remittance revisions and notice-line/allocation/discrepancy IDs.
2. Historical imported disposal legacy approver cannot satisfy the mandatory current approval FK/reportId. No fabricated approval is allowed.
3. Quote read/requote authorization lacks a grantable `Subject` or a defined parent mapping.

## Attributed checks and boundaries

Verifier reports `check.mjs` **19 checks PASS**, strict `api` + `api-check` compiler checks PASS, and diff check PASS. Independent adversarial dependency, maxima, requote, graph and **10,003-row snapshot export** cases passed. These successes do not resolve the source inconsistencies or change the rejection. Money/state and original functions are unchanged. Reviewer performed no writes, installs or cloud changes.

## Active ownership and next action

Following the repeated-failure diagnostic rule, the orchestrator dispatched a fresh focused foundation correction worker, task/thread suffix `99ba88de-c22b-4f56-a478-4652174b76a0` under command `c7da7ebe-28a5-4c15-983f-3a7a818760fd`, running in isolation from candidate `a0e5eee1426dd91bcc8890d82065d7bad6e4a4b2`. Original author is idle. The diagnostic worker is the **sole contract writer**; do not duplicate work. No other implementation is ready until T01 is accepted; T03 remains blocked. Next: focused correction and regression evidence, then fresh independent verification and orchestrator acceptance of the integrated revision.

This recording branch is `t3/record-t01-rejection-status`, based exactly on accepted integration above. Carry this small status record in the next substantive contract integration; **no separate ledger-only PR**. This worker made only ledger/HANDOFF/evidence edits, with no delegation, contract/application changes, installs, cloud actions, pushes, PRs, or integration/main ref updates.

## Local record checks

- Accepted merge/base tree equality with approved `33624fb`: PASS (Git tree `73f5b9014939b36f4e27aa7ea401d93aafb92398`).
- Four-file documentation-only allowlist, relative file links and `git diff --check`: PASS before commit. Historical evidence/contracts unchanged. No contract tests rerun by this recording worker.
