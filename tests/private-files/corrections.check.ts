import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { test } from "node:test"
import { deflateSync } from "node:zlib"
import sharp from "sharp"
import {
  digest,
  PrivateFileError,
  validateDocument,
} from "../../lib/server/private-files/validation.js"
import { pdf, pdfObjects, pngChunk, stream, validFixtures } from "./fixtures.js"

async function check(
  bytes: Buffer,
  mime: string,
  filename: string,
  accepted: boolean
) {
  const validation = validateDocument(bytes, {
    size: bytes.length,
    sha256: digest(bytes),
    mime,
    filename,
  })
  if (accepted) await validation
  else
    await assert.rejects(
      validation,
      (e: unknown) =>
        e instanceof PrivateFileError && e.code === "UPLOAD_MISMATCH"
    )
}
function webp(chunks: [string, Buffer][]) {
  const parts = chunks.map(([type, data]) => {
    const h = Buffer.alloc(8)
    h.write(type)
    h.writeUInt32LE(data.length, 4)
    return Buffer.concat([h, data, Buffer.alloc(data.length & 1)])
  })
  const header = Buffer.from("RIFF0000WEBP")
  header.writeUInt32LE(4 + parts.reduce((n, b) => n + b.length, 0), 4)
  return Buffer.concat([header, ...parts])
}
function chunks(b: Buffer): [string, Buffer][] {
  const result: [string, Buffer][] = []
  for (let p = 12; p < b.length; ) {
    const n = b.readUInt32LE(p + 4)
    result.push([b.toString("ascii", p, p + 4), b.subarray(p + 8, p + 8 + n)])
    p += 8 + n + (n & 1)
  }
  return result
}

test("native PNG completions exit cleanly across repeated fresh workers", async () => {
  const root = process.env.T06A_REVIEW_FIXTURES
  assert(root)
  const bytes = await readFile(join(root, "fixtures/pillow-plain.png"))
  for (let i = 0; i < 32; i++)
    await check(bytes, "image/png", "repeat.png", true)
})

test("WebP native consumption checks lossy, lossless and alpha, not just RIFF sizes", async () => {
  for (const lossless of [false, true])
    for (const alpha of [false, true]) {
      const b = await sharp({
        create: {
          width: 24,
          height: 16,
          channels: alpha ? 4 : 3,
          background: { r: 22, g: 40, b: 70, alpha: 0.5 },
        },
      })
        .webp({ lossless })
        .toBuffer()
      await check(b, "image/webp", "native.webp", true)
      const parts = chunks(b)
      for (const type of ["VP8 ", "VP8L", "ALPH"]) {
        if (!parts.some(([name]) => name === type)) continue
        for (const suffix of [
          Buffer.from("<"),
          Buffer.from("MZ"),
          Buffer.from("<html><script>bad()</script></html>"),
          Buffer.alloc(16),
        ]) {
          const tail = webp(
            parts.map(([name, data]) => [
              name,
              name === type ? Buffer.concat([data, suffix]) : data,
            ])
          )
          await check(tail, "image/webp", "payload-tail.webp", false)
        }
      }
    }
})

test("passive metadata/comments work; malformed spans and hidden metadata payloads fail", async () => {
  const root = process.env.T06A_REVIEW_FIXTURES
  assert(root)
  const jpg = await readFile(join(root, "fixtures/pillow-plain.jpg"))
  const exif = (
    await sharp(
      await readFile(join(root, "fixtures/pillow-exif.jpg"))
    ).metadata()
  ).exif!
  const icc = (
    await sharp(
      await readFile(join(root, "fixtures/pillow-icc.jpg"))
    ).metadata()
  ).icc!
  const app = (marker: number, data: Buffer) => {
    const h = Buffer.alloc(4)
    h[0] = 255
    h[1] = marker
    h.writeUInt16BE(data.length + 2, 2)
    return Buffer.concat([jpg.subarray(0, 2), h, data, jpg.subarray(2)])
  }
  await check(
    app(0xfe, Buffer.from("Synthetic inspection comment")),
    "image/jpeg",
    "comment.jpg",
    true
  )
  await check(
    app(0xe1, Buffer.concat([exif, Buffer.from("<script>bad()</script>")])),
    "image/jpeg",
    "exif-tail.jpg",
    false
  )
  const brokenExif = Buffer.from(exif)
  brokenExif.writeUInt32LE(0xfffffff0, 10)
  await check(app(0xe1, brokenExif), "image/jpeg", "exif-offset.jpg", false)
  const brokenIcc = Buffer.from(icc)
  brokenIcc.writeUInt32BE(0xfffffff0, 136)
  await check(
    app(
      0xe2,
      Buffer.concat([Buffer.from("ICC_PROFILE\0\x01\x01", "latin1"), brokenIcc])
    ),
    "image/jpeg",
    "icc-offset.jpg",
    false
  )
  const f = (await validFixtures())[1]
  await check(
    Buffer.concat([
      f.bytes.subarray(0, -12),
      pngChunk("tEXt", Buffer.from("Author\0Synthetic inspection")),
      f.bytes.subarray(-12),
    ]),
    "image/png",
    "comment.png",
    true
  )
  const compressedIcc = Buffer.concat([
    Buffer.from("icc\0\0"),
    deflateSync(icc),
    Buffer.from("tail"),
  ])
  await check(
    Buffer.concat([
      f.bytes.subarray(0, 33),
      pngChunk("iCCP", compressedIcc),
      f.bytes.subarray(33),
    ]),
    "image/png",
    "icc-tail.png",
    false
  )
  const source = await readFile(join(root, "fixtures/pillow-plain.webp")),
    metadata = await sharp(source).metadata()
  const extended = Buffer.alloc(10)
  extended[0] = 0x2c
  extended.writeUIntLE(metadata.width! - 1, 4, 3)
  extended.writeUIntLE(metadata.height! - 1, 7, 3)
  const xmp = Buffer.from(
    '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>inspection</rdf:Description></rdf:RDF></x:xmpmeta>'
  )
  await check(
    webp([
      ["VP8X", extended],
      ["ICCP", icc],
      ...chunks(source),
      ["EXIF", exif],
      ["XMP ", xmp],
    ]),
    "image/webp",
    "all-metadata.webp",
    true
  )
})

function imagePdf(
  data: Buffer,
  width: number,
  height: number,
  filters = "",
  twice = false
) {
  const objects = pdfObjects()
  objects[3] = stream(
    Buffer.from(`q 100 0 0 100 0 0 cm /Im1 Do ${twice ? "/Im2 Do" : ""} Q`)
  )
  objects[4] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 6 0 R ${twice ? "/Im2 7 0 R" : ""} >> >> /Contents 4 0 R >>`
  const image = stream(
    data,
    `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${filters}`
  )
  objects.push(image)
  if (twice) objects.push(image)
  return pdf(objects)
}
test("PDF actual raster footprints, predictors, JPEG dimensions and aggregate pixels", async () => {
  const raw = Buffer.alloc(32 * 32 * 3, 81)
  await check(imagePdf(raw, 32, 32), "application/pdf", "raw.pdf", true)
  await check(
    imagePdf(Buffer.concat([raw, Buffer.from([0])]), 32, 32),
    "application/pdf",
    "long-raster.pdf",
    false
  )
  const rows = Buffer.alloc((32 * 3 + 1) * 32, 81)
  for (let row = 0; row < 32; row++) rows[row * 97] = 0
  const predictor =
    "/Filter /FlateDecode /DecodeParms << /Predictor 15 /Columns 32 /Colors 3 /BitsPerComponent 8 >>"
  await check(
    imagePdf(deflateSync(rows), 32, 32, predictor),
    "application/pdf",
    "predictor.pdf",
    true
  )
  rows[0] = 5
  await check(
    imagePdf(deflateSync(rows), 32, 32, predictor),
    "application/pdf",
    "bad-predictor.pdf",
    false
  )
  const jpeg = await sharp({
    create: { width: 3000, height: 3000, channels: 3, background: "#336699" },
  })
    .jpeg()
    .toBuffer()
  await check(
    imagePdf(jpeg, 3000, 3000, "/Filter /DCTDecode"),
    "application/pdf",
    "jpeg.pdf",
    true
  )
  await check(
    imagePdf(jpeg, 1, 1, "/Filter /DCTDecode"),
    "application/pdf",
    "lying-dimensions.pdf",
    false
  )
  await check(
    imagePdf(jpeg, 3000, 3000, "/Filter /DCTDecode", true),
    "application/pdf",
    "actual-aggregate.pdf",
    false
  )
})
