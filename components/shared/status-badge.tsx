import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

// ── Status types ──────────────────────────────────────────────────────────────

type VehicleStatus =
  | "Purchased"
  | "InStock"
  | "InRepair"
  | "AdvancePlaced"
  | "AdvanceExpired"
  | "FinancePending"
  | "DOReceived"
  | "Delivered"
  | "Sold"
  | "WrittenOff"

type SaleStatus =
  | "Completed"
  | "AdvancePlaced"
  | "AdvanceExpired"
  | "FinancePending"
  | "DOReceived"
  | "Cancelled"

type RepairStatus = "InProgress" | "Completed" | "Cancelled"

type ApprovalStatus = "Pending" | "Approved" | "Rejected"

type LeaseDealStatus =
  | "Initiated"
  | "EligibilityPending"
  | "Eligible"
  | "Processing"
  | "DocumentsCollected"
  | "Dispatched"
  | "Completed"
  | "Rejected"

type LeaseDispatchStatus = "PendingDispatch" | "Dispatched"

type LeaseReconciliationStatus = "Pending" | "Reconciled" | "Overdue"

type UserStatus = "Active" | "Inactive"

// ── camelCase → readable text ─────────────────────────────────────────────────

function toReadable(status: string): string {
  // Insert space before uppercase letters that follow lowercase letters
  // e.g. "InStock" -> "In Stock", "DOReceived" -> "DO Received"
  return status.replace(/([a-z])([A-Z])/g, "$1 $2")
}

// ── Colour map ────────────────────────────────────────────────────────────────

type BadgeStyle = {
  variant: "default" | "secondary" | "outline" | "destructive"
  className?: string
}

const STATUS_STYLES: Record<string, BadgeStyle> = {
  // Vehicle
  Purchased: { variant: "secondary" },
  InStock: { variant: "default", className: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" },
  InRepair: { variant: "secondary" },
  AdvancePlaced: { variant: "outline" },
  AdvanceExpired: { variant: "destructive" },
  FinancePending: { variant: "secondary" },
  DOReceived: { variant: "outline" },
  Delivered: { variant: "default" },
  Sold: { variant: "default" },
  WrittenOff: { variant: "destructive" },

  // Sale (overlapping keys handled by same values)
  Completed: { variant: "default" },
  Cancelled: { variant: "destructive" },

  // Repair
  InProgress: { variant: "secondary" },

  // Approval
  Pending: { variant: "outline" },
  Approved: { variant: "default" },
  Rejected: { variant: "destructive" },

  // Lease deal
  Initiated: { variant: "secondary" },
  EligibilityPending: { variant: "outline" },
  Eligible: { variant: "default", className: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" },
  Processing: { variant: "secondary" },
  DocumentsCollected: { variant: "outline" },
  Dispatched: { variant: "default" },

  // Lease dispatch
  PendingDispatch: { variant: "outline" },

  // Lease reconciliation
  Reconciled: { variant: "default" },
  Overdue: { variant: "destructive" },

  // User
  Active: { variant: "default", className: "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20" },
  Inactive: { variant: "secondary" },
}

// ── Component ─────────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status:
    | VehicleStatus
    | SaleStatus
    | RepairStatus
    | ApprovalStatus
    | LeaseDealStatus
    | LeaseDispatchStatus
    | LeaseReconciliationStatus
    | UserStatus
    | string
  variant?: "vehicle" | "sale" | "repair" | "approval" | "leaseDeal"
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? { variant: "secondary" as const }

  return (
    <Badge
      variant={style.variant}
      className={cn("text-xs font-normal", style.className, className)}
    >
      {toReadable(status)}
    </Badge>
  )
}
