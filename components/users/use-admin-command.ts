"use client"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import type {
  Applied,
  Commands,
  Envelope,
} from "@/.planning/implementation/contracts/api"
import { privateRequest, RequestError } from "@/lib/security-client"

export function useAdminCommand() {
  const queries = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [stale, setStale] = useState(false)
  async function run<
    N extends "createUser" | "updateUser" | "saveRole" | "archiveRole",
  >(name: N, envelope: Envelope<Commands[N]>) {
    setPending(true)
    setError("")
    try {
      // Deliberately not useMutation: creation passwords never enter its cache.
      await privateRequest<Applied>(`/api/v1/commands/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(envelope),
      })
      await queries.invalidateQueries()
      window.dispatchEvent(new Event("auth-check"))
      return true
    } catch (error) {
      const code = error instanceof RequestError ? error.code : "NETWORK_ERROR"
      setStale(["STALE_REVISION", "REVISION_REQUIRED"].includes(code))
      setError(
        `${code}. Changes are not confirmed. Your form is retained; retry unchanged after a network error, or refresh revisions and explicitly reconfirm.`
      )
      return false
    } finally {
      setPending(false)
    }
  }
  return {
    run,
    pending,
    error,
    stale,
    reconfirm: () => {
      setStale(false)
      setError("")
    },
  }
}
