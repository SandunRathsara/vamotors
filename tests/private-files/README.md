# T06a2 document-validation candidate

Adapter base: `3cc43b3b89fd52038a8e0339c3eafdb40f966f52` (common `db2580dd`).
The first candidate `25da9d81` was **rejected** by the independent verifier.
See [CORRECTIONS.md](CORRECTIONS.md) for its five findings and red→green checks.
This is not T06/G2/requirement acceptance, schema/HTTP workflow integration or a
deployment/restore certification. The old operations runbook's unsupported-parser
section describes the adapter base, not this candidate.

## Interface and bytes

`validateDocument(Buffer, Declaration)` is asynchronous. Only `validateStage`
mints same-instance/same-intent opaque `ValidatedBytes` in its private WeakMap.
Declarations/retained metadata are copied before IO. Decoded pixels, metadata and
workbooks are discarded, never saved as replacement uploads. Finalize still
publishes the original snapshot create-if-absent, never rereading staging or
overwriting finals. Retained reads revalidate persisted MIME/size/SHA256.

Invalid content/resource limits: `UPLOAD_MISMATCH`. Missing/broken worker/module,
unexpected worker exit, sampler failure or capacity exhaustion:
`STORAGE_UNAVAILABLE`. Errors contain no parser text, OS cause, contents or paths.

## Fixed validation limits

All formats: extension/MIME/exact size/SHA256 agree; <=5 MiB, images <=2 MiB.

- **JPEG/PNG/WebP:** full unresized Sharp pixel decode, `failOn: warning`;
  <=16,000,000 pixels, <=8192/dimension, <=4 channels, one frame. JPEG <=1024
  markers, PNG <=256 chunks, WebP <=8 chunks; exact container endpoints/CRC.
  PNG IDAT inflation <=128,065,536 bytes (16-bit RGBA/Adam7 overhead included),
  with exact zlib consumption. WebP VP8/VP8L/ALPH payloads additionally undergo
  native decode-prefix consumption checks; only <=4 **zero** VP8 bool-coder flush
  bytes are permitted, not ignored arbitrary payload tails. VP8L/ALPH permit no
  whole-byte tail. This is not a handwritten VP8 decoder or a re-encoder.
- **Passive image metadata:** EXIF/ICC/XMP/text/comments are supported, combined
  <=256 KiB. TIFF spans/IFD references are checked, <=512 entries/depth 8, then
  exifr parses tags. JPEG EXIF thumbnails are fully decoded with <=1 MP. ICC
  declared size/tag spans are checked, <=128 tags, then exifr/native color decode.
  XMP <=4096 elements/depth 16/32 attributes; no DTD/declared entities. Unclaimed nonzero
  data, malformed offsets, active markup and compressed metadata tails fail.
- **PDF:** PDF.js parses every page's operator list/text and resolved image
  objects. <=50 pages, <=14,400pt/dimension, <=4096 objects, <=200,000 lexical
  tokens, depth <=32; <=200,000 drawing operations and 1,000,000 text characters.
  Classic xref offsets/references/reachability, direct stream lengths and EOF are
  checked. Standard bounded header/inter-object comments are supported (<=1024
  bytes/comment, <=64 KiB overall). Raw/Flate/DCT and ASCII85→Flate/DCT streams
  are supported with exact filter consumption; <=8 MiB decoded stream/20 MiB
  total. No PDF compression-ratio rejection: ordinary scans legitimately exceed
  100:1; absolute decoded limits remain. Raw/Flate raster row footprints and
  predictor bytes must match and undergo native pixel decode. JPEG streams
  <=2 MiB; actual decoded dimensions must match their dictionaries. Aggregate
  image pixels <=16 MP, <=8192/dimension. Reject encryption (including empty
  passwords), actions/scripts, attachments, external streams, forms/XFA,
  annotations, opaque/orphan streams and trailing content. PDF 2.0, object/xref
  streams, incremental/linearized/signed revisions, indexed/ICC raster color
  spaces and other filters remain unsupported; ordinary tested ReportLab DO/
  invoice/scan variants work. No PDF reserialization.
- **XLSX:** ZIP preflight before workbook parsing; <=256 entries, canonical
  allowlisted ASCII names <=128 bytes. No aliases/duplicates/symlinks/encryption,
  ZIP64/split archives/extras/comments/trailing content. Stored/deflate only,
  optional signed descriptors; actual size/CRC/complete inflation checked.
  <=8 MiB/entry, <=20 MiB total inflation, <=100:1. Strict UTF-8 XML, no DTD/
  declared entities/PI/comments/CDATA; depth <=64, <=32 attributes, <=300,000
  nodes. Internal worksheet relationships only; no macros/links/embedded objects/
  formulas/custom extensions. Then read-excel-file parses every worksheet/cell,
  without trimming. <=8 sheets, <=10,000 total rows/max row index, <=128 columns,
  <=100,000 cells, <=8192 characters/cell; no formula-leading strings/nonfinite
  numbers. This is not T16 domain-import validation.
- **CSV unchanged:** strict ASCII rectangular subset, >=2 rows/columns,
  <=10,000 rows, <=128 columns, <=8192 characters/field; LF/CRLF, quoted commas/
  escaped quotes; no multiline fields, formulas, markup, binary/Unicode/controls.

## Worker/runtime boundary

Two heavy validation children per server process, no queue; 10s deadline including
startup. V8 old-space 192 MiB/semi-space 8 MiB; one native decode thread, no Sharp
cache. Parent `/bin/ps` samples RSS every 100ms and kills above 384 MiB. This is a
**sampled limit, not a hard OS/native sandbox**; transient overshoot is possible.
No inherited runtime secrets/preload flags. Node read permissions cover only the
worker subtree and lexical/real node_modules paths; no writes/child processes/
worker threads, native addons allowed. No global multi-process quota guarantee.

Run the server from the **application root**. Keep `lib/server/private-files/*.mjs`
and node_modules as server assets. Worker location is app-root based, not a
generated bundle's import.meta.url. The test-owned real Next 16.1.7 production
Turbopack probe imports the adapter and performs actual HTTP byte IO; standalone
deployment tracing/copying of worker assets is not certified. Missing assets fail
retryably rather than silently validating or claiming an upload mismatch.

## Dependencies / checks

Pinned: sharp 0.35.5, pdfjs-dist 6.4.299, read-excel-file 9.3.13, saxes 6.0.0,
exifr 7.1.3 (no transitive dependencies). Context7 library→docs, npm metadata,
exact-version OSV and transitive npm audit checked; no current findings in these
parser trees. Existing unrelated repository audit findings remain. Node 24.16.0
and pnpm 12.4.1 used; `/bin/ps` and a private POSIX durable root required.

```sh
pnpm install --frozen-lockfile
export T06A_TEST_PARENT="$HOME/.local/share/vamotors/t06a2-review-unique"
mkdir -m 700 "$T06A_TEST_PARENT"
node --conditions=react-server --import tsx --test tests/private-files/filesystem.check.ts tests/private-files/formats.check.ts tests/private-files/containment.check.ts tests/private-files/infrastructure.check.ts
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint lib/server/private-files tests/private-files
pnpm exec prettier --check lib/server/private-files tests/private-files
pnpm exec vitest run tests/security
```

The original 16 checks plus four infrastructure checks remain real parser/IO
tests, not mocks. Each five-format run retains five finals/2,874 exact bytes and
per-file hashes/checkpoints. Restart after writers exit:

```sh
node --conditions=react-server --import tsx tests/private-files/restart.ts read "$RUN/bytes" 11111111-1111-4111-8111-111111111111 "$RUN/valid.pdf.checkpoint.json"
```

The independent corpus, extra boundary tests and real production-build/HTTP
probe commands/evidence are documented in [CORRECTIONS.md](CORRECTIONS.md).
No business/final bytes are automatically deleted; no cloud, DB, permanent HTTP
route, grants, application UI, schema or shared acceptance ledger is changed.
