import type { ReportKind } from "../.planning/implementation/contracts/api"

export const reportKinds = [
  "INVENTORY",
  "SOLD",
  "PROFIT",
  "ADVANCES",
  "REPAIRS",
  "CASH_FLOW",
  "DISPOSALS",
] as const satisfies readonly ReportKind[]

export const reportPages = {
  INVENTORY: { href: "/reports/stock", label: "Current vehicle inventory" },
  SOLD: { href: "/reports/sales", label: "Vehicles sold per period" },
  PROFIT: { href: "/reports/profit", label: "Profit per vehicle" },
  ADVANCES: {
    href: "/reports/advances",
    label: "Outstanding advance payments",
  },
  REPAIRS: { href: "/reports/repairs", label: "Vehicles currently in repair" },
  CASH_FLOW: { href: "/cash-flow", label: "Cash flow summary" },
  DISPOSALS: { href: "/reports/disposals", label: "Write-off and disposal" },
} as const satisfies Record<ReportKind, { href: string; label: string }>
