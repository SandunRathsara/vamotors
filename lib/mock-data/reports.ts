/**
 * Reports module — derives report data from fixture data.
 * These are helper functions, not standalone fixtures.
 */
import { vehicleFixtures } from "./vehicles"
import { salesFixtures } from "./sales"
import { customerFixtures } from "./customers"
import { repairsFixtures } from "./repairs"
import { thirdPartiesFixtures } from "./third-parties"
import type { Vehicle, Sale, Customer, Repair, ThirdParty } from "./schemas"

// ── Stock Report ──────────────────────────────────────────────────────────────

export type StockReportRow = {
  vehicle: Vehicle
  daysSincePurchase: number
  repairCount: number
  totalRepairCost: number
}

export function getStockReport(): StockReportRow[] {
  const inStockStatuses = ["InStock", "InRepair", "AdvancePlaced", "AdvanceExpired", "FinancePending", "DOReceived", "Delivered", "Purchased"] as const
  const now = new Date("2024-11-11")
  return vehicleFixtures
    .filter((v) => inStockStatuses.includes(v.status as typeof inStockStatuses[number]))
    .map((vehicle) => {
      const purchaseDate = new Date(vehicle.purchaseDate)
      const daysSincePurchase = Math.floor((now.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24))
      const vehicleRepairs = repairsFixtures.filter((r) => r.vehicleId === vehicle.id)
      const totalRepairCost = vehicleRepairs.reduce((sum, r) => sum + (r.invoiceAmount ?? 0), 0)
      return { vehicle, daysSincePurchase, repairCount: vehicleRepairs.length, totalRepairCost }
    })
    .sort((a, b) => b.daysSincePurchase - a.daysSincePurchase)
}

// ── Sales Report ──────────────────────────────────────────────────────────────

export type SalesReportRow = {
  sale: Sale
  vehicle: Vehicle | undefined
  customer: Customer | undefined
}

export function getSalesReport(fromDate?: string, toDate?: string): SalesReportRow[] {
  let filtered = salesFixtures.filter((s) => s.status === "Completed")
  if (fromDate) filtered = filtered.filter((s) => s.date >= fromDate)
  if (toDate) filtered = filtered.filter((s) => s.date <= toDate)
  return filtered.map((sale) => ({
    sale,
    vehicle: vehicleFixtures.find((v) => v.id === sale.vehicleId),
    customer: customerFixtures.find((c) => c.id === sale.customerId),
  }))
}

// ── Profit/Loss Report ────────────────────────────────────────────────────────

export type ProfitLossRow = {
  sale: Sale
  vehicle: Vehicle | undefined
  costBasis: number
  salePrice: number
  profitLoss: number
}

export function getProfitLossReport(fromDate?: string, toDate?: string): ProfitLossRow[] {
  const salesRows = getSalesReport(fromDate, toDate)
  return salesRows.map(({ sale, vehicle }) => ({
    sale,
    vehicle,
    costBasis: vehicle?.costBasis ?? 0,
    salePrice: sale.salePrice,
    profitLoss: sale.profitLoss ?? sale.salePrice - (vehicle?.costBasis ?? 0),
  }))
}

// ── Customer Activity Report ──────────────────────────────────────────────────

export type CustomerActivityRow = {
  customer: Customer
  totalPurchases: number
  totalSpend: number
  lastPurchaseDate: string | null
}

export function getCustomerActivityReport(): CustomerActivityRow[] {
  return customerFixtures.map((customer) => {
    const customerSales = salesFixtures.filter(
      (s) => s.customerId === customer.id && s.status === "Completed"
    )
    const totalSpend = customerSales.reduce((sum, s) => sum + s.salePrice, 0)
    const sortedDates = customerSales.map((s) => s.date).sort((a, b) => b.localeCompare(a))
    return {
      customer,
      totalPurchases: customerSales.length,
      totalSpend,
      lastPurchaseDate: sortedDates[0] ?? null,
    }
  }).filter((r) => r.totalPurchases > 0)
}

// ── Supplier Performance Report ───────────────────────────────────────────────

export type SupplierRow = {
  supplier: ThirdParty
  vehicleCount: number
  totalPurchaseValue: number
  soldCount: number
  totalSaleValue: number
}

export function getSupplierReport(): SupplierRow[] {
  const suppliers = thirdPartiesFixtures.filter((t) => t.type === "Supplier")
  return suppliers.map((supplier) => {
    const supplierVehicles = vehicleFixtures.filter((v) => v.supplierId === supplier.id)
    const soldVehicleIds = new Set(salesFixtures.filter((s) => s.status === "Completed").map((s) => s.vehicleId))
    const soldVehicles = supplierVehicles.filter((v) => soldVehicleIds.has(v.id))
    const saleMap = new Map(salesFixtures.map((s) => [s.vehicleId, s]))
    return {
      supplier,
      vehicleCount: supplierVehicles.length,
      totalPurchaseValue: supplierVehicles.reduce((sum, v) => sum + v.purchasePrice, 0),
      soldCount: soldVehicles.length,
      totalSaleValue: soldVehicles.reduce((sum, v) => sum + (saleMap.get(v.id)?.salePrice ?? 0), 0),
    }
  })
}

// ── Repair Cost Report ────────────────────────────────────────────────────────

export type RepairCostRow = {
  repair: Repair
  vehicle: Vehicle | undefined
  vendor: ThirdParty | undefined
}

export function getRepairCostReport(fromDate?: string, toDate?: string): RepairCostRow[] {
  let filtered = repairsFixtures.filter((r) => r.status === "Completed" && r.invoiceAmount != null)
  if (fromDate) filtered = filtered.filter((r) => r.dateSent >= fromDate)
  if (toDate) filtered = filtered.filter((r) => r.dateSent <= toDate)
  return filtered.map((repair) => ({
    repair,
    vehicle: vehicleFixtures.find((v) => v.id === repair.vehicleId),
    vendor: thirdPartiesFixtures.find((t) => t.id === repair.vendorId),
  }))
}
