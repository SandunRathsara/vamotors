import { Inbox } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface EmptyStateAction {
  label: string
  href?: string
  onClick?: () => void
}

interface EmptyStateProps {
  heading: string
  body: string
  action?: EmptyStateAction
  isFilterEmpty?: boolean
  onClearFilters?: () => void
  className?: string
}

export function EmptyState({
  heading,
  body,
  action,
  isFilterEmpty = false,
  onClearFilters,
  className,
}: EmptyStateProps) {
  const displayHeading = isFilterEmpty ? "No results match your filters" : heading
  const displayBody = isFilterEmpty
    ? "Try adjusting or clearing the active filters."
    : body

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 py-16 text-center",
        className,
      )}
    >
      <Inbox className="h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold">{displayHeading}</p>
        <p className="text-sm text-muted-foreground">{displayBody}</p>
      </div>
      {isFilterEmpty && onClearFilters ? (
        <Button variant="outline" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      ) : action ? (
        action.href ? (
          <Button variant="outline" size="sm" asChild>
            <a href={action.href}>{action.label}</a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )
      ) : null}
    </div>
  )
}
