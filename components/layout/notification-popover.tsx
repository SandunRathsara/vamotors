"use client"
import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { Bell } from "lucide-react"
import type {
  Applied,
  NotificationDTO,
  Visible,
} from "@/.planning/implementation/contracts/api"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"
import { privateRequest, RequestError } from "@/lib/security-client"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function NotificationPopover() {
  const { actor } = useActor(),
    queries = useQueryClient(),
    ability = abilityFor(actor.presentationGrants, actor.user.id)
  const [message, setMessage] = useState(""),
    [pending, setPending] = useState(false)
  const intents = useRef(new Map<string, string>())
  const query = useQuery({
    queryKey: ["notifications"],
    enabled: ability.can("read", "Notification"),
    retry: false,
    refetchInterval: 15000,
    refetchIntervalInBackground: false,
    queryFn: () =>
      privateRequest<{
        data: {
          data: Visible<NotificationDTO>[]
          unreadCount: number
          asOf: string
        }
      }>("/api/v1/queries/notifications?page=1&pageSize=20"),
  })
  async function read(row?: Visible<NotificationDTO>) {
    if (pending) return
    const key = row?.id ?? "all",
      name = row ? "markNotificationRead" : "markAllNotificationsRead"
    setPending(true)
    setMessage("")
    try {
      let body = intents.current.get(key)
      if (!body) {
        if (row && (!row.id || !row.revision))
          throw Error("Readable notification reference required")
        body = JSON.stringify({
          schemaVersion: 1,
          idempotencyKey: crypto.randomUUID(),
          expected: row
            ? [{ type: "Notification", id: row.id, revision: row.revision }]
            : [],
          input: row
            ? { notificationId: row.id }
            : { through: query.data?.data.asOf ?? new Date().toISOString() },
        })
        intents.current.set(key, body)
      }
      await privateRequest<Applied>(`/api/v1/commands/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
      intents.current.delete(key)
      setMessage("Read state committed.")
      void queries.invalidateQueries({ queryKey: ["notifications"] })
    } catch (error) {
      if (
        error instanceof RequestError &&
        ["STALE_REVISION", "REVISION_REQUIRED"].includes(error.code)
      )
        intents.current.delete(key)
      setMessage(
        error instanceof RequestError
          ? error.code
          : error instanceof Error
            ? error.message
            : "NETWORK_ERROR"
      )
    } finally {
      setPending(false)
    }
  }
  if (!ability.can("read", "Notification")) return null
  const rows = query.data?.data.data ?? [],
    count = query.data?.data.unreadCount
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${count === undefined ? "" : `, ${count} unread`}`}
          className="relative h-11 w-11"
        >
          <Bell className="h-4 w-4" />
          {count !== undefined && count > 0 && (
            <span className="absolute top-0 right-0 rounded bg-primary px-1 text-xs text-primary-foreground">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] space-y-3"
      >
        <h2 className="font-semibold">Notifications</h2>
        {query.isPending && <p role="status">Loading recipient inbox…</p>}
        {query.isError && (
          <p role="alert">
            Inbox unavailable.{" "}
            {query.error instanceof RequestError
              ? query.error.code
              : "Request failed"}{" "}
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry inbox
            </Button>
          </p>
        )}
        {query.data && (
          <>
            <p>{count} unread</p>
            {ability.can("update", "Notification") && (
              <Button
                variant="outline"
                disabled={pending || count === 0}
                onClick={() => void read()}
              >
                Mark all as read
              </Button>
            )}
            <ul className="max-h-80 space-y-3 overflow-y-auto">
              {rows.map((n) => (
                <li key={n.id} className="space-y-2 rounded border p-3">
                  {n.target?.href ? (
                    <Link
                      prefetch={false}
                      className="inline-flex min-h-11 items-center underline"
                      href={n.target.href}
                    >
                      {n.title ?? "Open notification"}
                    </Link>
                  ) : (
                    <p>{n.title ?? "Target unavailable"}</p>
                  )}
                  <p>{n.body}</p>
                  <p className="text-sm text-muted-foreground">{n.createdAt}</p>
                  {n.readAt === null &&
                    ability.can("update", "Notification") && (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() => void read(n)}
                      >
                        Mark notification read
                      </Button>
                    )}
                </li>
              ))}
            </ul>
            {rows.length === 0 && <p>No visible notifications.</p>}
          </>
        )}
        {message && (
          <p role="alert" className="break-words">
            {message}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
