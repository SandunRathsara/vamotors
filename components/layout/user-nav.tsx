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
      // The auth boundary owns local teardown/navigation too. Its channel also
      // receives this page's broadcast; one owner avoids competing replacements.
      window.dispatchEvent(new Event("access-lost"))
    } catch {
      setError("Logout failed. Please retry.")
      setPending(false)
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
      <span className="max-w-20 min-w-0 truncate sm:max-w-32">
        {actor.user.name}
      </span>
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => void logout()}
        disabled={pending}
      >
        {pending ? "Signing out…" : "Logout"}
      </Button>
      {error && <span role="alert">{error}</span>}
    </div>
  )
}
