# T05c acquisition runner shutdown — bounded TEST-ONLY correction

2026-10-30, parent-authorized disjoint one-file harness correction on clean **6791c90d6b54b97ed1dcfe3c43452f4cf554f1db**. **No application/schema correction, costs acceptance or shared-source ownership transfer.**

## Parent diagnosis / unresolved author evidence

- Parent reports the upgraded acquisition attempt hung about22 minutes after14 groups: restart group at original `purchase-acquisition-check.ts:1278` awaited `stop()` at90–96. Original app had no listening socket but its child remained alive. This is a **diagnostic inference, not JS stack proof**; ledger neither inspected nor adopted that process/root.
- **Terminal parent notification supersedes the earlier running recovery:** **ses_e73984cfdffetqQ2tKxiAwF31b COMPLETED/RELEASED**, full nine-root cleanup proved. Both source98 trees clean, all nine PG roots stopped/data retained, no owned test/app/browser. Exact stalled author job **sh_18c5e1e930011XG6EnepboxH16 CANCELLED-STALLED-GROUP15** after identity checks/SIGTERM to the runner first; **no force, no twelfth receipt and no original harness exit/completion metadata**. **AUTHOR-CAMPAIGN-INCOMPLETE /11 of12 receipts** is distinct from successful cleanup;14-group partial/failed/blocked/missing-metadata provenance retained. No author/root campaign rerun by this worker.
- Original author source **98fd8aaf02f28dcda8d47bb199971de895a960c8 remains FROZEN**, genuine ACK/release retained. **T06b ses_e738d7ffaffeXx7RewTpqYvIg0 exclusively owns shared schema/registry/grants/dispatcher/config** under [prior explicit dispatch](T06b-active-ownership.md). This narrowly disjoint test correction requires no T06b freeze; any later shared-source correction still first requires T06b checkpoint+freeze+ACK before reassignment.

The **FINAL stable authoritative dossier** `/Users/alpha/.local/share/vamotors/t05c-final-author-98fd8aa-20261030/{manifest.json,HANDOFF.md,final-state.json,terminal-cancellation.json,terminal-upgrade-retention.json,artifact-sha256.json}` was read only after parent explicitly permitted it. Ledger verified **all278 indexed artifact hashes/byte lengths**, including retained history; recovery preserves the old131-artifact BLOCKED package. Static terminal records corroborate nine stopped/retained roots, both clean source98 trees, runner-first SIGTERM only, original nonempty financial/rate/quote history and **668 old runtime column grants** retained. `terminal-dossier-check.json` binds those six authoritative files and checks; no live source/services/private runtime files were inspected, adopted or polled. Cleanup/retention is not acquisition group15 restart proof; `seal.py` remains unexecuted intent, not completion evidence.

## Exact correction / review-target supersession

Only **`tests/security/purchase-acquisition-check.ts` → `stop()`** changes. Capture the runner's own spawned child; both `exitCode` and `signalCode` must be null before waiting. Install the real exit wait before SIGTERM; after5 seconds report `APP_STOP_SIGTERM_TIMEOUT` and SIGKILL **only that captured child**. Still await real exit; at10 seconds reject `APP_STOP_TIMEOUT` if no exit. Clear both timers and abort the exit listener in `finally`; successful signal delivery alone is not an exit. This reuses the local production runner's5-second escalation idiom, adds the missing final bound/cleanup, and introduces no generic helper/dependency.

**New final runtime REVIEW target: the clean containing test-corrected candidate SHA returned in handback and its external manifest.** Parent expressly supersedes original combined **e9a9b0bfb515bca254b7b3aaa35ba65386fa67ef** only with that returned candidate; no self-referential SHA is invented here. All application/schema/migration/registry/grants/package/private-files/PWA/contracts bytes remain exact source98; current records/history remain. One test-helper exception is explicit, not source98 test-byte equality or inherited campaign PASS. Prior frozen-target assertions in the assembly/ownership records are historical under this bounded supersession.

## Narrow execution / unchanged assertion proof

External evidence/probe root: `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/vamotors-acquisition-stop-test-k89ylv3k/`.

The probe **extracts/transpiles the actual runner `stop()` AST**, not a mirrored implementation, and uses only its own synthetic Node children; it does not initialize the runner/app/DB or read private runtime configuration. Command (repository cwd, evidence paths shown above):

```sh
node <evidence-root>/probe.mjs "$PWD" <evidence-root>/final-probe.json include-failure
```

| Case | Original helper | Final formatted helper |
| --- | --- | --- |
| Graceful SIGTERM exit | PASS | PASS, real exit0,3ms |
| Already signaled/exited, exitCode null/signalCode SIGTERM | Deadline FAIL | PASS,0ms/no extra signal |
| Child ignores SIGTERM | Deadline FAIL | PASS, real SIGKILL exit after5009ms, truthful fallback diagnostic |
| Signals deliberately not delivered to owned live child | Not run before | PASS, `APP_STOP_TIMEOUT` after10003ms, exit listener removed; probe then cleans up its own child |

Final probe also asserts shutdown timers cleared. First corrected probe4/4 preceded a formatting-only line wrap; final exact formatted helper4/4 is retained separately. Original red results remain `before-probe.json`; no application campaign result is manufactured.

**Assertion preservation PASS:** runner prefix unchanged; the entire **42,330-byte remainder from `const browser` onward** is byte-identical to both ledger6791c90 and frozen98, SHA256 **`cffe22eb6ddca068faf784d27ed5b88109610446017a33af84886c60fca4ac9d`**. Independently parsed **all15 scenario group bodies/hashes,89 `assert.*` callsites and15 `expect(...)` sites** in that remainder are unchanged. Full runner still has94 `assert.*` callsites. Static counts are not executed scenario passes. `assertion-preservation.json` binds every group body hash; no assertion weakened or removed.

**Owned lint/format/diff and strict isolated extracted-helper typecheck PASS. Full project typecheck FAIL, not waived:**98 diagnostics from installed Prisma types lacking rates/cost models; a compiler-host overlay of the exact6791c90 runner produces **byte-identical98 baseline diagnostics**, none in this runner. `typecheck.json`, `full-typecheck.log`/`baseline-typecheck.log`, `isolated-typecheck.log` retain this result. No client generation/install/package changes or build was performed. Initial format failure and corrected line wrap are disclosed; final owned checks use normal installed direct tools, no package-manager side effects.

## Future distinct review — NORMAL committed runner

Parent has dispatched distinct costs reviewer **ses_e73866f03ffef8LtV6wZH4jIq7, RUNNING prep/static/own genuine accepted-parent fixture only**, awaiting **this worker's returned exact test-corrected SHA before runtime campaigns**. This status is parent-attributed, not a reviewer query. Bind that candidate, then the reviewer uses its own clean source/client/roots for fresh install and genuine **NONEMPTY accepted-e9 parent upgrade**, final costs/F1/rates/stock/audit/acquisition and affected regressions. Execute the normal committed acquisition runner on both suitable fresh and genuine-upgraded roots, from the candidate source whose PROJECT marker matches each root:

```sh
node --import tsx tests/security/purchase-acquisition-check.ts "$VAMOTORS_LOCAL_DIR"
```

No special probe, wrapper, external replacement runner, author root or cancelled-run receipt substitutes for this full15-group campaign. Final costs and retained review requirements remain those in the [T05c brief](../T05c-next-slice.md#transaction--real-ui--verification-bar); T06b still must later reconcile onto parent-accepted T05c source and pass final integrated review.

**F1 OPEN; VSTS-03 U;26 LOCAL/108 U/134**, matrix/bindings unchanged. Recovery cleanup is completed/released; **author campaign remains incomplete and independent final-candidate runtime verdict pending**. No costs/new-ID/G2–G6 acceptance or promotion. Primary acceptede9/main/remotes/protected unchanged; local commit only, no cloud/push/PR/deploy/reset/delete/delegation or fabricated GSD execution.

**Light preservation/link/diff checks PASS:** one runner plus seven records only; **755 other entries/modes/blobs exact6791c90**, all585 other nonplanning entries exact frozen98. Matrix SHA256 `93c19de098480685cdccc969f80d28a18bbea2dafa8e815b8f09c475de5f2ffd`, both brief bodies and historical sections preserved; **10 added local links including fragments** valid, main/accepted-primary/remote refs unchanged. `preservation-checks.json` and final containing-candidate manifest bind these checks, the four final child probes and unchanged assertion hashes. No application campaign/build/live-author inspection/job poll was run.
