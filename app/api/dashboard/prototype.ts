import { NextResponse } from "next/server"
import { vehiclesStore, salesStore } from "@/lib/mock-store"
import { activityFixtures } from "@/lib/mock-data/activity"
import { injectLatency } from "@/lib/utils"

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export async function GET() {
  await injectLatency()

  const vehicles = vehiclesStore.getAll()
  const sales = salesStore.getAll()

  const inStock = vehicles.filter((v) => v.status === "InStock").length
  const inRepair = vehicles.filter((v) => v.status === "InRepair").length
  const activeAdvances = sales.filter((s) => s.status === "AdvancePlaced").length

  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const recentSales = sales.filter((s) => {
    const saleDate = new Date(s.date)
    return saleDate >= sevenDaysAgo
  }).length

  // Build monthly sales counts for the last 12 months
  const monthlySales = MONTHS.map((month, idx) => {
    const count = sales.filter((s) => {
      const d = new Date(s.date)
      return d.getMonth() === idx
    }).length
    return { month, count }
  })

  const recentActivity = activityFixtures.slice(0, 8)

  return NextResponse.json({
    inStock,
    inRepair,
    activeAdvances,
    recentSales,
    monthlySales,
    recentActivity,
  })
}
