import { ImportStaging } from "@/components/imports/import-staging"
import { importAdapters } from "@/lib/server/import-adapters"
import { pageActor } from "@/lib/server/pages"
export const dynamic = "force-dynamic"
export default async function ImportsPage() {
  const { administrator } = await pageActor()
  return (
    <ImportStaging
      supportedTypes={Object.keys(importAdapters)}
      administrator={administrator}
    />
  )
}
