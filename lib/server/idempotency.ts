import { createHmac } from "node:crypto"
import { fail } from "./errors"

export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value)
  if (typeof value === "number" && Number.isSafeInteger(value))
    return String(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`
  fail("INVALID_INPUT", 422)
}
/** Keyed for ALL envelopes, especially password-bearing createUser. */
export function inputDigest(value: unknown, secret: string): string {
  return createHmac("sha256", secret)
    .update("command:v1\0")
    .update(canonical(value))
    .digest("hex")
}
