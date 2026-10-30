# Correction of independent FAIL on 25da9d81

## R2 correction of rejected e3ce4207

The R1 history below is retained, not an acceptance claim. Fresh R2 work starts
at exactly `e3ce42079141596c10ccb645cf4f6732d25bf90d`. Independent report, fixtures,
original author's checkout and interrupted `t3-9e9619b8` remain read-only.
Own copies/evidence: `/Users/alpha/.local/share/vamotors/t06a2-r2/`.

### Root causes / corrections

- **Inline PDF bypass:** preflight only collected `/Subtype /Image` stream
  objects. BI images in page/Form content were validated only after PDF.js had
  padded/rescaled them, losing original length/dimensions and aggregate pixels.
  An export-only patch exposes PDF.js's pinned Lexer/Parser. Its original inline
  byte spans now enter the **same** filter-consumption, exact raster/predictor,
  native JPEG dimensions and aggregate-pixel path as XObjects. Caching cannot
  skip repeated BI validation. JPEG/ASCII85 EI searches cannot swallow a tail.
  No regex search for BI in binary/string/comment data. Ordinary inline JPEGs,
  raw/Flate/predictor images and ReportLab DO/invoice/scan controls remain valid.
- **WebP heuristic + duplicate work:** native prefix equality was not an entropy
  consumption counter. The valid 660-byte Pillow VP8L payload consumes **5273
  bits**: its last zero byte contains a real bit, even though native short-input
  tolerance can reconstruct the same pixels without it. Repeated full-size
  native trial decodes also retained outputs/native allocations: unmodified R1
  children were SIGKILLed at sampled **426624 / 481856 KiB**, in 219 / 213ms.
  An export-only patch exposes the pinned TS-WebP entropy parser/bit readers;
  VP8 consumes modes/coefficients without reconstructing trial rasters; VP8L/ALPH
  use exact bit positions (no whole-byte tail allowance). Strict bounds reject
  missing bits instead of zero-filling them. The discarded lossless workspace is
  reclaimed before **one** native Sharp raster decode. No guard or deadline was
  raised/removed. All four 16MP RGB/alpha lossy/lossless cases exit 0. Initial
  four-case observation: largest sample **358688 KiB**, slowest 328ms;
  final-runtime observation (`worker-head.json`): **369120 KiB**, slowest 345ms.
  Both are below the unchanged 393216 KiB threshold. These are sampled
  observations, not hard peak-memory/sandbox claims.

### R2 evidence

- Same SHA-checked 94-case command on untouched rejected code: **79 correct / 15
  failures** (11 inline false accepts + 4 WebP false rejects). Corrected: **94/94**.
  Includes existing WebP tail negatives, 12MP controls, over-16MP rejection, valid
  standalone/inline rasters/JPEGs and actual aggregate negatives.
- Original independent corpus **68/68**, with all 20 positives retaining exact
  original bytes through snapshot mutation, immutable replay/read and fresh
  process restart. Original dedicated **24/24** (including 32 fresh PNG workers);
  two generated R2 checks add Form-inline/mixed-XObject aggregate and 8192-wide
  lossy/lossless alpha boundaries plus tailed variants. Security **101/101**.
- Actual Next production Turbopack route import/build + **28 HTTP requests**:
  **13×200 / 14×422 / 1×503**. All 11 inline negatives are 422; four 16MP WebPs
  and both 12MP controls are 200; over-16MP is 422. All 13 HTTP finals survive
  staging mutation, identical finalize replay, exact read and **restart after
  the Next writer has stopped**. Errors are fixed safe bodies. No permanent
  application route/config was installed.
- Prior review's 70 real HTTP requests (32 PNG workflows), six HTTP startup
  faults and exact final-restart evidence remain at
  `/Users/alpha/.local/share/vamotors/t06a2-correction-verifier-BO13yO/`;
  they are retained evidence, not represented as rerun R2 campaigns.
- Frozen install, Prisma generation, types, owned lint/format pass. New
  @stacksjs/ts-webp 0.1.7: no transitive dependencies, exact OSV query empty;
  repository audit findings remain unrelated and are retained in `audit.json`.

Parser references: Context7's pinned PDF.js architecture/API and libwebp
bit-reader/container docs were checked against the installed/source code.
Context7 did not index TS-WebP; its exact published `0.1.7` bundle was inspected
against the upstream [VP8L decoder](https://github.com/stacksjs/ts-webp/blob/main/src/vp8l/decoder.ts),
[VP8 decoder](https://github.com/stacksjs/ts-webp/blob/main/src/vp8/decoder.ts) and
[bit reader](https://github.com/stacksjs/ts-webp/blob/main/src/bitreader.ts).
The export-only patch targets the lockfile-pinned published bundle, not moving
`main`; `webp-parser-readable.js` retains the inspected bundle in private evidence.

### Runnable R2 replay

Copy the independent `extended/`, `limits/` and `corpus/` directories into an own
private root. The original 68-case runner also requires the own-copy marker
described below. Never point a writer at the verifier's originals.

```sh
export T06A_R2_FIXTURES=/absolute/own/private/root
export T06A_REVIEW_FIXTURES="$T06A_R2_FIXTURES/corpus"
export T06A_TEST_PARENT="$T06A_R2_FIXTURES"
node --conditions=react-server --import tsx tests/private-files/r2.check.ts
node --conditions=react-server --import tsx tests/private-files/r2.observe.mjs
node --conditions=react-server --import tsx --test tests/private-files/independent.check.ts
node --conditions=react-server --import tsx --test tests/private-files/filesystem.check.ts tests/private-files/formats.check.ts tests/private-files/containment.check.ts tests/private-files/corrections.check.ts tests/private-files/infrastructure.check.ts
node --conditions=react-server --import tsx tests/private-files/bundle.check.ts
```

For red, create an own archive/checkout of exact `e3ce4207`, install its frozen
dependencies, and from that app root run the absolute **corrected** `r2.check.ts`
path with `T06A_R2_RESULT=red-results.json`: it deliberately exits 1 with the 15
failures. Both runners resolve runtime code/workers from **cwd**, not their own
test-file location. The observer with `T06A_R2_EXPECT_RED=1` asserts all four old
WebPs fail and records real child exits/samples. The bundle runner uses
`red-results.json` to select the same focused regression HTTP cases.

Scope remains parser/package/tests/docs only. No schema, registry, grants,
application workflow, shared ledger, cloud/deploy/push/PR or acceptance changes.

## R1 history

Verifier report/fixtures are **read-only**:
`/Users/alpha/.local/share/vamotors/t06a2-verifier-HrNELt/review/result.json`.
Author copies are private at
`/Users/alpha/.local/share/vamotors/t06a2-corrections/`.
All 68 copied input SHA256s are checked against the independent manifest before
testing. No verifier files, other worktrees, application routes or ledgers changed.

## Red → green

1. **WebP:** original enlarged VP8/RIFF payload passes despite ignored script
   bytes. Sharp has no public consumed-byte API. Instead of trusting lengths or
   sniffing for script, the fix asks the real native decoder whether shortened
   VP8/VP8L/ALPH chunks still produce a complete identical image. A completed
   image with excess payload fails; only bounded zero VP8 arithmetic termination
   bytes from libwebp's documented BitWriterFinish are permitted. Additional
   regressions exercise one-byte/two-byte/script/zero-flood tails, alpha and
   lossless inputs, while ordinary valid files still pass.
2. **PDF:** original zero/short raw/Flate rasters and JPEG dimension lies pass.
   Exact raster/predictor footprints plus native raster decode now precede
   PDF.js. JPEG dimensions come from full actual decode and must match the PDF;
   actual image pixels are aggregated. Both misdeclared JPEGs and two honestly
   declared 9 MP JPEGs exceeding 16 MP fail. Single 9 MP JPEG and proper raw/
   predictor images pass. Resolved PDF.js image objects are also checked instead
   of assuming an operator-list promise proves image decode success.
3. **Ordinary metadata/PDFs:** all six independent EXIF/ICC photos and five
   ReportLab DO/invoice/scan variants were red. Bounded EXIF/ICC/XMP parsing and
   safe comments replace blanket exclusions; standard PDF comments and exact
   ASCII85 filter chains work. Scan compression no longer trips an arbitrary
   100:1 PDF ratio; absolute inflation/pixel limits remain. Bad metadata offsets,
   hidden metadata markup, compressed tails and unsafe PDFs remain negative.
4. **Real bundle import:** original production Turbopack probe fails resolving
   decoder.js. Internal TypeScript imports now use bundler-compatible source
   resolution. Workers remain unbundled assets located from the app root, not a
   generated chunk URL; both lexical and real dependency paths are permissioned.
   The generated private Next app imports the actual adapter and its Node route
   performs stage→validate→immutable-final→read with real HTTP requests for all
   six types. Six valid requests return 200 with exact hashes/sizes; the two
   independent false-accept cases return 422; a removed test-owned worker returns 503. No permanent route or runtime configuration is installed.
5. **Startup classification:** the exact original supervisor still reproduces
   UPLOAD_MISMATCH when its worker is missing (red command below). Only the
   worker's explicit invalid-content exit is UPLOAD_MISMATCH now; unexpected
   exits are STORAGE_UNAVAILABLE. Missing worker, missing imported module and
   syntax-broken worker and missing decoder export each have real-process
   positive-control/fault tests.
   Repeated PNG tests additionally exposed an abrupt native-addon shutdown race:
   parsing/pixels had completed, but synchronous process.exit inside the native
   completion callback could stall cleanup. Worker result exits now use
   process.exitCode so native work quiesces first; the deadline is unchanged.
   A 32-fresh-worker PNG regression covers this (70-repeat diagnostic also passed).

Initial author corpus command: **52 pass / 16 fail**, matching the verifier's
five false accepts and eleven ordinary false rejections. `red-results.json`
preserves this in the author's private copy. Corrected corpus: **68/68**, with
all 20 accepted fixtures additionally exercising snapshot/staging-mutation,
immutable replay, retained read and a separate-process restart. New boundary
suite adds four checks; original 16 checks and four startup checks stay green.
Security regressions: 101. Final exact-HEAD rerun evidence is returned with the
commit, not inferred from these author assertions. No acceptance decision is made.

## Reproduction

Use an own private corpus copy (never point the runner at the read-only verifier
root). Copy `fixtures/` and `fixtures-manifest.json`, create a 0600
`.author-owned-copy` containing exactly `t06a2-corrections` plus LF, and export:

```sh
export T06A_REVIEW_FIXTURES="/absolute/own/private/corpus-copy"
export T06A_TEST_PARENT="/absolute/own/private/test-parent"
node --conditions=react-server --import tsx --test tests/private-files/independent.check.ts
node --conditions=react-server --import tsx --test tests/private-files/corrections.check.ts
node --conditions=react-server --import tsx --test tests/private-files/infrastructure.check.ts
node --conditions=react-server --import tsx tests/private-files/bundle.check.ts
```

The deliberate original-code startup repro below **must fail** its corrected
expectation, showing actual UPLOAD_MISMATCH instead of STORAGE_UNAVAILABLE. It
uses `git show` and modifies only a new private copied runtime, not tracked code:

```sh
T06A_SUPERVISOR_BASELINE=25da9d8 node --conditions=react-server --import tsx --test tests/private-files/infrastructure.check.ts
```

Run the bundle probe separately from CPU-heavy checks: the decoder's fixed 10s
deadline is not raised for competing builds. The probe retains `build.log`,
`http-results.json`, an own private app copy/bytes root, then stops Next. All
corpus/IO fixtures and failed attempts remain private and retained. The 384 MiB
RSS policy is explicitly sampled, not a hard sandbox. Unsupported complex PDF/
import variants and deployment asset tracing remain as listed in README; no
format was disabled to pass these findings.
