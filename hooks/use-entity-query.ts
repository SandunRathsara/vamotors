import { useQuery } from "@tanstack/react-query"

// ── useEntityQuery ────────────────────────────────────────────────────────────

/**
 * Generic hook for paginated/filtered list queries.
 * Builds a query string from `params`, omitting undefined/null values.
 */
export function useEntityQuery<T>(
  entityKey: string,
  endpoint: string,
  params: Record<string, string | number | undefined | null>,
) {
  const queryString = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&")

  const url = queryString ? `${endpoint}?${queryString}` : endpoint

  return useQuery<T>({
    queryKey: [entityKey, params],
    queryFn: async () => {
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Failed to fetch ${entityKey}: ${res.status} ${res.statusText}`)
      }
      return res.json() as Promise<T>
    },
    staleTime: 30_000,
  })
}

// ── useEntityDetail ───────────────────────────────────────────────────────────

/**
 * Generic hook for single-record detail fetches.
 */
export function useEntityDetail<T>(
  entityKey: string,
  endpoint: string,
  id: string,
) {
  return useQuery<T>({
    queryKey: [entityKey, id],
    queryFn: async () => {
      const res = await fetch(`${endpoint}/${id}`)
      if (!res.ok) {
        throw new Error(
          `Failed to fetch ${entityKey} (id: ${id}): ${res.status} ${res.statusText}`,
        )
      }
      return res.json() as Promise<T>
    },
    staleTime: 30_000,
    enabled: Boolean(id),
  })
}
