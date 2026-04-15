import { describe, it, expect } from "vitest";
import { toCents, fromCents, addCents, formatCents } from "./money";

describe("money — integer-cents helpers", () => {
  it("documents why integer cents exist (IEEE 754 float drift)", () => {
    // If this ever starts passing .toBe, JavaScript broke the laws of physics
    // or someone swapped the helper to floats. Either way, stop the build.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  describe("toCents", () => {
    it("converts decimal strings to integer cents", () => {
      expect(toCents("123.45")).toBe(12345);
      expect(toCents("0.10")).toBe(10);
      expect(toCents("0.1")).toBe(10);
      expect(toCents("1")).toBe(100);
    });

    it("handles negatives", () => {
      expect(toCents("-5.00")).toBe(-500);
    });

    it("normalizes negative zero", () => {
      // `-0 === 0` is true, but Object.is(-0, 0) is false. We must return +0
      // so sort order, fixture diffs, and Object.is checks stay consistent.
      expect(Object.is(toCents("-0"), 0)).toBe(true);
      expect(Object.is(toCents("-0.00"), 0)).toBe(true);
      expect(Object.is(toCents("-0.0"), 0)).toBe(true);
    });

    it("rejects invalid input", () => {
      expect(() => toCents("abc")).toThrow(RangeError);
      expect(() => toCents("1.234")).toThrow(RangeError);
    });
  });

  describe("fromCents", () => {
    it("renders integer cents as 2-digit decimal strings", () => {
      expect(fromCents(12345)).toBe("123.45");
      expect(fromCents(5)).toBe("0.05");
      expect(fromCents(-100)).toBe("-1.00");
    });

    it("rejects non-integers", () => {
      expect(() => fromCents(1.5)).toThrow(RangeError);
    });
  });

  describe("addCents", () => {
    it("is float-safe for the classic 0.1 + 0.2 case", () => {
      // This is the whole reason integer cents exist.
      const result = addCents(toCents("0.10"), toCents("0.20"));
      expect(result).toBe(30);
      expect(fromCents(result)).toBe("0.30");
    });

    it("adds any number of integer amounts", () => {
      expect(addCents(10, 20, 30, 40)).toBe(100);
    });

    it("rejects non-integer inputs", () => {
      expect(() => addCents(1, 2.5)).toThrow(RangeError);
    });
  });

  describe("formatCents", () => {
    it("formats with 2 fraction digits", () => {
      const out = formatCents(12345);
      expect(out).toContain("123.45");
    });
  });
});
