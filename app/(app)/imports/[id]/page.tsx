import { ImportStaging } from "@/components/imports/import-staging"
import { pageActor } from "@/lib/server/pages"
export const dynamic = "force-dynamic"
export default async function ImportFilesPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await pageActor()
  return <ImportStaging id={(await params).id} />
}
