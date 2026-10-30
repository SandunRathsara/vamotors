import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { authenticatedApprovalDetail } from "@/lib/server/approvals"
import { ApprovalDetail } from "@/components/approvals/write-off"
import { CommandError } from "@/lib/server/errors"

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let detail: Awaited<ReturnType<typeof authenticatedApprovalDetail>>
  try {
    detail = await authenticatedApprovalDetail(await headers(), id)
  } catch (error) {
    if (error instanceof CommandError) {
      if (error.status === 401 || error.code === "ACCOUNT_INACTIVE")
        redirect("/login?reason=access-changed")
      if (error.status === 404 || error.status === 403) notFound()
    }
    throw error
  }
  return <ApprovalDetail {...detail} targetId={id} />
}
