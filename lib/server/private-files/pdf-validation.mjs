import { crc32, deflateSync, inflateSync } from "node:zlib"
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs"
import sharp from "sharp"
import { validateImage } from "./image-validation.mjs"
import { passiveText } from "./metadata-validation.mjs"

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

function ascii85(data) {
  const text = data.toString("latin1"),
    end = text.indexOf("~>")
  if (end < 0 || !/^[\t\n\f\r ]*$/.test(text.slice(end + 2))) reject()
  const output = [],
    group = []
  const emit = (count) => {
    let number = 0
    for (let i = 0; i < 5; i++) number = number * 85 + (group[i] ?? 84)
    if (number > 0xffffffff) reject()
    for (let i = 0; i < count; i++) output.push((number >>> (24 - 8 * i)) & 255)
    group.length = 0
  }
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i)
    if ([9, 10, 12, 13, 32].includes(c)) continue
    if (c === 122) {
      if (group.length) reject()
      output.push(0, 0, 0, 0)
    } else {
      if (c < 33 || c > 117) reject()
      group.push(c - 33)
      if (group.length === 5) emit(4)
    }
    if (output.length > 8 * 1024 * 1024) reject()
  }
  if (group.length === 1) reject()
  if (group.length) emit(group.length - 1)
  return Buffer.from(output)
}

// Strict single-revision, classic-xref PDF envelope. This is not the PDF
// decoder: PDF.js below actually parses every page's drawing/text operations.
// Parsing tokens (including #xx name escapes) avoids regex deny-list bypasses;
// exact stream lengths avoid confusing binary data with object delimiters.
function preflight(b) {
  const text = b.toString("latin1")
  const header = /^%PDF-1\.[0-7]\r?\n/.exec(text)
  if (!header) reject()
  let p = header[0].length,
    tokens = 0,
    inflated = 0,
    commentBytes = 0
  const objects = new Map(),
    values = new Map(),
    streamObjects = new Set(),
    streams = [],
    refs = []
  const ws = () => {
    while (p < text.length) {
      if (/[\t\n\f\r ]/.test(text[p])) {
        p++
        continue
      }
      if (text[p] !== "%" || text.startsWith("%%EOF", p)) break
      const start = p
      while (p < text.length && !["\r", "\n"].includes(text[p])) p++
      commentBytes += p - start
      if (p - start > 1024 || commentBytes > 65536) reject()
      passiveText(b.subarray(start, p))
    }
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
    if (token === "true") return true
    if (token === "false") return false
    if (token === "null") return null
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
      const filters = obj.has("Filter")
        ? (Array.isArray(obj.get("Filter"))
            ? obj.get("Filter")
            : [obj.get("Filter")]
          ).map((f) => f?.name)
        : []
      if (filters.some((filter) => typeof filter !== "string")) reject()
      if (
        ![
          "",
          "FlateDecode",
          "DCTDecode",
          "ASCII85Decode",
          "ASCII85Decode,FlateDecode",
          "ASCII85Decode,DCTDecode",
        ].includes(filters.join(","))
      )
        reject()
      let decoded = data
      for (const filter of filters) {
        if (filter === "ASCII85Decode") decoded = ascii85(decoded)
        if (filter !== "FlateDecode") continue
        const result = inflateSync(decoded, {
          maxOutputLength: 8 * 1024 * 1024,
          info: true,
        })
        if (result.engine.bytesWritten !== decoded.length) reject()
        decoded = result.buffer
      }
      inflated += decoded.length
      if (inflated > 20 * 1024 * 1024) reject()
      const parms = Array.isArray(obj.get("DecodeParms"))
        ? obj.get("DecodeParms").at(-1)
        : obj.get("DecodeParms")
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
        streams.push({
          dict: obj,
          decoded,
          jpeg: filters.at(-1) === "DCTDecode",
          parms,
        })
      }
      if (filters.includes("DCTDecode")) {
        if (obj.get("Subtype")?.name !== "Image") reject()
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
  return { streams, values }
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]),
    header = Buffer.alloc(4),
    crc = Buffer.alloc(4)
  header.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([header, body, crc])
}

async function raster({ dict, decoded, jpeg, parms }, values) {
  const lookup = (value) => (value?.ref ? values.get(value.ref) : value)
  const width = dict.get("Width"),
    height = dict.get("Height")
  if (jpeg) {
    const actual = await validateImage(decoded, "jpeg")
    if (actual.width !== width || actual.height !== height) reject()
    return actual.width * actual.height
  }
  const colors = {
    DeviceGray: 1,
    G: 1,
    DeviceRGB: 3,
    RGB: 3,
    DeviceCMYK: 4,
    CMYK: 4,
  }
  const components =
    dict.get("ImageMask") === true
      ? 1
      : colors[lookup(dict.get("ColorSpace"))?.name]
  const bits =
    dict.get("BitsPerComponent") ??
    (dict.get("ImageMask") === true ? 1 : undefined)
  if (
    !components ||
    ![1, 2, 4, 8, 16].includes(bits) ||
    (components > 1 && bits < 8)
  )
    reject()
  const rowBytes = Math.ceil((width * components * bits) / 8)
  const predictor = parms?.get("Predictor") ?? 1
  if (
    ![1, 2, 10, 11, 12, 13, 14, 15].includes(predictor) ||
    (parms?.has("Columns") && parms.get("Columns") !== width) ||
    (parms?.has("Colors") && parms.get("Colors") !== components) ||
    (parms?.has("BitsPerComponent") && parms.get("BitsPerComponent") !== bits)
  )
    reject()
  if (decoded.length !== (rowBytes + (predictor >= 10 ? 1 : 0)) * height)
    reject()
  const scanlines = Buffer.alloc((rowBytes + 1) * height)
  for (let row = 0; row < height; row++) {
    if (predictor >= 10) {
      if (decoded[row * (rowBytes + 1)] > 4) reject()
      decoded.copy(
        scanlines,
        row * (rowBytes + 1),
        row * (rowBytes + 1),
        (row + 1) * (rowBytes + 1)
      )
    } else {
      scanlines[row * (rowBytes + 1)] = predictor === 2 ? 1 : 0
      decoded.copy(
        scanlines,
        row * (rowBytes + 1) + 1,
        row * rowBytes,
        (row + 1) * rowBytes
      )
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = bits
  ihdr[9] = components === 1 ? 0 : components === 3 ? 2 : 6
  // Native PNG decoding interprets all packed samples/predictor rows; the
  // resulting pixels are discarded, never used to replace the original PDF.
  const png = Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
  await sharp(png, {
    failOn: "warning",
    limitInputPixels: 16_000_000,
    limitInputChannels: 4,
  })
    .raw()
    .toBuffer()
  return width * height
}

export async function validatePdf(bytes) {
  const { streams, values } = preflight(bytes)
  let pixels = 0
  for (const image of streams) {
    pixels += await raster(image, values)
    if (pixels > 16_000_000) reject()
  }
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
      for (let i = 0; i < ops.fnArray.length; i++) {
        const op = ops.fnArray[i],
          args = ops.argsArray[i]
        if ([OPS.paintImageXObject, OPS.paintImageXObjectRepeat].includes(op)) {
          const id = args[0],
            store = id.startsWith("g_") ? page.commonObjs : page.objs
          const image = await new Promise((resolve) => store.get(id, resolve))
          decodedImage(image)
        } else if (
          [
            OPS.paintInlineImageXObject,
            OPS.paintInlineImageXObjectGroup,
          ].includes(op)
        )
          decodedImage(args[0])
      }
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

function decodedImage(image) {
  if (
    !image ||
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width < 1 ||
    image.height < 1 ||
    image.width > 8192 ||
    image.height > 8192 ||
    image.width * image.height > 16_000_000
  )
    reject()
  const size =
    image.kind === 1
      ? Math.ceil(image.width / 8) * image.height
      : image.width *
        image.height *
        (image.kind === 2 ? 3 : image.kind === 3 ? 4 : 0)
  if (!size || !image.data || image.data.length !== size) reject()
}
