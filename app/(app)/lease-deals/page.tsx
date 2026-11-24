import { pageActor } from "@/lib/server/pages"
import { BrokerageList } from "@/components/lease/brokerage-workspace"

export default async function LeaseDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ quote?: string | string[] }>
}) {
  await pageActor()
  const { quote } = await searchParams
  return <BrokerageList initialQuoteId={typeof quote === "string" ? quote : undefined} />
}
