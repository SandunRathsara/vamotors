"use client"

import { useQuery } from "@tanstack/react-query"
import { formatDistanceToNow } from "date-fns"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Activity } from "@/lib/mock-data/schemas"

type DashboardData = { recentActivity: Activity[] }

export function ActivityFeed() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error("Failed to load dashboard data")
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    )
  }

  const activities = data?.recentActivity ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {activities.map((activity) => (
            <li key={activity.id} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-normal">{activity.user}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(activity.timestamp), { addSuffix: true })}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-snug">
                {activity.action} — {activity.entity}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
