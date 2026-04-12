import { NextRequest, NextResponse } from "next/server"
import { thirdPartiesStore, repairsStore, salesStore, vehiclesStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"
import type { ThirdParty } from "@/lib/mock-data/schemas"
import { vehicleFixtures } from "@/lib/mock-data/vehicles"
import { customerFixtures } from "@/lib/mock-data/customers"

const vehicleMap = new Map(vehicleFixtures.map((v) => [v.id, v]))
const customerMap = new Map(customerFixtures.map((c) => [c.id, c]))

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await injectLatency()

  const { id } = await params
  const thirdParty = thirdPartiesStore.getById(id)

  if (!thirdParty) {
    return NextResponse.json({ error: "Third party not found" }, { status: 404 })
  }

  let historyData: Record<string, unknown>[] = []

  if (thirdParty.type === "Supplier") {
    // Purchase history — vehicles purchased from this supplier
    const vehicles = vehiclesStore.getAll().filter((v) => v.supplierId === id)
    historyData = vehicles.map((v) => ({
      vehicleId: v.id,
      make: v.make,
      model: v.model,
      year: v.year,
      purchaseType: v.purchaseType,
      purchaseDate: v.purchaseDate,
      purchasePrice: v.purchasePrice,
      status: v.status,
    }))
  } else if (thirdParty.type === "RepairVendor") {
    // Repair history — repairs sent to this vendor
    const repairs = repairsStore.getAll().filter((r) => r.vendorId === id)
    historyData = repairs.map((r) => {
      const vehicle = vehicleMap.get(r.vehicleId)
      return {
        repairId: r.id,
        vehicleId: r.vehicleId,
        vehicleMake: vehicle?.make,
        vehicleModel: vehicle?.model,
        vehicleYear: vehicle?.year,
        repairRequest: r.repairRequest,
        dateSent: r.dateSent,
        dateReturned: r.dateReturned,
        invoiceAmount: r.invoiceAmount,
        status: r.status,
      }
    })
  } else if (thirdParty.type === "FinanceCompany") {
    // Lease deals — sales using this finance company
    const leaseSales = salesStore
      .getAll()
      .filter((s) => s.financeCompanyId === id && s.saleType === "LeaseFinance")
    historyData = leaseSales.map((s) => {
      const vehicle = vehicleMap.get(s.vehicleId)
      const customer = customerMap.get(s.customerId)
      return {
        saleId: s.id,
        vehicleId: s.vehicleId,
        vehicleMake: vehicle?.make,
        vehicleModel: vehicle?.model,
        vehicleYear: vehicle?.year,
        customerId: s.customerId,
        customerName: customer?.fullName,
        date: s.date,
        financeAmount: s.financeAmount,
        salePrice: s.salePrice,
        status: s.status,
      }
    })
  }

  return NextResponse.json({ ...thirdParty, historyData })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  await injectLatency()

  const { id } = await params
  const body = (await request.json()) as Partial<ThirdParty>

  const updated = thirdPartiesStore.update(id, { ...body, updatedAt: new Date().toISOString() })

  if (!updated) {
    return NextResponse.json({ error: "Third party not found" }, { status: 404 })
  }

  return NextResponse.json(updated)
}
