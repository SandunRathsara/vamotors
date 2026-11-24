import { pageActor } from "@/lib/server/pages"
import { BrokerageDispatch } from "@/components/lease/brokerage-workspace"

export default async function LeaseDispatchPage() {
  await pageActor()
  return <BrokerageDispatch />
}
