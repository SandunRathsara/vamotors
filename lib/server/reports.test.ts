import { describe, expect, it, vi } from "vitest"
import { reportFilter } from "./reports"
import { abilityFor } from "./permissions"
vi.mock("server-only", () => ({}))

describe("report filters", () => {
  it("uses inclusive reporting dates and rejects impossible/reversed ranges", () => {
    expect(
      reportFilter(
        new URLSearchParams("kind=SOLD&from=2026-11-24&through=2026-11-24")
      ).from
    ).toBe("2026-11-24")
    for (const input of [
      "kind=SOLD&from=2026-02-30",
      "kind=SOLD&from=2026-11-24&through=2026-11-23",
    ])
      expect(() => reportFilter(new URLSearchParams(input))).toThrow(
        "INVALID_INPUT"
      )
  })

  it("rejects duplicate, irrelevant and contradictory filters", () => {
    for (const input of [
      "kind=SOLD&kind=INVENTORY",
      "kind=REPAIRS&available=false",
      "kind=PROFIT&profitOnly=true&lossOnly=true",
    ])
      expect(() => reportFilter(new URLSearchParams(input))).toThrow(
        "INVALID_INPUT"
      )
  })
})

describe("report capabilities", () => {
  it("keeps per-report read and export grants independent", () => {
    const actor = abilityFor(
      [{ subject: "Report", action: "read", fields: ["INVENTORY"] }],
      "actor"
    )
    expect(actor.can("read", "Report", "INVENTORY")).toBe(true)
    expect(actor.can("read", "Report", "SOLD")).toBe(false)
    expect(actor.can("export", "Report", "INVENTORY")).toBe(false)
  })
})
