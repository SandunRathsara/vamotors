import { inflateSync } from "node:zlib"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { validateImage } from "./image-validation.mjs"

const reject = () => {
  throw new Error("invalid")
}
const forbidden = new Set([
  "Encrypt",
  "ObjStm",
  "XRef",
  "Prev",
  "XRefStm",
  "Linearized",
  "JavaScript",
  "JS",
  "AA",
  "OpenAction",
  "Action",
  "A",
  "Next",
  "Launch",
  "URI",
  "GoToR",
  "GoToE",
  "SubmitForm",
  "ImportData",
  "EmbeddedFile",
  "EmbeddedFiles",
  "Filespec",
  "FileAttachment",
  "EF",
  "AF",
  "AcroForm",
  "XFA",
  "Annots",
  "RichMedia",
  "Movie",
  "Sound",
  "Rendition",
  "3D",
  "Collection",
  "Names",
  "F",
  "FFilter",
  "FDecodeParms",
  "PS",
  "Metadata",
  "PieceInfo",
])

// Strict single-revision, classic-xref PDF envelope. This is not the PDF
// decoder: PDF.js below actually parses every page's drawing/text operations.
// Parsing tokens (including #xx name escapes) avoids regex deny-list bypasses;
// exact stream lengths avoid confusing binary data with object delimiters.
function preflight(b) {
  const text = b.toString("latin1")
  const header = /^%PDF-1\.[0-7]\r?\n(?:%[\x80-\xff]{4}\r?\n)?/.exec(text)
  if (!header) reject()
  let p = header[0].length,
    tokens = 0,
    inflated = 0,
    imagePixels = 0
  const objects = new Map(),
    values = new Map(),
    streamObjects = new Set(),
    streams = [],
    refs = []
  const ws = () => {
    while (/[\t\n\f\r ]/.test(text[p] ?? "!") && p < text.length) p++
  }
  const word = () => {
    const start = p
    while (p < text.length && !/[\s()[\]<>/%]/.test(text[p])) p++
    if (p === start) reject()
    return text.slice(start, p)
  }
  const literal = (s) => {
    if (!text.startsWith(s, p)) reject()
    p += s.length
  }
  function value(depth = 0) {
    if (++tokens > 200_000 || depth > 32) reject()
    ws()
    if (text.startsWith("<<", p)) {
      p += 2
      const dict = new Map()
      ws()
      while (!text.startsWith(">>", p)) {
        if (text[p] !== "/") reject()
        const key = value(depth + 1).name
        if (dict.has(key)) reject()
        dict.set(key, value(depth + 1))
        ws()
      }
      p += 2
      return dict
    }
    if (text[p] === "[") {
      p++
      const array = []
      ws()
      while (text[p] !== "]") {
        array.push(value(depth + 1))
        ws()
      }
      p++
      return array
    }
    if (text[p] === "/") {
      p++
      const raw = word()
      if (/#(?![\da-fA-F]{2})/.test(raw)) reject()
      const name = raw.replace(/#([\da-fA-F]{2})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16))
      )
      if (forbidden.has(name)) reject()
      return { name }
    }
    if (text[p] === "(") {
      let level = 1
      p++
      while (level) {
        if (p >= text.length || level > 32) reject()
        const c = text[p++]
        if (c === "\\") {
          if (p >= text.length) reject()
          p++
        } else if (c === "(") level++
        else if (c === ")") level--
      }
      return null
    }
    if (text[p] === "<") {
      p++
      while (/[\da-fA-F\t\n\f\r ]/.test(text[p] ?? "!")) p++
      literal(">")
      return null
    }
    const token = word()
    if (["true", "false", "null"].includes(token)) return null
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) reject()
    const number = Number(token)
    if (!Number.isFinite(number) || Math.abs(number) > 1_000_000_000) reject()
    const end = p
    ws()
    const ref = /^(\d+)\s+R\b/.exec(text.slice(p, p + 32))
    if (ref) {
      if (
        !Number.isInteger(number) ||
        number < 1 ||
        number > 4096 ||
        Number(ref[1]) !== 0
      )
        reject()
      p += ref[0].length
      refs.push(number)
      return { ref: number }
    }
    p = end
    return number
  }
  ws()
  while (!text.startsWith("xref", p)) {
    const offset = p
    const match = /^(\d+) 0 obj\b/.exec(text.slice(p, p + 32))
    if (!match || objects.size >= 4096) reject()
    const id = Number(match[1])
    if (!id || id > 4096 || objects.has(id)) reject()
    p += match[0].length
    const obj = value()
    objects.set(id, offset)
    values.set(id, obj)
    ws()
    if (text.startsWith("stream", p)) {
      streamObjects.add(id)
      if (!(obj instanceof Map)) reject()
      p += 6
      if (text[p] === "\r") p++
      literal("\n")
      const size = obj.get("Length")
      if (!Number.isSafeInteger(size) || size < 0 || p + size > b.length)
        reject()
      const data = b.subarray(p, p + size)
      p += size
      if (text[p] === "\r") p++
      if (text[p] === "\n") p++
      literal("endstream")
      const filter = obj.get("Filter")?.name
      if (obj.has("Filter") && !["FlateDecode", "DCTDecode"].includes(filter))
        reject()
      let decoded = data
      if (filter === "FlateDecode") {
        const result = inflateSync(data, {
          maxOutputLength: 8 * 1024 * 1024,
          info: true,
        })
        if (result.engine.bytesWritten !== data.length) reject()
        decoded = result.buffer
        if (decoded.length > Math.max(1, data.length) * 100) reject()
      }
      inflated += decoded.length
      if (inflated > 20 * 1024 * 1024) reject()
      const parms = obj.get("DecodeParms")
      if (
        parms &&
        (!(parms instanceof Map) ||
          [...parms].some(
            ([k, v]) =>
              !["Predictor", "Colors", "BitsPerComponent", "Columns"].includes(
                k
              ) ||
              !Number.isInteger(v) ||
              v < 1 ||
              v > (k === "Columns" ? 8192 : k === "Colors" ? 4 : 16)
          ))
      )
        reject()
      if (obj.get("Subtype")?.name === "Image") {
        const w = obj.get("Width"),
          h = obj.get("Height")
        if (
          !Number.isInteger(w) ||
          !Number.isInteger(h) ||
          w < 1 ||
          h < 1 ||
          w > 8192 ||
          h > 8192 ||
          w * h > 16_000_000
        )
          reject()
        imagePixels += w * h
        if (imagePixels > 16_000_000) reject()
      }
      if (filter === "DCTDecode") {
        if (obj.get("Subtype")?.name !== "Image") reject()
        streams.push(data)
      }
      ws()
    }
    literal("endobj")
    ws()
  }
  const xref = p
  literal("xref")
  ws()
  // No holes, generations, duplicate entries, repair/recovery or hidden objects.
  const subsection = /^0 (\d+)\r?\n/.exec(text.slice(p, p + 32))
  if (!subsection || Number(subsection[1]) !== objects.size + 1) reject()
  p += subsection[0].length
  for (let id = 0; id <= objects.size; id++) {
    const entry = /^(\d{10}) (\d{5}) ([nf])(?: \r?\n|\r\n)/.exec(
      text.slice(p, p + 24)
    )
    if (
      !entry ||
      (id === 0
        ? entry[1] !== "0000000000" || entry[2] !== "65535" || entry[3] !== "f"
        : Number(entry[1]) !== objects.get(id) ||
          entry[2] !== "00000" ||
          entry[3] !== "n")
    )
      reject()
    p += entry[0].length
  }
  literal("trailer")
  const trailer = value()
  if (
    !(trailer instanceof Map) ||
    trailer.get("Size") !== objects.size + 1 ||
    !trailer.get("Root")?.ref
  )
    reject()
  if (refs.some((id) => !objects.has(id))) reject()
  // Do not accept orphan objects or opaque arbitrary streams which a page
  // decoder would never inspect. Only page/form/image/font/CMap data is allowed.
  const reachable = new Set(),
    pending = [trailer]
  while (pending.length) {
    const value = pending.pop()
    if (value instanceof Map) pending.push(...value.values())
    else if (Array.isArray(value)) pending.push(...value)
    else if (value?.ref && !reachable.has(value.ref)) {
      reachable.add(value.ref)
      pending.push(values.get(value.ref))
    }
  }
  if (reachable.size !== objects.size) reject()
  const dataStreams = new Set()
  const mark = (value) => {
    if (value?.ref) dataStreams.add(value.ref)
    else if (Array.isArray(value)) value.forEach(mark)
  }
  for (const obj of values.values()) {
    if (!(obj instanceof Map)) continue
    if (obj.get("Type")?.name === "Page") mark(obj.get("Contents"))
    for (const key of ["FontFile", "FontFile2", "FontFile3", "ToUnicode"])
      mark(obj.get(key))
  }
  for (const id of streamObjects) {
    const obj = values.get(id)
    if (
      !dataStreams.has(id) &&
      !(
        obj.get("Type")?.name === "XObject" &&
        ["Form", "Image"].includes(obj.get("Subtype")?.name)
      )
    )
      reject()
  }
  ws()
  literal("startxref")
  ws()
  if (word() !== String(xref)) reject()
  ws()
  literal("%%EOF")
  if (!/^(?:\r?\n)?$/.test(text.slice(p))) reject()
  return streams
}

export async function validatePdf(bytes) {
  for (const jpeg of preflight(bytes)) await validateImage(jpeg, "jpeg")
  const task = getDocument({
    data: Uint8Array.from(bytes),
    stopAtErrors: true,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    enableXfa: false,
    maxImageSize: 16_000_000,
    verbosity: 0,
  })
  const pdf = await task.promise
  try {
    if (
      pdf.numPages < 1 ||
      pdf.numPages > 50 ||
      (await pdf.getAttachments()) ||
      (await pdf.getJSActions())
    )
      reject()
    let operations = 0,
      characters = 0
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      if (
        ![viewport.width, viewport.height].every(
          (n) => Number.isFinite(n) && n > 0 && n <= 14_400
        )
      )
        reject()
      const ops = await page.getOperatorList()
      operations += ops.fnArray.length
      const text = await page.getTextContent()
      for (const item of text.items) characters += item.str?.length ?? 0
      if (operations > 200_000 || characters > 1_000_000) reject()
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
}
