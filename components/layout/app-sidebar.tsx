"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Car } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { NAV_SECTIONS } from "./nav-config"

export function AppSidebar() {
  const { actor } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <Car aria-hidden="true" className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">VA Motors</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main navigation">
          {NAV_SECTIONS.map(({ label, items }) => {
            const visible = items.filter(
              (item) => item.visible?.(ability) ?? true
            )
            if (!visible.length) return null
            return (
              <SidebarGroup key={label}>
                <SidebarGroupLabel>{label}</SidebarGroupLabel>
                <SidebarMenu>
                  {visible.map(({ title, href, icon: Icon }) => {
                    const current =
                      pathname === href ||
                      (href !== "/reports" && pathname.startsWith(href + "/"))
                    return (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          asChild
                          isActive={current}
                          className="min-h-10"
                        >
                          <Link
                            href={href}
                            prefetch={false}
                            aria-current={current ? "page" : undefined}
                            onNavigate={() => setOpenMobile(false)}
                          >
                            <Icon aria-hidden="true" />
                            {title}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroup>
            )
          })}
        </nav>
      </SidebarContent>
    </Sidebar>
  )
}
