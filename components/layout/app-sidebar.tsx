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
import { useActor } from "@/components/providers/auth-boundary"

export function AppSidebar() {
  const { administrator } = useActor()
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
          {administrator && (
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
