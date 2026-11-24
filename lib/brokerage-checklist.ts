export function checklistItemKey(item: {
  kind: string
  participantId?: string | null
  label?: string | null
}) {
  return `${item.kind}:${item.kind === "PROCESSING_DOCUMENT" ? item.label ?? "" : item.participantId ?? ""}`
}
