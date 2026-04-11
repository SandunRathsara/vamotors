"use client"

import { useState } from "react"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { NotificationPopover } from "@/components/layout/notification-popover"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { UserNav } from "@/components/layout/user-nav"
import { CommandMenu } from "@/components/layout/command-menu"
import { Search } from "lucide-react"

export function Header() {
  const [commandOpen, setCommandOpen] = useState(false)

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />

      <div className="flex flex-1 items-center gap-2">
        <div
          className="relative w-full max-w-sm cursor-pointer"
          onClick={() => setCommandOpen(true)}
        >
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            readOnly
            placeholder="Search… (⌘K)"
            className="pl-8 h-8 text-sm bg-background cursor-pointer"
            onFocus={() => setCommandOpen(true)}
          />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <NotificationPopover />
        <ThemeToggle />
        <UserNav />
      </div>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </header>
  )
}
