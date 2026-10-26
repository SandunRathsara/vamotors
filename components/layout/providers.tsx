"use client"

import {
  QueryClient,
  QueryClientProvider,
  isServer,
} from "@tanstack/react-query"
import { NuqsAdapter } from "nuqs/adapters/next/app"

let browserQueryClient: QueryClient | undefined

function getQueryClient() {
  if (isServer) {
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 0,
          gcTime: 0,
          retry: false,
        },
      },
    })
  }
  if (!browserQueryClient) {
    browserQueryClient = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 0,
          gcTime: 0,
          retry: false,
        },
      },
    })
  }
  return browserQueryClient
}

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient()

  return (
    <QueryClientProvider client={queryClient}>
      <NuqsAdapter>{children}</NuqsAdapter>
    </QueryClientProvider>
  )
}
