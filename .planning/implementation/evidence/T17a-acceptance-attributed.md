# T17a — source-bound bounded lint acceptance

2026-10-30. Parent explicitly accepts **`68ee0d8bcb1c6b699fbb23e2bec0232247d96a22`**, base `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`, after independent **`ses_e74e7ac0affe0PE24lnzmmgx5m` PASS**. Author: `ses_e74ec9276ffeDlsFSk7sjpE04U`. Acceptance is **bounded lint only**, not T17/G6/build/release or whole-ID acceptance; source is not combined here.

Read-only original evidence: `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/t17a-independent.DVzYd1/REVIEW.md`. Ledger read the report, not its test fixtures/logs, and ran no application checks. Reviewer used a fresh detached clone and its own schema-correct generated Prisma client; requested selection was `openai/gpt-6.1-sol-fast#xhigh`.

| Independent exact-source check | Attributed result |
| --- | --- |
| Frozen offline install / Prisma6.19 generation / typecheck | **PASS**; no downloads or package/lock changes, no DB connection |
| Pristine committed unit suite | **121 PASS / 12 files** |
| Five isolated review-only lifecycle tests added | Supplemented suite **126 PASS / 13 files**; supplemented types PASS; review tests are not in candidate commit |
| Full lint, pristine and supplemented | **0 errors / 39 warnings**; baseline3 errors/40 warnings; normalized comparison found **zero new warnings**, all39 preexisting |
| Focused lint / new test formatting / diff/scope | **PASS**; no rule/config suppression, tracked candidate sources unchanged |
| Private cash-flow boundary | Route/retired page/unavailable handler/actor/HTTP helpers/queries byte-identical; all seven route methods remain authenticated/current-actor/origin/no-store unavailable; prototype stays unreachable |

Exactly four committed paths: `lib/compose-refs.ts`, `lib/compose-refs.test.tsx`, `app/api/cash-flow/prototype.ts`, `.planning/implementation/evidence/T17a-lint-author.md`. Two production hook callers both supply two refs; exported composeRefs remains variadic, setRef/composeRefs cleanup logic unchanged. Independent DOM lifecycle coverage includes identity/swaps/null transitions, callback replacement/removal, normal/Strict Mode, node replacement/mixed cleanup and fresh inline closures. Prototype change is only let→const.

Limits: existing `lib/compose-refs.ts` formatting fails on **both** base/candidate; no full-repository formatting pass. No independent browser/DB/build campaign or G6 claim. The pg SSL-mode unit warning is synthetic-driver test output, not service IO. Thirty-nine warnings are retained/triaged, not suppressed or waived. Earlier baseline3/40 evidence remains historical; exact-source0/39 does **not** certify the current records branch or future combined SHA.

Next carry remains conditional on corrected T05b independent PASS/parent acceptance and explicit integration instruction: corrected T05b → accepted T06a3cc43b3 → this accepted lint SHA → fresh independent exact-combined-SHA review. No merge/ref promotion, source fixes, services, installs, secrets/cloud, push/PR/deploy or delegation by ledger.
