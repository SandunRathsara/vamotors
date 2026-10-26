# T03a source rejection — correction running, G1 unaccepted

Recorded 2026-10-26 from the orchestrator recovery brief. **Findings, checks and task outcomes are attributed, not reproduced by this documentation worker.** No successful correction or acceptance is inferred.

## Reviewed revision and verdict

Rejected source **`ad314cdbbc8adc2bb86a086449c48c3cc4e0804a6`**, independent verifier suffix **`f0300cd4-f056-4a0d-929d-289ca5433d1c`**:

| Priority | Finding |
| --- | --- |
| P1 | Prisma P2010 nested SQLSTATE missed retry and lock mapping. |
| P1 | PostgreSQL query-supplied role, host, TLS and startup GUC overrides bypass safeguards. |
| P2 | Better Auth SQL detail logging. |
| P2 | State validation accepts inherited action properties. |

Foundation owns all four corrections. Source branch/checkout and corrected head were not supplied; do not invent them. Passing offline checks do not override this rejection. Fresh independent verification must bind to the corrected head and any subsequent integrated result before acceptance.

## Independent check summary and limits

Verifier-reported **PASS**: frozen offline install with scripts ignored; generated schema; migration diff; typecheck; **24 unit tests**; **19 contract checks**; production build; owned-file lint and formatting. Full lint: **3 errors / 27 warnings**. Exact command lines/logs were not supplied in the recovery brief; this is an attributed summary, not newly executed evidence.

**Real-DB BLOCKED:** no isolated resources or restricted credentials; private access requests timed out. Offline checks do not prove real migrations, sessions, isolation, rollback or races. [T02b1 isolation blocker](T02b1-blocked-attributed.md) remains in force: no owner/shared DB fallback or shared ACL changes.

## Recovery identities and next action

All suffixes below are under command **`c7da7ebe-28a5-4c15-983f-3a7a818760fd`**.

- Original worker `ab83bd6a-9e5d-4d42-b20b-b87552951881` is **idle**, not still running the original slice.
- Original-author correction resume **`794a695f-9afc-44a4-9bce-d3b2adfc4155`** and ledger resume **`908c80f4-b416-42b4-8c14-f6b648217500`** failed provider turns. Neither proves successful correction/recording; inspect and preserve partial work.
- Fresh correction worker **`45799758-6c45-4480-8f32-295b02141367`** is **running**, provider instance `opencode`, model `openai/gpt-6.1-sol`, isolated branch; branch/head not supplied. Reconcile its completion notification and inspect its committed artifact, then obtain fresh independent review. No duplicate worker, polling or inferred success.
- Infrastructure/user access separately owns authorized free isolated Neon branch and private restricted credentials. Prior private asks timed out; this documentation worker issues none.

**G0 accepted at `ddd69fb617b4790b3cd64cbf09cb10112d19c281`; T03/G1 unaccepted; G1 real-DB acceptance blocked; 0/134 implemented requirements accepted.** Full T02 and G2–G6 pending; downstream accepted-parent dependencies remain closed.

## Documentation recovery boundary

Branch `t3/integration-ledger-recovery` began clean at accepted `ddd69fb`. Pending ledger history was inspected first, then both commits from `t3/integration-ledger-docs` head **`9f4ea66e2ce0419956a88c98769a1dfd8f26fff8`** were carried without history rewriting: `963aabb` → `ba71500`, `9f4ea66` → `3152b90`. Carried tree equals the pending head before this update. Prior evidence remains byte-unchanged; its dispatch-time running statements are historical, superseded here.

Only ledger, HANDOFF, evidence index and this new attributed review change. No contracts/app/dependency/cloud edits, PR, push, main/integration ref changes or recursive delegation. GSD tool discovery returned no available entry point; no GSD execution claimed. Carry this recovery history with the **next substantive integration**, not a separate documentation PR. Documentation checks appear in worker handback; no application/real-DB checks rerun.
