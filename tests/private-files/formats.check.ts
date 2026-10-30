import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { test } from "node:test"
import { deflateSync } from "node:zlib"
import sharp from "sharp"
import readExcelFile from "read-excel-file/node"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import {
  openPrivateFiles,
  PrivateFileError,
} from "../../lib/server/private-files/index.js"
import {
  digest,
  validateDocument,
} from "../../lib/server/private-files/validation.js"
import { preflightZip } from "../../lib/server/private-files/xlsx-validation.mjs"
import {
  apng,
  encryptedPdf,
  pdf,
  pdfObjects,
  pngChunk,
  stream,
  validFixtures,
  xlsxMime,
  zip,
  type Fixture,
  type ZipPart,
} from "./fixtures.js"

const parent = process.env.T06A_TEST_PARENT
assert(
  parent && parent === resolve(parent),
  "Set private T06A_TEST_PARENT outside Git/temp"
)
const stat = await lstat(parent)
assert(
  stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    stat.uid === process.getuid!() &&
    (stat.mode & 0o777) === 0o700
)
const run = await mkdtemp(join(parent, "t06a2-formats-"))
const environmentId = "11111111-1111-4111-8111-111111111111"
const fixtures = await validFixtures()
assert.deepEqual(await readExcelFile(fixtures[4].bytes), [
  {
    sheet: "Synthetic",
    data: [
      ["name", "value"],
      ["car", 123],
    ],
  },
])
const declaration = (f: Fixture) => ({
  size: f.bytes.length,
  sha256: digest(f.bytes),
  mime: f.mime,
  filename: f.filename,
})
const mismatch = (error: unknown) => {
  assert(error instanceof PrivateFileError)
  assert.equal(error.code, "UPLOAD_MISMATCH")
  assert.equal(error.message, error.code)
  assert(!("cause" in error))
  return true
}
async function invalid(f: Fixture, bytes: Buffer, label: string) {
  await writeFile(join(run, label), bytes, { mode: 0o600, flag: "wx" })
  await assert.rejects(
    validateDocument(bytes, declaration({ ...f, bytes })),
    mismatch,
    label
  )
}

test("genuine JPEG/PNG/WebP/PDF/XLSX exact bytes survive immutable finalize and process restart", async () => {
  const root = join(run, "bytes")
  await mkdir(root, { mode: 0o700 })
  const store = await openPrivateFiles({
    root,
    environmentId,
    forbiddenRoots: [process.cwd()],
    mayWrite: () => true,
  })
  const evidence = []
  try {
    for (const f of fixtures) {
      await writeFile(join(run, f.filename), f.bytes, {
        mode: 0o600,
        flag: "wx",
      })
      const intent = randomUUID(),
        stage = store.newStageKey(intent),
        final = store.newFinalKey(intent, randomUUID())
      async function* source() {
        yield f.bytes
      }
      await store.writeStage(stage, source(), declaration(f))
      const declared = declaration(f)
      const validation = store.validateStage(stage, declared)
      declared.mime = "text/html"
      declared.filename = "changed.html"
      const token = await validation
      assert.equal(token.metadata.mime, f.mime)
      await writeFile(join(root, stage), Buffer.from("mutated staging"))
      const metadata = await store.finalize(final, token)
      assert.deepEqual(await store.readFinal(final, metadata), f.bytes)
      const mutableMetadata = { ...metadata }
      const retainedRead = store.readFinal(final, mutableMetadata)
      mutableMetadata.mime = "text/html"
      assert.deepEqual(await retainedRead, f.bytes)
      assert.deepEqual(await store.finalize(final, token), metadata)
      evidence.push({ filename: f.filename, ...metadata })
      const manifest = join(run, f.filename + ".checkpoint.json")
      await writeFile(manifest, JSON.stringify({ key: final, metadata }), {
        mode: 0o600,
        flag: "wx",
      })
      const restarted = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          "tests/private-files/restart.ts",
          "read",
          root,
          environmentId,
          manifest,
        ],
        { encoding: "utf8", timeout: 15_000 }
      )
      assert.equal(restarted.status, 0, restarted.stderr)
      assert.deepEqual(JSON.parse(restarted.stdout), {
        size: f.bytes.length,
        sha256: digest(f.bytes),
        finals: evidence.length,
      })
    }
  } finally {
    await store.close()
  }
  await writeFile(
    join(run, "evidence.json"),
    JSON.stringify(evidence, null, 2),
    { mode: 0o600, flag: "wx" }
  )
  console.log(`retained format evidence: ${run}`)
})

test("all formats reject truncated, wrong-MIME and leading/trailing polyglot envelopes", async () => {
  for (const f of fixtures) {
    await invalid(
      f,
      f.bytes.subarray(0, Math.floor(f.bytes.length / 2)),
      f.filename + ".truncated"
    )
    await invalid(
      f,
      Buffer.concat([f.bytes, Buffer.from("<html>active</html>")]),
      f.filename + ".trailing"
    )
    await invalid(
      f,
      Buffer.concat([Buffer.from("MZ"), f.bytes]),
      f.filename + ".leading"
    )
    await invalid(
      f,
      Buffer.from("<svg onload='alert(1)'/>"),
      f.filename + ".wrong"
    )
  }
})

test("images require real decode, single frame, strict metadata/container and dimension/pixel bounds", async () => {
  const png = fixtures[1],
    jpg = fixtures[0],
    webp = fixtures[2]
  const bomb = await sharp({
    create: { width: 4001, height: 4000, channels: 3, background: "red" },
  })
    .png()
    .toBuffer()
  await invalid(png, bomb, "pixels.png")
  const wide = await sharp({
    create: { width: 8193, height: 1, channels: 3, background: "red" },
  })
    .png()
    .toBuffer()
  await invalid(png, wide, "dimension.png")
  await invalid(png, apng(), "animated.png")
  // The animated WebP is genuinely encoded by Sharp from a locally built GIF.
  const gif = Buffer.from(
    "47494638396101000100800000000000ffffff21f90400010000002c000000000100010000020244010021f90400010000002c00000000010001000002024c01003b",
    "hex"
  )
  const animatedWebp = await sharp(gif, { animated: true }).webp().toBuffer()
  assert.equal(
    (await sharp(animatedWebp, { animated: true }).metadata()).pages,
    2
  )
  await invalid(webp, animatedWebp, "animated.webp")
  const iend = png.bytes.length - 12
  await invalid(
    png,
    Buffer.concat([
      png.bytes.subarray(0, iend),
      pngChunk("tEXt", Buffer.from("comment\0<html>polyglot</html>")),
      png.bytes.subarray(iend),
    ]),
    "metadata.png"
  )
  const badCrc = Buffer.from(png.bytes)
  badCrc[badCrc.length - 1] ^= 1
  await invalid(png, badCrc, "crc.png")
  // Valid envelope/CRC but invalid compressed pixels: magic/metadata is not enough.
  const idat = png.bytes.indexOf(Buffer.from("IDAT"))
  const n = png.bytes.readUInt32BE(idat - 4)
  await invalid(
    png,
    Buffer.concat([
      png.bytes.subarray(0, idat - 4),
      pngChunk(
        "IDAT",
        Buffer.concat([
          png.bytes.subarray(idat + 4, idat + 4 + n),
          Buffer.from("<html>polyglot</html>"),
        ])
      ),
      png.bytes.subarray(idat + 4 + n + 4),
    ]),
    "trailing-idat.png"
  )
  await invalid(
    png,
    Buffer.concat([
      png.bytes.subarray(0, idat - 4),
      pngChunk("IDAT", Buffer.alloc(n, 1)),
      png.bytes.subarray(idat + 4 + n + 4),
    ]),
    "pixels-corrupt.png"
  )
  await invalid(
    jpg,
    Buffer.concat([
      jpg.bytes.subarray(0, 2),
      Buffer.from("fffe000b3c68746d6c3e212121", "hex"),
      jpg.bytes.subarray(2),
    ]),
    "comment.jpg"
  )
  await invalid(
    jpg,
    Buffer.concat([
      jpg.bytes.subarray(0, jpg.bytes.length - 8),
      Buffer.from([255, 217]),
    ]),
    "entropy-truncated.jpg"
  )
  await invalid(
    webp,
    Buffer.concat([
      webp.bytes.subarray(0, 20),
      Buffer.alloc(webp.bytes.length - 20),
    ]),
    "pixels-corrupt.webp"
  )
})

test("PDF full page parse, encryption (including empty password), passive object policy and inflate bounds", async () => {
  const f = fixtures[3]
  const compressed = pdfObjects()
  compressed[3] = stream(
    deflateSync(
      Buffer.from("BT /F1 12 Tf 10 100 Td (Compressed fixture) Tj ET")
    ),
    "/Filter /FlateDecode"
  )
  const compressedPdf = pdf(compressed)
  await validateDocument(
    compressedPdf,
    declaration({ ...f, bytes: compressedPdf })
  )
  const withImage = pdfObjects()
  withImage[3] = stream(Buffer.from("q 100 0 0 100 0 0 cm /Im1 Do Q"))
  withImage[4] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 4 0 R >>"
  withImage.push(
    stream(
      fixtures[0].bytes,
      "/Type /XObject /Subtype /Image /Width 12 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode"
    )
  )
  const imagePdf = pdf(withImage)
  await validateDocument(imagePdf, declaration({ ...f, bytes: imagePdf }))
  await validateDocument(
    pdf(pdfObjects(50)),
    declaration({ ...f, bytes: pdf(pdfObjects(50)) })
  )
  await invalid(f, pdf(pdfObjects(51)), "pages.pdf")
  for (const password of ["", "secret"]) {
    const bytes = encryptedPdf(password)
    // Independently exercise the real parser to establish a genuine encrypted fixture.
    const task = getDocument({
      data: Uint8Array.from(bytes),
      password,
      verbosity: 0,
    })
    const doc = await task.promise
    assert.equal(doc.numPages, 1)
    const decrypted = await (await doc.getPage(1)).getTextContent()
    assert(
      decrypted.items.some(
        (item) => "str" in item && item.str === "Encrypted fixture"
      )
    )
    await task.destroy()
    await invalid(f, bytes, password ? "encrypted.pdf" : "empty-password.pdf")
  }
  for (const [label, object] of [
    ["javascript", "<< /S /JavaScript /JS (app.alert\\(1\\)) >>"],
    ["escaped-js", "<< /S /Java#53cript /J#53 (alert) >>"],
    ["embedded", "<< /Type /EmbeddedFile >>"],
    ["external", "<< /Type /Action /S /URI /URI (https://example.invalid/) >>"],
    ["objstm", "<< /Type /ObjStm /Length 0 >>\nstream\n\nendstream"],
  ])
    await invalid(f, pdf([...pdfObjects(), object]), label + ".pdf")
  const bad = pdfObjects()
  bad[3] = stream(Buffer.from([255, 1, 2]), "/Filter /FlateDecode")
  await invalid(f, pdf(bad), "unreadable.pdf")
  const trailingFlate = pdfObjects()
  trailingFlate[3] = stream(
    Buffer.concat([
      deflateSync(Buffer.from("q Q")),
      Buffer.from("<html>polyglot</html>"),
    ]),
    "/Filter /FlateDecode"
  )
  await invalid(f, pdf(trailingFlate), "trailing-flate.pdf")
  const expanded = pdfObjects()
  expanded[3] = stream(
    deflateSync(Buffer.alloc(9 * 1024 * 1024, 32)),
    "/Filter /FlateDecode"
  )
  await invalid(f, pdf(expanded), "inflate.pdf")
  const brokenXref = Buffer.from(
    f.bytes
      .toString("latin1")
      .replace(/0000000015 00000 n/, "0000000016 00000 n"),
    "latin1"
  )
  await invalid(f, brokenXref, "xref.pdf")
  await invalid(
    f,
    Buffer.concat([f.bytes, f.bytes]),
    "incremental-polyglot.pdf"
  )
})

test("XLSX archive preflight rejects unsafe archives before actual workbook parsing", async () => {
  const f = fixtures[4]
  const entries = preflightZip(f.bytes) as Map<string, Buffer>
  const parts: ZipPart[] = [...entries].map(([name, data]) => ({
    name,
    data,
    compress: true,
  }))
  await validateDocument(zip(parts), declaration({ ...f, bytes: zip(parts) }))
  const changed = (name: string, transform: (text: string) => string) =>
    parts.map((p) =>
      p.name === name
        ? { ...p, data: Buffer.from(transform(p.data.toString())) }
        : p
    )
  for (const [label, candidate] of [
    [
      "traversal",
      [...parts, { name: "../evil.xml", data: Buffer.from("evil") }],
    ],
    ["duplicate", [...parts, parts[0]]],
    ["encrypted", parts.map((p) => ({ ...p, flags: 1 }))],
    ["genuine-encrypted", parts.map((p) => ({ ...p, password: "secret" }))],
    [
      "macro",
      [...parts, { name: "xl/vbaProject.bin", data: Buffer.from("MZ") }],
    ],
    [
      "external",
      changed("xl/_rels/workbook.xml.rels", (t) =>
        t.replace(
          /Target="[^"]+"/,
          'Target="https://example.invalid/" TargetMode="External"'
        )
      ),
    ],
    [
      "doctype",
      changed("xl/workbook.xml", (t) =>
        t.replace(/\?>/, '?><!DOCTYPE workbook [<!ENTITY x "boom">]>')
      ),
    ],
    [
      "formula",
      changed("xl/worksheets/sheet1.xml", (t) =>
        t.replace(/<v>/, "<f>1+1</f><v>")
      ),
    ],
    [
      "row",
      changed("xl/worksheets/sheet1.xml", (t) =>
        t.replace('r="2"', 'r="10001"')
      ),
    ],
    [
      "column",
      changed("xl/worksheets/sheet1.xml", (t) =>
        t.replace('r="B2"', 'r="DY2"')
      ),
    ],
    [
      "field",
      changed("xl/sharedStrings.xml", (t) =>
        t.replace("car", "x".repeat(8193))
      ),
    ],
    [
      "ratio",
      [
        ...parts,
        {
          name: "xl/theme/theme2.xml",
          data: Buffer.alloc(1_000_000, 32),
          compress: true,
        },
      ],
    ],
    [
      "inflate",
      parts.map((p) => (p.name === "xl/workbook.xml" ? { ...p, size: 16 } : p)),
    ],
    ["count", Array.from({ length: 257 }, () => parts[0])],
    [
      "trailing-deflate",
      parts.map((p) =>
        p.name === "xl/workbook.xml"
          ? { ...p, packedTail: Buffer.from("<html>polyglot</html>") }
          : p
      ),
    ],
    ["not-workbook", parts.filter((p) => p.name !== "xl/workbook.xml")],
    [
      "broken-cell",
      changed("xl/worksheets/sheet1.xml", (t) =>
        t.replace("<v>2</v>", "<v>9999</v>")
      ),
    ],
    [
      "broken-xml",
      changed("xl/workbook.xml", (t) => t.replace("</workbook>", "</wrong>")),
    ],
  ] as [string, ZipPart[]][])
    await invalid(f, zip(candidate), label + ".xlsx")
  const huge = Buffer.alloc(7 * 1024 * 1024)
  randomBytes(110_000).copy(huge)
  await invalid(
    f,
    zip([
      ...parts.filter((p) => !p.name.startsWith("xl/theme/")),
      ...[1, 2, 3].map((n) => ({
        name: `xl/theme/theme${n}.xml`,
        data: huge,
        compress: true,
      })),
    ]),
    "total-inflation.xlsx"
  )
  const denseRows = Array.from(
    { length: 1000 },
    (_, r) =>
      `<row r="${r + 1}">${Array.from({ length: 101 }, (_, c) => {
        const n = c + 1
        const column =
          n <= 26
            ? String.fromCharCode(64 + n)
            : String.fromCharCode(64 + Math.floor((n - 1) / 26)) +
              String.fromCharCode(65 + ((n - 1) % 26))
        return `<c r="${column}${r + 1}"><v>1</v></c>`
      }).join("")}</row>`
  ).join("")
  await invalid(
    f,
    zip(
      changed("xl/worksheets/sheet1.xml", (t) =>
        t.replace(
          /<sheetData>.*<\/sheetData>/,
          `<sheetData>${denseRows}</sheetData>`
        )
      )
    ),
    "cells.xlsx"
  )
  const crc = Buffer.from(zip(parts))
  crc.writeUInt32LE(0, 14)
  crc.writeUInt32LE(0, crc.readUInt32LE(crc.length - 6) + 16)
  await invalid(f, crc, "crc.xlsx")
  const mislabeled = { ...f, mime: "application/zip" }
  await assert.rejects(
    validateDocument(f.bytes, declaration(mislabeled)),
    mismatch
  )
  assert.equal(f.mime, xlsxMime)
})
