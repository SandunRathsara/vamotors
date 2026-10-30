import { crc32, inflateRawSync } from "node:zlib"
import { posix } from "node:path"
import { SaxesParser } from "saxes"
import readExcelFile from "read-excel-file/node"

const reject = () => {
  throw new Error("invalid")
}
const sheetNS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
const relNS = "http://schemas.openxmlformats.org/package/2006/relationships"
const typeNS = "http://schemas.openxmlformats.org/package/2006/content-types"
const officeRel =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
const allowedPath =
  /^(?:\[Content_Types\]\.xml|_rels\/\.rels|docProps\/(?:core|app)\.xml|xl\/(?:workbook|styles|sharedStrings)\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/theme\/theme[1-8]\.xml|xl\/worksheets\/sheet[1-8]\.xml)$/
const directories = new Set([
  "_rels/",
  "docProps/",
  "xl/",
  "xl/_rels/",
  "xl/theme/",
  "xl/worksheets/",
])

// No extraction and no ZIP parser allocations before checking the central and
// local envelopes. ZIP64, split/encrypted archives, aliases and opaque extra
// fields/comments are deliberately unsupported. Validate actual inflated bytes,
// CRC and complete deflate consumption, not just attacker-supplied sizes.
export function preflightZip(b) {
  if (b.length < 22) reject()
  const end = b.length - 22
  if (
    b.readUInt32LE(end) !== 0x06054b50 ||
    b.readUInt16LE(end + 4) ||
    b.readUInt16LE(end + 6) ||
    b.readUInt16LE(end + 20)
  )
    reject()
  const count = b.readUInt16LE(end + 10),
    start = b.readUInt32LE(end + 16)
  if (
    !count ||
    count > 256 ||
    count !== b.readUInt16LE(end + 8) ||
    start + b.readUInt32LE(end + 12) !== end
  )
    reject()
  let p = start,
    local = 0,
    total = 0
  const entries = new Map(),
    aliases = new Set()
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || b.readUInt32LE(p) !== 0x02014b50) reject()
    const flags = b.readUInt16LE(p + 8),
      method = b.readUInt16LE(p + 10)
    const crc = b.readUInt32LE(p + 16),
      compressed = b.readUInt32LE(p + 20),
      size = b.readUInt32LE(p + 24)
    const n = b.readUInt16LE(p + 28),
      extra = b.readUInt16LE(p + 30),
      comment = b.readUInt16LE(p + 32)
    if (
      flags & ~0x808 ||
      ![0, 8].includes(method) ||
      extra ||
      comment ||
      b.readUInt16LE(p + 34) ||
      b.readUInt32LE(p + 42) !== local ||
      p + 46 + n > end
    )
      reject()
    const nameBytes = b.subarray(p + 46, p + 46 + n),
      name = nameBytes.toString("utf8")
    if (
      !n ||
      n > 128 ||
      !nameBytes.equals(Buffer.from(name)) ||
      !/^[\x21-\x7e]+$/.test(name) ||
      (!allowedPath.test(name) && !directories.has(name)) ||
      aliases.has(name.toLowerCase())
    )
      reject()
    aliases.add(name.toLowerCase())
    const mode = b.readUInt32LE(p + 38) >>> 16
    if (
      mode & 0xf000 &&
      (mode & 0xf000) !== (name.endsWith("/") ? 0x4000 : 0x8000)
    )
      reject()
    total += size
    if (
      size > 8 * 1024 * 1024 ||
      total > 20 * 1024 * 1024 ||
      size > Math.max(1, compressed) * 100
    )
      reject()
    if (
      local + 30 + n > start ||
      b.readUInt32LE(local) !== 0x04034b50 ||
      b.readUInt16LE(local + 6) !== flags ||
      b.readUInt16LE(local + 8) !== method ||
      b.readUInt16LE(local + 26) !== n ||
      b.readUInt16LE(local + 28) ||
      !b.subarray(local + 30, local + 30 + n).equals(nameBytes)
    )
      reject()
    for (const [offset, expected] of [
      [14, crc],
      [18, compressed],
      [22, size],
    ]) {
      const actual = b.readUInt32LE(local + offset)
      if (actual !== expected && (!(flags & 8) || actual !== 0)) reject()
    }
    local += 30 + n
    if (local + compressed > start) reject()
    const data = b.subarray(local, local + compressed)
    let decoded = data
    if (method === 8) {
      const result = inflateRawSync(data, {
        maxOutputLength: Math.max(1, size),
        info: true,
      })
      if (result.engine.bytesWritten !== data.length) reject()
      decoded = result.buffer
    }
    if (
      decoded.length !== size ||
      crc32(decoded) !== crc ||
      (name.endsWith("/") && size)
    )
      reject()
    entries.set(name, decoded)
    local += compressed
    if (flags & 8) {
      if (
        local + 16 > start ||
        b.readUInt32LE(local) !== 0x08074b50 ||
        b.readUInt32LE(local + 4) !== crc ||
        b.readUInt32LE(local + 8) !== compressed ||
        b.readUInt32LE(local + 12) !== size
      )
        reject()
      local += 16
    }
    p += 46 + n
  }
  if (p !== end || local !== start) reject()
  for (const required of [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
  ])
    if (!entries.has(required)) reject()
  return entries
}

function preflightXml(entries) {
  let rows = 0,
    cells = 0,
    sheets = 0,
    nodes = 0
  const contentTypes = new Set([
    "application/vnd.openxmlformats-package.relationships+xml",
    "application/xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
    "application/vnd.openxmlformats-officedocument.theme+xml",
    "application/vnd.openxmlformats-package.core-properties+xml",
    "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  ])
  const relations = new Set(
    [
      "officeDocument",
      "worksheet",
      "styles",
      "sharedStrings",
      "theme",
      "extended-properties",
    ].map((s) => officeRel + s)
  )
  relations.add(
    "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
  )
  const workbookSheets = new Set(),
    sheetTargets = new Set(),
    sheetIds = new Set()
  let officeDocuments = 0
  for (const [path, data] of entries) {
    if (path.endsWith("/")) continue
    const text = new TextDecoder("utf-8", { fatal: true }).decode(data)
    let depth = 0,
      root = false,
      row = 0,
      lastRow = 0,
      col = 0
    const ids = new Set()
    const parser = new SaxesParser({ xmlns: true })
    for (const event of [
      "doctype",
      "processinginstruction",
      "comment",
      "cdata",
      "error",
    ])
      parser.on(event, reject)
    parser.on("opentag", (tag) => {
      if (
        ++depth > 64 ||
        ++nodes > 300_000 ||
        Object.keys(tag.attributes).length > 32
      )
        reject()
      const attrs = Object.fromEntries(
        Object.values(tag.attributes).map((a) => [a.name, a.value])
      )
      if (!root) {
        root = true
        const expected =
          path === "[Content_Types].xml"
            ? [typeNS, "Types"]
            : path.endsWith(".rels")
              ? [relNS, "Relationships"]
              : path === "xl/workbook.xml"
                ? [sheetNS, "workbook"]
                : path.includes("/worksheets/")
                  ? [sheetNS, "worksheet"]
                  : path === "xl/styles.xml"
                    ? [sheetNS, "styleSheet"]
                    : path === "xl/sharedStrings.xml"
                      ? [sheetNS, "sst"]
                      : path.startsWith("xl/theme/")
                        ? [
                            "http://schemas.openxmlformats.org/drawingml/2006/main",
                            "theme",
                          ]
                        : path === "docProps/core.xml"
                          ? [
                              "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
                              "coreProperties",
                            ]
                          : [
                              "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
                              "Properties",
                            ]
        if (expected && (tag.uri !== expected[0] || tag.local !== expected[1]))
          reject()
      }
      if (
        (path === "xl/workbook.xml" ||
          path === "xl/styles.xml" ||
          path === "xl/sharedStrings.xml" ||
          path.includes("/worksheets/")) &&
        tag.uri !== sheetNS
      )
        reject()
      if (
        path.endsWith(".rels") &&
        (tag.uri !== relNS ||
          !["Relationships", "Relationship"].includes(tag.local))
      )
        reject()
      if (
        [
          "f",
          "formula",
          "formula1",
          "formula2",
          "hyperlink",
          "hyperlinks",
          "externalReferences",
          "oleObjects",
          "controls",
          "extLst",
          "legacyDrawing",
          "drawing",
          "AlternateContent",
        ].includes(tag.local)
      )
        reject()
      if (tag.local === "Relationship") {
        if (
          tag.uri !== relNS ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(attrs.Id ?? "") ||
          !relations.has(attrs.Type) ||
          (attrs.TargetMode && attrs.TargetMode !== "Internal") ||
          !/^[A-Za-z0-9_.\-/]+$/.test(attrs.Target ?? "") ||
          ids.has(attrs.Id)
        )
          reject()
        ids.add(attrs.Id)
        const base = path === "_rels/.rels" ? "" : "xl"
        const target = attrs.Target.startsWith("/")
          ? attrs.Target.slice(1)
          : posix.normalize(posix.join(base, attrs.Target))
        if (!allowedPath.test(target) || !entries.has(target)) reject()
        if (attrs.Type === officeRel + "officeDocument") {
          if (
            path !== "_rels/.rels" ||
            target !== "xl/workbook.xml" ||
            ++officeDocuments > 1
          )
            reject()
        }
        if (attrs.Type === officeRel + "worksheet") {
          if (
            path !== "xl/_rels/workbook.xml.rels" ||
            !/^xl\/worksheets\/sheet[1-8]\.xml$/.test(target) ||
            sheetTargets.has(target)
          )
            reject()
          sheetTargets.add(target)
          sheetIds.add(attrs.Id)
        }
      }
      if (path === "[Content_Types].xml" && tag.local !== "Types") {
        if (
          tag.uri !== typeNS ||
          !["Default", "Override"].includes(tag.local) ||
          !contentTypes.has(attrs.ContentType)
        )
          reject()
      }
      if (tag.uri === sheetNS) {
        if (tag.local === "sheet") {
          if (
            path !== "xl/workbook.xml" ||
            ++sheets > 8 ||
            !attrs["r:id"] ||
            workbookSheets.has(attrs["r:id"])
          )
            reject()
          workbookSheets.add(attrs["r:id"])
        }
        if (tag.local === "dimension") {
          if (!/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(attrs.ref ?? ""))
            reject()
          for (const address of attrs.ref.split(":")) checkAddress(address)
        }
        if (tag.local === "row") {
          row = Number(attrs.r)
          col = 0
          if (
            !Number.isInteger(row) ||
            row <= lastRow ||
            row > 10_000 ||
            ++rows > 10_000
          )
            reject()
          lastRow = row
        }
        if (tag.local === "c") {
          const address = checkAddress(attrs.r)
          if (address.row !== row || address.col <= col || ++cells > 100_000)
            reject()
          col = address.col
        }
      }
    })
    parser.on("closetag", () => {
      depth--
    })
    parser.write(text).close()
    if (!root || depth) reject()
  }
  if (
    !sheets ||
    !cells ||
    officeDocuments !== 1 ||
    workbookSheets.size !== sheetIds.size ||
    [...workbookSheets].some((id) => !sheetIds.has(id)) ||
    [...entries.keys()]
      .filter((path) => /^xl\/worksheets\/sheet[1-8]\.xml$/.test(path))
      .some((path) => !sheetTargets.has(path))
  )
    reject()
}

function checkAddress(value) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,4})$/.exec(value ?? "")
  if (!match) reject()
  let col = 0
  for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64
  const row = Number(match[2])
  if (col > 128 || row > 10_000) reject()
  return { col, row }
}

export async function validateXlsx(bytes) {
  preflightXml(preflightZip(bytes))
  const sheets = await readExcelFile(bytes, { trim: false })
  if (!sheets.length || sheets.length > 8) reject()
  let rows = 0,
    cells = 0
  for (const sheet of sheets) {
    if (sheet.data.length > 10_000) reject()
    for (const row of sheet.data) {
      if (++rows > 10_000) reject()
      if (row.length > 128) reject()
      for (const cell of row) {
        if (cell === null) continue
        if (
          ++cells > 100_000 ||
          (typeof cell === "string" &&
            (cell.length > 8192 || /^[\s]*[=+@-]/.test(cell))) ||
          (typeof cell === "number" && !Number.isFinite(cell))
        )
          reject()
      }
    }
  }
  if (!cells) reject()
}
