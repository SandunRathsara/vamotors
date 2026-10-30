# T06a2 bounded document-validation candidate

Base: exact accepted adapter `3cc43b3b89fd52038a8e0339c3eafdb40f966f52`
(common base `db2580dd`). This changes only adapter validation, its dedicated
tests and four pinned parser dependencies. No schema, HTTP, business target,
grant, runtime script or shared planning acceptance is implemented or claimed.
The older operations runbook's **unsupported parser** section describes the
base, not this candidate. Its filesystem/retention/integration limits still apply.

## Interface and exact-byte guarantee

`validateDocument(Buffer, Declaration)` is now asynchronous. Both adapter callers
await it. `validateStage` alone still mints same-instance/same-intent opaque
`ValidatedBytes` in its private WeakMap. Declaration/retained metadata are copied
before IO; mutable caller metadata cannot change the validated MIME after an
await. Sharp's decoded pixels and parsed workbooks are discarded, never saved as
replacement uploads. Finalization still publishes the original snapshot with
create-if-absent semantics, never rereading staging or overwriting final bytes.
Retained reads revalidate all supported formats using the persisted MIME.

## Fixed limits and conservative interoperability

All inputs require matching extension, MIME, exact size and SHA256; maximum
5 MiB (images 2 MiB). Invalid content/resource limits map only to
`UPLOAD_MISMATCH`. Decoder startup/infrastructure failure or capacity exhaustion
maps to `STORAGE_UNAVAILABLE`. No parser output, path, OS error or contents leak.

| Format        | Required validation and limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG/PNG/WebP | Sharp full, unresized raw-pixel decode, `failOn: warning`; <=16,000,000 pixels, <=8192 per dimension, <=4 channels, one frame. Exact JPEG marker/entropy/EOI, PNG chunk/CRC/IEND and WebP RIFF/chunk envelopes. PNG <=256 chunks; JPEG <=1024 markers; WebP <=4 chunks. Reject trailing/prefixed data, animation and arbitrary metadata payloads (EXIF/XMP/ICC/comments/text). Thus many camera/metadata-bearing images fail closed rather than being silently stripped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PDF           | PDF.js parses **every page's operator list and text**, not just a header/page count. <=50 pages, <=14,400pt page dimension, <=4096 objects, 200,000 lexical tokens, nesting <=32; <=200,000 drawing operations and 1,000,000 extracted characters overall. Validate classic xref offsets, object references/reachability, stream lengths and exact EOF. Reject encryption even with empty password, actions/scripts/name-escape bypasses, attachments/embedded files, forms/XFA/annotations, external streams, metadata/private payloads and opaque/orphan streams. Flate streams <=8 MiB each/20 MiB total, <=100:1, exact deflate consumption. JPEG streams also fully decoded; aggregate image pixels <=16,000,000, dimensions <=8192. Only unfiltered/Flate/DCT streams, direct stream lengths, one classic-xref revision; PDF 2.0, object/xref streams, linearized/incremental/signed revisions and other filters fail closed. No PDF reserialization.                                                                                       |
| XLSX          | Strict ZIP central/local-header consistency **before workbook parsing**; <=256 entries, ASCII canonical allowlisted part names <=128 bytes, no duplicates/case aliases/symlinks, encryption, ZIP64, split archives, extras/comments or trailing data. Stored/deflate only, optional signed data descriptors; actual size/CRC/complete deflate consumption checked. <=8 MiB per entry, <=20 MiB total inflation, <=100:1. Strict UTF-8 XML, no DTD/declared entities/PI/comments/CDATA, <=64 depth/32 attributes/300,000 nodes. Standard internal relationships and matching worksheet targets only; no macros/links/embedded objects/custom parts/formulas/extensions. Then `read-excel-file` actually parses every worksheet and cell, without trimming input values. <=8 sheets, <=10,000 total rows and maximum row index, <=128 columns, <=100,000 cells, <=8192 characters per cell; reject formula-leading strings/nonfinite numbers. This is a passive structured-import subset, not full Excel interoperability or T16 domain validation. |
| CSV           | Existing strict ASCII rectangular subset retained: <=10,000 rows, <=128 columns, <=8192 characters/field, >=2 rows/columns, LF/CRLF; quoted commas/escaped quotes supported. Reject multiline fields, formulas, markup, binary/Unicode/control characters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

Heavy parsers run in standalone `.mjs` child processes (no production `tsx`
dependency), at most **two per server process**, no waiting queue, **10s deadline**
including startup. Each child has V8 old-space 192 MiB/semi-space 8 MiB, one native
decode thread, Sharp cache disabled and explicit pixel/inflation budgets. Parent
samples RSS every 100ms with `/bin/ps` and SIGKILLs above **384 MiB**; sampler
infrastructure failure fails closed. This is a sampled limit, **not a hard kernel
RSS ceiling**: transient overshoot is possible. Node permissions restrict reads
to this validation subtree and repository `node_modules`, deny writes/child
processes/worker threads; native addons must be allowed. No inherited runtime
secrets/preload options. This is **not an OS/native-code security sandbox**, nor
a global multi-process capacity policy. Runtime integration must retain the
`.mjs` siblings/`node_modules` layout; bundling/deployment is not certified.

PNG IDAT also receives bounded zlib preflight (maximum 128,065,536 inflated
bytes, covering 16-bit RGBA/Adam7 overhead), rejecting unconsumed compressed
payload tails before the independent Sharp pixel decode.

## Dependency review (2026-10-30)

- `sharp@0.35.5`: existing optional Next Sharp 0.34.5 is not sufficient; current
  advisory GHSA-wq5f-xc86-pv6w affects older versions. The adapter imports the
  patched direct dependency; the unrelated existing Next copy is not upgraded.
- `pdfjs-dist@6.4.299`: current PDF parser; requires Node >=22.13 or >=24.
- `read-excel-file@9.3.13`: Node >=18; smaller maintained reader instead of the
  runbook's ExcelJS proposal (the latter introduced vulnerable legacy transitives).
- `saxes@6.0.0`: already present transitively; made direct for strict XML preflight.
  No separate ZIP package, PDF renderer or fixture-only dependency added.

Context7 `library` then `docs` fetched for each selected parser and Node 24;
installed 6.4.299 PDF.js types/source checked where indexed docs lagged (cleanup
is `loadingTask.destroy()`, evaluation option removed). npm engine/version
metadata and OSV exact-version checks completed. Final `pnpm audit --json` has
**no findings in the added parser dependency trees**; the repository's existing
179 findings remain (20 low/82 moderate/71 high/6 critical), including its older
Next/Sharp tree. This is not a clean repository-wide security audit.

## Reproduce on an independent new private root

Requires Node 24 (author used 24.16.0), pnpm, local POSIX filesystem and `/bin/ps`.

```sh
pnpm install --frozen-lockfile
export T06A_TEST_PARENT="$HOME/.local/share/vamotors/t06a2-review-unique"
mkdir -m 700 "$T06A_TEST_PARENT"
node --conditions=react-server --import tsx --test tests/private-files/filesystem.check.ts tests/private-files/formats.check.ts tests/private-files/containment.check.ts
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint lib/server/private-files tests/private-files
pnpm exec prettier --check lib/server/private-files tests/private-files
pnpm exec vitest run tests/security
```

Tests generate genuine JPEG/PNG/WebP/APNG/animated-WebP/PDF/XLSX locally. R2 PDF
encryption fixtures (empty/nonempty passwords) are independently opened by
PDF.js; the ZipCrypto fixture was independently decrypted with Python `zipfile`
(all six entries/CRCs verified). No parser is mocked. Format tests retain valid
and negative files, private `bytes/`, checkpoint manifests and `evidence.json`
under a fresh `t06a2-formats-*` run. Five formats each exercise real write,
validate, staging mutation, immutable finalize/replay/read, then a separate
process read. Existing actual-IO/race/symlink/quota/crash/retry checks remain.
The containment test SIGSTOPs only its own two real decoder children, verifies
capacity rejection and deadline kills, then verifies the decoder works again.

The test prints the exact retained evidence directory. After all writers exit:

```sh
node --conditions=react-server --import tsx tests/private-files/restart.ts read "$RUN/bytes" 11111111-1111-4111-8111-111111111111 "$RUN/valid.pdf.checkpoint.json"
```

There is no daemon, automatic cleanup, cloud call, DB access, HTTP grant, restore
certification, T06/G2 acceptance or independent-verifier decision in this slice.

Author checks: **16/16** dedicated checks and **101/101** security regressions;
full TypeScript, owned ESLint/Prettier and frozen-lockfile install passed. The
five-format checkpoint retains **5 final objects / 2,874 exact bytes**; hashes
and individual sizes are in each run's `evidence.json`, not inferred from MIME.
