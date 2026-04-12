import { NextRequest, NextResponse } from "next/server"
import { customersStore, salesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"

const vehicleMap = new Map(vehicleFixtures.map((v) => [v.id, v]))

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await injectLatency()

  const { id } = await params
  const customer = customersStore.getById(id)

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 })
  }

  // Join all sales for this customer
  const allSales = salesStore.getAll().filter((s) => s.customerId === id)
  const salesWithVehicle = allSales.map((sale) => {
    const vehicle = vehicleMap.get(sale.vehicleId)
    return {
      ...sale,
      vehicleMake: vehicle?.make,
      vehicleModel: vehicle?.model,
      vehicleYear: vehicle?.year,
    }
  })

  return NextResponse.json({ ...customer, sales: salesWithVehicle })
}
