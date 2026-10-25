# T00 preservation evidence

Date: 2026-10-25. Author: integration/ledger worker, `openai/gpt-6.1-sol`, provider instance `opencode`.

## Commit boundary

- Initial branch: `main`; HEAD: `233249f6e874796df9ee80cd58c6d40040e1f84c` (matches dispatch).
- Created `integration/full-v1` without resetting, cleaning, stashing, or overwriting files.
- Preservation commit: `8203d2a1dbd9b98c13d3188abf53286f393d98c7`.
- Explicitly staged only the eleven inspected files below. Three were modified tracked files; eight were untracked files. No unrelated files were staged.
- Initial tracked diff: 3 files, 20 insertions, 4 deletions. Preservation commit: 11 files, 9,001 insertions, 4 deletions (includes formerly untracked documentation).
- No push, PR, default-branch merge, cloud mutation, secret-file read, or secret installation in T00.

## Original bytes (SHA-256)

These hashes were calculated **before staging**, after inspecting the tracked diff and reading the plan, C4 decisions, research, and documentation structure. The byte scan read all eleven files, including embedded viewer data. Verify against Git blobs and checkout bytes; preservation is not endorsement of old research claims.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `.gitignore` | 532 | `d8205c9e74eba37e74aa997178767503510a52038d173638899ef14861104a57` |
| `package.json` | 2187 | `97016604681c8f6e5e620b0141f6ec68006d25a16bb970c9d9038ed96ae02cbe` |
| `pnpm-lock.yaml` | 351526 | `45f118a44c0481f6e1a5fadb33bd9dab7d4ec7de7c5235cdb4a6094430739164` |
| `.planning/FULL-IMPLEMENTATION-ORCHESTRATION.md` | 32956 | `afc25b7836527bca62cea4677b5468196a9c928b853b9aeca98167f89dd9f7c2` |
| `.planning/research/c4-business-findings.md` | 57235 | `9728073c0711dafc4d5590e7f8f6a1b4057d2bc988c6c6f27ab142eb75e0f85e` |
| `.planning/research/c4-current-findings.md` | 49488 | `0aceb86ea91afcc0d41b406051e3f6cc37d59b401d118dc58fee9f0d4d383f7d` |
| `.planning/research/c4-infrastructure-findings.md` | 32364 | `fd1b390f4ecf4b7e011434d23c951be3c6b2654af4f15f9d52e454d6e2b7d51a` |
| `docs/architecture/build-model.py` | 71460 | `32c79540f748dbf9076e8d4ae91eed4f737493565367ac26030226ea16cc84ce` |
| `docs/architecture/c4-model.json` | 120180 | `938f7b4927a199f1cd55280de01bce6e80900e2537b5ebac44823bbffc6917ac` |
| `docs/architecture/c4-viewer.html` | 149329 | `4ff5882e2a7c66586e08d2e1e8198b0c73c1080c53dc4f08d28d81a2548c3c31` |
| `pnpm-workspace.yaml` | 61 | `be1316e880567697567d8dd45722e8d9bbd0c660d6e4ce6ee8bac7448850e2a4` |

## Inspected intent and exclusions

- `.gitignore`: preserves user's `.netlify` exclusion.
- Manifest/lock: preserves portless dev command, explicit `dev:port`, portless dependency, and react-is resolution change; no dependency repair attempted.
- Workspace: preserves build approvals for msw, sharp, unrs-resolver.
- Plan/research/C4: preserves all source material, generator, model and standalone viewer unchanged. The plan's approved Netlify default supersedes the older unresolved-host annotation without rewriting the user's artifacts.
- Credential-pattern scan: no PostgreSQL connection URLs, AWS-style access IDs, private-key headers, GitHub token patterns, or assigned database/R2 secret values detected in these candidates. This is heuristic screening, not a guarantee of absence of every possible secret.
- Existing tracked environment/auth-related files: `.env.local.example`, `playwright/.auth/.gitkeep`, `tests/auth.setup.ts`; no browser storage-state JSON or credential files staged. Test artifacts remain ignored.
- Private config is referenced only by path/name in the contract and handoff; its contents were not read.

## Reproduction

1. `git show --stat 8203d2a1dbd9b98c13d3188abf53286f393d98c7`.
2. For each row, SHA-256 of `git show 8203d2a1dbd9b98c13d3188abf53286f393d98c7:<path>` must match above and the working file.
3. `git diff --exit-code 233249f6e874796df9ee80cd58c6d40040e1f84c -- app components hooks lib tests playwright.config.ts Justfile` returned 0 after baseline checks: no application or test fixes.
4. `git status --short` was empty after preservation/checks, before creating the T00 ledger files.
