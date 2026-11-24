import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 text-center">
        <p className="text-xs font-normal tracking-widest text-muted-foreground uppercase">
          VA Motors
        </p>
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-semibold">Page not found</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            The page you&#39;re looking for doesn&#39;t exist or has been moved.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard">Return to Dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
