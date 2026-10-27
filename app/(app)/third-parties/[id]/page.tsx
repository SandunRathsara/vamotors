import { pageActor } from "@/lib/server/pages"
import { partySelector } from "@/lib/server/validators"
import { PartyDetail } from "@/components/third-parties/party-detail"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { authenticate } from "@/lib/server/actor"
import { securityQuery } from "@/lib/server/queries"
import { CommandError } from "@/lib/server/errors"
export default async function PartyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await pageActor()
  const search = await searchParams
  if (Object.keys(search).some((key) => key !== "type")) notFound()
  const input = partySelector.safeParse({
    ...search,
    ...(await params),
  })
  if (!input.success) notFound()
  try {
    await securityQuery(
      await authenticate(await headers()),
      "party",
      new URLSearchParams(input.data)
    )
  } catch (error) {
    if (error instanceof CommandError && [403, 404, 422].includes(error.status))
      notFound()
    throw error
  }
  return (
    <PartyDetail
      key={`${input.data.type}:${input.data.id}`}
      kind={input.data.type}
      id={input.data.id}
    />
  )
}
