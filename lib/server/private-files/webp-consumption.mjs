// Export-only patch of the pinned decoder's existing entropy parser. Sharp
// remains the full native pixel decoder; no trial raster decodes or re-encoding.
import {
  BitReader,
  decodeLosslessImage,
  parseLossyHeader,
  parseIntraMode,
  tokenPartitions,
  decodeMacroblock,
  defaultIntraMode,
} from "@stacksjs/ts-webp"

const reject = () => {
  throw new Error("invalid")
}

function lossless(data, width, height, header) {
  class StrictReader extends BitReader {
    check() {
      if (this.getBitPosition() > data.length * 8) reject()
    }
    consume(n) {
      super.consume(n)
      this.check()
    }
    readBit() {
      const v = super.readBit()
      this.check()
      return v
    }
    readBits(n) {
      const v = super.readBits(n)
      this.check()
      return v
    }
  }
  const reader = new StrictReader(data)
  if (header) {
    if (
      reader.readBits(8) !== 47 ||
      reader.readBits(14) + 1 !== width ||
      reader.readBits(14) + 1 !== height
    )
      reject()
    reader.readBit()
    if (reader.readBits(3)) reject()
  }
  decodeLosslessImage(reader, { width, height, hasAlpha: false, version: 0 })
  const bits = reader.getBitPosition()
  if (
    Math.ceil(bits / 8) !== data.length ||
    (bits % 8 && data.at(-1) >>> (bits % 8))
  )
    reject()
}

function lossy(data, width, height) {
  const header = parseLossyHeader(data)
  if (header.frame.width !== width || header.frame.height !== height) reject()
  const columns = Math.ceil(header.frame.width / 16),
    rows = Math.ceil(header.frame.height / 16),
    top = new Uint8Array(columns * 4),
    left = new Uint8Array(4),
    blocks = Array.from({ length: columns }, () => ({
      segment: 0,
      skip: false,
      isI4x4: false,
      imodes: new Uint8Array(16),
      uvMode: 0,
      coeffs: new Int16Array(384),
      nonZeroY: 0,
      nonZeroUV: 0,
      nonZeroDc: 0,
    })),
    above = Array.from({ length: columns }, () => ({ nz: 0, nzDc: 0 })),
    previous = { nz: 0, nzDc: 0 },
    partitions = tokenPartitions(
      data,
      header.partitionsOffset,
      header.numPartitions
    ),
    skip = header.probSkipFalse !== null
  for (let row = 0; row < rows; row++) {
    left.fill(defaultIntraMode)
    previous.nz = previous.nzDc = 0
    for (let col = 0; col < columns; col++)
      parseIntraMode(
        header.bool,
        header.segmentation,
        skip,
        header.probSkipFalse ?? 0,
        top,
        col * 4,
        left,
        blocks[col]
      )
    for (let col = 0; col < columns; col++)
      decodeMacroblock(
        partitions[row % partitions.length],
        blocks[col],
        previous,
        above[col],
        skip,
        header.coefProbs,
        header.quant
      )
  }
  for (const reader of [header.bool, ...partitions]) {
    // The one-byte boolean reader's position includes its active decision
    // window. Permit only the existing bounded zero arithmetic flush bytes.
    const tail = data.subarray(reader.position(), reader.bufEnd)
    if (reader.isEof() || tail.length > 4 || tail.some((b) => b !== 0)) reject()
  }
}

export function consumedWebp(bytes, frames, width, height) {
  for (const { p, n, type } of frames) {
    const data = bytes.subarray(p + 8, p + 8 + n)
    if (type === "VP8 ") lossy(data, width, height)
    else if (type === "VP8L") lossless(data, width, height, true)
    else {
      const method = data[0] & 3
      if (data[0] & 0xc0 || method > 1) reject()
      if (method === 0) {
        if (data.length !== width * height + 1) reject()
      } else lossless(data.subarray(1), width, height, false)
    }
  }
}
