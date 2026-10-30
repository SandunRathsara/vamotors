"use client"

import { useState } from "react"
import type { Applied } from "@/.planning/implementation/contracts/api"
import { RequestError } from "@/lib/security-client"

/** 403 can be a field refusal, not logout. Reverify without destroying a draft. */
export async function rateRequest<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("access-lost"))
    if (response.status === 403) window.dispatchEvent(new Event("auth-check"))
    const body = await response.json().catch(() => null)
    throw new RequestError(
      body?.error?.code ?? "REQUEST_FAILED",
      response.status
    )
  }
  return response.json() as Promise<T>
}
export const postRead = <T,>(name: string, input: unknown) =>
  rateRequest<{ data: T }>(`/api/v1/queries/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

/** One exact serialized request per intent; no automatic new-key retry. */
export function useRateCommand(name: "publishRates" | "selectQuote") {
  const [body, setBody] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [definitive, setDefinitive] = useState(false)
  async function send(
    input: unknown,
    expected: unknown[]
  ): Promise<Applied | null> {
    if (pending) return null
    const request =
      body ??
      JSON.stringify({
        schemaVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        expected,
        input,
      })
    setBody(request)
    setPending(true)
    setError("")
    try {
      const result = await rateRequest<Applied>(`/api/v1/commands/${name}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: request,
      })
      setBody(null)
      return result
    } catch (cause) {
      const code = cause instanceof RequestError ? cause.code : "NETWORK_ERROR"
      const detail =
        name === "publishRates" && code === "IDENTITY_CONFLICT"
          ? " (published validity overlaps an existing sheet)"
          : name === "publishRates" && code === "INVALID_STATE"
            ? " (company is inactive)"
            : ""
      setDefinitive(
        cause instanceof RequestError &&
          cause.status < 500 &&
          cause.status !== 429 &&
          !["COMMAND_IN_PROGRESS", "IDEMPOTENCY_MISMATCH"].includes(code)
      )
      setError(
        `${code}${detail}. Your values and exact request are retained. Retry uses the same key. For a definitive rejection, refresh references and explicitly confirm a new request.`
      )
      return null
    } finally {
      setPending(false)
    }
  }
  return {
    body,
    pending,
    error,
    setError,
    definitive,
    send,
    reconfirm: () => {
      if (!pending && definitive) {
        setBody(null)
        setError("")
        setDefinitive(false)
      }
    },
  }
}
