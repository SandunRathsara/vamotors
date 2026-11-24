import { createHash } from "node:crypto"

export type ChecklistHashItem = {
  uniqueKey: string
  kind: string
  label: string | null
  participantId: string | null
  applicability: string
  applicabilityReason: string | null
  collected: boolean
  quantity: number
  attachments: string[]
}

/**
 * Canonical checklist/evidence digest. Binds the current quote selection version
 * so a replaced quote invalidates prior verification even with unchanged rows.
 */
export function checklistHashFor(
  items: ChecklistHashItem[],
  selectionVersion: number
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        selectionVersion,
        items: [...items]
          .sort((a, b) => a.uniqueKey.localeCompare(b.uniqueKey))
          .map((item) => ({
            key: item.uniqueKey,
            kind: item.kind,
            label: item.label,
            participantId: item.participantId,
            applicability: item.applicability,
            reason: item.applicabilityReason,
            collected: item.collected,
            quantity: item.quantity,
            attachments: [...item.attachments].sort(),
          })),
      })
    )
    .digest("hex")
}
