import { describe, it, expect } from "vitest"
import {
  settingsInput,
  financeInput,
  partySelector,
  partyEnvelope,
  moneyInput,
} from "@/lib/server/validators"
import {
  abilityFor,
  grantSchema,
  registryVersion,
} from "@/lib/server/permissions"
import { subject } from "@casl/ability"

export const syntheticSettings = {
  company: {
    name: "Synthetic",
    identity: "DEV",
    address: "Synthetic address",
    phone: "0112345678",
    email: "dev@example.invalid",
  },
  declarations: ["Synthetic development only"],
  currency: "LKR",
  scale: 2 as const,
  timezone: "Asia/Colombo",
  tiers: [
    { upperBps: 500, days: 7 },
    { upperBps: 1000, days: 14 },
    { upperBps: 1500, days: 21 },
    { upperBps: null, days: 31 },
  ],
  warningLeadDays: 3,
  processingFee: "250000",
  dateFormat: "YYYY-MM-DD",
  itemsPerPage: 20,
  theme: "SYSTEM",
}
describe("Settings and finance trust boundaries", () => {
  it("parses only bounded canonical nonnegative minor-unit strings without throwing", () => {
    for (const value of ["0", "1", "9999999999999", "99999999999999"])
      expect(moneyInput.safeParse(value)).toEqual({
        success: true,
        data: value,
      })
    for (const value of [
      "abc",
      "1.5",
      "1e2",
      "",
      " ",
      "+1",
      "-1",
      "-0",
      "01",
      "00",
      "1\n",
      "\n1",
      "1 ",
      "1\r\n",
      "０",
      "١",
      "0x10",
      "NaN",
      "Infinity",
      "100000000000000",
      "9".repeat(1000),
      0,
      1,
      null,
      undefined,
      {},
      [],
    ]) {
      expect(() => moneyInput.safeParse(value)).not.toThrow()
      expect(moneyInput.safeParse(value).success).toBe(false)
    }
  })
  it("validates the complete strict Settings object, not only fee", () => {
    expect(settingsInput.safeParse(syntheticSettings).success).toBe(true)
    for (const patch of [
      { company: { ...syntheticSettings.company, identity: "" } },
      { declarations: [""] },
      { currency: "XXX" },
      { currency: "JPY" },
      { scale: 3 },
      { timezone: "not/a-zone" },
      { tiers: [{ upperBps: null, days: 0 }] },
      { tiers: [{ upperBps: 500, days: 7 }] },
      {
        tiers: [
          { upperBps: 500, days: 7 },
          { upperBps: 500, days: 14 },
          { upperBps: null, days: 31 },
        ],
      },
      { warningLeadDays: 8 },
      { processingFee: "100000000000000" },
      { processingFee: "01" },
      { dateFormat: "US" },
      { itemsPerPage: 5 },
      { theme: "OTHER" },
      { revision: 1 },
    ])
      expect(
        settingsInput.safeParse({ ...syntheticSettings, ...patch }).success
      ).toBe(false)
  })
  it("requires exact typed identity without guessing", () => {
    const selector = {
      type: "SUPPLIER",
      id: "03000000-0000-4000-8000-000000000001",
    }
    expect(partySelector.safeParse(selector).success).toBe(true)
    for (const input of [
      { id: selector.id },
      { type: "SUPPLIER", id: "bad" },
      { ...selector, q: "guess" },
      { ...selector, type: ["SUPPLIER"] },
    ])
      expect(partySelector.safeParse(input).success).toBe(false)
  })
  it("keeps both existing commission variants strict with no contact IDs", () => {
    const values = {
      name: "Synthetic finance",
      contacts: [],
      policy: {
        path: "APPLICATION",
        commission: { basis: "FIXED", fixed: "99999999999999", rateBps: 10000 },
        processingFee: "0",
        reconciliationMethod: "PER_DEAL",
      },
    }
    expect(financeInput.safeParse(values).success).toBe(true)
    for (const commission of [
      { basis: "FIXED", fixed: "1" },
      { basis: "FINANCED_PRINCIPAL", rateBps: 10001 },
      { basis: "FINANCED_PRINCIPAL", rateBps: 1, fixed: "1" },
    ])
      expect(
        financeInput.safeParse({
          ...values,
          policy: { ...values.policy, commission },
        }).success
      ).toBe(false)
    expect(
      financeInput.safeParse({
        ...values,
        contacts: [
          {
            id: "foreign",
            name: "Contact",
            phone: "0112345678",
            role: "Agent",
            primary: true,
          },
        ],
      }).success
    ).toBe(false)
  })
  it("has explicit Settings updates and independently grantable policy leaves", () => {
    expect(registryVersion).toBe(16)
    expect(
      grantSchema.safeParse({
        subject: "Settings",
        action: "update",
        fields: ["*"],
      }).success
    ).toBe(true)
    const ability = abilityFor(
      [
        { subject: "Settings", action: "read", fields: ["id", "revision"] },
        {
          subject: "FinanceCompany",
          action: "read",
          fields: ["id", "policy.path"],
          conditions: { createdBy: "$actor.id" },
        },
      ],
      "a"
    )
    expect(ability.can("read", "Settings", "processingFee")).toBe(false)
    expect(
      ability.can(
        "read",
        subject("FinanceCompany", { createdBy: "a" }),
        "policy.path"
      )
    ).toBe(true)
    expect(
      ability.can(
        "read",
        subject("FinanceCompany", { createdBy: "b" }),
        "policy.path"
      )
    ).toBe(false)
    expect(ability.can("read", "FinanceCompany", "policy.processingFee")).toBe(
      false
    )
  })
  it("rejects duplicated dependencies and invented input metadata", () => {
    const ref = {
      type: "Settings",
      id: "03000000-0000-4000-8000-000000000001",
      revision: 1,
    }
    const body = {
      schemaVersion: 1,
      idempotencyKey: ref.id,
      expected: [ref, ref],
      input: {
        name: "Synthetic",
        contacts: [],
        policy: {
          path: "REFERRAL",
          commission: { basis: "FINANCED_PRINCIPAL", rateBps: 0 },
          processingFee: "0",
          reconciliationMethod: "PER_DEAL",
        },
      },
    }
    expect(partyEnvelope("createFinanceCompany").safeParse(body).success).toBe(
      false
    )
    expect(
      partyEnvelope("createFinanceCompany").safeParse({
        ...body,
        expected: [ref],
      }).success
    ).toBe(true)
  })
})
