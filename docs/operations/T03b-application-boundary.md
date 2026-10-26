# T03b bounded application boundary

Implementation-owner runbook, **not independent acceptance**. Base: `95ae8836b61b6901655cc53362292bb27e98fea7`. The implementation commit containing this document is the candidate; private machine-readable runs record the exact tested HEAD and whether it was dirty. No cloud actions, push, PR, deployment, dependency, Prisma, migration, foundation setup-script, ledger, HANDOFF or contract edits.

## Delivered scope

- Real restricted Better Auth credential login/error/loading and logout; safe allowlisted return paths and currentActor presentation. Signup, password reset/change, public bootstrap and raw session transport remain unavailable.
- Every application page, including guessed detail RSC URLs, invokes the live session/current-grant page seam. `/users` additionally requires Administrator. Layout protection is additional, not the read boundary. No protected list DTOs are hydrated or built as static pages.
- Existing v1 queries/commands and transaction/idempotency/revision owners are reused. User create/update supports multiple roles, current role revision dependencies, activation, reasons and creation-only passwords. Passwords are local form/request values, never React Query mutation variables/cache, storage, logs or audit. No password update/reset UI exists.
- Role create/save/archive and protected system-role presentation; JSON grant editor with the bounded live permission registry. Stale forms retain input, disable save and require explicit revision refresh/reconfirmation with a new intention key. An assigned archived role can be removed but not newly assigned.
- Administrative lists apply authorized scope, literal case-insensitive search, active/role filters, allowlisted multi-sort and stable ID ordering **before count/page**. `sort` is a JSON array of `{field,direction}`. User creation-date `from`/`through` bounds use inclusive Colombo days. Unknown/duplicate parameters, invalid values and unreadable/unsupported sort/filter fields fail closed. User list/detail include projected administrator protection.
- Permission registry HTTP output is limited to User/Role/bounded AuditLog policy. Existing downstream foundation policy primitives are not implemented domain services. The audit query remains User/Role-only.
- Client queries are no-store, stale immediately, nonpersistent and evicted on access loss, logout or identity/grant-fingerprint change. Normal navigation uses full document requests, not cached private RSC navigation. Private content is hidden until identity validation, on blur/pagehide and during focus revalidation; bfcache restoration reloads. CurrentActor is rechecked every three seconds while visible and after successful commands. Any next API/RSC request uses current grants immediately; idle UI detection has that bounded polling interval, not a push guarantee. Same-origin tab identity changes use BroadcastChannel.
- Strict existing mutation Origin checks and `private,no-store` also cover protected errors, redirects and framework 404/405 responses through `proxy.ts`. The proxy is not an authorization substitute. Local HTTP/HttpOnly/Lax cookies are the explicit foundation loopback exception, not hosted TLS acceptance.

## Route/method inventory

Executable exact inventory: `tests/security/route-inventory.ts`; source completeness check: `tests/security/application-boundaries.test.ts`.

| Surface                                                                    | Methods / outcome                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`, logo and framework static assets                                 | Public sign-in shell/static only; no protected records                                                                                                                             |
| `/`                                                                        | Live active actor, then redirect to overview                                                                                                                                       |
| `/users`                                                                   | Live active Administrator; client uses v1 safe DTOs only                                                                                                                           |
| 28 domain pages listed in `unavailablePages`, including five detail routes | Live active actor; explicit Unavailable; never import prototype data/components                                                                                                    |
| 29 legacy APIs listed in `legacyAPIs`                                      | GET, HEAD, OPTIONS, POST, PUT, PATCH, DELETE: anonymous 401; active authorized identity 503 UNAVAILABLE; foreign-origin mutations 403; no mock reads/writes                        |
| `/api/auth/sign-in/email`, `/api/auth/sign-out`                            | POST only, strict body/Origin; safe result and original cookie lifecycle; other methods 404                                                                                        |
| Other `/api/auth/**`                                                       | All listed methods 404; no raw get-session transport                                                                                                                               |
| `/api/v1/queries/[name]`                                                   | GET/implicit HEAD; currentActor or Administrator-only users/user/roles/role/permissionRegistry/audit; unsupported names 404, unsupported methods framework 405/OPTIONS negotiation |
| `/api/v1/commands/[name]`                                                  | POST only; four existing Administrator-only commands; unsupported names 404; unsupported methods framework 405/OPTIONS negotiation                                                 |
| `/api/test/reset`                                                          | Existing local retained-environment reset404 behavior preserved                                                                                                                    |
| Unmatched guessed endpoints, including `/api/users/{id}`                   | Framework 404, private/no-store; not a supported mutation seam                                                                                                                     |

Unsupported page/API originals are retained byte-for-byte in colocated `prototype.tsx`/`prototype.ts` files, outside Next route conventions, for later domain migration. Their components/mock data remain in source; they are not imported by live entry points. The lease-comparison DTO retains a type-only export for its preserved component. All 134 requirements remain in scope; unavailable is interim hardening, **not feature completion**.

## Reproduce without using author services

Use a new off-Git private directory with the foundation runbook (`T03-local-postgres.md`). This worker used `/Users/alpha/.config/vamotors/local-t03b-fabddd0f`; no existing author cluster was used or stopped. Native PostgreSQL 18 and the pinned existing dependencies/browser installation are used.

```sh
pnpm install --frozen-lockfile
pnpm db:generate
export VAMOTORS_LOCAL_DIR="$HOME/.config/vamotors/local-t03b-REVIEWER-UNIQUE"
pnpm local:setup
pnpm local:test
pnpm typecheck
pnpm test:unit
node .planning/implementation/contracts/check.mjs
pnpm build
pnpm local:test:http
node --import tsx tests/security/production-check.ts "$VAMOTORS_LOCAL_DIR"
pnpm local:stop
pnpm local:start
node --import tsx tests/security/production-check.ts "$VAMOTORS_LOCAL_DIR" --verify-retained
pnpm local:stop
```

The production check creates/stops its own Next TCP server on a free numeric-loopback port and uses real isolated Chromium contexts and real PostgreSQL. It does not run the old mock API suite, intercept network requests, use preview tools, disable the real authentication limiter, or reset the DB. It honors actual login429 Retry-After responses. Synthetic records are retained, the tested second seed administrator is restored in `finally`, and the newly created test account ends inactive. Failed interrupted test artifacts are retained, not mistaken for passing runs.

Private paths (no values): `runtime.env`, `migration.env`, `admin.env`, `accounts.env`, `cluster.env`, `postgres/`, `postgres.log` under the selected directory; all secret input files remain owner-only. New files `t03b-production-evidence.json` and `t03b-restart-evidence.json` contain only SHA/results/retained synthetic IDs. `t03b-private-failure.log`, if present, is private diagnostic output from an earlier failed attempt, **not passing evidence**. No browser traces, storage-state dumps or credential screenshots are generated. Test Next processes are stopped automatically; cluster stop retains all data.

## Validation and remaining gates

The source checks cover all page/API entry points and closed query planning. Production browser/HTTP groups cover anonymous inventory, failed/successful login, independent identities, no-store, unsupported domain denial, create/update/multiroles, role create/save/archive, stale reconfirmation, direct HTTP/RSC denial, same-cookie administrator removal and account deactivation, logout/back/account switch, keyboard dialogs/mobile width, HttpOnly/Lax cookies and empty browser local/session storage. Restart mode checks retained UI-created rows, activation, assignments, grants, revisions, archived role and restored seed-admin authority. The unchanged foundation real-DB suite retains audit/notification rollback, receipt/replay, current-grant/record/field denial, last-admin races and runtime-privilege regressions. These tests combine coarse Administrator-only HTTP/RSC denial with the existing real field-policy engine tests; they do not claim delegated partial-field admin UI support.

Expected checks: typecheck, 77 unit tests, 19 contract checks, production build, changed executable-file ESLint/Prettier and diff checks. Full lint still has exactly three baseline errors and 27 warnings: cash-flow `prefer-const` now in the **unchanged preserved** `app/api/cash-flow/prototype.ts`, and two `lib/compose-refs.ts` compiler-hook errors. Prototype formatting is deliberately preserved, not silently rewritten.

**Unfinished, not waived:** delegated administration and its parent-approved anti-escalation contract; full capability/registry/record/field UI across all future domains; full G1/T03 independent combined-SHA acceptance; full domain audit/notification surfaces; G2–G6 feature delivery and `INITIAL_SECURITY / INITIAL_PURCHASE_ONLY` schema expansion; persistent files, scheduled work and full recovery; hosted transport/provider/deployment acceptance. Administrator-only guards stay in place. No purchases, sales, reports, files or downstream requirements are accepted by this slice. Integration owns the acceptance ledger and handoff updates after the fresh independent review.
