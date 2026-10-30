import { pageActor } from "@/lib/server/pages"
import { LeaseComparisonView } from "@/components/lease/lease-comparison-view"
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ quote?: string }>
}) {
  await pageActor()
  return <LeaseComparisonView quoteId={(await searchParams).quote} />
}
