import type { ColumnDef } from "@tanstack/react-table"
import type { UserAdminDTO } from "@/.planning/implementation/contracts/api"

// Only the real safe DTO: no invented last-login or single-role/status fields.
export const usersColumns: ColumnDef<UserAdminDTO>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "email", header: "Email" },
  {
    id: "roles",
    header: "Roles",
    cell: ({ row }) =>
      row.original.roles?.map((r) => r.name ?? "Unavailable").join(", ") ||
      "Unavailable",
  },
  {
    id: "active",
    header: "Access",
    cell: ({ row }) =>
      row.original.active === undefined
        ? "Unavailable"
        : row.original.active
          ? "Active"
          : "Inactive",
  },
]
