"use client"

import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { ApprovalsTable } from "@/components/approvals/approvals-table"
import {
  ApprovalActionDialog,
  type ApprovalDialogMode,
} from "@/components/approvals/approval-action-dialog"
import type { Approval } from "@/lib/mock-data/schemas"
import type { ApprovalActionPayload } from "@/components/approvals/approvals-columns"

export default function ApprovalsPage() {
  const [selectedApproval, setSelectedApproval] = React.useState<Approval | null>(null)
  const [dialogMode, setDialogMode] = React.useState<ApprovalDialogMode>(null)

  function handleAction({ approval, action }: ApprovalActionPayload) {
    if (action === "view") return
    setSelectedApproval(approval)
    setDialogMode(action as ApprovalDialogMode)
  }

  function handleDialogOpenChange(open: boolean) {
    if (!open) {
      setSelectedApproval(null)
      setDialogMode(null)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Review and action pending approval requests"
      />
      <ApprovalsTable onAction={handleAction} />
      <ApprovalActionDialog
        approval={selectedApproval}
        mode={dialogMode}
        onOpenChange={handleDialogOpenChange}
      />
    </div>
  )
}
