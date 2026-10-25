/**
 * Legacy number wrappers serve the unmigrated mock UI only. New business paths
 * use the exact M1 bigint/string functions below (adopted from T01 reference).
 * Per CLAUDE.md: "Store all monetary values as integers (smallest currency unit);
 * divide by 100 only for display." This eliminates IEEE 754 rounding bugs
 * (e.g. 0.1 + 0.2 !== 0.3).
 *
 * All `cents` values here are positive or negative integers representing the
 * smallest currency unit (e.g. 12345 === LKR 123.45 / $123.45).
 */

/** Convert a decimal-string amount (e.g. "123.45") into integer cents. */
export function toCents(amount: string): number {
  if (typeof amount !== "string") {
    throw new TypeError(`toCents expected string, got ${typeof amount}`)
  }
  const trimmed = amount.trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new RangeError(`toCents: invalid amount "${amount}"`)
  }
  const [whole, frac = ""] = trimmed.split(".")
  const paddedFrac = (frac + "00").slice(0, 2)
  const sign = whole.startsWith("-") ? -1 : 1
  const wholeAbs = whole.replace(/^-/, "")
  const result =
    sign * (parseInt(wholeAbs, 10) * 100 + parseInt(paddedFrac, 10))
  // Normalize negative-zero: `-0 === 0` is true, but `Object.is(-0, 0)` is
  // false and JSON.stringify flattens `-0` to `"0"`. The asymmetry can leak
  // into fixture diffs, sort order, and equality assertions.
  if (!Number.isSafeInteger(result)) throw new RangeError("MONEY_OVERFLOW")
  return result === 0 ? 0 : result
}

/** Convert integer cents into a plain decimal string with 2 fraction digits. */
export function fromCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`fromCents: expected integer, got ${cents}`)
  }
  const sign = cents < 0 ? "-" : ""
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = (abs % 100).toString().padStart(2, "0")
  return `${sign}${whole}.${frac}`
}

/** Add integer-cent amounts. Rejects non-integers so float drift cannot sneak in. */
export function addCents(...amounts: number[]): number {
  let total = 0
  for (const a of amounts) {
    if (!Number.isSafeInteger(a)) {
      throw new RangeError(`addCents: expected integer, got ${a}`)
    }
    total += a
    if (!Number.isSafeInteger(total)) throw new RangeError("MONEY_OVERFLOW")
  }
  return total
}

/** Format integer cents as a display string with thousands separators. */
export function formatCents(cents: number, locale = "en-US"): string {
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`formatCents: expected integer, got ${cents}`)
  }
  const value = BigInt(cents)
  const abs = value < 0n ? -value : value
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === "decimal")?.value ?? "."
  return `${value < 0n ? "-" : ""}${(abs / 100n).toLocaleString(locale)}${decimal}${(abs % 100n).toString().padStart(2, "0")}`
}

export const A = 99999999999999n
export const C = 9999999999999999n
export const B = 9223372036854775807n

export function bounded(value: bigint, bound = B): bigint {
  if (typeof value !== "bigint" || value > bound || value < -bound)
    throw new RangeError("MONEY_OVERFLOW")
  return value
}

export function minor(text: string, bound = A, signed = false): bigint {
  if (typeof text !== "string" || !/^(0|[1-9]\d*|-[1-9]\d*)$/.test(text))
    throw new TypeError("INVALID_INPUT")
  const value = bounded(BigInt(text), bound)
  if (!signed && value < 0n) throw new RangeError("INVALID_INPUT")
  return value
}

export function parseMajor(text: string, signed = false): string {
  if (typeof text !== "string") throw new TypeError("INVALID_INPUT")
  const clean = text.trim()
  if (!/^-?\d+(\.\d{1,2})?$/.test(clean)) throw new TypeError("INVALID_INPUT")
  const [whole, fraction = ""] = clean.replace(/^-/, "").split(".")
  const absolute = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))
  const value = bounded(clean.startsWith("-") ? -absolute : absolute, A)
  if (!signed && value < 0n) throw new RangeError("INVALID_INPUT")
  return value.toString()
}

export function major(value: bigint): string {
  bounded(value)
  const abs = value < 0n ? -value : value
  return `${value < 0n ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`
}

export function sum(values: readonly bigint[], bound = B): bigint {
  return bounded(
    values.reduce((total, value) => total + bounded(value, bound), 0n),
    bound
  )
}

export function cashTotals(
  facts: readonly { direction: "IN" | "OUT"; amount: string }[]
) {
  const incoming = sum(
    facts.filter((f) => f.direction === "IN").map((f) => minor(f.amount))
  )
  const outgoing = sum(
    facts.filter((f) => f.direction === "OUT").map((f) => minor(f.amount))
  )
  return {
    incoming: incoming.toString(),
    outgoing: outgoing.toString(),
    net: bounded(incoming - outgoing).toString(),
  }
}

export function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (
    typeof numerator !== "bigint" ||
    typeof denominator !== "bigint" ||
    denominator <= 0n
  )
    throw new RangeError("INVALID_INPUT")
  const abs = numerator < 0n ? -numerator : numerator
  const rounded = (2n * abs + denominator) / (2n * denominator)
  return numerator < 0n ? -rounded : rounded
}

export function commission(basis: bigint, bps: number): bigint {
  bounded(basis, C)
  if (basis < 0n || !Number.isInteger(bps) || bps < 0 || bps > 10000)
    throw new RangeError("INVALID_INPUT")
  return bounded(roundRatio(basis * BigInt(bps), 10000n), C)
}

export function tierDays(advance: bigint, listed: bigint): number {
  bounded(advance, A)
  bounded(listed, A)
  if (advance <= 0n || listed <= 0n) throw new RangeError("INVALID_INPUT")
  return advance * 100n <= listed * 5n
    ? 7
    : advance * 100n <= listed * 10n
      ? 14
      : advance * 100n <= listed * 15n
        ? 21
        : 31
}
