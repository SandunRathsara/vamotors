import { describe, expect, it } from "vitest"
import { generateImportTemplateXlsx } from "./import-template"
import { parseImportBuffer } from "./import-parsers"

describe("historical import templates", () => {
  it("round-trips an Excel template through the existing parser", async () => {
    const parsed = await parseImportBuffer(
      "SUPPLIERS",
      "XLSX",
      generateImportTemplateXlsx("SUPPLIERS")
    )
    expect(parsed.errors).toEqual([])
    expect(parsed.validRows).toHaveLength(1)
  })
})
