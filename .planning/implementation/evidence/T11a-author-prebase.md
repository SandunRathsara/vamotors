# T11a author evidence — pre-combined-base checkpoint

**Author evidence only; not independent acceptance.** Runtime source commit `af60168` (following `50dba94`), branch `t11a-rates`, checkout `/Users/alpha/Developer/Personal/vamotors-t11a`, accepted starting base `00ae05292278ec9807dbd605d6ca4eebc3ea3500`. No stock candidate or unverified combined source was imported. Final parent-provided combined-base rebase, fresh install and genuine exact-parent upgrade proof remain pending; do not treat this file as that final-base evidence.

## Executed local results

- Frozen pnpm install and Prisma client generation: PASS; package manifests/lockfiles unchanged.
- Production Next build at the runtime source revision: PASS. `pnpm exec tsc --noEmit`: PASS.
- Focused units: `rates`, `settings-finance`, `party-primitives`, `purchase-acquisition`: **21 PASS**. Existing registry-version assertions now expect v8.
- Full lint baseline check: **0 errors, 46 existing warnings**. All owned runtime/UI/runner files also lint with **0 errors/warnings**; no warning regression introduced.
- Owned TypeScript/TSX formatting: PASS after formatter; Prisma schema formatted.
- Fresh project-owned local PostgreSQL18 install at private state path `/Users/alpha/.config/vamotors/local-t11a-rates-author-fresh`, loopback port51957. Separate runtime/migration/admin/account files remain outside Git. PostgreSQL server binaries18.6 were restored through Homebrew; no global service was enabled. Other worker clusters/worktrees were not changed.
- `node --import tsx tests/security/rates-check.ts /Users/alpha/.config/vamotors/local-t11a-rates-author-fresh`: **8/8 real production groups PASS**, Chromium147.0.7727.15, desktop1920×1080/mobile360×800. The campaign launches/stops its own random-loopback production Next process and browser contexts, retaining its synthetic database rows.

## Production campaign witnesses

1. Real administrator A/B and staff UI sign-ins; anonymous and foreign-Origin rate query denial; no-store protected reads.
2. Desktop/mobile UI publication → real HTTP → PostgreSQL: company A maximum1200, exact1000/12/90 and1000/24/50; company B maximum1100, exact1000/12/95 and1000/24/55. Companies/policies/contacts come from real directory commands, not fixtures.
3. Maxima before principal/term causes no business writes. Both lookup directions return identical card IDs/terms/amounts per company. Principal1001 is NO_CARD, not nearby1000;1201 is OVER_LIMIT while applicable maximum1200 remains visible. Expired discovery exposes maximum:null.
4. Desktop keyboard comparison/selection, additional fees25+10, saved immutable quote and reloadable authorized link. DB snapshots retain exact card/max/charges, actual company/contact values, current Settings version/values and expected commission. A later company path/commission/fee policy change does not rewrite the old row; quote read resolves the current authorized company revision separately. Same-key replay returns the original command/result with zero new rows.
5. Duplicate cards, invalid money/types/bounds/date order/unknown authority fields, overlapping validity, missing/stale CAS, foreign card and expired selection fail with zero effects. Reverse-installment ambiguity returns both explicit choices; selecting the24-month card saves that exact term.
6. Real grants prove company-scoped rows, owner/foreign quote404, create≠read, denied charge-field creation, independent policy/charges redaction, withheld current-company revision, explicit cross-staff Quote.read handoff, immediate revocation and revoked replay denial. A genuinely blocked UI command waits on BusinessSequence while another actor revokes its capability; after release it returns403 with zero effects. Same-membership auth refresh preserves fee values and the identical failed request while purging old private query/results.
7. Concurrent identical selection creates one quote/receipt/audit and one replay; conflicting publications produce one success/one conflict. Owner-installed essential AuditEntry failure rolls back quote/publication/receipt/read-version/sequence changes. Real500 publication refusal retains UI values/request; removing the fault permits same-key retry exactly once. Runtime cannot update/delete/truncate new immutable history or create schema objects. Direct late-card, duplicate-card and out-of-bound inserts hit actual PostgreSQL guards/constraints.
8. Inactive company excluded from maxima/comparison and cannot publish. Real409 conflict retains publication values; retry sends byte-identical request. Explicit reconfirmation retains values, while invalid principal/maximum is rejected without clearing the draft.

No mocked financial/security invariant, cloud execution, owned inventory acquisition, fabricated BrokerageDeal, or intake placeholder was used. Runners do not persist auth/browser state or print credentials.

## Schema/grants and bounded requirement result

- New migration: `202610300001_exact_rates_quotes`; old migrations unchanged. New tables: immutable `RateSheetVersion`, `RateCardEntry`, `Quote`; essential source audit/read-version/receipt graph; bounds/card uniqueness/overlap and quote snapshot checks.
- Registryv8: `RateSheet` and `Quote`, create/read only, trusted createdBy and company scope. Four new explicit protected-Administrator capabilities; no change to old grant universes, immutable Permission values or old joins. Runtime SELECT/INSERT only on new tables; no owner/DDL/delete/default-future grant.
- LBRK-01–05 implementation and author scenarios delivered; independent review remains required.
- LBRK-06 delivered only through exact selection, charges, immutable snapshot and authorized quote-context link. Actual customer/guarantor brokerage intake remains a later explicit task. The open-intake button is truthfully disabled; **no full LBRK-06/T11/T06/G4 acceptance**.
- Final integration prerequisite: parent supplies the independently verified stock+file combined SHA. Rebase preserving migration202610270004/registryv7/stock grants, then execute fresh install and the same campaign’s `prepare-upgrade`/`verify-upgrade` modes against that exact genuine parent installation. These modes exist but their final-base proof is not yet claimed here.

Runbook and integration seam: `docs/operations/T11a-rates-quotes.md`.
