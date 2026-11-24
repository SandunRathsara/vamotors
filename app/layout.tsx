import type { Metadata } from "next"
import { Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Providers } from "@/components/layout/providers"
import { Toaster } from "@/components/ui/sonner"
import { PwaRegistration } from "@/components/pwa-registration"
import { cn } from "@/lib/utils"

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" })

export const metadata: Metadata = {
  title: "VSMS — VA Motors",
  description: "Vehicle Sale Management System",
  appleWebApp: { capable: true, title: "VA Motors", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("font-sans", inter.variable)}
    >
      <body className={inter.variable}>
        <PwaRegistration />
        <ThemeProvider>
          <Providers>{children}</Providers>
          <Toaster position="top-right" richColors />
        </ThemeProvider>
      </body>
    </html>
  )
}
