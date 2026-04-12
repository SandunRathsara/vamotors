"use client"

import type { ColumnDef } from "@tanstack/react-table"
import { format } from "date-fns"
import { Trash2 } from "lucide-react"
import * as React from "react"

import type { User } from "@/lib/mock-data/schemas"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/shared/status-badge"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useEntityMutation } from "@/hooks/use-entity-mutation"

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatLastLogin(dateStr?: string) {
  if (!dateStr) return "Never"
  try {
    return format(new Date(dateStr), "dd MMM yyyy, HH:mm")
  } catch {
    return dateStr
  }
}

function getInitials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
}

const roleLabels: Record<string, string> = {
  Administrator: "Administrator",
  Manager: "Manager",
  SalesExecutive: "Sales Executive",
  FinanceOfficer: "Finance Officer",
}

// ── Delete cell ───────────────────────────────────────────────────────────────

function DeleteUserCell({ user }: { user: User }) {
  const [open, setOpen] = React.useState(false)

  const { mutate, isPending } = useEntityMutation({
    entityKey: "users",
    endpoint: "/api/users",
    method: "PATCH",
    successMessage: "User deleted.",
  })

  function handleDelete() {
    mutate(
      { id: user.id, status: "Inactive" } as Parameters<typeof mutate>[0],
      { onSuccess: () => setOpen(false) },
    )
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        <span className="sr-only">Delete user</span>
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${user.name}?`}
        description={`Delete ${user.name}? This will permanently remove their access. This cannot be undone.`}
        cancelLabel="Cancel"
        confirmLabel="Delete User"
        variant="destructive"
        onConfirm={handleDelete}
        isPending={isPending}
      />
    </>
  )
}

// ── Columns ───────────────────────────────────────────────────────────────────

export const usersColumns: ColumnDef<User>[] = [
  {
    id: "index",
    header: "#",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground tabular-nums">{row.index + 1}</span>
    ),
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
  {
    id: "name",
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => {
      const user = row.original
      return (
        <div className="flex items-center gap-2.5">
          <Avatar className="h-7 w-7 text-xs">
            <AvatarFallback className="text-xs">{getInitials(user.name)}</AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-normal">{user.name}</p>
            <p className="text-xs text-muted-foreground">{user.email}</p>
          </div>
        </div>
      )
    },
    enableSorting: true,
  },
  {
    id: "role",
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => (
      <Badge variant="secondary">{roleLabels[row.original.role] ?? row.original.role}</Badge>
    ),
    enableSorting: true,
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    enableSorting: true,
  },
  {
    id: "lastLogin",
    accessorKey: "lastLogin",
    header: "Last Login",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums text-muted-foreground">
        {formatLastLogin(row.original.lastLogin)}
      </span>
    ),
    enableSorting: true,
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <DeleteUserCell user={row.original} />,
    enableSorting: false,
    enableHiding: false,
    size: 48,
  },
]
