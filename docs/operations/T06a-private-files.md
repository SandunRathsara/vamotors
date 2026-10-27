# T06a: bounded private local-byte adapter

Candidate based exactly on `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`.
This is an independent byte-backend slice, **not full F06, T06, or G2 acceptance**.
No shared source/config/schema/package/contract/ledger changes. No DB, HTTP,
cloud, credential, UI or business-target implementation is included.

## Owned paths and interface

- `lib/server/private-files/index.ts`: server-only filesystem adapter.
- `lib/server/private-files/validation.ts`: declaration checks, strict CSV
  parser, hash and safe error codes; other document validation fails closed.
- `tests/private-files/filesystem.check.ts`: direct Node filesystem tests.
- `tests/private-files/restart.ts`: one-shot independent process checkpoint,
  read verification and deliberate interrupted transfer.
- This separate operations handoff.

`openPrivateFiles({root, environmentId, forbiddenRoots, mayWrite})` accepts only
explicit server configuration; no environment discovery, default root or cloud
path. The existing root must be durable, dedicated to one Environment, current
UID, exactly 0700, outside Git/temp/public/static and every supplied forbidden
tree. Ancestors must be real directories owned by root/current UID and not
group/world writable. Supply **all** checkout and served trees, including
nonstandard static mounts. This is a local POSIX filesystem adapter, not an
NFS/network/Windows adapter. Runtime owner must choose/verify the durable volume,
UID, disk allowance and actual free-capacity policy.

Returned server-only operations:

| Operation                                                 | Boundary                                                                                                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `newStageKey(intentId)`                                   | Random flat server key, environment + correlation UUID; not an HTTP capability.                                                                                                          |
| `newFinalKey(intentId, attemptId)`                        | Fresh immutable-attempt destination; persist this exact key before IO/retry.                                                                                                             |
| `writeStage(key, AsyncIterable<Uint8Array>, Declaration)` | Only staging keys; checks size/hash, <=5 MiB, image declaration <=2 MiB, <=65,536 chunks. Atomically publishes only complete bytes. Same key/same bytes is replay; other bytes conflict. |
| `validateStage(key, Declaration)`                         | Bounded descriptor read, actual hash/size and content validation; returns an opaque in-process `ValidatedBytes` snapshot.                                                                |
| `finalize(finalKey, ValidatedBytes)`                      | Same-instance, same-intent validated snapshots only; writes the exact privately retained bytes, never rereads staging. Returns verified `{size, sha256, mime}`.                          |
| `readFinal(finalKey, persistedMetadata)`                  | Bounded read + hash/size + current supported content validation. Use metadata from the durable validated attempt/Attachment, never browser input. Reads do not invoke quota policy.      |
| `inventory(limit=1000)`                                   | Up to 10,000 entries, with explicit `truncated`; stage/final/attempt, byte count, mtime and correlation key. Server/operator only, never HTTP or logs.                                   |
| `close()`                                                 | Releases the directory descriptor; no deletion.                                                                                                                                          |

`Declaration` is `{size, sha256, mime, filename}`. Filename is display-only,
basename <=200 characters, no separators/controls; it never becomes a path.
The low-level `writeAll(FileHandle, Buffer)` export exists for partial-write
fault testing; application integration should use only the store operations.

## Storage guarantees and honest limits

Flat generated names, strict environment/key parsing, `O_EXCL` creation and
`O_NOFOLLOW`/descriptor reads prevent traversal and raced **leaf** symlink
following. Files are 0600. Root inode/device/mode are checked on operations.
This trusts the current server UID and root-owned ancestors: a hostile process
already running as that UID/root can directly alter bytes, rename ancestors or
read memory. Node's portable pathname APIs do not provide a hostile-same-UID
directory-swap sandbox. Do not grant other processes that identity/access; an
openat-based isolated/native broker would be needed if that is a requirement.
No claim of that stronger boundary is made by the leaf-race tests.

Writes stream to a new exclusive `p.<nonce>.<destination>` attempt. Partial writes
are looped, declared size/hash checked, file fsynced, then an atomic hard-link
create-if-absent publishes the destination; directory fsync and bounded reread
verify it. Existing destinations are never opened writable. Identical replay
verifies retained bytes; conflicting replay fails without changing them.
Staging cannot name a final key. No validator callback, client-provided proof or
mutable caller buffer can manufacture a validated snapshot.

Attempt names intentionally remain for inspection, including successful hardlink
aliases; they are **not** automatic extra document versions or proof of an
orphan. Count disk usage by unique inode/allocated blocks, not the sum of alias
sizes. Full/incomplete/unreferenced final bytes remain retained. The adapter
does not delete anything, including staging: terminal + expired capability +
unreferenced + 24h-grace decisions require the future DB-aware owner. Inventory
does not decide references, leases, authorization or cleanup. A truncated scan
is incomplete evidence and must trigger operator review, not orphan deletion.

Quota callback runs before transfer and again before publication. False stops
new writes, throwing maps to unavailable, and retained reads remain usable.
The callback must conservatively include in-flight/reserved writes; this is not
a cross-process capacity reservation system. The HTTP owner must also bound
transfer duration/cancel stalled sources and global IO concurrency. The adapter
limits bytes/chunks per call, not the number of concurrent calls or retained
snapshots. Successful fsync and process restart are tested; power-loss/device
cache, network filesystem semantics and backup/restore are **not** certified.

Errors expose only a fixed `PrivateFileError.code/message`, no OS cause/path,
bytes or capability. There are no adapter logs/listeners/routes/static mounts.
An anonymous/static HTTP request is not tested: no transport exists here.

## Validation: supported subset and package-owner request

CSV only: <=5 MiB strict ASCII rectangular CSV, >=2 rows/columns, <=10,000
rows, <=128 columns, <=8,192 characters/field, LF or CRLF, quoted comma and
escaped-quote parsing. Rejects multiline fields, formula-leading cells, markup,
binary/control/Unicode content, executable/PDF/ZIP prefixes and malformed rows.
These are conservative adapter resource/format limits, **not** accepted T16
domain-import rules or a claim of full CSV interoperability. Domain column,
currency, permissions and row semantics remain unimplemented.

JPEG/PNG/WebP/PDF/XLSX return `UNSUPPORTED_VALIDATION` after declaration and
actual size/hash checks. No extension/magic sniff is represented as validation.
Truncated signatures/encrypted-or-51-page PDF candidates and ZIP candidates are
tested as **unsupported**, not successful decoder/encryption/page/bomb tests.
SVG/HTML/executable MIME declarations fail `UPLOAD_MISMATCH`.

Minimal next implementation seam: add reviewed format-specific branches inside
`validateDocument(bytes, declaration): void`; success must mean real decoding
and structural/resource/envelope validation of these exact bytes, otherwise
throw. Keep the opaque snapshot minting inside `validateStage`. Do not add a
generic plugin registry or a caller-supplied boolean validator.

Concrete pinned **proposals**, not installs/security approvals (versions and
engine metadata checked in npm registry during this work):

| Format        | Package-owner proposal                                       | Tests required before enabling                                                                                                                                                                                                                                                                                                                 |
| ------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG/PNG/WebP | `sharp@0.34.5`                                               | Full decode, <=2 MiB, explicit pixel/dimension/frame limits (propose 16MP/8192px/single frame), malformed/truncated/container-trailing/polyglot corpus and decode timeout/memory containment. Magic/metadata-only checks are insufficient.                                                                                                     |
| PDF           | `pdfjs-dist@5.4.624`                                         | <=5 MiB/50 pages, encryption rejected even with empty password, unreadable/truncated files, full bounded parse, dangerous embedded content and strict envelope/trailing-polyglot handling in a restricted worker. No rendering-package substitute.                                                                                             |
| XLSX          | `yauzl@3.2.0` ZIP preflight + `exceljs@4.4.0` workbook parse | Before workbook loading: bounded streaming ZIP scan, no encryption/path aliases/duplicate entries, propose <=256 entries/20 MiB inflated/100:1 ratio; reject macros/external relations/embedded objects/DTD/entities. Then bounded sheets/rows/columns/cells and worker timeout/heap limits. Workbook parsing alone is not a ZIP-bomb defense. |

The package owner must review advisories/transitives, pin accepted dependencies,
fetch current parser docs and validate these proposed limits with domain owners.
No native library/decoder or parser was installed or upgraded by this slice.
Node 24 filesystem docs were fetched through Context7 for exclusive creation,
NOFOLLOW flags, partial writes and fsync semantics.

## Direct checks and retained restart evidence

Use installed dependencies from the accepted package/lock set, including tsx.
No shared package-script/tsconfig edits are needed. Choose a **new own** durable
private parent for independent review; do not point at other people's files.

```sh
export T06A_TEST_PARENT="$HOME/.local/share/vamotors/t06a-review-unique-id"
mkdir -m 700 "$T06A_TEST_PARENT"
node --conditions=react-server --import tsx --test tests/private-files/filesystem.check.ts
pnpm exec tsc --noEmit --incremental false
pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --types node lib/server/private-files/index.ts lib/server/private-files/validation.ts tests/private-files/filesystem.check.ts tests/private-files/restart.ts
pnpm exec eslint lib/server/private-files/index.ts lib/server/private-files/validation.ts tests/private-files/filesystem.check.ts tests/private-files/restart.ts
pnpm exec prettier --check lib/server/private-files/index.ts lib/server/private-files/validation.ts tests/private-files/filesystem.check.ts tests/private-files/restart.ts
pnpm exec vitest run tests/security
```

The test creates only new `t06a-run-*` directories underneath that parent and
retains them. No services are started, external DB accessed or fixtures reset.
The independent-process test leaves `checkpoint.json` and `bytes/` together in
its run directory. Repeat the read after all writer/test processes have exited:

```sh
# Set these to the exact test-owned run directory and UUID, not application data.
RUN="$T06A_TEST_PARENT/t06a-run-<checkpoint-run>"
ENVIRONMENT_ID=11111111-1111-4111-8111-111111111111
node --conditions=react-server --import tsx tests/private-files/restart.ts read "$RUN/bytes" "$ENVIRONMENT_ID" "$RUN/checkpoint.json"
```

For a standalone write/stop/read proof, create a new own run directory and
0700 `bytes/`, run the same executable with `write`, let it exit, then `read`.
`write` refuses an existing checkpoint manifest. There is no daemon to stop.
The `crash` mode is reserved for disposable test-owned runs: it SIGKILLs its own
writer mid-transfer and retains the partial attempt. Do not use on retained
business storage.

Observed candidate evidence: **10/10** dedicated filesystem checks,
**101/101** existing security-unit regressions, full/owned TypeScript checks and
owned lint/format checks. Restart checkpoint: **19 bytes**, **1 final object**,
SHA256 `807e9dfd052cd52eb453be74dafa5ef66df48ce9fd609a81c3198e0e76552801`.
Independent child processes agree on bytes/hash/count; interrupted transfer
leaves a 3-byte inventoried attempt and retry succeeds without pruning it.

## Required target/config/transport integration (still blocked)

The accepted schema lacks UploadIntent/Attachment and lawful accepted target
models SaleCase/BrokerageDeal/Remittance/ImportBatch/ExportJob. Vehicle and
PurchaseRecord are not accepted attachment targets. Parent must select a genuine
target creation workflow with its domain/schema owner; do not invent a target
or purchase-upload path to demonstrate this adapter.

Serialized owners must supply: durable private root/config/Environment binding,
operator capacity/IO policy, parser decisions, lawful target schema/permissions,
UploadIntent/Attachment/provenance/grants and persisted attempt metadata/keys.
Then implement accepted UploadReady/init/complete/download DTOs, 5-minute
capability/claim lease, current record+field+uploader authority, revision/expiry,
claim/recovery and **post-IO** reauthorization, atomic link/intent/audit/receipt,
exactly one business attachment on concurrent finalizers and DB-failure orphans.
Downloads need current field authority and <=60s bearer bound or an authorized
proxy, exact-origin/anonymous/foreign-record/expired tests, attachment headers
and no-store. UI→HTTP→real DB, app/DB/files restart and isolated DB+files restore
must follow. This adapter supplies no upload/download grants or current-actor
flow and closes no G2 storage or hosted acceptance gap.
