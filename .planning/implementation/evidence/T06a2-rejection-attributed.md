# T06a2 — rejected format-validator source; correction active

2026-10-30. Parent rejects **`25da9d81e1c7158b84f4151ec90d817a33f5a56a`**, base accepted adapter `3cc43b3b89fd52038a8e0339c3eafdb40f966f52`, after independent **`ses_e74d500a7ffeo065r9u4jlVqxr` FAIL**. Original author **`ses_e74ec4a83ffe256FD01xFxgSJf`** is correcting all five findings as sole private-files/package writer; replacement head/reviewer not supplied. Do not integrate the rejected candidate or duplicate its author.

Read-only original evidence: `/Users/alpha/.local/share/vamotors/t06a2-verifier-HrNELt/review/result.json`. Ledger read that result only; reproducer commands, byte fixtures and services were not executed/opened by ledger.

| Finding | Independent demonstrated failure at exact candidate |
| --- | --- |
| F1 WebP unconsumed payload | RIFF/VP8 lengths can enclose appended HTML/script; decoder discards unconsumed VP8 tail. The in-chunk polyglot passes validateStage/finalize/readFinal/restart. |
| F2 PDF raster and aggregate dimensions | Empty/short raw or Flate raster payloads accepted despite declared32×32 RGB. Actual JPEG dimensions not compared with PDF dictionary: two3000×3000 images declared1×1 bypass16MP aggregate bound with18MP actual. |
| F3 Routine input compatibility | Six valid EXIF/ICC JPEG/PNG/WebP inspection inputs and five routine ReportLab PDF variants rejected. Conservative exclusions were disclosed, but normal workflow support remains a gap; not every PDF variant is newly mandated. |
| F4 Real Next import/build | An actual Node route importing validateDocument makes default Turbopack build fail resolving **`./decoder.js`**. Unreferenced baseline build PASS is not integration compatibility proof. |
| F5 Missing worker classification | Missing worker exit maps to **UPLOAD_MISMATCH**, not retryable **STORAGE_UNAVAILABLE**; missing imported module correctly maps unavailable. |

Preserve independent positives as **partial**, not an overall validator PASS: dedicated checks **16/16**, security **101/101**, frozen install/own Prisma generation/types/owned ESLint/Prettier and unreferenced Next build PASS. Independent corpus68:9 positives accepted,11 ordinary inputs rejected,43 negatives rejected,5 negatives incorrectly accepted. XLSX passive-subset and unchanged strict ASCII CSV checks passed; tested worker concurrency/deadline/sampled RSS limits passed, not a hard native sandbox/RSS guarantee.

Opaque-snapshot/finalization/restart mechanics passed for9 retained finals/90261 bytes, **including two known false accepts**; that is not proof all retained documents are valid. Parser-tree advisory checks passed, not a clean whole-repository audit. Full HTTP/DB/restore/T06/G2 remains blocked/outside this review. Accepted bounded T06a adapter and its original evidence stay unchanged.

Next: same author corrects F1–F5 and returns exact replacement for fresh independent verification and parent decision. Package changes remain solely that author's scoped work. Current integration order excludes T06a2: wait corrected T05b PASS/acceptance, then explicitly authorized corrected T05b + separately accepted T06a + accepted lint, followed by combined independent review. No whole-ID/matrix promotion or source integration by ledger.
