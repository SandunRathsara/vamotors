import { headers } from "next/headers"
import { notFound } from "next/navigation"
import { pageActor } from "@/lib/server/pages"
import { authenticate } from "@/lib/server/actor"
import { securityQuery } from "@/lib/server/queries"
import { CommandError } from "@/lib/server/errors"
import { SaleDetailView } from "@/components/sales/sale-detail-view"

export default async function SaleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await pageActor()
  const { id } = await params
  try {
    await securityQuery(
      await authenticate(await headers()),
      "sale",
      new URLSearchParams({ id })
    )
  } catch (error) {
    if (error instanceof CommandError && [403, 404, 422].includes(error.status))
      notFound()
    throw error
  }
  return <SaleDetailView id={id} />
}
