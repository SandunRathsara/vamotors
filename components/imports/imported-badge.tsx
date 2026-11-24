import Link from "next/link"

export function ImportedBadge({ provenance }: { provenance?: unknown }) {
  if (
    !provenance ||
    typeof provenance !== "object" ||
    !("imported" in provenance) ||
    !provenance.imported
  )
    return null
  const href =
    "batchId" in provenance && typeof provenance.batchId === "string"
      ? `/imports/${provenance.batchId}`
      : null
  return (
    <p className="text-sm font-medium">
      {href ? (
        <Link className="underline" prefetch={false} href={href}>
          Imported
          {"row" in provenance && typeof provenance.row === "number"
            ? ` · source row ${provenance.row}`
            : ""}
        </Link>
      ) : (
        "Imported"
      )}
    </p>
  )
}
