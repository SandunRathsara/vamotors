# T04c bounded review corrections — author evidence

Base: `4c97d48e6cd0ad2b4a3b4cdab727c57068dc26b5`.
Corrected candidate: the local commit containing this record; exact final SHA is
also bound in the private `correction-summary.json` and implementation handoff.
Independent review `909027d3` rejected the base with P1/P2; **fresh independent
review is required**. This is not acceptance of T04, G2, Settings or downstream
domains.

## Changes and preserved boundaries

- Detail editing owns its opening DTO snapshot outside the transient query row
  guard. The stateful form and complete draft/reason/revision/serialized envelope
  survive zero-cache cleanup and focus verification. A local Activity hides the
  form if the current row is absent or its read fails; it does not substitute the
  opening snapshot for a current authorized detail read.
- Existing AuthBoundary/Activity verification, identity/access-change discard,
  query cache retention, current server authorization, explicit reconciliation,
  and immutable retry logic are unchanged. Confirmed auth changes still unmount
  private state. The opening revision is not silently replaced by later data.
- Money validation accepts canonical nonnegative integer strings of at most 14
  digits, preserving string MoneyJSON and maximum `99999999999999`. No numeric
  conversion can throw during validation. No coercion or trimming is introduced.
- Only two production files changed. Packages/lockfile, schema/migrations,
  contracts, ledger, admin and auth boundary are byte-unchanged. No scope expansion.

## Before: observed failures on the exact base

Tests were written and run before either production fix, using an isolated local
PostgreSQL and a production build of the exact base:

```sh
pnpm exec vitest run tests/security/settings-finance.test.ts
node --import tsx tests/security/party-edit-retention-check.ts "$OWN_DIR" --money-only
node --import tsx tests/security/party-edit-retention-check.ts "$OWN_DIR" --detail-only
```

- Unit: 5 passed / 1 failed; `safeParse("abc")` threw `SyntaxError`.
- HTTP: failed `createFinanceCompany/principal-fee/"abc"` (expected 422).
- Chromium: failed retained draft value after committed lost response,
  concurrent finance edit, and private focus/refetch.
- Reviewer artifacts were read only from
  `/Users/alpha/.config/vamotors/t04c-independent-evidence/`; their credentials,
  databases and services were not used.

## After: fresh author checks

Evidence directory: `/Users/alpha/.config/vamotors/t04c-correction-aafe/`.
Commands run from this checkout; private env values never printed.

| Check | Result | Evidence |
| --- | --- | --- |
| New production Chromium/real-PG corrections | 10 groups PASS, repeated against final build | `corrections-final.log`, `corrections-repeat.log`, `corrections-all.json` |
| Malformed money HTTP create/update × 3 policy positions × 16 values | 96 responses: 422 `INVALID_INPUT`; each leaves all counts and existing DTO unchanged | Included in corrections logs |
| Finance/supplier/vendor detail lost-response retry | Exact body/key/expected/reason retained despite later revision; same command ID/replayed result; zero extra effects on retry | Included in corrections logs |
| Finance/supplier/vendor unsent drafts and stale reconciliation | Draft/reason survive focus; stale response has zero effects; explicit reconfirm creates new key with current revision and unchanged input | Included in corrections logs |
| Finance unresolved privacy | Blur/pending hides; genuine update-authority revocation denies replay with zero effects and removes old editor; cookie account switch and logout discard private state | Included in corrections logs |
| Affected unit suites | 20 tests / 3 files PASS | `affected-units.log` |
| Retained production Settings/finance campaign | 15 groups PASS on own fresh fixture | `retained-finance-fresh.log` |
| Retained production party-directory campaign | 17 groups PASS on own fresh fixture | `retained-party-fresh.log` |
| Contract specifications | 19 PASS; specifications only | `contracts.log` |
| Typecheck and production build | PASS | `typecheck.log`, `build.log` |
| All four changed TS/TSX files lint/format | PASS | `owned-lint.log`, `owned-format.log` |
| Diff whitespace and protected-source preservation | PASS | Git diff checks; no protected-path changes |

HTTP no-effect checks include company/contact/policy rows, audit, receipt,
EntityReadVersion and BusinessSequence, plus the existing full company DTO.
Malformed cases include text, decimal/exponent, empty/whitespace, signs, negative
zero, leading zeros, trailing newline, hex, overflow, oversized strings, number
and null. Units additionally cover non-ASCII digits, nonfinite names, surrounding
whitespace, wrong shapes and exact zero/maximum round trips without conversion.

## Honest retries and bounded exclusions

- Initial setup/build could not run before locked dependencies were installed;
  `pnpm install --frozen-lockfile` succeeded without package/lockfile changes.
- Early privacy fixture repeatedly signed in and hit the production sign-in
  limiter. The final fixture reuses its session and switches to another real
  existing signed-in identity; production auth/rate limits remain unchanged.
- Retained finance first failed its created-heading assertion on the accumulated
  correction fixture. SQL confirmed that row was position **38** in its default
  id order, outside the test's first-20-page assumption (`retained-fixture-rank.json`).
  A fresh isolated fixture passed all 15 groups. Temporary diagnostic logging was
  removed; the retained runner is byte-unchanged. Failed attempts are not passes.
- Three own PG directories were used: correction, `-reg-finance`, `-reg-party`.
  Only their app/browser/PG processes were stopped. Private local fixture data
  and sanitized evidence remain. No reviewer or other services were touched.
- No full unchanged migration-upgrade/security/other domain campaign was repeated.
  Fresh schema setup was needed for isolated tests; retained campaigns' own
  app/DB restarts ran. No new upgrade acceptance is claimed.
- Whole-repo lint was not rerun: reviewer-established exact parent/candidate debt
  remains **3 errors / 40 warnings** (27 + 5 contract aliases + 8 proposal
  diagnostics), not 27 warnings. Owned-file lint is clean.
- Full Settings writes/UI/atomic write faults, remaining T04/TPRT/CUST obligations,
  T05 purchases/inline selection, T08 repairs, and T10–T14 selection, snapshots,
  histories and reconciliation remain excluded/unaccepted. READY contract
  specimens are not integrated-domain evidence. No G2/whole-requirement claim.
- Local commit only: no delegation, cloud secrets, push, PR, deploy or merge.
