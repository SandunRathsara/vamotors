"use client"

import { format } from "date-fns"
import Link from "next/link"

import type { PaginatedResponse, Vehicle } from "@/lib/mock-data/schemas"
import { useEntityDetail } from "@/hooks/use-entity-query"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/shared/status-badge"
import { CurrencyDisplay } from "@/components/shared/currency-display"
import { VehicleOverview } from "./vehicle-overview"
import { VehicleFinancials } from "./vehicle-financials"
import { VehicleRepairs } from "./vehicle-repairs"
import { VehicleSalesHistory } from "./vehicle-sales-history"

interface VehicleDetailTabsProps {
  id: string
}

function QuickStatsCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Quick Stats</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">Status</span>
          <StatusBadge status={vehicle.status} />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">Listed Price</span>
          <CurrencyDisplay amount={vehicle.listedPrice} className="text-sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">Cost Basis</span>
          <CurrencyDisplay amount={vehicle.costBasis} className="text-sm" />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">Purchase Date</span>
          <span className="text-sm">
            {format(new Date(vehicle.purchaseDate), "dd MMM yyyy")}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">Purchase Type</span>
          <span className="text-sm">
            {vehicle.purchaseType === "Cash"
              ? "Cash"
              : vehicle.purchaseType === "LeaseSettlement"
                ? "Lease Settlement"
                : "Brand New"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-xs font-normal text-muted-foreground">Availability</span>
          <span className="flex items-center gap-1.5 text-sm">
            <span
              className={`inline-block h-2 w-2 rounded-full ${vehicle.isAvailableForSale ? "bg-green-500" : "bg-red-500"}`}
            />
            {vehicle.isAvailableForSale ? "Available for sale" : "Unavailable"}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export function VehicleDetailTabs({ id }: VehicleDetailTabsProps) {
  const { data: vehicle, isLoading, error } = useEntityDetail<Vehicle>(
    "vehicles",
    "/api/vehicles",
    id,
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-4 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-64" />
        </div>
      </div>
    )
  }

  if (error || !vehicle) {
    return (
      <div className="rounded-lg border p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Could not load this record. It may have been removed or the request failed.
        </p>
        <button
          className="mt-2 text-sm underline"
          onClick={() => window.history.back()}
          type="button"
        >
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/vehicles">Vehicles</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>
              {vehicle.make} {vehicle.model} {vehicle.year}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Main layout: tabs left, quick stats right on lg */}
      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Tabs */}
        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="financials">Financials</TabsTrigger>
            <TabsTrigger value="repairs">Repairs</TabsTrigger>
            <TabsTrigger value="sales-history">Sales History</TabsTrigger>
            <TabsTrigger value="audit-trail">Audit Trail</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <VehicleOverview vehicle={vehicle} />
          </TabsContent>

          <TabsContent value="financials">
            <VehicleFinancials vehicle={vehicle} />
          </TabsContent>

          <TabsContent value="repairs">
            <VehicleRepairs vehicle={vehicle} />
          </TabsContent>

          <TabsContent value="sales-history">
            <VehicleSalesHistory vehicle={vehicle} />
          </TabsContent>

          <TabsContent value="audit-trail">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  Audit trail will be available when the system is connected to the database.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Quick Stats (right panel) */}
        <div className="lg:order-last">
          <QuickStatsCard vehicle={vehicle} />
        </div>
      </div>
    </div>
  )
}
