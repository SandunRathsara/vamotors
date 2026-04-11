import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ── Latency injection for mock API route handlers ─────────────────────────────

export async function injectLatency(): Promise<void> {
  const min = parseInt(process.env.MOCK_LATENCY_MS_MIN ?? "200", 10)
  const max = parseInt(process.env.MOCK_LATENCY_MS_MAX ?? "600", 10)
  const ms = min + Math.random() * (max - min)
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ── Currency formatting (LKR, stored as integer cents) ───────────────────────

/**
 * Format an integer cent amount to a human-readable currency string.
 * e.g. 350000000 -> "Rs. 3,500,000.00"
 */
export function formatCurrency(amountInCents: number): string {
  const amount = amountInCents / 100
  const formatted = new Intl.NumberFormat("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
  return `Rs. ${formatted}`
}

/**
 * Parse a currency input string to integer cents.
 * e.g. "3,500,000.00" -> 350000000
 * e.g. "Rs. 3,500,000.00" -> 350000000
 */
export function parseCurrencyInput(input: string): number {
  const cleaned = input.replace(/Rs\.?\s*/g, "").replace(/,/g, "").trim()
  const parsed = parseFloat(cleaned)
  if (isNaN(parsed)) return 0
  return Math.round(parsed * 100)
}
