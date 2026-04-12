import { SaleDetailView } from "@/components/sales/sale-detail-view"

type SaleDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function SaleDetailPage({ params }: SaleDetailPageProps) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <SaleDetailView id={id} />
    </div>
  )
}
