"use client"
import { Car, LayoutDashboard, Users } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useCapabilities } from "@/components/users/use-capabilities"

export function AppSidebar() {
  const { can } = useCapabilities()
  const administration = (["User", "Role"] as const).some((t) =>
    ["read", "create", "update", "archive"].some((a) => can(t, a))
  )
  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-3">
          <Car className="h-5 w-5 text-primary" />
          <span className="text-sm font-semibold">VA Motors</span>
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="/dashboard">
                <LayoutDashboard />
                Overview
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {administration && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/users">
                  <Users />
                  Users &amp; Roles
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarContent>
    </Sidebar>
  )
}
