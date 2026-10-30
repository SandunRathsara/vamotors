import { createHash } from "node:crypto"
import { decodeDocument } from "./decoder"

export type Declaration = {
  size: number
  sha256: string
  mime: string
  /** Display name only; never used to construct a path. */
  filename: string
}

export class PrivateFileError extends Error {
  constructor(
    public readonly code:
      | "UPLOAD_MISMATCH"
      | "UNSUPPORTED_VALIDATION"
      | "DOCUMENT_NOT_READY"
      | "QUOTA_STOP"
      | "STORAGE_UNAVAILABLE"
      | "UNSAFE_STORAGE"
      | "INVALID_KEY"
      | "FINAL_CONFLICT"
  ) {
    super(code)
    this.name = "PrivateFileError"
  }
}

export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function checkDeclaration(value: Declaration): void {
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > 5 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    typeof value.filename !== "string" ||
    value.filename.length > 200 ||
    !/^[^/\\\x00-\x1f]+$/.test(value.filename)
  ) {
    throw new PrivateFileError("UPLOAD_MISMATCH")
  }
  const extensions: Record<string, RegExp> = {
    "text/csv": /\.csv$/i,
    "image/jpeg": /\.jpe?g$/i,
    "image/png": /\.png$/i,
    "image/webp": /\.webp$/i,
    "application/pdf": /\.pdf$/i,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      /\.xlsx$/i,
  }
  if (
    !(extensions[value.mime] instanceof RegExp) ||
    !extensions[value.mime].test(value.filename) ||
    (value.mime.startsWith("image/") && value.size > 2 * 1024 * 1024)
  ) {
    throw new PrivateFileError("UPLOAD_MISMATCH")
  }
}

/** CSV is a strict ASCII subset; other formats run in a bounded child process. */
export async function validateDocument(
  bytes: Buffer,
  declared: Declaration
): Promise<void> {
  checkDeclaration(declared)
  if (bytes.length !== declared.size || digest(bytes) !== declared.sha256) {
    throw new PrivateFileError("UPLOAD_MISMATCH")
  }
  if (declared.mime !== "text/csv") {
    await decodeDocument(bytes, declared.mime)
    return
  }
  // No markup, NUL, executable/binary prefixes, Unicode ambiguity or controls.
  for (const b of bytes) {
    if (b !== 10 && b !== 13 && (b < 32 || b > 126)) {
      throw new PrivateFileError("UPLOAD_MISMATCH")
    }
  }
  const text = bytes.toString("ascii")
  if (
    /[<>]/.test(text) ||
    /^(?:#!|%PDF-|MZ|PK|\x7fELF)/.test(text) ||
    !text.endsWith("\n")
  ) {
    throw new PrivateFileError("UPLOAD_MISMATCH")
  }
  let width = 0
  let rows = 0
  let columns = 0
  let field = ""
  let quoted = false
  let closed = false
  const mismatch = () => {
    throw new PrivateFileError("UPLOAD_MISMATCH")
  }
  const endField = () => {
    if (/^[ \t]*[=+@-]/.test(field)) mismatch()
    if (++columns > 128) mismatch()
    field = ""
    closed = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else if (c === "\r" || c === "\n") mismatch()
      else field += c
    } else if (c === '"' && !field && !closed) quoted = true
    else if (c === ",") endField()
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[++i] !== "\n") mismatch()
      endField()
      if (!width) width = columns
      if (width < 2 || columns !== width || ++rows > 10000) mismatch()
      columns = 0
    } else {
      if (closed || c === '"') mismatch()
      field += c
    }
    if (field.length > 8192) mismatch()
  }
  if (quoted || field || columns || rows < 2) mismatch()
}
