"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, User } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { Input } from "@/components/ui/input"
import { usersColumns } from "./users-columns"

export function UsersTable() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault("name"),
    sortDir: parseAsString.withDefault("asc"),
  })

  const { data, isLoading } = useEntityQuery<PaginatedResponse<User>>(
    "users",
    "/api/users",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const users = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q)

  function handleClearFilters() {
    void setParams({ q: "", page: 1 })
  }

  if (isLoading && users.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading users...</span>
      </div>
    )
  }

  return (
    <DataTableShell
      columns={usersColumns}
      data={users}
      pageCount={pageCount}
      emptyState={{
        heading: "No users added",
        body: "Add the first user to grant access to the system.",
      }}
      isFiltered={isFiltered}
      onClearFilters={handleClearFilters}
      toolbarChildren={
        <Input
          placeholder="Search users..."
          value={params.q}
          onChange={(e) => void setParams({ q: e.target.value, page: 1 })}
          className="h-8 w-56"
        />
      }
    />
  )
}
