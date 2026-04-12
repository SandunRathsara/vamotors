import { CustomerDetailView } from "@/components/customers/customer-detail-view"

type CustomerDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function CustomerDetailPage({ params }: CustomerDetailPageProps) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <CustomerDetailView id={id} />
    </div>
  )
}
