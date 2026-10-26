import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { privateRequest } from "@/lib/security-client"

// ── Options ───────────────────────────────────────────────────────────────────

interface UseEntityMutationOptions {
  /** Query key to invalidate on success (e.g. "vehicles") */
  entityKey: string
  /** API endpoint — method + id appended by caller via mutationFn input */
  endpoint: string
  /** HTTP method */
  method: "POST" | "PATCH" | "DELETE"
  /** Sonner success message shown on success */
  successMessage: string
  /** Sonner error message shown on failure. Default: "Something went wrong. Your changes were not saved." */
  errorMessage?: string
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Generic mutation hook for create / update / delete operations.
 *
 * Usage:
 *   const { mutate } = useEntityMutation({
 *     entityKey: "vehicles",
 *     endpoint: "/api/vehicles",
 *     method: "POST",
 *     successMessage: "Purchase recorded. Vehicle added to inventory.",
 *   })
 *   mutate({ make: "Toyota", ... })
 *
 * For PATCH/DELETE, caller can include `id` in the body; the hook uses the
 * base endpoint. For routes like /api/vehicles/:id, the caller may pass
 * endpoint: `/api/vehicles/${id}` directly.
 */
export function useEntityMutation<TData = unknown, TVariables = unknown>({
  entityKey,
  endpoint,
  method,
  successMessage,
  errorMessage = "Something went wrong. Your changes were not saved.",
}: UseEntityMutationOptions) {
  const queryClient = useQueryClient()

  return useMutation<TData, Error, TVariables>({
    mutationFn: async (variables: TVariables) => {
      return privateRequest<TData>(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method !== "DELETE" ? JSON.stringify(variables) : undefined,
      })
    },
    onSuccess: () => {
      toast.success(successMessage)
      void queryClient.invalidateQueries({ queryKey: [entityKey] })
    },
    onError: () => {
      toast.error(errorMessage)
    },
  })
}
