"use client"

import { format } from "date-fns"
import { cn } from "@/lib/utils"

interface TimelineEntry {
  date: string
  event: string
  detail: string
}

interface SaleTimelineProps {
  timeline: TimelineEntry[]
}

export function SaleTimeline({ timeline }: SaleTimelineProps) {
  if (!timeline || timeline.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No timeline events recorded.</p>
    )
  }

  return (
    <ol className="relative border-l border-border pl-6 space-y-6">
      {timeline.map((entry, index) => {
        const isLast = index === timeline.length - 1
        const isFirst = index === 0
        return (
          <li key={index} className="relative">
            {/* Circle marker */}
            <span
              className={cn(
                "absolute -left-[1.625rem] flex h-5 w-5 items-center justify-center rounded-full ring-2 ring-background",
                isFirst
                  ? "bg-primary"
                  : isLast
                    ? "bg-muted border border-border"
                    : "bg-primary/60",
              )}
            >
              {isFirst && (
                <span className="h-2 w-2 rounded-full bg-primary-foreground" />
              )}
            </span>

            {/* Content */}
            <div className="space-y-0.5">
              <time className="text-xs font-normal text-muted-foreground">
                {(() => {
                  try {
                    return format(new Date(entry.date), "dd MMM yyyy")
                  } catch {
                    return entry.date
                  }
                })()}
              </time>
              <p className="text-sm font-normal leading-tight">{entry.event}</p>
              {entry.detail && (
                <p className="text-xs font-normal text-muted-foreground">{entry.detail}</p>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
