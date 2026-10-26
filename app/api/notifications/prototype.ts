import { NextRequest, NextResponse } from "next/server"
import { notificationsStore } from "@/lib/mock-store"
import { injectLatency } from "@/lib/utils"

export async function GET() {
  await injectLatency()

  const all = notificationsStore.getAll().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const unreadCount = all.filter((n) => !n.isRead).length

  return NextResponse.json({
    data: all,
    total: all.length,
    unreadCount,
  })
}

export async function PATCH(request: NextRequest) {
  await injectLatency()

  const body = await request.json()

  if (body.markAllRead === true) {
    const all = notificationsStore.getAll()
    for (const n of all) {
      notificationsStore.update(n.id, { ...n, isRead: true })
    }
  } else if (typeof body.id === "string") {
    const existing = notificationsStore.getById(body.id)
    if (!existing) {
      return NextResponse.json({ error: "Notification not found" }, { status: 404 })
    }
    notificationsStore.update(body.id, { ...existing, isRead: body.isRead ?? existing.isRead })
  } else {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 })
  }

  const updated = notificationsStore.getAll().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  const unreadCount = updated.filter((n) => !n.isRead).length

  return NextResponse.json({
    data: updated,
    total: updated.length,
    unreadCount,
  })
}
