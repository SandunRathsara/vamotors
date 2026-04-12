"use client"

import * as React from "react"
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs"

import type { PaginatedResponse, ThirdParty } from "@/lib/mock-data/schemas"
import { useEntityQuery } from "@/hooks/use-entity-query"
import { useEntityMutation } from "@/hooks/use-entity-mutation"
import { DataTableShell } from "@/components/shared/data-table-shell"
import { createThirdPartiesColumns } from "./third-parties-columns"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

const TYPE_TABS = [
  { value: "", label: "All" },
  { value: "Supplier", label: "Suppliers" },
  { value: "RepairVendor", label: "Repair Vendors" },
  { value: "FinanceCompany", label: "Finance Companies" },
] as const

export function ThirdPartiesTable() {
  const [params, setParams] = useQueryStates({
    page: parseAsInteger.withDefault(1),
    pageSize: parseAsInteger.withDefault(20),
    q: parseAsString.withDefault(""),
    type: parseAsString.withDefault(""),
    sortBy: parseAsString.withDefault(""),
    sortDir: parseAsString.withDefault("asc"),
  })

  // Archive dialog state
  const [archiveTarget, setArchiveTarget] = React.useState<ThirdParty | null>(null)

  const { data, isLoading } = useEntityQuery<PaginatedResponse<ThirdParty>>(
    "third-parties",
    "/api/third-parties",
    {
      page: params.page,
      pageSize: params.pageSize,
      q: params.q || undefined,
      type: params.type || undefined,
      sortBy: params.sortBy || undefined,
      sortDir: params.sortDir || undefined,
    },
  )

  const { mutate: archiveMutate, isPending: isArchiving } = useEntityMutation({
    entityKey: "third-parties",
    endpoint: archiveTarget ? `/api/third-parties/${archiveTarget.id}` : "/api/third-parties",
    method: "PATCH",
    successMessage: "Third party archived.",
  })

  const thirdParties = data?.data ?? []
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / params.pageSize))
  const isFiltered = Boolean(params.q || params.type)

  function handleClearFilters() {
    void setParams({ q: "", type: "", page: 1 })
  }

  function handleArchive(tp: ThirdParty) {
    setArchiveTarget(tp)
  }

  function confirmArchive() {
    if (!archiveTarget) return
    archiveMutate(
      { isActive: false } as Parameters<typeof archiveMutate>[0],
      {
        onSuccess: () => setArchiveTarget(null),
      },
    )
  }

  const columns = React.useMemo(
    () => createThirdPartiesColumns(handleArchive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  if (isLoading && thirdParties.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center">
        <span className="text-sm text-muted-foreground">Loading third parties...</span>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-4">
        <Tabs
          value={params.type}
          onValueChange={(value) => void setParams({ type: value, page: 1 })}
        >
          <TabsList>
            {TYPE_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <DataTableShell
          columns={columns}
          data={thirdParties}
          pageCount={pageCount}
          searchPlaceholder="Search third parties..."
          emptyState={{
            heading: "No third parties added",
            body: "Add a supplier, repair vendor, or finance company.",
          }}
          isFiltered={isFiltered}
          onClearFilters={handleClearFilters}
          toolbarChildren={
            <Input
              placeholder="Search third parties..."
              value={params.q}
              onChange={(e) => void setParams({ q: e.target.value, page: 1 })}
              className="h-8 w-64"
            />
          }
        />
      </div>

      {/* Archive confirmation dialog */}
      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">Archive Third Party</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Archive{" "}
            <span className="font-medium text-foreground">{archiveTarget?.name}</span>? They
            will no longer appear in selection lists. Existing records will be unaffected.
          </p>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setArchiveTarget(null)}
              disabled={isArchiving}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmArchive}
              disabled={isArchiving}
            >
              {isArchiving ? "Archiving..." : "Archive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
