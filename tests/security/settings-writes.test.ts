import { describe, it, expect } from "vitest"
import { settingsCommand, settingsEnvelope } from "@/lib/server/validators"
import {
  abilityFor,
  fieldsFor,
  project,
  attenuation,
  administratorGrants,
} from "@/lib/server/permissions"
const syntheticSettings = {
  company: {
    name: "Synthetic",
    identity: "DEV",
    address: "Synthetic address",
    phone: "0112345678",
    email: "dev@example.invalid",
  },
  declarations: ["Synthetic only"],
  currency: "LKR",
  scale: 2,
  timezone: "Asia/Colombo",
  tiers: [
    { upperBps: 500, days: 7 },
    { upperBps: null, days: 31 },
  ],
  warningLeadDays: 3,
  processingFee: "250000",
  dateFormat: "YYYY-MM-DD",
  itemsPerPage: 20,
  theme: "SYSTEM",
}

const id = "03000000-0000-4000-8000-000000000001"
const input = { ...syntheticSettings, reason: "Synthetic policy correction" }
describe("Settings full replacement write boundary", () => {
  it("requires complete strict business fields and reason, never metadata", () => {
    expect(settingsCommand.safeParse(input).success).toBe(true)
    for (const key of Object.keys(input)) {
      const missing = { ...input } as Record<string, unknown>
      delete missing[key]
      expect(settingsCommand.safeParse(missing).success, key).toBe(false)
    }
    for (const key of [
      "id",
      "revision",
      "policyVersion",
      "effectiveAt",
      "currentVersionId",
      "createdBy",
      "values",
    ])
      expect(settingsCommand.safeParse({ ...input, [key]: id }).success).toBe(
        false
      )
    expect(settingsCommand.safeParse({ ...input, reason: " " }).success).toBe(
      false
    )
    expect(
      settingsCommand.safeParse({
        ...input,
        company: { ...input.company, hidden: "no" },
      }).success
    ).toBe(false)
  })
  it("uses existing strict envelope with unique required-ref shape", () => {
    const ref = { type: "Settings", id, revision: 17 }
    const body = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [ref],
      input,
    }
    expect(settingsEnvelope.safeParse(body).success).toBe(true)
    expect(
      settingsEnvelope.safeParse({ ...body, expected: [ref, ref] }).success
    ).toBe(false)
    expect(
      settingsEnvelope.safeParse({
        ...body,
        expected: [{ ...ref, policyVersion: 1 }],
      }).success
    ).toBe(false)
  })
  it("keeps read wildcards/compound coverage and delegation ceilings read-only", () => {
    const ceiling = [
      { subject: "Settings" as const, action: "read" as const, fields: ["*"] },
    ]
    const ability = abilityFor(ceiling, id)
    expect(ability.can("update", "Settings")).toBe(false)
    expect(
      attenuation(
        ceiling,
        [],
        [{ subject: "Settings", action: "update", fields: ["company.name"] }],
        id
      ).covered
    ).toBe(false)
    for (const key of [
      "id",
      "revision",
      "policyVersion",
      "reason",
      "effectiveAt",
      "currentVersionId",
    ])
      expect(fieldsFor("Settings", "update")).not.toContain(key)
    const grant = administratorGrants.find(
      (g) => g.subject === "Settings" && g.action === "update"
    )!
    expect(grant.fields).not.toContain("*")
    expect(grant.fields).not.toContain("company")
  })
  it("projects individual company leaves without siblings or inferred update", () => {
    const ability = abilityFor(
      [
        {
          subject: "Settings",
          action: "read",
          fields: ["id", "revision", "company.name"],
        },
      ],
      id
    )
    const visible = project(ability, "Settings", {
      ...syntheticSettings,
      id,
      revision: 17,
      policyVersion: 1,
    })
    expect(visible.company).toEqual({ name: syntheticSettings.company.name })
    expect(visible.redactedFields).toContain("company.identity")
    expect(ability.can("update", "Settings", "company.name")).toBe(false)
  })
})
