import { useQuery } from "@tanstack/react-query"
import { privateRequest } from "@/lib/security-client"

// ── useEntityQuery ────────────────────────────────────────────────────────────

/**
 * Generic hook for paginated/filtered list queries.
 * Builds a query string from `params`, omitting undefined/null values.
 */
export function useEntityQuery<T>(
  entityKey: string,
  endpoint: string,
  params: Record<string, string | number | undefined | null>
) {
  const queryString = Object.entries(params)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
    )
    .join("&")

  const url = queryString ? `${endpoint}?${queryString}` : endpoint

  return useQuery<T>({
    queryKey: [entityKey, params],
    queryFn: ({ signal }) => privateRequest<T>(url, { signal }),
    staleTime: 0,
  })
}

// ── useEntityDetail ───────────────────────────────────────────────────────────

/**
 * Generic hook for single-record detail fetches.
 */
export function useEntityDetail<T>(
  entityKey: string,
  endpoint: string,
  id: string
) {
  return useQuery<T>({
    queryKey: [entityKey, id],
    queryFn: ({ signal }) => privateRequest<T>(`${endpoint}/${id}`, { signal }),
    staleTime: 0,
    enabled: Boolean(id),
  })
}
