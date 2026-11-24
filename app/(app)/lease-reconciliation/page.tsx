import { notFound } from "next/navigation"
import { FinanceReconciliation } from "@/components/lease/finance-reconciliation"
import { pageActor } from "@/lib/server/pages"
import { abilityFor } from "@/lib/server/permissions"

export default async function ReconciliationPage() {
  const { actor } = await pageActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  if (
    !ability.can("read", "ReconciliationRun") ||
    !ability.can("read", "CommissionEntitlement")
  )
    notFound()
  return <FinanceReconciliation />
}
