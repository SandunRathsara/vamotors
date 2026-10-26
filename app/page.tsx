import { redirect } from "next/navigation"
import { pageActor } from "@/lib/server/pages"

export const dynamic = "force-dynamic"
export default async function Page() {
  await pageActor()
  redirect("/dashboard")
}
