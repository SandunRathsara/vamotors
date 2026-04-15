/**
 * Integer-cents money helper.
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
    throw new TypeError(`toCents expected string, got ${typeof amount}`);
  }
  const trimmed = amount.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new RangeError(`toCents: invalid amount "${amount}"`);
  }
  const [whole, frac = ""] = trimmed.split(".");
  const paddedFrac = (frac + "00").slice(0, 2);
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeAbs = whole.replace(/^-/, "");
  const result = sign * (parseInt(wholeAbs, 10) * 100 + parseInt(paddedFrac, 10));
  // Normalize negative-zero: `-0 === 0` is true, but `Object.is(-0, 0)` is
  // false and JSON.stringify flattens `-0` to `"0"`. The asymmetry can leak
  // into fixture diffs, sort order, and equality assertions.
  return result === 0 ? 0 : result;
}

/** Convert integer cents into a plain decimal string with 2 fraction digits. */
export function fromCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`fromCents: expected integer, got ${cents}`);
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

/** Add integer-cent amounts. Rejects non-integers so float drift cannot sneak in. */
export function addCents(...amounts: number[]): number {
  let total = 0;
  for (const a of amounts) {
    if (!Number.isInteger(a)) {
      throw new RangeError(`addCents: expected integer, got ${a}`);
    }
    total += a;
  }
  return total;
}

/** Format integer cents as a display string with thousands separators. */
export function formatCents(cents: number, locale = "en-US"): string {
  if (!Number.isInteger(cents)) {
    throw new RangeError(`formatCents: expected integer, got ${cents}`);
  }
  return (cents / 100).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
