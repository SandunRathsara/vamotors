import { headers } from "next/headers"
import { brokeragePageDetail } from "@/lib/server/brokerage"
import { pageActor } from "@/lib/server/pages"
import { BrokerageDetail } from "@/components/lease/brokerage-workspace"

export default async function LeaseDealPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await pageActor()
  await brokeragePageDetail(await headers(), id)
  return <BrokerageDetail dealId={id} />
}
