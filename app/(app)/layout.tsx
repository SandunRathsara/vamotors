import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Header } from "@/components/layout/header"
import { pageActor } from "@/lib/server/pages"
import { AuthBoundary } from "@/components/providers/auth-boundary"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await pageActor()
  return (
    <AuthBoundary initial={context}>
      <SidebarProvider>
        <a
          href="#main-content"
          className="sr-only z-50 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:rounded-md focus:bg-background focus:p-3"
        >
          Skip to content
        </a>
        <AppSidebar />
        <SidebarInset>
          <Header />
          <main
            id="main-content"
            tabIndex={-1}
            className="flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-6"
          >
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </AuthBoundary>
  )
}
