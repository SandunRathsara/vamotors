import { NextRequest, NextResponse } from "next/server"
import { vehiclesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { Vehicle } from "@/lib/mock-data/schemas"

export async function GET(request: NextRequest) {
  await injectLatency()

  const { searchParams } = request.nextUrl
  const page = parseInt(searchParams.get("page") ?? "1", 10)
  const pageSize = parseInt(searchParams.get("pageSize") ?? "20", 10)
  const sortBy = searchParams.get("sortBy") ?? "purchaseDate"
  const sortDir = (searchParams.get("sortDir") ?? "desc") as "asc" | "desc"
  const q = searchParams.get("q") ?? undefined
  const purchaseType = searchParams.get("purchaseType") ?? undefined
  const status = searchParams.get("status") ?? undefined

  const filters: Record<string, string> = {}
  if (purchaseType) filters.purchaseType = purchaseType
  if (status) filters.status = status

  const result = vehiclesStore.query({ page, pageSize, sortBy, sortDir, q, filters })

  return NextResponse.json(result)
}

type PurchaseBody = Partial<Vehicle> & { mileageAtPurchase?: number }

export async function POST(request: NextRequest) {
  await injectLatency()

  const body = (await request.json()) as PurchaseBody
  const now = new Date().toISOString()

  const vehicle: Vehicle = {
    id: `v-${Date.now()}`,
    make: body.make ?? "",
    model: body.model ?? "",
    year: body.year ?? new Date().getFullYear(),
    colour: body.colour ?? "",
    engineNumber: body.engineNumber ?? "",
    chassisNumber: body.chassisNumber ?? "",
    vin: body.vin,
    crNumber: body.crNumber,
    fuelType: body.fuelType ?? "Petrol",
    transmission: body.transmission ?? "Automatic",
    status: "Purchased",
    isAvailableForSale: false,
    purchasePrice: body.purchasePrice ?? 0,
    listedPrice: body.listedPrice ?? 0,
    costBasis: body.costBasis ?? body.purchasePrice ?? 0,
    purchaseDate: body.purchaseDate ?? now.slice(0, 10),
    purchaseType: body.purchaseType ?? "Cash",
    supplierId: body.supplierId ?? "",
    mileageHistory: body.mileageAtPurchase
      ? [{ date: body.purchaseDate ?? now.slice(0, 10), reading: body.mileageAtPurchase, remark: "At purchase" }]
      : [],
    additionalCosts: body.additionalCosts ?? [],
    photos: [],
    createdAt: now,
    updatedAt: now,
  }

  const created = vehiclesStore.create(vehicle)
  return NextResponse.json(created, { status: 201 })
}
