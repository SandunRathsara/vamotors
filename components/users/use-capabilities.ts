"use client"
import { subject } from "@casl/ability"
import { useActor } from "@/components/providers/auth-boundary"
import { abilityFor } from "@/lib/server/permissions"

/** Presentation hints only. HTTP/RSC always reload and enforce current authority. */
export function useCapabilities() {
  const { actor, administrator } = useActor()
  const ability = abilityFor(actor.presentationGrants, actor.user.id)
  const can = (
    type: "User" | "Role",
    action: string,
    fields: string[] = [],
    row: object = {}
  ) =>
    ability.can(action, subject(type, row)) &&
    fields.every((f) => ability.can(action, subject(type, row), f))
  return { can, actor, administrator }
}
