import { pageActor } from "@/lib/server/pages"
import { ApprovalsList } from "@/components/approvals/write-off"
export default async function ApprovalsPage() {
  await pageActor()
  return <ApprovalsList />
}
