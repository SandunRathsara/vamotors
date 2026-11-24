import "server-only"
import { subject } from "@casl/ability"
import type {
  ImportType,
  Provenance,
} from "../../.planning/implementation/contracts/api"
import type { Actor } from "./actor"
import type { Tx } from "./db"
import { batchSubject, documentSubject } from "./import-staging"

export async function importProvenance(
  tx: Tx,
  actor: Actor,
  type: string,
  entityId: string
): Promise<Provenance> {
  const row = await tx.importSourceRow.findFirst({
    where: { targetVersion: { entityType: type, entityId } },
    include: { batch: true, file: { include: { attachment: true } } },
    orderBy: [{ batch: { createdAt: "asc" } }, { rowNumber: "asc" }],
  })
  if (!row) return { imported: false as const }
  const batch = subject("ImportBatch", batchSubject(row.batch))
  const document = subject("Document", documentSubject(row.file.attachment))
  if (
    !actor.ability.can("read", batch, "id") ||
    !actor.ability.can("read", batch, "uploads.attachmentId") ||
    !actor.ability.can("read", document, "attachmentId")
  )
    return { imported: true as const }
  return {
    imported: true as const,
    batchId: row.batchId,
    row: row.rowNumber,
    sourceKey: row.sourceKey,
    contributingRows: [
      {
        rowId: row.id,
        type: (row.sourceType === "VEHICLE_IDENTITY"
          ? "VEHICLES"
          : row.sourceType) as ImportType,
        sourceKey: row.sourceKey,
      },
    ],
  }
}

export async function withImportProvenance<T extends Record<string, unknown>>(
  tx: Tx,
  actor: Actor,
  type: string,
  data: T
): Promise<T> {
  if (!data.provenance || typeof data.id !== "string") return data
  return {
    ...data,
    provenance: await importProvenance(tx, actor, type, data.id),
  }
}
