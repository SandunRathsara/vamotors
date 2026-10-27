import { SettingsPage } from "@/components/settings/settings-page"
import { pageActor } from "@/lib/server/pages"
import { abilityFor } from "@/lib/server/permissions"
import { notFound } from "next/navigation"

export default async function Page() {
  const { actor } = await pageActor()
  if (
    !abilityFor(actor.presentationGrants, actor.user.id).can("read", "Settings")
  )
    notFound()
  return <SettingsPage />
}
