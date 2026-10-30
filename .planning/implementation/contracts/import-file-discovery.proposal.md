# Import staging/file discovery — CONTRACT CANDIDATE

Base: `db2580dd7fa722489c591f3f9ed8ed0ea4d26a72`; branch `opencode/contract-import-file-discovery`. Parent dispatched bounded contract authorship. Independent review and explicit parent acceptance are required before runtime adoption; this is not T06/T16/G2 or requirement acceptance.

## Smallest missing read seam

Existing `importBatch` requires ImportPreview data and has no actual upload inventory. UploadReady/Applied are action results; download requires a known attachment ID. Add only `importBatches` (existing ListParams + exact optional state/namespace) and `importBatchFiles(id)`, with summary/current roots, complete authorized IMPORT_SOURCE intent summaries and FINAL attachment references. `createdAt` supplies the permission-checked ListParams date/order basis. No command or old ImportPreview/importBatch shape changes. An unpreviewed batch has no invented preview/hash/valid graph/control totals.

Normative candidate detail is in [W16](workflows.md#w16-historical-import-t16), [F06](files-runtime.md#f06-stagingfinalizationdownload) and [api.ts](api.ts). Own/delegated record scope, current document-field projection, complete per-owner arrays, coherence/CAS, original expiry and persisted FINALIZING lease are explicit. Discovery never grants import/finalize/upload authority, revives a bearer URL or exposes keys/attempt identity. Protected import policy is unchanged. Source-shaped typed specimens are specification only, not runtime authorization/storage proof.

## Contract-only validation

No dependency installation. Use the existing `/Users/alpha/Developer/Personal/vamotors/node_modules/.bin/tsc`:

```sh
node .planning/implementation/contracts/check.mjs
/Users/alpha/Developer/Personal/vamotors/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2020 --module ESNext --moduleResolution bundler .planning/implementation/contracts/api.ts .planning/implementation/contracts/api-check.ts .planning/implementation/contracts/roundtrip-check.ts .planning/implementation/contracts/party-detail-settings.proposal.ts .planning/implementation/contracts/party-detail-settings.proposal-check.ts
```

Emit the same five files with `--module commonjs --moduleResolution node --outDir <private-approved-temp-directory>` (omit `--noEmit`), then execute `roundtrip-check.js` and `party-detail-settings.proposal-check.js` there. No services, Prisma/schema, packages, registry/grants, application or shared ledger edits are authorized by this candidate.

Fresh author results (2026-10-30):

- PASS20 specification checks, including all134 seam coverage, exact query/response catalog and new discovery/index assertions.
- PASS strict standalone five-file no-emit compilation and CommonJS emission; no install. Temporary output: `/private/var/folders/gb/j8pkyq8j0rd50dzkps44xgh40000gn/T/opencode/import-file-discovery.nh4Uvd`.
- PASS8 main typed specimens (preserved5 + new3) and preserved3 party/Settings specimens. New groups cover navigation-list rediscovery, current read-to-init/finalize/download refs, concurrent stale roots, no fabricated preview, scoped totals/pagination/Colombo date filters, final Attachment authorization, persisted claim/orphan non-disclosure,101-item complete arrays, own/delegated/leaf/document scopes and protected import non-escalation. JSON source reconstruction models loss of browser memory only; it is not an exercised service restart.
- PASS byte preservation against base for Commands, ImportPreview and old importBatch shape; PASS316 local contract Markdown targets (paths, not anchors); PASS `git diff --check`.

Future implementation stays with the serialized source owner, including registry-universe migration/old-grant attenuation and persisted root/lease metadata. Distinct independent contract review/parent acceptance must precede that work. Real UI/HTTP/DB authorization, actual IO/restarts, replay/races, migrations/grants and G2 remain unverified by this candidate.
