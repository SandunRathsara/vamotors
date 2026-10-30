# Authorized lint + CONTRACT candidate / accepted baseline promotion

2026-10-30. Parent authorizes two local no-ff merges on the isolated candidate branch and **only** the primary baseline fast-forward. No candidate acceptance is inferred. Current model authority remains parent-verified `openai/gpt-6.1-sol-fast#xhigh`; no delegation/cloud/push/PR/deploy.

## Actual Git outcomes

- Own branch/path unchanged: `integration/local-v1-ledger-20261030` at `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/vamotors-local-v1-ledger-20261030`.
- Started clean at records head `d039cfe5334993fe1621f927f7b6ef3e093a0f70`.
- Ordinary `git merge --no-ff --no-edit 68ee0d8bcb1c6b699fbb23e2bec0232247d96a22` produced **`b11072e8ddb7ae3cd4a317a69f005300dce1cb68`**; accepted lint's four paths carried unchanged.
- Ordinary `git merge --no-ff --no-edit 6c68a653178dab8a005d9d9df191864e04e59bcf` produced **`de4c46784955bf47e57c01f7d950a2b105f1f5e4`**; accepted CONTRACT's eight paths carried unchanged. No conflicts, cherry-picks or source fixes.
- Primary `/Users/alpha/Developer/Personal/vamotors` was independently rechecked clean, on `integration/full-v1`, exact **`ddd69fb617b4790b3cd64cbf09cb10112d19c281`**; ancestry to accepted db2580dd confirmed. Authorized `git merge --ff-only --no-stat db2580dd7fa722489c591f3f9ed8ed0ea4d26a72` **succeeded**. Primary now contains accepted foundation/T05a at **exact db2580dd**, not this mixed candidate or failed T05b.
- `main` remains `233249f6e874796df9ee80cd58c6d40040e1f84c`; remotes not updated. Protected `t3-9e9619b8` and all existing worker checkouts untouched.

Containing final records head is returned in handback. Executable/contracts under test are exact de4c467; the subsequent integration-owned diff is records only. Final combined verification still awaits corrected T05b independent PASS/parent acceptance + accepted T06a carry; neither is merged here. Rejected490f7d3, rejected T06a225da9d8 and unaccepted T17b are excluded.

## Fresh integration-owner checks — not independent acceptance

Own node_modules did not previously exist. `pnpm install --offline --frozen-lockfile --ignore-scripts` cloned909 packages from local store, **downloaded0**, no lifecycle scripts or package/lock edits. Explicit `pnpm db:generate` generated Prisma6.19.0 inside **this worktree's own** node_modules, not a borrowed client. Service/auth/cloud credential variables were removed for package/app checks; no secret file, DB or cloud connection used.

| Check on de4c467 source | Fresh result |
| --- | --- |
| `node .planning/implementation/contracts/check.mjs` | **20 PASS**, specification only |
| Own TypeScript5.9.3 five-file strict no-emit compile | **PASS**: api/api-check/roundtrip/party-detail-settings.proposal/proposal-check |
| Same five-file CommonJS emission, run both specimen executables | **8 + 3 PASS**, specification only |
| `pnpm typecheck` with own generated client | **PASS** |
| Focused Vitest compose-refs + application-boundaries | **2 files / 11 tests PASS** |
| Full `pnpm lint` / captured direct ESLint JSON | **PASS, 0 errors / 46 warnings** |
| Warning comparison to original accepted lint reviewer JSON | **39 retained, 7 added, 0 removed** after root-path normalization; all7 added are unused contract assertion aliases in api-check.ts, not new application diagnostics. No warning suppressed/waived or accepted source changed. |
| `git diff --check db2580dd HEAD` | **PASS** |

Seven aliases: PreviewReadUnchanged, BatchListParams, BatchListData, BatchFileData, NoFileCapabilities, OnlyFinalAttachment, NoUnlinkedAttachment. Exact lint68ee0d8 independent0/39 remains true for that source; it must not be relabeled as this combined candidate's result.

Local emitted specimens/logs/lint JSON and warning comparison: `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/local-v1-integration-checks-grekgf2a/`. Original independent CONTRACT6 probes remain attributed, not fresh integration execution. No full build/unit/DB/browser/storage/G2 campaign or whole-ID promotion here.

## Preservation / next action

At this checkpoint, fresh preservation checks **PASS**: exact six-record follow-up allowlist; all4 accepted lint paths and all8 accepted CONTRACT paths byte-identical, entire contracts tree exact6c68a653; **670** other previous-checkpoint entries preserved; matrix exact134 unique U; **190** existing file-link targets across six records (anchors not checked); own client inside own worktree; primary clean exactdb2580dd/main unchanged; protected dirty-worktree fingerprints unchanged; rejected490f7d3/25da9d8, unacceptedf27c1d9 and separately accepted adapter3cc43b3 are **not ancestors/carried**. Diff whitespace PASS. This is a pre-PWA source snapshot, not authority to reverse later parent decisions.

Next integration at this snapshot waits corrected T05b independent PASS/parent acceptance/instruction, then corrected T05b + separately accepted T06a and fresh distinct exact-combined-SHA verification. Primary stays accepteddb2580dd. Subsequent parent acceptance/authorization for T17b is applied only after committing this checkpoint; its PWA merge/results are recorded separately. T06a2 correction stays excluded.
