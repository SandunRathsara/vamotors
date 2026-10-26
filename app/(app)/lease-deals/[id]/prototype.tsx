import { LeaseDealDetailTabs } from "@/components/lease/lease-deal-detail-tabs"

type LeaseDealDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function LeaseDealDetailPage({ params }: LeaseDealDetailPageProps) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <LeaseDealDetailTabs id={id} />
    </div>
  )
}
