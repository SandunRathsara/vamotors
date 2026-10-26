"use client"
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type {
  RoleDTO,
  Grant,
  PermissionRegistryDTO,
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
import { useAdminCommand } from "./use-admin-command"
import type { QueryResult } from "./users-table"
import { useCapabilities } from "./use-capabilities"

export function RoleEditor({
  role,
  onClose,
}: {
  role: RoleDTO | "new"
  onClose: () => void
}) {
  const existing = role === "new" ? null : role
  const { can } = useCapabilities()
  const action = existing ? "update" : "create"
  const editable = (field: string) =>
    can("Role", action, [field], existing ?? {})
  const complete =
    !existing ||
    (typeof existing.name === "string" &&
      Array.isArray(existing.grants) &&
      !!existing.id &&
      !!existing.revision)
  const registryAllowed =
    (can("Role", "read") && can("Role", "update")) ||
    can("User", "create") ||
    can("User", "update")
  const [name, setName] = useState(existing?.name ?? "")
  const [grants, setGrants] = useState(
    existing && !Array.isArray(existing.grants)
      ? ""
      : JSON.stringify(existing?.grants ?? [], null, 2)
  )
  const [revision, setRevision] = useState(existing?.revision)
  const [key, setKey] = useState(crypto.randomUUID())
  const [parseError, setParseError] = useState("")
  const command = useAdminCommand()
  const registry = useQuery({
    enabled: registryAllowed,
    queryKey: ["permissionRegistry"],
    queryFn: () =>
      privateRequest<QueryResult<PermissionRegistryDTO>>(
        "/api/v1/queries/permissionRegistry"
      ),
  })
  async function submit(
    event: React.FormEvent<HTMLFormElement>,
    archive: boolean
  ) {
    event.preventDefault()
    if (!archive && (!complete || !can("Role", action))) return
    if (
      archive &&
      !can(
        "Role",
        "archive",
        existing?.active ? ["active"] : [],
        existing ?? {}
      )
    )
      return
    const reason = String(new FormData(event.currentTarget).get("reason"))
    const envelope = {
      schemaVersion: 1 as const,
      idempotencyKey: key,
      expected:
        existing && revision
          ? [{ type: "Role" as const, id: existing.id, revision }]
          : [],
    }
    let parsed: Grant[]
    try {
      parsed = archive ? [] : (JSON.parse(grants) as Grant[])
    } catch {
      setParseError("Grants must be valid JSON.")
      return
    }
    setParseError("")
    const ok =
      archive && existing
        ? await command.run("archiveRole", {
            ...envelope,
            input: { id: existing.id, reason },
          })
        : await command.run("saveRole", {
            ...envelope,
            input: {
              ...(existing ? { id: existing.id } : {}),
              name,
              grants: parsed,
              reason,
            },
          })
    if (ok) onClose()
  }
  async function refreshRevision() {
    if (existing)
      setRevision(
        (
          await privateRequest<QueryResult<RoleDTO>>(
            `/api/v1/queries/role?id=${existing.id}`
          )
        ).data.revision
      )
    setKey(crypto.randomUUID())
    command.reconfirm()
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !command.pending) onClose()
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{existing ? "Edit Role" : "Add Role"}</SheetTitle>
          <SheetDescription>
            Only authorized changed fields may be saved. Hidden grants are never
            replaced. Domain services outside this bounded administration remain
            unavailable.
          </SheetDescription>
        </SheetHeader>
        <form
          className="space-y-4 p-4"
          onChange={() => setKey(crypto.randomUUID())}
          onSubmit={(e) =>
            void submit(
              e,
              (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
                "value"
              ) === "archive"
            )
          }
        >
          <fieldset
            disabled={command.pending || !!existing?.systemKey}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label htmlFor="role-name">Role name</Label>
              <Input
                id="role-name"
                disabled={!editable("name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-grants">Grants (JSON array)</Label>
              <textarea
                id="role-grants"
                readOnly={!editable("grants") || !complete}
                className="min-h-48 w-full rounded-md border bg-background p-3 font-mono text-sm"
                value={grants}
                onChange={(e) => setGrants(e.target.value)}
                required
                spellCheck={false}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-reason">Reason</Label>
              <Input id="role-reason" name="reason" required maxLength={2000} />
            </div>
            {(command.error || parseError) && (
              <p role="alert" className="text-sm text-destructive">
                {parseError || command.error}
              </p>
            )}
            {command.stale && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void refreshRevision().catch(() => undefined)}
              >
                Refresh revisions and reconfirm
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="submit"
                disabled={command.stale || !complete || !can("Role", action)}
              >
                {command.pending ? "Saving…" : "Save Role"}
              </Button>
              {existing &&
                can(
                  "Role",
                  "archive",
                  existing.active ? ["active"] : [],
                  existing
                ) && (
                  <Button
                    type="submit"
                    value="archive"
                    variant="destructive"
                    disabled={command.stale}
                  >
                    Archive Role
                  </Button>
                )}
            </div>
          </fieldset>
          {existing?.systemKey && (
            <p>This system role is protected and cannot be changed.</p>
          )}
          {!complete && (
            <p>
              Grants or required references are unavailable. Save is disabled to
              avoid replacing hidden authority; authorized archive remains
              independent.
            </p>
          )}
          {existing?.active === false && (
            <p>This role is archived and cannot be assigned.</p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={command.pending}
          >
            Close
          </Button>
          <details className="text-sm">
            <summary className="cursor-pointer">
              Available administration permission fields
            </summary>
            <p className="my-2">
              Example:{" "}
              {JSON.stringify([
                { subject: "User", action: "read", fields: ["name"] },
              ])}
              . This registry is a conservative subset: conditional-only fields
              and choices that cannot safely be represented are omitted.
              Existing authorized grants remain viewable; every save is
              revalidated by the server.
            </p>
            {registry.data?.data.subjects.map((s) => (
              <div key={s.subject} className="my-3">
                <strong>{s.subject}</strong>
                {s.actions.map((a) => (
                  <p key={a.action}>
                    {a.action}: {a.fields.map((f) => f.path).join(", ")}
                  </p>
                ))}
              </div>
            ))}
            {registry.isError && (
              <p role="alert">Permission registry unavailable.</p>
            )}
          </details>
        </form>
      </SheetContent>
    </Sheet>
  )
}
