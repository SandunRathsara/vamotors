import "server-only"
import { database, assertEnvironment } from "./db"
import { currentActor, type Identity } from "./actor"
import {
  loadPurchase,
  purchaseAuth,
  repairAuth,
  visiblePurchase,
} from "./purchases"
import { requireFields } from "./permissions"
import { id } from "./validators"
import { importProvenance } from "./import-provenance"
import { fail } from "./errors"

/** Exact persisted FK lookup and the SAME typed purchase projection; not a new
 * repair query/DTO, a page scan, a guessed revision or receipt-based discovery. */
export async function repairPagePurchase(identity: Identity, repairId: string) {
  if (!id.safeParse(repairId).success) fail("NOT_FOUND", 404)
  return database().$transaction(
    async (tx) => {
      await assertEnvironment(tx)
      const actor = await currentActor(tx, identity)
      const target = await tx.repairRecord.findUnique({
        where: { id: repairId },
        select: { cycleId: true },
      })
      if (!target) fail("NOT_FOUND", 404)
      const row = await loadPurchase(tx, target.cycleId)
      if (!row) fail("NOT_FOUND", 404)
      const repair = row.repairs.find((r) => r.id === repairId)
      if (!repair) fail("NOT_FOUND", 404)
      requireFields(
        actor.ability,
        "PurchaseRecord",
        "read",
        purchaseAuth(row),
        ["id", "repairs"]
      )
      requireFields(actor.ability, "RepairRecord", "read", repairAuth(repair), [
        "id",
      ])
      return {
        ...visiblePurchase(actor, row),
        id: row.id,
        repairImport: await importProvenance(tx, actor, "RepairRecord", repairId),
      }
    },
    { isolationLevel: "RepeatableRead", timeout: 5000 }
  )
}
