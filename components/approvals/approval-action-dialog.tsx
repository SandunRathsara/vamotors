"use client"

import * as React from "react"

import type { Approval } from "@/lib/mock-data/schemas"
import { useEntityMutation } from "@/hooks/use-entity-mutation"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApprovalDialogMode =
  | "approve"
  | "reject"
  | "cancel-no-refund"
  | "cancel-with-refund"
  | "view"
  | null

interface ApprovalActionDialogProps {
  approval: Approval | null
  mode: ApprovalDialogMode
  onOpenChange: (open: boolean) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ApprovalActionDialog({
  approval,
  mode,
  onOpenChange,
}: ApprovalActionDialogProps) {
  const isOpen = Boolean(approval && mode && mode !== "view")

  const approveMutation = useEntityMutation({
    entityKey: "approvals",
    endpoint: "/api/approvals",
    method: "PATCH",
    successMessage: "Request approved.",
  })

  const rejectMutation = useEntityMutation({
    entityKey: "approvals",
    endpoint: "/api/approvals",
    method: "PATCH",
    successMessage: "Request rejected.",
  })

  const cancelMutation = useEntityMutation({
    entityKey: "approvals",
    endpoint: "/api/approvals",
    method: "PATCH",
    successMessage: "Advance cancelled.",
  })

  function handleConfirm() {
    if (!approval) return

    if (mode === "approve") {
      approveMutation.mutate(
        { id: approval.id, action: "approve" } as Parameters<typeof approveMutation.mutate>[0],
        { onSuccess: () => onOpenChange(false) },
      )
    } else if (mode === "reject") {
      rejectMutation.mutate(
        { id: approval.id, action: "reject" } as Parameters<typeof rejectMutation.mutate>[0],
        { onSuccess: () => onOpenChange(false) },
      )
    } else if (mode === "cancel-no-refund" || mode === "cancel-with-refund") {
      cancelMutation.mutate(
        { id: approval.id, action: "reject" } as Parameters<typeof cancelMutation.mutate>[0],
        { onSuccess: () => onOpenChange(false) },
      )
    }
  }

  const isPending =
    approveMutation.isPending || rejectMutation.isPending || cancelMutation.isPending

  // ── Dialog config per mode ────────────────────────────────────────────────

  const config = React.useMemo(() => {
    switch (mode) {
      case "approve":
        return {
          title: "Approve request?",
          description: "Approve this request? The requested change will be applied.",
          cancelLabel: "Cancel",
          confirmLabel: "Approve",
          variant: "default" as const,
        }
      case "reject":
        return {
          title: "Reject request?",
          description: "Reject this request? The requestor will be notified.",
          cancelLabel: "Cancel",
          confirmLabel: "Reject",
          variant: "destructive" as const,
        }
      case "cancel-no-refund":
        return {
          title: "Cancel advance?",
          description:
            "Cancel this advance without a refund? The advance amount will not be returned to the customer.",
          cancelLabel: "Keep Advance",
          confirmLabel: "Cancel Without Refund",
          variant: "destructive" as const,
        }
      case "cancel-with-refund":
        return {
          title: "Cancel advance and refund?",
          description:
            "Cancel this advance and refund the customer? This will update the advance status and mark it for refund processing.",
          cancelLabel: "Keep Advance",
          confirmLabel: "Cancel and Refund",
          variant: "destructive" as const,
        }
      default:
        return null
    }
  }, [mode])

  if (!config) return null

  return (
    <ConfirmDialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title={config.title}
      description={config.description}
      cancelLabel={config.cancelLabel}
      confirmLabel={config.confirmLabel}
      variant={config.variant}
      onConfirm={handleConfirm}
      isPending={isPending}
    />
  )
}
