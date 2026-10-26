"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type { CurrentActorDTO } from "@/.planning/implementation/contracts/api"
import { privateRequest } from "@/lib/security-client"

type Context = { actor: CurrentActorDTO; administrator: boolean }
const AuthContext = createContext<Context | null>(null)
export function useActor() {
  const context = useContext(AuthContext)
  if (!context) throw new Error("AUTH_CONTEXT_REQUIRED")
  return context
}

export function AuthBoundary({
  initial,
  children,
}: {
  initial: Context
  children: React.ReactNode
}) {
  const queries = useQueryClient()
  const root = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [verified, setVerified] = useState(false)
  useEffect(() => {
    let alive = true
    let checking = false
    const channel = new BroadcastChannel("vamotors-auth")
    const hide = () => {
      if (root.current) root.current.hidden = true
      setReady(false)
    }
    const leave = () => {
      hide()
      setVerified(false)
      void queries.cancelQueries()
      queries.clear()
      window.location.replace("/login?reason=access-changed")
    }
    const check = async () => {
      if (checking || !alive) return
      checking = true
      try {
        const { data } = await privateRequest<{ data: CurrentActorDTO }>(
          "/api/v1/queries/currentActor"
        )
        if (!alive) return
        if (
          data.user.id !== initial.actor.user.id ||
          data.authzRevision !== initial.actor.authzRevision
        ) {
          hide()
          void queries.cancelQueries()
          queries.clear()
          window.location.reload()
          return
        }
        setReady(true)
        setVerified(true)
        if (root.current) root.current.hidden = false
      } catch {
        if (alive) leave()
      } finally {
        checking = false
      }
    }
    const visible = () => {
      hide()
      if (!document.hidden) void check()
    }
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        hide()
        window.location.reload()
      } else void check()
    }
    channel.onmessage = leave
    window.addEventListener("access-lost", leave)
    const recheck = () => {
      hide()
      void check()
    }
    window.addEventListener("auth-check", recheck)
    window.addEventListener("pagehide", hide)
    window.addEventListener("pageshow", pageShow)
    window.addEventListener("focus", visible)
    window.addEventListener("blur", hide)
    document.addEventListener("visibilitychange", visible)
    const timer = window.setInterval(() => {
      if (!document.hidden) void check()
    }, 3000)
    void check()
    return () => {
      alive = false
      clearInterval(timer)
      channel.close()
      window.removeEventListener("access-lost", leave)
      window.removeEventListener("auth-check", recheck)
      window.removeEventListener("pagehide", hide)
      window.removeEventListener("pageshow", pageShow)
      window.removeEventListener("focus", visible)
      window.removeEventListener("blur", hide)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [initial, queries])
  return (
    <AuthContext.Provider value={initial}>
      {!ready && (
        <p role="status" className="p-6">
          Checking access…
        </p>
      )}
      <div ref={root} hidden={!ready}>
        {verified ? children : null}
      </div>
    </AuthContext.Provider>
  )
}
