import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/utils"

interface CurrencyDisplayProps {
  /** Amount in integer cents (smallest currency unit) */
  amount: number
  className?: string
}

export function CurrencyDisplay({ amount, className }: CurrencyDisplayProps) {
  return (
    <span className={cn("font-normal tabular-nums", className)}>
      {formatCurrency(amount)}
    </span>
  )
}
