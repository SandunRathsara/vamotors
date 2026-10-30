# Correction of independent FAIL on 25da9d81

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
