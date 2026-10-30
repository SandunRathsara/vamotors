# T06b — private staged-import source attachments

## Source boundary

Reconciled onto exact parent-accepted
`ac746b90ce9782fd35635847dff6c1b3ab669618`. All13 accepted migration files,
cost/privacy/acquisition behavior and bounded F1 correction are unchanged.
Migration `202610300004_import_attachments` is the14th migration; registry10
preserves every accepted v9 universe and adds only two separate subjects. Old
PREBASE/e9 roots and evidence remain historical, retained and stopped; final proof
uses new fresh and genuine exact-ac13-migration nonempty roots.

This is source-file staging/retention, not historical business import. It creates
real `STAGED` metadata and private attachments, never preview rows, graph/hash,
control totals, `VALIDATED`/`COMMITTED` status, provenance or business cash rows.
No preview/confirmation command is enabled. Only `IMPORT_BATCH` + `IMPORT_SOURCE`
CSV/XLSX is accepted. No invented SaleCase/BrokerageDeal/Remittance/vehicle target.
Accepted contracts, adapter/parser/workers, packages/patches and PWA bytes stay
unchanged. No hosted, restore, T16, full T06/G2 or gate acceptance is claimed.

## Local configuration

Fresh `local:setup` creates these **server-only** runtime entries alongside the
existing restricted connection and Environment identity:

- `PRIVATE_FILES_ROOT`: dedicated retained `private-files/` beneath the operator's
  off-Git local directory, exactly0700/current UID; not temporary, public or static.
- `PRIVATE_FILES_POLICY`: separate0600 regular non-symlink operator JSON file.

The adapter independently checks root/ancestor ownership, symlinks, inode/mode,
forbidden checkout/public/temp roots and environment-bound keys. No client key,
filesystem path or storage credential is accepted or returned. This binding is
local-only; unknown/nonlocal configuration fails closed. Never install cloud,
migrator, bootstrap or another worker's credentials in the runtime.

Policy shape (operator chooses actual capacity; the UUID below is illustrative):

```json
{
  "environmentId": "11111111-1111-4111-8111-111111111111",
  "allowWrites": true,
  "reviewedThrough": "2026-10-31T00:00:00.000Z",
  "maxBytes": 268435456,
  "minFreeBytes": 134217728,
  "maxEntries": 10000
}
```

Setup gives its new own environment a conservative256MiB local budget,128MiB
free-space floor and24-hour review deadline. The current callback rereads the
policy on each check, verifies0600/UID/size/expiry/Environment, checks real statfs
free space and bounded inventory, and reserves three5MiB transfers per in-flight
operation.85% of budget stops new writes; unknown/truncated/unsafe inventory or
expired policy also stops writes. Hardlink aliases are conservatively overcounted,
not misrepresented as extra documents. No paid fallback or silent pruning.

Operate **one local app instance** for a root. IO is two concurrent operations per
process, no queue; raw transfers have a15-second/original-expiry deadline and a
5MiB bound. This is not a distributed capacity reservation service. Existing
retained downloads do not call the write policy. Operator review/renewal is
deliberate; ordinary startup never renews policy, reseeds, migrates or resets.

## HTTP and UI

`/imports` lists currently authorized staging metadata; `/imports/{id}` rediscovers
actual upload intents and FINAL attachment references independently of preview.
Filters round-trip in the URL: exact state/namespace, case-insensitive literal
namespace search, Colombo creation dates. API sort is id/createdAt/state/namespace,
default createdAt desc/id asc. Unknown predicates/order422, forbidden leaves403.
Read scope precedes search/count/order/page. Detail is one repeatable-read snapshot,
independently scopes Document rows/fields and returns all authorized intents in
uploadId order, including populations over100. It returns no hidden counts/keys.

1. `stageImport` persists revision1/actor/time/types/namespace, no business rows.
2. `initUpload` requires a real batch and current target CAS; persists metadata and
   audit before201 `UPLOAD_READY`. Its receipt contains references, **not a URL**.
3. The returned relative URL is the real same-origin authenticated raw
   `PUT /api/v1/uploads/{uploadId}`. It requires exact Origin, session, original
   five-minute expiry, declared MIME/hash/size and current source+Document authority.
   It cannot address a final key. Discovery can reselect exact bytes for this proxy,
   but never renews expiry or reconstructs a lost bearer capability.
4. `completeUpload` explicitly finalizes or recovers a persisted attempt.
5. `download(attachmentId)` returns a current-authority GET proxy reference with a
   sixty-second observation deadline. Actual `GET /api/v1/attachments/{id}` validates
   that deadline and **reauthorizes target and Document fields before and after IO**.
   The deadline is not a bearer authority: changing a date cannot bypass auth.
   Responses are private/no-store, nosniff, sanitized attachment disposition.

The UI shows STAGED/INIT/FINALIZING/FAILED/FINAL truthfully. A live lease is in
progress; an expired lease offers explicit persisted-attempt recovery. Expired or
stale INIT needs new init/key using the current batch ref. Missing projected refs
disable actions. Uncertain responses retain the exact serialized request/key;
stale reload/reconfirmation is distinct from replay. Navigation/restart rediscovers
the DB, not browser memory. No private bytes or writes are queued/cached by the SW.

CSV remains the accepted strict ASCII subset, not full UTF-8/domain import. XLSX
uses the accepted bounded worker/parser. Native versions/patches, Node24/POSIX,
app-root CWD, unbundled mjs, two-child/no-queue/10s and sampled—not hard OS—RSS
limits remain unchanged. Byte validation does not establish a valid import graph.

## Authorization and grants

Existing subject/action universes are byte-identical, so old wildcard/compound,
create and delegation ceilings cannot acquire either new subject. Existing
permissions/joins are preserved; the migration appends six immutable positive
rules **only to protected Administrator** and increments that role revision.
Canonical hashes are revalidated during setup. No protected ImportBatch.import,
Administrator membership or invented `upload` verb is granted to stage/read files.

| Operation        | Exact current checks                                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| stage            | ImportBatch.create: types,namespace on server-owned candidate                                                                                                                                         |
| init/PUT         | ImportBatch.read id,revision,uploads; update uploads; Document.create target,purpose,filename,contentType,size,sha256 on actual immutable uploader; Document.read uploadId,revision for persisted PUT |
| complete/recover | same target read/write; Document.read uploadId,revision,attachmentId; current uploader's create fields **or** explicit Document.update uploadId for another uploader                                  |
| discovery        | ImportBatch summary/each uploads.leaf plus independent Document.read on intent; FINAL attachmentId also checks actual Attachment                                                                      |
| download         | actual batch read id,uploads.attachmentId AND actual Document.read attachmentId,filename,contentType,size,sha256,bytes                                                                                |

Read-only/own/delegated discovery alone confers no upload/finalize/import authority.
All mutation phases serialize BusinessSequence → AdminGuard → current session →
batch → intent. A revocation committed before that authorization lock wins. The
current session/activation/role rules are reloaded in each phase, not trusted from
the original request or a new browser ref.

New runtime SQL map (old purchase/rate grants unchanged):

- SELECT/INSERT: ImportBatch, UploadIntent, UploadAttempt, Attachment, UploadEvent.
- UPDATE ImportBatch: **revision only**.
- UPDATE UploadIntent: **revision,state,currentAttemptId,claimExpiresAt only**.
- No attachment/attempt/event/audit/read-history UPDATE/DELETE, no business DELETE,
  DDL/ownership/default future-table privilege. Immutable-history triggers remain.

The only target FK is typed ImportBatch. Deferred graph checks correlate original
environment/uploader/purpose/declaration/attempt/final key and require FINAL linkage,
revision/event/audit/read-version/receipt evidence. The database does not pretend a
declared hash is validation proof: recovery revalidates retained bytes through the
actual adapter before linking.

## Claim, IO and recovery

Two short serializable phases surround external IO; no storage/parsing runs inside
a transaction or automatic retry callback. First phase authenticates and checks
current source/document fields, original expiry, caller refs and captured target.
It claims INIT→FINALIZING, bumps intent and persists an immutable UploadAttempt:
original command/key/digest/refs, actor, exact expected bytes and server final key.
UploadEvent plus safe audit/read-version/receipt records every protocol transition.

Outside the transaction, `validateStage` is called once; its opaque same-instance
token is passed directly to `finalize`. The exact validated snapshot is retained,
never re-read from overwritten staging. `readFinal` verifies retained hash/size/type.
Second phase reloads current session/authority/target, checks captured target and
the claimed attempt/revision/live lease, then atomically inserts Attachment, FINAL,
parent bump, audit, versions and original receipt. Lost-response exact-key replay
returns that result without another link/bump/audit. A different key is not replay.
Explicit reconfirmation with a new key and current FINAL refs returns the same
attachment with a new no-op receipt, never another link/parent bump/history delta.

After lease expiry, explicit recovery uses the persisted attempt/final key and
`readFinal` validation; no WeakMap token, caller attempt/key or staging bytes are
trusted. A new coherent read supplies current refs but does not waive captured
target CAS. Original exact-key recovery separately recognizes only its stored
unchanged digest/original refs. Live competing claims return COMMAND_IN_PROGRESS.
No retained final means DOCUMENT_NOT_READY/FAILED, not permission to upload fresh
bytes under an expired intent. A post-IO revocation/stale target/DB evidence failure
leaves an unlinked correlated final; it is not FINAL/business evidence. Recoverable
orphans link only after current authorization and exact retained-byte verification.

No automatic deletion exists, including staging. Final orphans remain for operator
review. A future staging cleanup must prove terminal/unreferenced/original expiry
+24h grace; a truncated inventory is incomplete, never a complete orphan census.
Filesystem guarantees retain the adapter's honest trusted-UID/ancestor limits.

## Retained checks

Use only new worker-owned roots. Never point these runners at a shared/primary
environment. Every failed root/execution stays retained; stop your own services.

```sh
pnpm install --frozen-lockfile
pnpm exec prisma generate
VAMOTORS_LOCAL_DIR="$OWN_LOCAL_DIR" node --import tsx scripts/local-postgres.ts setup
pnpm build
node --import tsx tests/security/import-attachments-check.ts "$OWN_LOCAL_DIR" "$OWN_PRIVATE_FILES_ROOT"
pnpm exec tsc --noEmit --incremental false
pnpm exec vitest run
VAMOTORS_LOCAL_DIR="$OWN_LOCAL_DIR" node --import tsx scripts/local-postgres.ts stop
```

The full runner uses real production Chromium sign-in/UI at1920/360px, active SW,
restricted HTTP/DB/files, second/staff/fresh accounts, response-loss and concurrent
commands,101-intent discovery, MIME/hash/size/expiry/CAS/authority negatives, capacity
stop, natural five-minute deadlines, app+PG restart and new-session exact download.
Its separate **test-only child** authenticates a real browser session and uses the
same coordinator/restricted DB/real adapter with IO barriers: deterministic snapshot
overwrite, during-IO revocation, post-final crash, target change and essential-write
rollback. These barriers are supplementary coordinator fault proofs, not a hidden
production route or a claim that every crash case was driven by browser transport.
The child is killed/awaited or closed; no capability/credential is printed.

Genuine nonempty upgrade (fresh exact accepted-parent worktree, its own install,
generate/build/local setup **before** candidate migrations):

```sh
node --import tsx tests/security/import-attachments-upgrade-check.ts prepare "$OWN_UPGRADE_DIR" "$ACCEPTED_PARENT_SHA"
node --import tsx tests/security/import-attachments-upgrade-check.ts bind "$OWN_UPGRADE_DIR" "$ACCEPTED_PARENT_SHA"
VAMOTORS_LOCAL_DIR="$OWN_UPGRADE_DIR" node --import tsx scripts/local-postgres.ts setup
node --import tsx tests/security/import-attachments-upgrade-check.ts verify "$OWN_UPGRADE_DIR" "$ACCEPTED_PARENT_SHA"
VAMOTORS_LOCAL_DIR="$OWN_UPGRADE_DIR" node --import tsx scripts/local-postgres.ts setup
node --import tsx tests/security/import-attachments-upgrade-check.ts repeat "$OWN_UPGRADE_DIR" "$ACCEPTED_PARENT_SHA"
```

Prepare uses real parent HTTP to retain purchases/payments/stock/Settings versions,
finance/contacts/rates/quotes, costs/edits/payments/reversals/basis history and
privacy projections plus old wildcard/compound/create/delegation rules. Bind is an
explicit same-worker cluster-project handoff, not other-worker service adoption.
Verification preserves old migration checksums/rows/universes/ACLs and verifies
only six protected-admin additions; repeat setup must change nothing. Restore to
a separate DB+files Environment remains later T18, not inferred from restart.

Execution receipts/manifests and their hashes are handed back separately, bound
to the tested source SHA; this runbook does not turn author checks into acceptance.
