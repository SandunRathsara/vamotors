import { ImportStaging } from "@/components/imports/import-staging"
import { pageActor } from "@/lib/server/pages"
export const dynamic = "force-dynamic"
export default async function ImportsPage() {
  await pageActor()
  return <ImportStaging />
}
