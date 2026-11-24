import { pageActor } from "@/lib/server/pages"
import { BrokerageList } from "@/components/lease/brokerage-workspace"

export default async function LeaseDealsPage() {
  await pageActor()
  return <BrokerageList />
}
