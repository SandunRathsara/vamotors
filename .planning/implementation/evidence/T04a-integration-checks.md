# T04a docs-only integration checks

2026-10-26. Local candidate branch `t3/t04a-ledger-candidate`, direct parent/base **`4c430863de3984fdb9fe5fbfb90f0c19f99ac58a`**. Exact containing candidate SHA is returned after commit in handback; this file cannot embed its own commit hash. These are integration-owner checks, not a new independent runtime verdict.

## Fresh execution

- `node .planning/implementation/contracts/check.mjs`: **19 PASS** (pure specification).
- Direct installed TypeScript strict compile of `api.ts`, `api-check.ts`, `roundtrip-check.ts` with repository-compatible `--module esnext --moduleResolution bundler --target ES2020 --skipLibCheck`: **PASS**.
- `node --import tsx .planning/implementation/contracts/roundtrip-check.ts`: **5 PASS**, specification/provenance/authorization round trips, not DB proof.
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`: **PASS**.
- `node node_modules/vitest/vitest.mjs run`: **95 PASS / 7 files**. Retained pg future-version TLS-alias warning emitted; no credentials or service were used.
- Prettier on the three new records and `git diff --check`: **PASS**. **141 relative documentation targets / nine records PASS**. Exact **134 IDs**, accountable owners, source rules, contributors and original acceptance scenarios preserved; **134 U**. **620 tracked blobs identical** outside the nine-record allowlist, including all contracts and earlier evidence. Historical documents are not bulk reformatted.

One initial standalone strict-contract command used NodeNext resolution and failed because existing extensionless imports require the repository's bundler resolution. Retried with the actual `tsconfig.json` module settings and passed, without source edits; the failed command is retained here rather than represented as a product defect or clean first run.

## Preservation and execution boundary

Only nine declared records may differ: `task-ledger.md`, `HANDOFF.md`, `requirements-matrix.md`, `local-completion.md`, `T03-G1-closure-next-slice.md`, `T04b-next-slice.md`, `evidence/README.md`, `evidence/T04a-acceptance-attributed.md`, and this file, all under `.planning/implementation/`. Every tracked blob outside that allowlist must equal exact base. All contract bytes, earlier evidence records, original requirement catalog/owners/scenarios, application code, tests, schema/migrations, grants, packages/lockfiles, infrastructure interlocks and user work remain unchanged. The matrix keeps all134 IDs and `U` results; only CUST-01–04 evidence/seam cells and current scope text are reconciled.

Exact source-manifest binding: SHA-256 **`30d7ffbf4d66d08794d3d145c783d02db997a07bb82c4e1f8edaa234ff333a7b`** over `git ls-tree -r 4c430863de3984fdb9fe5fbfb90f0c19f99ac58a` lines excluding the nine records, with newline termination. All corresponding candidate file bytes match; this identifies unchanged blobs, not a new source review.

Installed dependencies reused through an ignored checkout-local `node_modules` symlink to the exact-source independent review checkout; no install, package-manager/lifecycle invocation, generated schema or dependency changes. Existing GSD availability limitation is inherited from the accepted integration records; no GSD entry tool was exposed and local `gsd` was not found. This is the directly requested bounded integration/ledger work, not a claimed GSD run.

No production build or DB/browser/service campaign is rerun for byte-identical source; build and runtime evidence remain attributed to the named independent reviewers in [acceptance mapping](T04a-acceptance-attributed.md). Full lint **FAIL 3 errors / 27 warnings** is explicitly retained from independent exact-source evidence, not freshly run or fixed. G6 remains pending. No cloud/environment-secret reads, service use, source fixes, delegation, push/PR/deploy or accepted-ref movement. Local `main` and `integration/full-v1` remain at their initial refs.
