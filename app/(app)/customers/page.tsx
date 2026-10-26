import { pageActor } from "@/lib/server/pages"
import { CustomerDirectory } from "@/components/customers/customer-directory"
import { abilityFor } from "@/lib/server/permissions"
export default async function CustomersPage() {
  const { actor } = await pageActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  if (!ability.can("read", "Customer") && !ability.can("create", "Customer"))
    return <p>Customer access unavailable.</p>
  return <CustomerDirectory />
}
