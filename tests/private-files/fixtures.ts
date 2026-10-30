import { createHash } from "node:crypto"
import { crc32, deflateSync, deflateRawSync } from "node:zlib"
import sharp from "sharp"

export const xlsxMime =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
export type Fixture = { bytes: Buffer; mime: string; filename: string }

export function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4),
    crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

export function apng(): Buffer {
  const ihdr = Buffer.from("00000001000000010806000000", "hex")
  const control = Buffer.alloc(8)
  control.writeUInt32BE(2)
  const frame = (sequence: number) => {
    const b = Buffer.alloc(26)
    b.writeUInt32BE(sequence)
    b.writeUInt32BE(1, 4)
    b.writeUInt32BE(1, 8)
    b.writeUInt16BE(1, 20)
    b.writeUInt16BE(10, 22)
    return b
  }
  const pixel = deflateSync(Buffer.from([0, 255, 0, 0, 255]))
  const sequence = Buffer.alloc(4)
  sequence.writeUInt32BE(2)
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("acTL", control),
    pngChunk("fcTL", frame(0)),
    pngChunk("IDAT", pixel),
    pngChunk("fcTL", frame(1)),
    pngChunk("fdAT", Buffer.concat([sequence, pixel])),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

export function pdf(objects: (string | Buffer)[], trailer = ""): Buffer {
  const parts: Buffer[] = [
    Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"),
  ]
  const offsets = [0]
  for (const [i, object] of objects.entries()) {
    offsets.push(parts.reduce((sum, b) => sum + b.length, 0))
    parts.push(
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(object) ? object : Buffer.from(object),
      Buffer.from("\nendobj\n")
    )
  }
  const start = parts.reduce((sum, b) => sum + b.length, 0)
  parts.push(
    Buffer.from(
      `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
        .slice(1)
        .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
        .join(
          ""
        )}trailer\n<< /Size ${offsets.length} /Root 1 0 R ${trailer} >>\nstartxref\n${start}\n%%EOF\n`
    )
  )
  return Buffer.concat(parts)
}

export function pdfObjects(pages = 1): (string | Buffer)[] {
  return [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 5} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream(
      Buffer.from("BT /F1 12 Tf 10 100 Td (Synthetic local fixture) Tj ET")
    ),
    ...Array.from(
      { length: pages },
      () =>
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>"
    ),
  ]
}
export function stream(data: Buffer, filter = ""): Buffer {
  return Buffer.concat([
    Buffer.from(`<< /Length ${data.length} ${filter} >>\nstream\n`),
    data,
    Buffer.from("\nendstream"),
  ])
}

// Genuine PDF standard-security revision 2 fixture, not just /Encrypt text.
function rc4(key: Buffer, input: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255
    ;[s[i], s[j]] = [s[j], s[i]]
  }
  let i = 0
  j = 0
  return Buffer.from(
    input.map((b) => {
      i = (i + 1) & 255
      j = (j + s[i]) & 255
      ;[s[i], s[j]] = [s[j], s[i]]
      return b ^ s[(s[i] + s[j]) & 255]
    })
  )
}
export function encryptedPdf(password: string): Buffer {
  const pad = Buffer.from(
    "28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a",
    "hex"
  )
  const padded = (s: string) =>
    Buffer.concat([Buffer.from(s, "latin1"), pad]).subarray(0, 32)
  const md5 = (b: Buffer) => createHash("md5").update(b).digest()
  const owner = rc4(md5(padded("owner")).subarray(0, 5), padded(password))
  const permissions = Buffer.from("fcffffff", "hex"),
    id = Buffer.alloc(16, 7)
  const key = md5(
    Buffer.concat([padded(password), owner, permissions, id])
  ).subarray(0, 5)
  const user = rc4(key, pad)
  const objectKey = md5(
    Buffer.concat([key, Buffer.from([4, 0, 0, 0, 0])])
  ).subarray(0, 10)
  const objects = pdfObjects()
  objects[3] = stream(
    rc4(
      objectKey,
      Buffer.from("BT /F1 12 Tf 10 100 Td (Encrypted fixture) Tj ET")
    )
  )
  objects.push(
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`
  )
  return pdf(
    objects,
    `/Encrypt 6 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>]`
  )
}

export type ZipPart = {
  name: string
  data: Buffer
  flags?: number
  size?: number
  compress?: boolean
  password?: string
  packedTail?: Buffer
}
// Traditional ZipCrypto only for generating a genuine encrypted negative
// fixture. This weak historical cipher must not be used for retained storage.
function zipCrypto(data: Buffer, password: string, crc: number): Buffer {
  const keys = [0x12345678, 0x23456789, 0x34567890]
  const updateCrc = (key: number, byte: number) => {
    let n = (key ^ byte) >>> 0
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
    return n >>> 0
  }
  const update = (byte: number) => {
    keys[0] = updateCrc(keys[0], byte)
    keys[1] =
      (Math.imul((keys[1] + (keys[0] & 255)) >>> 0, 134775813) + 1) >>> 0
    keys[2] = updateCrc(keys[2], keys[1] >>> 24)
  }
  for (const byte of Buffer.from(password)) update(byte)
  const header = Buffer.alloc(12)
  header[11] = crc >>> 24
  return Buffer.from(
    Buffer.concat([header, data]).map((byte) => {
      const temp = keys[2] | 2
      const encrypted = byte ^ ((Math.imul(temp, temp ^ 1) >>> 8) & 255)
      update(byte)
      return encrypted
    })
  )
}
export function zip(parts: ZipPart[]): Buffer {
  const locals: Buffer[] = [],
    central: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const name = Buffer.from(part.name)
    let data = part.compress ? deflateRawSync(part.data) : part.data
    if (part.packedTail) data = Buffer.concat([data, part.packedTail])
    if (part.password) data = zipCrypto(data, part.password, crc32(part.data))
    const local = Buffer.alloc(30),
      entry = Buffer.alloc(46)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE((part.flags ?? 0) | (part.password ? 1 : 0), 6)
    local.writeUInt16LE(part.compress ? 8 : 0, 8)
    local.writeUInt32LE(crc32(part.data), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(part.size ?? part.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    local.copy(entry, 8, 6, 26)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    central.push(entry, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

export async function validFixtures(): Promise<Fixture[]> {
  const image = () =>
    sharp({
      create: { width: 12, height: 8, channels: 3, background: "#226699" },
    })
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  const relations = (items: string) =>
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`
  const xml = (text: string) =>
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>${text}`)
  const parts = [
    {
      name: "[Content_Types].xml",
      data: xml(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`
      ),
    },
    {
      name: "_rels/.rels",
      data: xml(
        relations(
          `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/>`
        )
      ),
    },
    {
      name: "xl/workbook.xml",
      data: xml(
        `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Synthetic" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: xml(
        relations(
          `<Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/>`
        )
      ),
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: xml(
        `<worksheet xmlns="${ns}"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>123</v></c></row></sheetData></worksheet>`
      ),
    },
    {
      name: "xl/sharedStrings.xml",
      data: xml(
        `<sst xmlns="${ns}" count="3" uniqueCount="3"><si><t>name</t></si><si><t>value</t></si><si><t>car</t></si></sst>`
      ),
    },
  ]
  return [
    {
      bytes: await image().jpeg().toBuffer(),
      mime: "image/jpeg",
      filename: "valid.jpg",
    },
    {
      bytes: await image().png().toBuffer(),
      mime: "image/png",
      filename: "valid.png",
    },
    {
      bytes: await image().webp().toBuffer(),
      mime: "image/webp",
      filename: "valid.webp",
    },
    {
      bytes: pdf(pdfObjects()),
      mime: "application/pdf",
      filename: "valid.pdf",
    },
    {
      bytes: zip(parts.map((p) => ({ ...p, compress: true }))),
      mime: xlsxMime,
      filename: "valid.xlsx",
    },
  ]
}
