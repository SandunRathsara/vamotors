"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { NAV_SECTIONS } from "@/components/layout/nav-config"
import { useApprovalsCount } from "@/hooks/use-approvals-count"
import { Car } from "lucide-react"

export function AppSidebar() {
  const pathname = usePathname()
  const approvalsCount = useApprovalsCount()

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <Car className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">VA Motors</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === item.href
                      : pathname.startsWith(item.href)
                  const Icon = item.icon
                  const showBadge = item.badge && approvalsCount > 0

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild data-active={isActive}>
                        <Link href={item.href}>
                          <Icon className="h-4 w-4" />
                          <span>{item.title}</span>
                          {showBadge && (
                            <Badge className="ml-auto bg-primary text-primary-foreground text-xs px-1.5 py-0">
                              {approvalsCount}
                            </Badge>
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter />
    </Sidebar>
  )
}
