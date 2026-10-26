"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  UserAdminDTO,
  RoleDTO,
  Page,
} from "@/.planning/implementation/contracts/api"
import { privateRequest } from "@/lib/security-client"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AddUserDialog } from "./add-user-dialog"
import { RoleEditor } from "./role-editor"
import { useCapabilities } from "./use-capabilities"

export type QueryResult<T> = { ok: true; data: T }
export async function allRoles() {
  const rows: RoleDTO[] = []
  for (let page = 1; ; page++) {
    const { data } = await privateRequest<QueryResult<Page<RoleDTO>>>(
      `/api/v1/queries/roles?pageSize=100&page=${page}`
    )
    rows.push(...data.data)
    if (rows.length >= data.total || !data.data.length) return rows
  }
}

export function UsersTable() {
  const { can } = useCapabilities()
  const [kind, setKind] = useState<"users" | "roles">(
    can("User", "read") || can("User", "create") ? "users" : "roles"
  )
  const type = kind === "users" ? "User" : "Role"
  const readable = can(type, "read", ["id"])
  const searchable = can(
    type,
    "read",
    kind === "users" ? ["name", "email"] : ["name"]
  )
  const nameSort = can(type, "read", ["name"])
  const canCreate =
    can(
      type,
      "create",
      type === "User"
        ? ["name", "email", "password", "roleIds"]
        : ["name", "grants"]
    ) &&
    can(type, "read", ["id", "revision"]) &&
    (type !== "User" || can("Role", "read", ["id", "revision", "grants"]))
  const [q, setQ] = useState("")
  const [active, setActive] = useState("")
  const [roleId, setRoleId] = useState("")
  const [page, setPage] = useState(1)
  const [direction, setDirection] = useState<"asc" | "desc">("asc")
  const [user, setUser] = useState<UserAdminDTO | "new" | null>(null)
  const [role, setRole] = useState<RoleDTO | "new" | null>(null)
  const [error, setError] = useState("")
  const options = useQuery({
    queryKey: ["role-options"],
    queryFn: allRoles,
    enabled: can("Role", "read", ["id"]),
  })
  const params = new URLSearchParams({
    page: String(page),
    pageSize: "20",
    ...(searchable && q ? { q } : {}),
    sort: JSON.stringify([{ field: nameSort ? "name" : "id", direction }]),
    ...(can(type, "read", ["active"]) && active ? { active } : {}),
    ...(kind === "users" && roleId ? { roleId } : {}),
  })
  const list = useQuery({
    enabled: readable,
    queryKey: [kind, params.toString()],
    queryFn: ({ signal }) =>
      privateRequest<QueryResult<Page<UserAdminDTO | RoleDTO>>>(
        `/api/v1/queries/${kind}?${params}`,
        { signal }
      ),
  })
  async function edit(id: string) {
    setError("")
    try {
      if (kind === "users")
        setUser(
          (
            await privateRequest<QueryResult<UserAdminDTO>>(
              `/api/v1/queries/user?id=${id}`
            )
          ).data
        )
      else
        setRole(
          (
            await privateRequest<QueryResult<RoleDTO>>(
              `/api/v1/queries/role?id=${id}`
            )
          ).data
        )
    } catch {
      setError("Unable to open this record. Refresh and try again.")
    }
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users & Roles"
        description="Account and multirole management within your current capabilities."
        actions={
          canCreate ? (
            <Button
              onClick={() =>
                kind === "users" ? setUser("new") : setRole("new")
              }
            >
              {kind === "users" ? "Add User" : "Add Role"}
            </Button>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!can("User", "read") && !can("User", "create")}
          variant={kind === "users" ? "default" : "outline"}
          onClick={() => {
            setKind("users")
            setPage(1)
          }}
        >
          Users
        </Button>
        <Button
          disabled={!can("Role", "read") && !can("Role", "create")}
          variant={kind === "roles" ? "default" : "outline"}
          onClick={() => {
            setKind("roles")
            setPage(1)
          }}
        >
          Roles
        </Button>
        <Input
          disabled={!searchable}
          className="max-w-xs"
          aria-label="Search accounts or roles"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder="Search name or email…"
        />
        <select
          disabled={!can(type, "read", ["active"])}
          className="rounded-md border bg-background p-2 text-sm"
          aria-label="Filter access"
          value={active}
          onChange={(e) => {
            setActive(e.target.value)
            setPage(1)
          }}
        >
          <option value="">All access states</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        {kind === "users" &&
          can("User", "read", ["roles"]) &&
          can("Role", "read", ["id", "name"]) && (
            <select
              className="max-w-xs rounded-md border bg-background p-2 text-sm"
              aria-label="Filter role"
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value)
                setPage(1)
              }}
            >
              <option value="">All roles</option>
              {options.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        <Button
          disabled={!nameSort}
          variant="outline"
          onClick={() => {
            setDirection(direction === "asc" ? "desc" : "asc")
            setPage(1)
          }}
        >
          Name {direction === "asc" ? "↑" : "↓"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void list.refetch()
            void options.refetch()
          }}
        >
          Refresh
        </Button>
      </div>
      {(error || list.isError || options.isError) && (
        <p role="alert">{error || "Unable to load administration data."}</p>
      )}
      {!readable ? (
        <p>List unavailable with your current read capabilities.</p>
      ) : list.isPending ? (
        <p role="status">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">
                  {kind === "users" ? "Email / Roles" : "Protection"}
                </th>
                <th className="p-3">Access</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.data.data.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3">{row.name ?? "Unavailable"}</td>
                  <td className="p-3">
                    {kind === "users" ? (
                      <>
                        {("email" in row && row.email) || "Unavailable"}
                        <div className="text-muted-foreground">
                          {("roles" in row &&
                            row.roles
                              ?.map((r) => r.name ?? "Unavailable")
                              .join(", ")) ||
                            "Unavailable"}
                        </div>
                      </>
                    ) : "systemKey" in row && row.systemKey ? (
                      "Protected system role"
                    ) : "systemKey" in row ? (
                      "Custom role"
                    ) : (
                      "Unavailable"
                    )}
                  </td>
                  <td className="p-3">
                    {row.active === undefined
                      ? "Unavailable"
                      : row.active
                        ? "Active"
                        : "Inactive"}
                  </td>
                  <td className="p-3">
                    <Button variant="outline" onClick={() => void edit(row.id)}>
                      Edit {row.name}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.data?.data.data.length && (
            <p className="p-6">No matching records.</p>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>
          Page {page} · {list.data?.data.total ?? 0} records
        </span>
        <Button
          variant="outline"
          disabled={!list.data || page * 20 >= list.data.data.total}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      {user && (
        <AddUserDialog
          key={typeof user === "string" ? "new" : user.id}
          user={user}
          onClose={() => setUser(null)}
        />
      )}
      {role && (
        <RoleEditor
          key={typeof role === "string" ? "new" : role.id}
          role={role}
          onClose={() => setRole(null)}
        />
      )}
    </div>
  )
}
