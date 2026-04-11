import Link from "next/link"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"

export function QuickActions() {
  return (
    <div className="flex flex-wrap gap-3">
      <Button asChild>
        <Link href="/purchases">
          <Plus className="mr-1.5 h-4 w-4" />
          Record Purchase
        </Link>
      </Button>
      <Button asChild>
        <Link href="/sales">
          <Plus className="mr-1.5 h-4 w-4" />
          Record Sale
        </Link>
      </Button>
      <Button asChild>
        <Link href="/repairs">
          <Plus className="mr-1.5 h-4 w-4" />
          Send for Repair
        </Link>
      </Button>
    </div>
  )
}
