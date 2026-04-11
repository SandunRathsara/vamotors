"use client"

import { useQuery } from "@tanstack/react-query"

export function useApprovalsCount(): number {
  const { data } = useQuery<{ total: number }>({
    queryKey: ["approvals", "pending-count"],
    queryFn: async () => {
      const res = await fetch("/api/approvals?status=Pending&pageSize=1")
      if (!res.ok) return { total: 0 }
      return res.json()
    },
    refetchInterval: 30_000,
    staleTime: 30_000,
  })
  return data?.total ?? 0
}
