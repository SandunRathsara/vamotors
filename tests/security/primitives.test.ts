// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  A,
  B,
  C,
  bounded,
  minor,
  parseMajor,
  major,
  roundRatio,
  tierDays,
  sum,
  commission,
  cashTotals,
} from "../../lib/money"
import { transition, effectiveAvailable, states } from "../../lib/state"
import {
  abilityFor,
  project,
  requireFields,
  grantSchema,
  readScope,
} from "../../lib/server/permissions"
import { canonical, inputDigest } from "../../lib/server/idempotency"
import { envelopeSchema } from "../../lib/server/validators"
import { runtimeConfig } from "../../lib/server/config"
import type { Grant } from "../../.planning/implementation/contracts/api"

const uid = "03000000-0000-4000-8000-000000000011"
describe("adopted M1/S1 primitives (pure checks, NOT DB acceptance)", () => {
  it("preserves exact wide money, canonical wire and inclusive bounds", () => {
    expect(parseMajor("21474836.48")).toBe("2147483648")
    expect(minor(A.toString())).toBe(A)
    expect(major(B)).toBe("92233720368547758.07")
    expect(minor(C.toString(), C)).toBe(C)
    for (const input of ["01", "-0", "1e3", "+1", "1.0", " 1", "-1"])
      expect(() => minor(input)).toThrow()
    expect(() => minor((A + 1n).toString())).toThrow("MONEY_OVERFLOW")
    expect(() => sum([B, 1n])).toThrow("MONEY_OVERFLOW")
    expect(() => bounded(-B - 1n)).toThrow("MONEY_OVERFLOW")
    expect(parseMajor("-0.00")).toBe("0")
    expect(() => parseMajor("1.001")).toThrow()
    expect(
      cashTotals([
        { direction: "IN", amount: "100" },
        { direction: "OUT", amount: "60" },
      ])
    ).toEqual({ incoming: "100", outgoing: "60", net: "40" })
  })
  it("matches independent quotient/remainder rounding and exact tier boundaries", () => {
    for (let n = -1000n; n <= 1000n; n++)
      for (let d = 1n; d <= 17n; d++) {
        const a = n < 0n ? -n : n
        const q = a / d
        const r = a % d
        const expected = (n < 0n ? -1n : 1n) * (q + (r * 2n >= d ? 1n : 0n))
        expect(roundRatio(n, d)).toBe(expected)
      }
    expect(commission(110n, 500)).toBe(6n)
    expect(
      [500n, 501n, 1000n, 1001n, 1500n, 1501n].map((v) => tierDays(v, 10000n))
    ).toEqual([7, 14, 14, 21, 21, 31])
    expect(() => tierDays(0n, 100n)).toThrow()
  })
  it("retains ten states and does not allow unsupported edges/evidence", () => {
    expect(states).toHaveLength(10)
    expect(
      transition("IN_STOCK", "completeImmediate", {
        available: true,
        completion: true,
        handover: true,
      })
    ).toBe("SOLD")
    expect(() =>
      transition("IN_STOCK", "completeImmediate", { available: true })
    ).toThrow("INVALID_STATE")
    expect(() => transition("DELIVERED", "normalizeDelivered")).toThrow(
      "DELIVERED_WITHOUT_COMPLETION"
    )
    expect(() => transition("SOLD", "receiveStock")).toThrow("INVALID_STATE")
    expect(
      effectiveAvailable({
        state: "ADVANCE_EXPIRED",
        openCycle: true,
        staffAvailable: true,
        openCommitment: true,
        openRepair: false,
      })
    ).toBe(false)
  })
})

describe("actual CASL grant union and record/field projection", () => {
  const grants: Grant[] = [
    {
      action: "read",
      subject: "Vehicle",
      fields: ["id", "revision", "status"],
    },
    {
      action: "read",
      subject: "Vehicle",
      fields: ["listedPrice", "financial.purchase"],
      conditions: { createdBy: "$actor.id" },
    },
  ]
  const own = {
    id: uid,
    revision: 1,
    status: "IN_STOCK",
    createdBy: uid,
    listedPrice: "200",
    financial: { purchase: "100", originalProfit: "100" },
    password: "never",
  }
  it("combines positive rules per actual row and projects nested leaves", () => {
    const ability = abilityFor(grants, uid)
    const result = project(ability, "Vehicle", own)
    expect(result).toMatchObject({
      id: uid,
      listedPrice: "200",
      financial: { purchase: "100" },
    })
    expect(JSON.stringify(result)).not.toContain('"originalProfit":"100"')
    expect(result).not.toHaveProperty("password")
    const foreign = project(ability, "Vehicle", {
      ...own,
      createdBy: "someone-else",
    })
    expect(foreign).not.toHaveProperty("listedPrice")
    expect(foreign).not.toHaveProperty("financial")
    expect(() =>
      requireFields(
        ability,
        "Vehicle",
        "read",
        { ...own, createdBy: "someone-else" },
        ["listedPrice"]
      )
    ).toThrow("FIELD_FORBIDDEN")
    expect(() =>
      requireFields(ability, "Vehicle", "update", own, ["listedPrice"])
    ).toThrow("FORBIDDEN")
  })
  it("fails closed for unknown rule grammar, empty fields and forbidden sort", () => {
    for (const bad of [
      { action: "read", subject: "User", fields: ["password"] },
      { action: "read", subject: "Vehicle", fields: ["id"], inverted: true },
      {
        action: "read",
        subject: "Vehicle",
        fields: ["id"],
        conditions: { createdBy: { $ne: uid } },
      },
      {
        action: "read",
        subject: "Role",
        fields: ["id"],
        conditions: { status: "IN_STOCK" },
      },
      { action: "pay", subject: "Quote", fields: ["*"] },
    ])
      expect(grantSchema.safeParse(bad).success).toBe(false)
    expect(() =>
      project(
        abilityFor([{ action: "read", subject: "Vehicle", fields: [] }], uid),
        "Vehicle",
        own
      )
    ).toThrow("NOT_FOUND")
    expect(() => readScope(grants, uid, "Vehicle", ["listedPrice"])).toThrow(
      "FIELD_FORBIDDEN"
    )
    expect(readScope([], uid, "User")).toEqual({ OR: [] })
  })
})

describe("strict command/environment boundaries", () => {
  it("canonicalizes key order but retains ordered arrays and keyed secret digest", () => {
    expect(canonical({ b: 2, a: 1 })).toBe(canonical({ a: 1, b: 2 }))
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]))
    expect(inputDigest({ password: "private" }, "one")).not.toBe(
      inputDigest({ password: "private" }, "two")
    )
    expect(() => canonical(1n)).toThrow("INVALID_INPUT")
  })
  it("rejects browser actor/unknown keys, duplicate refs and numeric password", () => {
    const envelope = {
      schemaVersion: 1,
      idempotencyKey: uid,
      expected: [],
      input: {
        name: "Staff",
        email: "staff@example.test",
        password: "only-an-input-specimen",
        roleIds: [uid],
      },
    }
    expect(envelopeSchema("createUser").safeParse(envelope).success).toBe(true)
    expect(
      envelopeSchema("createUser").safeParse({ ...envelope, actor: uid })
        .success
    ).toBe(false)
    expect(
      envelopeSchema("createUser").safeParse({
        ...envelope,
        input: { ...envelope.input, active: true },
      }).success
    ).toBe(false)
    expect(
      envelopeSchema("createUser").safeParse({
        ...envelope,
        input: { ...envelope.input, password: 12345678 },
      }).success
    ).toBe(false)
    const ref = { type: "Role", id: uid, revision: 1 }
    expect(
      envelopeSchema("createUser").safeParse({
        ...envelope,
        expected: [ref, ref],
      }).success
    ).toBe(false)
  })
  it("does not permit missing/migrator/startup-GUC/foreign-origin runtime config", () => {
    const fixture = {
      APP_ENV: "disposable-test",
      ENVIRONMENT_ID: uid,
      DATABASE_URL:
        "postgresql://vamotors_runtime:nonsecret-test-specimen@db.example.test/isolated?sslmode=require",
      APP_ORIGIN: "http://localhost:8000",
      BETTER_AUTH_URL: "http://localhost:8000",
      BETTER_AUTH_SECRET: "nonsecret-config-validation-specimen-only",
    }
    expect(runtimeConfig(fixture).ENVIRONMENT_ID).toBe(uid)
    for (const bad of [
      {},
      { ...fixture, DIRECT_URL: "forbidden" },
      { ...fixture, APP_ENV: "shared-dev" },
      {
        ...fixture,
        DATABASE_URL: `${fixture.DATABASE_URL}&options=statement_timeout%3D5000`,
      },
      { ...fixture, BETTER_AUTH_URL: "https://foreign.example.test" },
    ])
      expect(() => runtimeConfig(bad)).toThrow("ENVIRONMENT_UNAVAILABLE")
  })
})
