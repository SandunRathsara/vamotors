import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

type Glyph = { id: number }
type Face = {
  unitsPerEm: number
  ascent: number
  descent: number
  bbox: { minX: number; minY: number; maxX: number; maxY: number }
  hasGlyphForCodePoint(code: number): boolean
  layout(text: string): {
    glyphs: Glyph[]
    positions: { xAdvance: number; xOffset: number; yOffset: number }[]
  }
  createSubset(): { includeGlyph(glyph: Glyph): number; encode(): Uint8Array }
}

const fontkit = createRequire(import.meta.url)("fontkit") as {
  create(bytes: Buffer): Face
}
const faces = [
  () =>
    readFileSync(new URL("./pdf-fonts/NotoSans-Regular.ttf", import.meta.url)),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansSinhala-Regular.ttf", import.meta.url)
    ),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansTamil-Regular.ttf", import.meta.url)
    ),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansDevanagari-Regular.ttf", import.meta.url)
    ),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansArabic-Regular.ttf", import.meta.url)
    ),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansHebrew-Regular.ttf", import.meta.url)
    ),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansThai-Regular.ttf", import.meta.url)
    ),
  () =>
    readFileSync(
      new URL("./pdf-fonts/NotoSansBengali-Regular.ttf", import.meta.url)
    ),
]
const loaded = new Map<number, Face>()
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })
function face(index: number) {
  const cached = loaded.get(index)
  if (cached) return cached
  const font = fontkit.create(faces[index]())
  loaded.set(index, font)
  return font
}

export function unicodeRuns(text: string) {
  const runs: { index: number; text: string }[] = []
  for (const { segment } of graphemes.segment(text)) {
    const index = faces.findIndex((_, i) =>
      [...segment].every(
        (char) =>
          /\p{Cf}/u.test(char) ||
          face(i).hasGlyphForCodePoint(char.codePointAt(0)!)
      )
    )
    const fontIndex = Math.max(0, index)
    const last = runs.at(-1)
    if (last?.index === fontIndex) last.text += segment
    else runs.push({ index: fontIndex, text: segment })
  }
  return runs.map(({ index, text }) => {
    const font = face(index)
    const { glyphs, positions } = font.layout(text)
    return {
      index,
      text,
      font,
      glyphs,
      positions,
      width:
        positions.reduce((width, position) => width + position.xAdvance, 0) /
        font.unitsPerEm,
    }
  })
}

export class PdfFontSubsets {
  readonly subsets = new Map<number, ReturnType<Face["createSubset"]>>()

  text(text: string, x: number, y: number, size: number) {
    const actualText = Buffer.from(text, "utf16le").swap16().toString("hex")
    const shapedText = unicodeRuns(text)
      .map((run) => {
        let subset = this.subsets.get(run.index)
        if (!subset) {
          subset = run.font.createSubset()
          this.subsets.set(run.index, subset)
        }
        const scale = size / run.font.unitsPerEm
        let dx = 0
        const ops = run.glyphs.map((glyph, i) => {
          const { xOffset, yOffset, xAdvance } = run.positions[i]
          const cx = (x + dx + xOffset * scale).toFixed(3)
          const cy = (y + yOffset * scale).toFixed(3)
          dx += xAdvance * scale
          const cid = subset.includeGlyph(glyph).toString(16).padStart(4, "0")
          return `1 0 0 1 ${cx} ${cy} Tm <${cid}> Tj`
        })
        x += run.width * size
        return `BT /U${run.index} ${size} Tf\n${ops.join("\n")}\nET`
      })
      .join("\n")
    return `/Span << /ActualText <FEFF${actualText}> >> BDC\n${shapedText}\nEMC`
  }

  embed(objects: Buffer[]) {
    return [...this.subsets]
      .map(([index, subset]) => {
        const id = objects.length + 1
        const name = `VASUBS+NotoSans${index}`
        const font = face(index)
        const scale = (value: number) =>
          Math.round((1000 * value) / font.unitsPerEm)
        const { minX, minY, maxX, maxY } = font.bbox
        const program = Buffer.from(subset.encode())
        objects.push(
          Buffer.from(
            `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${id + 1} 0 R] >>`
          ),
          Buffer.from(
            `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${id + 2} 0 R /CIDToGIDMap /Identity >>`
          ),
          Buffer.from(
            `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${[minX, minY, maxX, maxY].map(scale).join(" ")}] /Ascent ${scale(font.ascent)} /Descent ${scale(font.descent)} /CapHeight ${scale(font.ascent)} /ItalicAngle 0 /StemV 80 /FontFile2 ${id + 3} 0 R >>`
          ),
          Buffer.concat([
            Buffer.from(
              `<< /Length ${program.length} /Length1 ${program.length} >>\nstream\n`
            ),
            program,
            Buffer.from("\nendstream"),
          ])
        )
        return `/U${index} ${id} 0 R`
      })
      .join(" ")
  }
}
