"use client"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { useActor } from "@/components/providers/auth-boundary"
import { privateRequest } from "@/lib/security-client"

export function UserNav() {
  const { actor } = useActor()
  const queries = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  async function logout() {
    setPending(true)
    await queries.cancelQueries()
    queries.clear()
    try {
      await privateRequest("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
      const channel = new BroadcastChannel("vamotors-auth")
      channel.postMessage("changed")
      channel.close()
      window.location.replace("/login")
    } catch {
      setError("Logout failed. Please retry.")
      setPending(false)
    }
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="max-w-32 truncate">{actor.user.name}</span>
      <Button
        variant="outline"
        onClick={() => void logout()}
        disabled={pending}
      >
        {pending ? "Signing out…" : "Logout"}
      </Button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
