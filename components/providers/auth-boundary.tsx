"use client"

import {
  Activity,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { flushSync } from "react-dom"
import { useQueryClient } from "@tanstack/react-query"
import type { CurrentActorDTO } from "@/.planning/implementation/contracts/api"
import { privateRequest, RequestError } from "@/lib/security-client"

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
  const [context, setContext] = useState(initial)
  const current = useRef(initial)
  const [ready, setReady] = useState(false)
  const [verified, setVerified] = useState(false)
  useEffect(() => {
    let alive = true
    let checking = false
    let obscured = document.hidden
    const channel = new BroadcastChannel("vamotors-auth")
    const hide = () => {
      // Flush before the browser can paint or move focus into a private portal.
      flushSync(() => setReady(false))
    }
    const obscure = () => {
      obscured = true
      hide()
    }
    const discard = () => {
      alive = false
      flushSync(() => {
        setReady(false)
        setVerified(false)
      })
      void queries.cancelQueries()
      queries.clear()
    }
    const leave = () => {
      discard()
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
          data.user.id !== current.current.actor.user.id ||
          data.authzRevision !== current.current.actor.authzRevision
        ) {
          const sameMembership =
            data.user.id === current.current.actor.user.id &&
            JSON.stringify(data.roles.map((r) => r.id).sort()) ===
              JSON.stringify(
                current.current.actor.roles.map((r) => r.id).sort()
              )
          if (
            sameMembership &&
            ["/lease-rate-sheets", "/lease-comparison"].includes(
              window.location.pathname
            )
          ) {
            // Preserve exact-request drafts, never the old read authority.
            await queries.cancelQueries()
            queries.clear()
            current.current = { ...current.current, actor: data }
            setContext(current.current)
          } else {
            discard()
            window.location.reload()
            return
          }
        }
        setReady(!obscured)
        setVerified(true)
      } catch (error) {
        if (alive) {
          if (
            error instanceof RequestError &&
            [401, 403].includes(error.status)
          )
            leave()
          else setReady(false) // Retain hidden Activity/drafts during transient verification failure.
        }
      } finally {
        checking = false
      }
    }
    const visible = () => {
      hide()
      obscured = document.hidden
      if (!obscured) void check()
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
    window.addEventListener("pagehide", obscure)
    window.addEventListener("pageshow", pageShow)
    window.addEventListener("focus", visible)
    window.addEventListener("blur", obscure)
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
      window.removeEventListener("pagehide", obscure)
      window.removeEventListener("pageshow", pageShow)
      window.removeEventListener("focus", visible)
      window.removeEventListener("blur", obscure)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [initial, queries])
  return (
    <AuthContext.Provider value={context}>
      {!ready && (
        <p role="status" className="p-6">
          Checking access…
        </p>
      )}
      {/* Activity preserves drafts while cleaning up portaled DOM/focus scopes. */}
      <Activity mode={ready ? "visible" : "hidden"}>
        {verified ? children : null}
      </Activity>
    </AuthContext.Provider>
  )
}
