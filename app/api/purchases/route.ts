import { NextRequest, NextResponse } from "next/server"
import { vehiclesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { Vehicle } from "@/lib/mock-data/schemas"

export async function GET() {
  await injectLatency()

  const all = vehiclesStore.getAll()
  const sorted = [...all].sort(
    (a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime()
  )

  return NextResponse.json({
    data: sorted,
    total: sorted.length,
    page: 1,
    pageSize: sorted.length,
  })
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
