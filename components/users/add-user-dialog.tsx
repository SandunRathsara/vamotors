"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  Dependency,
  UserAdminDTO,
} from "@/.planning/implementation/contracts/api"
import { privateRequest } from "@/lib/security-client"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { allRoles, type QueryResult } from "./users-table"
import { useAdminCommand } from "./use-admin-command"
import { useCapabilities } from "./use-capabilities"
import { attenuation } from "@/lib/server/permissions"

export function AddUserDialog({
  user,
  onClose,
}: {
  user: (UserAdminDTO & { redactedFields?: string[] }) | "new"
  onClose: () => void
}) {
  const existing = user === "new" ? null : user
  const { can, actor, administrator } = useCapabilities()
  const action = existing ? "update" : "create"
  const editable = (field: string) =>
    can("User", action, [field], existing ?? {})
  const complete =
    !existing ||
    (typeof existing.name === "string" &&
      typeof existing.active === "boolean" &&
      !!existing.id &&
      !!existing.revision &&
      Array.isArray(existing.roles) &&
      !existing.redactedFields?.some(
        (f) => f === "roles" || f.startsWith("roles.")
      ) &&
      existing.roles.every((r) => r.id && r.revision))
  const [name, setName] = useState(existing?.name ?? "")
  const [active, setActive] = useState(existing?.active ?? true)
  const [roleIds, setRoleIds] = useState(
    existing?.roles?.map((r) => r.id) ?? []
  )
  const [expected, setExpected] = useState<Dependency[] | null>(null)
  const [key, setKey] = useState(crypto.randomUUID())
  const roles = useQuery({
    queryKey: ["role-options"],
    queryFn: allRoles,
    enabled: can("Role", "read", ["id", "revision"]),
  })
  const assignable = (r: NonNullable<typeof roles.data>[number]) =>
    administrator ||
    (r.systemKey === null &&
      Array.isArray(r.grants) &&
      attenuation(
        actor.presentationGrants,
        [],
        r.grants,
        actor.user.id,
        existing?.id
      ).covered)
  const protectedAccount =
    !administrator &&
    (existing?.adminProtection?.isAdministrator ||
      existing?.roles?.some(
        (assigned) =>
          roles.data?.find((r) => r.id === assigned.id)?.systemKey !== null
      ))
  const reactivationCovered =
    administrator ||
    existing?.active !== false ||
    roleIds.every((id) => {
      const r = roles.data?.find((r) => r.id === id)
      return r && assignable(r)
    })
  const command = useAdminCommand()
  async function refreshRevisions() {
    const rows = await roles.refetch()
    if (!rows.data) return
    const current = existing
      ? (
          await privateRequest<QueryResult<UserAdminDTO>>(
            `/api/v1/queries/user?id=${existing.id}`
          )
        ).data
      : null
    setExpected([
      ...(current
        ? [
            {
              type: "User" as const,
              id: current.id,
              revision: current.revision,
            },
          ]
        : []),
      ...rows.data
        .filter((r) => roleIds.includes(r.id))
        .map((r) => ({
          type: "Role" as const,
          id: r.id,
          revision: r.revision,
        })),
    ])
    setKey(crypto.randomUUID())
    command.reconfirm()
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!complete || !can("User", action)) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const refs = expected ?? [
      ...(existing
        ? [
            {
              type: "User" as const,
              id: existing.id,
              revision: existing.revision,
            },
          ]
        : []),
      ...(roles.data ?? [])
        .filter((r) => roleIds.includes(r.id))
        .map((r) => ({
          type: "Role" as const,
          id: r.id,
          revision: r.revision,
        })),
    ]
    setExpected(refs)
    const envelope = {
      schemaVersion: 1 as const,
      idempotencyKey: key,
      expected: refs,
    }
    const ok = existing
      ? await command.run("updateUser", {
          ...envelope,
          input: {
            id: existing.id,
            name,
            active,
            roleIds,
            reason: String(fields.get("reason")),
          },
        })
      : await command.run("createUser", {
          ...envelope,
          input: {
            name,
            email: String(fields.get("email")),
            password: String(fields.get("password")),
            roleIds,
          },
        })
    if (ok) {
      form.reset()
      onClose()
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose()
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{existing ? "Edit User" : "Add User"}</SheetTitle>
          <SheetDescription>
            Assign one or more active roles. Passwords are creation-only.
          </SheetDescription>
        </SheetHeader>
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => void submit(e)}
          onChange={() => {
            setKey(crypto.randomUUID())
            setExpected(null)
          }}
        >
          <fieldset disabled={command.pending} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">Name</Label>
              <Input
                id="user-name"
                disabled={!editable("name") || !complete}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            {!existing && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="user-email">Email</Label>
                  <Input
                    id="user-email"
                    name="email"
                    type="email"
                    required
                    maxLength={254}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="user-password">Initial password</Label>
                  <Input
                    id="user-password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </div>
              </>
            )}
            {existing && (
              <>
                <p className="text-sm">{existing.email}</p>
                {typeof existing.active === "boolean" ? (
                  <Label>
                    <input
                      type="checkbox"
                      disabled={
                        !editable("active") ||
                        !!protectedAccount ||
                        !reactivationCovered
                      }
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                    />{" "}
                    Active account
                  </Label>
                ) : (
                  <p>Access state unavailable.</p>
                )}
                {existing.adminProtection?.lastActiveAdministrator && (
                  <p className="text-sm">
                    Last active administrator: removal or deactivation is
                    protected.
                  </p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="user-reason">Reason</Label>
                  <Input
                    id="user-reason"
                    name="reason"
                    required
                    maxLength={2000}
                  />
                </div>
              </>
            )}
            <fieldset
              className="space-y-2"
              disabled={!editable("roleIds") || !complete}
            >
              <legend className="mb-2 text-sm font-medium">
                Roles (select at least one)
              </legend>
              {roles.data
                ?.filter((r) => r.id && r.revision && r.name !== undefined)
                .map((r) => (
                  <Label key={r.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={roleIds.includes(r.id)}
                      disabled={
                        (!r.active && !roleIds.includes(r.id)) ||
                        (!administrator && r.systemKey !== null) ||
                        (!roleIds.includes(r.id) && !assignable(r))
                      }
                      onChange={(e) =>
                        setRoleIds(
                          e.target.checked
                            ? [...roleIds, r.id]
                            : roleIds.filter((id) => id !== r.id)
                        )
                      }
                    />
                    {r.name}
                    {!r.active && " (archived)"}
                  </Label>
                ))}
            </fieldset>
            {roles.isError && <p role="alert">Unable to load roles.</p>}
            {!complete && (
              <p>
                Required fields or role references are unavailable. This record
                cannot be replaced safely.
              </p>
            )}
            {command.error && (
              <p role="alert" className="text-sm text-destructive">
                {command.error}
              </p>
            )}
            {command.stale && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshRevisions().catch(() => undefined)}
              >
                Refresh revisions and reconfirm
              </Button>
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  command.stale ||
                  !complete ||
                  !can("User", action) ||
                  !roles.data ||
                  roleIds.length === 0
                }
              >
                {command.pending ? "Saving…" : "Save User"}
              </Button>
            </div>
          </fieldset>
        </form>
      </SheetContent>
    </Sheet>
  )
}
