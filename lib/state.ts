import type { State } from "../.planning/implementation/contracts/api"

// Adopted S1/S2 reference. Evidence is server-owned; never accept it from HTTP.
export const states = [
  "PURCHASED",
  "IN_STOCK",
  "IN_REPAIR",
  "ADVANCE_PLACED",
  "ADVANCE_EXPIRED",
  "FINANCE_PENDING",
  "DO_RECEIVED",
  "DELIVERED",
  "SOLD",
  "WRITTEN_OFF",
] as const
const edges: Record<State, Record<string, State>> = {
  PURCHASED: { receiveStock: "IN_STOCK", approvedWriteOff: "WRITTEN_OFF" },
  IN_STOCK: {
    holdStock: "IN_STOCK",
    releaseStock: "IN_STOCK",
    sendRepair: "IN_REPAIR",
    placeReservation: "ADVANCE_PLACED",
    startFinance: "FINANCE_PENDING",
    completeImmediate: "SOLD",
    approvedWriteOff: "WRITTEN_OFF",
  },
  IN_REPAIR: { returnRepair: "IN_STOCK" },
  ADVANCE_PLACED: {
    expireReservation: "ADVANCE_EXPIRED",
    convertReservation: "SOLD",
    cancelRetained: "IN_STOCK",
    approvedRefundCancel: "IN_STOCK",
  },
  ADVANCE_EXPIRED: {
    convertReservation: "SOLD",
    cancelRetained: "IN_STOCK",
    approvedRefundCancel: "IN_STOCK",
  },
  FINANCE_PENDING: {
    recordDO: "DO_RECEIVED",
    approvedFinanceCorrection: "IN_STOCK",
  },
  DO_RECEIVED: {
    confirmDOAndHandover: "SOLD",
    approvedFinanceCorrection: "IN_STOCK",
  },
  DELIVERED: { normalizeDelivered: "SOLD" },
  SOLD: {},
  WRITTEN_OFF: {},
}
type Evidence = Partial<
  Record<
    | "available"
    | "due"
    | "openCommitment"
    | "verifiedDO"
    | "completion"
    | "handover"
    | "approval"
    | "openObligation",
    boolean
  >
>
export function transition(
  state: State,
  action: string,
  evidence: Evidence = {}
): State {
  if (!Object.hasOwn(edges, state) || !Object.hasOwn(edges[state], action))
    throw new RangeError("INVALID_STATE")
  const next = edges[state]?.[action]
  if (!next) throw new RangeError("INVALID_STATE")
  if (
    ["completeImmediate", "placeReservation", "startFinance"].includes(
      action
    ) &&
    !evidence.available
  )
    throw new RangeError("STOCK_UNAVAILABLE")
  if (
    action === "expireReservation" &&
    (!evidence.due || !evidence.openCommitment)
  )
    throw new RangeError("INVALID_STATE")
  if (action === "recordDO" && !evidence.verifiedDO)
    throw new RangeError("DOCUMENT_NOT_READY")
  if (
    action === "confirmDOAndHandover" &&
    (!evidence.verifiedDO || !evidence.completion || !evidence.handover)
  )
    throw new RangeError("INVALID_STATE")
  if (
    ["completeImmediate", "convertReservation"].includes(action) &&
    (!evidence.completion || !evidence.handover)
  )
    throw new RangeError("INVALID_STATE")
  if (
    action.startsWith("approved") &&
    (!evidence.approval || evidence.openObligation)
  )
    throw new RangeError("OBLIGATION_OPEN")
  if (
    action === "normalizeDelivered" &&
    (!evidence.completion || !evidence.handover)
  )
    throw new RangeError("DELIVERED_WITHOUT_COMPLETION")
  return next
}
export function effectiveAvailable(input: {
  state: State
  openCycle: boolean
  staffAvailable: boolean
  openCommitment: boolean
  openRepair: boolean
}) {
  return (
    input.state === "IN_STOCK" &&
    input.openCycle &&
    input.staffAvailable &&
    !input.openCommitment &&
    !input.openRepair
  )
}
