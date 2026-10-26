import { pageActor } from "@/lib/server/pages"
import { PartyDirectory } from "@/components/third-parties/party-directory"
import { abilityFor } from "@/lib/server/permissions"
import { notFound } from "next/navigation"
export default async function ThirdPartiesPage() {
  const { actor } = await pageActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  if (!["Supplier", "RepairVendor"].some((type) => ability.can("read", type)))
    notFound()
  return <PartyDirectory />
}
