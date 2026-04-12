import { ThirdPartyDetailView } from "@/components/third-parties/third-party-detail-view"

type ThirdPartyDetailPageProps = {
  params: Promise<{ id: string }>
}

export default async function ThirdPartyDetailPage({ params }: ThirdPartyDetailPageProps) {
  const { id } = await params
  return (
    <div className="space-y-6">
      <ThirdPartyDetailView id={id} />
    </div>
  )
}
