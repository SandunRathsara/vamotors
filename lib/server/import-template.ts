import { crc32, deflateRawSync } from "node:zlib"
import type { ImportType } from "../../.planning/implementation/contracts/api"
import { importTemplateColumns } from "./import-parsers"

export type XlsxCell =
  | string
  | { num: string }
  | { bool: boolean }
  | { dateSerial: number }
  | { formula: string; cached?: string }
  | null

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function colLetters(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1
  let out = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function makeZip(parts: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const part of parts) {
    const name = Buffer.from(part.name, "utf8")
    const compressed = deflateRawSync(part.data)
    const crc = crc32(part.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(part.data.length, 22)
    local.writeUInt16LE(name.length, 26)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    local.copy(entry, 8, 6, 26)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)

    locals.push(local, name, compressed)
    central.push(entry, name)
    offset += local.length + name.length + compressed.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(parts.length, 8)
  end.writeUInt16LE(parts.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

export function buildXlsx(
  sheets: { name: string; rows: XlsxCell[][] }[]
): Buffer {
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  const rel =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

  const sharedStrings: string[] = []
  const sharedIndex = new Map<string, number>()
  const intern = (s: string): number => {
    let idx = sharedIndex.get(s)
    if (idx === undefined) {
      idx = sharedStrings.length
      sharedStrings.push(s)
      sharedIndex.set(s, idx)
    }
    return idx
  }

  const sheetXmls = sheets.map((sheet) => {
    let maxCol = 0
    const rowXml = sheet.rows
      .map((row, rIdx) => {
        const rNum = rIdx + 1
        maxCol = Math.max(maxCol, row.length)
        const cellsXml = row
          .map((cell, cIdx) => {
            if (cell === null) return ""
            const ref = `${colLetters(cIdx)}${rNum}`
            if (typeof cell === "string") {
              if (cell === "") return ""
              const idx = intern(cell)
              return `<c r="${ref}" t="s"><v>${idx}</v></c>`
            }
            if ("num" in cell) {
              return `<c r="${ref}"><v>${xmlEscape(cell.num)}</v></c>`
            }
            if ("bool" in cell) {
              return `<c r="${ref}" t="b"><v>${cell.bool ? "1" : "0"}</v></c>`
            }
            if ("dateSerial" in cell) {
              return `<c r="${ref}" s="1"><v>${cell.dateSerial}</v></c>`
            }
            return `<c r="${ref}" t="str"><f>${xmlEscape(cell.formula)}</f><v>${xmlEscape(cell.cached ?? "0")}</v></c>`
          })
          .join("")
        return `<row r="${rNum}">${cellsXml}</row>`
      })
      .join("")
    const endRef = `${colLetters(Math.max(0, maxCol - 1))}${Math.max(1, sheet.rows.length)}`
    return Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><dimension ref="A1:${endRef}"/><sheetData>${rowXml}</sheetData></worksheet>`,
      "utf8"
    )
  })

  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`,
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`,
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>`,
    ...sheets.map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ),
  ].join("")

  const sheetTags = sheets
    .map(
      (s, i) =>
        `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    )
    .join("")

  const sheetRels = sheets
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    )
    .join("")
  const stylesRelId = sheets.length + 1
  const stringsRelId = sheets.length + 2

  const sstItems = sharedStrings
    .map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`)
    .join("")

  // Style 0 = General, Style 1 = numFmtId 14 (built-in m/d/yy date format)
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${ns}"><numFmts count="0"/><fonts count="1"><font/></fonts><fills count="1"><fill/></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`

  const parts = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`,
        "utf8"
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        "utf8"
      ),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheetTags}</sheets></workbook>`,
        "utf8"
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${stylesRelId}" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="rId${stringsRelId}" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
        "utf8"
      ),
    },
    {
      name: "xl/styles.xml",
      data: Buffer.from(stylesXml, "utf8"),
    },
    {
      name: "xl/sharedStrings.xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${ns}" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sstItems}</sst>`,
        "utf8"
      ),
    },
    ...sheetXmls.map((data, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data,
    })),
  ]

  return makeZip(parts)
}

export function generateImportTemplateXlsx(type: ImportType) {
  const columns = importTemplateColumns(type)
  return buildXlsx([
    {
      name: type,
      rows: [
        columns.map((column) => column.name),
        columns.map((column) => column.example),
      ],
    },
  ])
}
