import { crc32, inflateSync } from "node:zlib"
import sharp from "sharp"

const reject = () => {
  throw new Error("invalid")
}
sharp.cache(false)
sharp.concurrency(1)

// Deliberately passive envelopes: no comments, EXIF/XMP, text, animation or
// arbitrary application payloads. A decoder accepting a prefix is insufficient.
function envelope(b, format) {
  if (format === "png") {
    if (!b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
      reject()
    let p = 8,
      count = 0,
      idat = false,
      ended = false
    const seen = new Set()
    const compressed = []
    while (p < b.length) {
      if (++count > 256 || p + 12 > b.length) reject()
      const n = b.readUInt32BE(p),
        type = b.toString("ascii", p + 4, p + 8)
      if (
        p + n + 12 > b.length ||
        ![
          "IHDR",
          "PLTE",
          "tRNS",
          "IDAT",
          "IEND",
          "sRGB",
          "gAMA",
          "cHRM",
          "pHYs",
        ].includes(type)
      )
        reject()
      if (type !== "IDAT" && seen.has(type)) reject()
      seen.add(type)
      const fixed = { IHDR: 13, IEND: 0, sRGB: 1, gAMA: 4, cHRM: 32, pHYs: 9 }
      if (
        (type in fixed && n !== fixed[type]) ||
        (type === "PLTE" && (!n || n > 768 || n % 3)) ||
        (type === "tRNS" && (!n || n > 256))
      )
        reject()
      if (crc32(b.subarray(p + 4, p + 8 + n)) !== b.readUInt32BE(p + 8 + n))
        reject()
      if ((count === 1) !== (type === "IHDR") || (type === "IHDR" && n !== 13))
        reject()
      if (type === "IDAT") {
        if (ended) reject()
        idat = true
        compressed.push(b.subarray(p + 8, p + 8 + n))
      } else if (idat) ended = true
      if (type === "IHDR") {
        const width = b.readUInt32BE(p + 8),
          height = b.readUInt32BE(p + 12)
        if (
          !width ||
          !height ||
          width > 8192 ||
          height > 8192 ||
          width * height > 16_000_000
        )
          reject()
      }
      p += n + 12
      if (type === "IEND") {
        if (n || !idat || p !== b.length) reject()
        // libpng can tolerate bytes after the zlib datastream inside IDAT.
        // Account for worst-case 16-bit RGBA + Adam7 scanline overhead, and
        // reject any payload the inflater did not consume, before Sharp decode.
        const packed = Buffer.concat(compressed)
        const result = inflateSync(packed, {
          maxOutputLength: 128_065_536,
          info: true,
        })
        if (result.engine.bytesWritten !== packed.length) reject()
        return
      }
    }
    reject()
  } else if (format === "webp") {
    if (
      b.length < 20 ||
      b.toString("ascii", 0, 4) !== "RIFF" ||
      b.readUInt32LE(4) !== b.length - 8 ||
      b.toString("ascii", 8, 12) !== "WEBP"
    )
      reject()
    let p = 12,
      count = 0,
      image = false
    while (p < b.length) {
      if (++count > 4 || p + 8 > b.length) reject()
      const type = b.toString("ascii", p, p + 4),
        n = b.readUInt32LE(p + 4)
      if (!n || p + 8 + n + (n & 1) > b.length) reject()
      if (type === "VP8X") {
        if (
          count !== 1 ||
          n !== 10 ||
          b[p + 8] & ~0x10 ||
          b.readUIntBE(p + 9, 3)
        )
          reject()
      } else if (type === "ALPH") {
        if (image || count !== 2) reject()
      } else if (type === "VP8 " || type === "VP8L") {
        if (image) reject()
        image = true
      } else reject()
      if (n & 1 && b[p + 8 + n] !== 0) reject()
      p += 8 + n + (n & 1)
    }
    if (!image) reject()
  } else {
    if (b.length < 4 || b.readUInt16BE(0) !== 0xffd8) reject()
    let p = 2,
      count = 0,
      scans = 0
    while (p < b.length) {
      if (++count > 1024 || b[p++] !== 255) reject()
      while (b[p] === 255) p++
      const marker = b[p++]
      if (marker === 0xd9) {
        if (!scans || p !== b.length) reject()
        return
      }
      if (
        ![0xe0, 0xdb, 0xc4, 0xc0, 0xc1, 0xc2, 0xdd, 0xda].includes(marker) ||
        p + 2 > b.length
      )
        reject()
      const n = b.readUInt16BE(p)
      if (n < 2 || p + n > b.length) reject()
      if (
        marker === 0xe0 &&
        (n !== 16 ||
          b.toString("latin1", p + 2, p + 7) !== "JFIF\0" ||
          b[p + 14] ||
          b[p + 15])
      )
        reject()
      p += n
      if (marker === 0xda) {
        scans++
        while (p < b.length) {
          if (b[p++] !== 255) continue
          const start = p - 1
          while (b[p] === 255) p++
          if (b[p] === 0 || (b[p] >= 0xd0 && b[p] <= 0xd7)) {
            p++
            continue
          }
          p = start
          break
        }
      }
    }
    reject()
  }
}

export async function validateImage(bytes, format) {
  if (bytes.length > 2 * 1024 * 1024) reject()
  envelope(bytes, format)
  const image = sharp(bytes, {
    failOn: "warning",
    limitInputPixels: 16_000_000,
    limitInputChannels: 4,
    animated: true,
  })
  const meta = await image.metadata()
  if (
    meta.format !== format ||
    !meta.width ||
    !meta.height ||
    meta.width > 8192 ||
    meta.height > 8192 ||
    meta.width * meta.height > 16_000_000 ||
    (meta.pages ?? 1) !== 1 ||
    meta.channels > 4
  )
    reject()
  // Force every pixel through the actual native decoder, without resizing.
  // The result is discarded; it must NEVER replace the uploaded exact bytes.
  const { data, info } = await image
    .raw({ depth: "uchar" })
    .toBuffer({ resolveWithObject: true })
  if (
    info.width !== meta.width ||
    info.height !== meta.height ||
    data.length > 64_000_000
  )
    reject()
}
