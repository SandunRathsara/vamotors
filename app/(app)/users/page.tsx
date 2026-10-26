import { pageActor } from "@/lib/server/pages"
import { UsersTable } from "@/components/users/users-table"

export default async function UsersPage() {
  await pageActor(true)
  return <UsersTable />
}
