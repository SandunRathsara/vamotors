import { pageActor } from "@/lib/server/pages"
import { RateSheetsView } from "@/components/lease/rate-sheets-view"
export default async function Page() {
  await pageActor()
  return <RateSheetsView />
}
