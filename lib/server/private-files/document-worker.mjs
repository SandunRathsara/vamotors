// Standalone JS is intentional: production does not need the dev-only tsx loader.
// No paths, credentials, parser messages or decoded content cross this boundary.
let validate
try {
  const mime = process.argv[2]
  if (mime.startsWith("image/")) {
    const { validateImage } = await import("./image-validation.mjs")
    validate = (b) => validateImage(b, mime.slice(6))
  } else if (mime === "application/pdf") {
    validate = (await import("./pdf-validation.mjs")).validatePdf
  } else {
    validate = (await import("./xlsx-validation.mjs")).validateXlsx
  }
} catch {
  process.exit(70)
}
try {
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > 5 * 1024 * 1024) throw new Error("invalid")
    chunks.push(chunk)
  }
  await validate(Buffer.concat(chunks))
  process.exit(0)
} catch {
  process.exit(65)
}
