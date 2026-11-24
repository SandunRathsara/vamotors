"use client"

export class RequestError extends Error {
  constructor(
    public code: string,
    public status: number,
    message = code
  ) {
    super(message)
  }
}

export async function privateRequest<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
  })
  if (!response.ok) {
    if ([401, 403].includes(response.status)) {
      window.dispatchEvent(new Event("access-lost"))
    }
    const body = await response.json().catch(() => null)
    throw new RequestError(
      body?.error?.code ?? "REQUEST_FAILED",
      response.status,
      body?.error?.message
    )
  }
  return response.json() as Promise<T>
}

export function safeReturnPath(value: string | null) {
  // Explicit page allowlist: no external, protocol-relative, API or encoded paths.
  return value && /^\/(dashboard|users)$/.test(value) ? value : "/dashboard"
}
