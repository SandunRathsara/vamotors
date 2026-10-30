import { headers } from "next/headers"
import { notFound, redirect } from "next/navigation"
import { authenticate, currentActor } from "@/lib/server/actor"
import { database, assertEnvironment } from "@/lib/server/db"
import { approvalDetail } from "@/lib/server/approvals"
import { ApprovalDetail } from "@/components/approvals/write-off"
import { CommandError } from "@/lib/server/errors"

export default async function ApprovalPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  let detail: Awaited<ReturnType<typeof approvalDetail>>
  try {
    const identity = await authenticate(await headers())
    detail = await database().$transaction(
      async (tx) => {
        await assertEnvironment(tx)
        return approvalDetail(tx, await currentActor(tx, identity), id)
      },
      { isolationLevel: "RepeatableRead" }
    )
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
