import exifr from "exifr"
import { SaxesParser } from "saxes"
import sharp from "sharp"

const reject = () => {
  throw new Error("invalid")
}
export function passiveText(b) {
  if (
    b.length > 262144 ||
    /<(?:script|html|svg|iframe|object)\b|<!DOCTYPE|%PDF-|PK\x03\x04/i.test(
      b.toString("latin1")
    )
  )
    reject()
}

// EXIF is passive TIFF, not an arbitrary application segment. Bound every IFD
// and value span, then independently parse its tags with exifr. Nonzero bytes
// outside the declared structures/values are not accepted as ignored tails.
export async function validateExif(input) {
  const b = input.subarray(
    input.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 6 : 0
  )
  passiveText(b)
  if (b.length < 8 || !["II", "MM"].includes(b.toString("ascii", 0, 2)))
    reject()
  const le = b.toString("ascii", 0, 2) === "II"
  const short = (p) => (le ? b.readUInt16LE(p) : b.readUInt16BE(p))
  const long = (p) => (le ? b.readUInt32LE(p) : b.readUInt32BE(p))
  if (short(2) !== 42) reject()
  const used = new Uint8Array(b.length),
    visited = new Set(),
    thumbnails = []
  const span = (p, n) => {
    if (p < 0 || n < 0 || p + n > b.length) reject()
    used.fill(1, p, p + n)
  }
  span(0, 8)
  const sizes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4]
  let entries = 0
  function ifd(p, depth) {
    if (!p) return
    if (depth > 8 || visited.has(p) || p < 8 || p + 2 > b.length) reject()
    visited.add(p)
    const count = short(p)
    entries += count
    if (entries > 512) reject()
    span(p, 2 + count * 12 + 4)
    let thumbnail, thumbnailSize
    for (let i = 0; i < count; i++) {
      const e = p + 2 + i * 12,
        tag = short(e),
        type = short(e + 2),
        count = long(e + 4)
      if (!sizes[type]) reject()
      const n = sizes[type] * count,
        data = n <= 4 ? e + 8 : long(e + 8)
      span(data, n)
      if ([330, 34665, 34853, 40965].includes(tag)) {
        if (![4, 13].includes(type) || count > 8) reject()
        for (let j = 0; j < count; j++) ifd(long(data + j * 4), depth + 1)
      }
      if (tag === 513) thumbnail = long(data)
      if (tag === 514) thumbnailSize = long(data)
    }
    // Thumbnail bytes are a declared TIFF value span; the main decoder also
    // parses EXIF. They are never interpreted as another upload or executable.
    if (thumbnail !== undefined || thumbnailSize !== undefined) {
      if (!thumbnail || !thumbnailSize) reject()
      span(thumbnail, thumbnailSize)
      if (
        b.readUInt16BE(thumbnail) !== 0xffd8 ||
        b.readUInt16BE(thumbnail + thumbnailSize - 2) !== 0xffd9
      )
        reject()
      thumbnails.push(b.subarray(thumbnail, thumbnail + thumbnailSize))
    }
    ifd(long(p + 2 + count * 12), depth + 1)
  }
  ifd(long(4), 0)
  if (!visited.size || b.some((byte, i) => !used[i] && byte !== 0)) reject()
  await exifr.parse(b, {
    silentErrors: false,
    ifd0: true,
    ifd1: true,
    exif: true,
    gps: true,
    interop: true,
    makerNote: true,
    userComment: true,
    chunked: false,
  })
  for (const bytes of thumbnails) {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: 1_000_000,
      limitInputChannels: 4,
    })
    const meta = await image.metadata()
    if (meta.format !== "jpeg") reject()
    await image.raw().toBuffer()
  }
}

export async function validateIcc(b) {
  passiveText(b)
  if (
    b.length < 132 ||
    b.readUInt32BE(0) !== b.length ||
    b.toString("ascii", 36, 40) !== "acsp"
  )
    reject()
  const n = b.readUInt32BE(128)
  if (n > 128 || 132 + n * 12 > b.length) reject()
  const used = new Uint8Array(b.length)
  used.fill(1, 0, 132 + n * 12)
  for (let i = 0; i < n; i++) {
    const p = 132 + i * 12,
      offset = b.readUInt32BE(p + 4),
      size = b.readUInt32BE(p + 8)
    if (
      offset < 132 + n * 12 ||
      offset % 4 ||
      size < 8 ||
      offset + size > b.length
    )
      reject()
    used.fill(1, offset, offset + size)
  }
  if (b.some((byte, i) => !used[i] && byte !== 0)) reject()
  await exifr.sidecar(b, { silentErrors: false, icc: true }, "icc")
}

export function validateXmp(b) {
  passiveText(b)
  let depth = 0,
    nodes = 0
  const parser = new SaxesParser({ xmlns: true })
  for (const event of ["error", "doctype", "cdata"]) parser.on(event, reject)
  parser.on("processinginstruction", (pi) => {
    if (pi.target !== "xpacket") reject()
  })
  parser.on("opentag", (tag) => {
    if (
      ++depth > 16 ||
      ++nodes > 4096 ||
      Object.keys(tag.attributes).length > 32
    )
      reject()
  })
  parser.on("closetag", () => {
    depth--
  })
  parser.write(new TextDecoder("utf-8", { fatal: true }).decode(b)).close()
  if (!nodes || depth) reject()
}
