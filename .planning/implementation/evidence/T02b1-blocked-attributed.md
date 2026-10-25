# T02b1 completed blocked — G1 real-DB access gate

Recorded 2026-10-25 by integration/ledger worker from the orchestrator update and read-only inspection of the infrastructure source runbook. **Worker/cloud findings and private-request outcomes are attributed, not rerun or independently accepted by this recording worker.** The existing [G0 acceptance report](T01-G0-acceptance-attributed.md) is preserved byte-for-byte; its T02b1 running status is historical dispatch context.

## Returned artifact and actual blocker

- Infrastructure task/thread suffix `b4d06816-c159-4649-852e-dd67469ffed6` **completed blocked**, branch `t3/disposable-db-provision`, commit **`bd316be80b73e25837a423d9be5ddf0513c6856a`**, accepted base `ddd69fb617b4790b3cd64cbf09cb10112d19c281`. Source author evidence: **`docs/operations/T02b1-disposable-access.md` at that exact commit**. No independent review/acceptance is claimed.
- SQL owner has **CREATEDB/CREATEROLE**, but retained shared dev grants **PUBLIC CONNECT/TEMPORARY**. New same-branch roles would inherit shared access through PUBLIC; NOINHERIT or a separate same-branch database does not remove PUBLIC privileges. Shared ACL changes are prohibited. This is an isolation/scope blocker, **not missing owner creation privilege**.
- Infrastructure reports **no resources, schemas, roles or credentials created**, no shared ACL edits, no EnvironmentID assigned. Planned private destinations **`~/.config/vamotors/disposable-test-runtime.env`** and **`~/.config/vamotors/disposable-test-migration.env`** are absent, not delivered credentials. No management API/branch creation attempted. Do not treat an identity placeholder as an actual provisioned EnvironmentID.
- Direct and pooled **verified-TLS read-only checks PASS**. These prove bounded connectivity only, not restricted-role isolation, actual adapter transactions, migrations, auth or G1 acceptance. Recording worker did not execute the preflight/diagnostic or any runbook instructions.

## Access requests and exact next action

- Worker's private project-scoped management-key request **timed out**, no secret received.
- Orchestrator personally issued `request_secret` with **`delivery: file`**, clientRequestId **`vamotors-neon-isolated-branch-management-02`**; it also **timed out**, no secret received. This recording does not represent the request as active, delivered or successful and does not issue another request.
- **Owner: infrastructure / user access. Next user action: supply a project-scoped Neon management key through the private card, never chat.** Infrastructure then requires an explicitly authorized **isolated Neon branch within verified approved free allowance**, with management inventory/capacity checked before creation. No paid fallback, alternative provider/project, shared ACL mutation or use of owner/shared DB as a substitute.
- Only after authorized isolation/provisioning may infrastructure privately deliver restricted runtime versus migrator access and actual EnvironmentID, coordinate exact table/auth grants through orchestrator with foundation, and produce isolation evidence for independent verification. No business schema or Netlify deploy is authorized by this record.

## Foundation and gates

Foundation suffix **`ab83bd6a-9e5d-4d42-b20b-b87552951881`** is **still running independent pins/schema/code**, explicitly told **not to use owner/shared DB**. Both slices were dispatched under command `c7da7ebe-28a5-4c15-983f-3a7a818760fd`, model `openai/gpt-6.1-sol` via `opencode`, isolated from accepted `ddd69fb`. Continue independent work without inventing real-DB results or dispatching duplicate workers.

**G0 remains ACCEPTED; G1 real-DB acceptance BLOCKED; 0/134 implemented requirements accepted.** Full T02 and parent T03 remain unaccepted; G2–G6 pending. Started/returned partial code cannot release downstream accepted-parent dependencies. Infrastructure access/isolation is the next real-DB prerequisite, not permission to migrate retained shared dev.

## Documentation-only recording boundary

Pending ledger branch started clean at `963aabb0ea0e4de210ee41f6352531b72901b6bb`. Updated active ledger/HANDOFF/index and added this attributed report only. Infrastructure runbook was **read from the Git source object, not carried, modified or executed**; identity JSON/preflight code and all other source-commit changes were not integrated. No PR/push, main/integration ref change, cloud/app/dependency edits, secret access, delegation or additional private request. Carry the returned new commit with next substantive integration, no separate ledger PR churn.

Documentation validation **PASS**: exact four-file allowlist; **478 other tracked files byte-unchanged** from `963aabb` including prior G0 evidence/matrix/contracts; **134 U rows**; **42 local file-link targets** exist; main/integration refs unchanged; `git diff --check` clean. Heading fragments were not revalidated. New commit returned in handback. No application or real-DB checks rerun.
