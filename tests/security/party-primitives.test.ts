import { describe, expect, it } from "vitest"
import { directoryInput, partyEnvelope } from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  grantSchema,
  registryVersion,
} from "../../lib/server/permissions"
import { subject } from "@casl/ability"
const contact = {
  name: "Synthetic contact",
  phone: "+94 77 123 4567",
  role: "Manager",
  primary: true,
}
const values = {
  name: "Synthetic supplier",
  category: "COMPANY",
  contacts: [contact],
}
describe("party boundary primitives", () => {
  it("validates all contact fields without dropping incomplete contacts", () => {
    for (const key of ["name", "phone", "role"] as const) {
      expect(
        directoryInput.safeParse({
          ...values,
          contacts: [{ ...contact, [key]: "" }],
        }).success
      ).toBe(false)
    }
    expect(
      directoryInput.safeParse({
        ...values,
        contacts: [{ ...contact, email: "bad" }],
      }).success
    ).toBe(false)
    expect(
      directoryInput.safeParse({
        ...values,
        contacts: [contact, { ...contact, name: "Other" }],
      }).success
    ).toBe(false)
    expect(
      directoryInput.safeParse({
        ...values,
        contacts: [contact, { ...contact, primary: false }],
      }).success
    ).toBe(true)
  })
  it("rejects forged actor/IDs, invalid categories and duplicate dependencies", () => {
    const id = "03000000-0000-4000-8000-000000000001"
    const envelope = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [],
      input: { type: "SUPPLIER", values },
    }
    expect(
      partyEnvelope("createDirectoryParty").safeParse(envelope).success
    ).toBe(true)
    expect(
      partyEnvelope("createDirectoryParty").safeParse({
        ...envelope,
        actor: id,
      }).success
    ).toBe(false)
    expect(
      directoryInput.safeParse({ ...values, category: "OTHER" }).success
    ).toBe(false)
    expect(
      directoryInput.safeParse({ ...values, contacts: [{ ...contact, id }] })
        .success
    ).toBe(false)
    expect(
      partyEnvelope("createDirectoryParty").safeParse({
        ...envelope,
        expected: [
          { type: "Supplier", id, revision: 1 },
          { type: "Supplier", id, revision: 1 },
        ],
      }).success
    ).toBe(false)
  })
  it("keeps nested directory/contact permissions and condition scopes explicit", () => {
    const grants = [
      {
        subject: "Supplier" as const,
        action: "read" as const,
        fields: ["id", "contacts"],
      },
    ]
    const ability = abilityFor(grants, "a")
    expect(registryVersion).toBe(17)
    expect(ability.can("read", "Supplier", "directory.contacts")).toBe(false)
    expect(ability.can("read", "Supplier", "contacts")).toBe(true)
    expect(
      attenuation(
        grants,
        [],
        [
          {
            subject: "Supplier",
            action: "read",
            fields: ["directory.contacts"],
          },
        ],
        "a"
      ).covered
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "RepairVendor",
        action: "read",
        fields: ["*"],
        conditions: { customerId: "03000000-0000-4000-8000-000000000001" },
      }).success
    ).toBe(false)
    const owned = abilityFor(
      [
        {
          subject: "RepairVendor",
          action: "update",
          fields: ["notes"],
          conditions: { createdBy: "$actor.id" },
        },
      ],
      "a"
    )
    expect(
      owned.can("update", subject("RepairVendor", { createdBy: "b" }), "notes")
    ).toBe(false)
    expect(
      owned.can("update", subject("RepairVendor", { createdBy: "a" }), "notes")
    ).toBe(true)
  })
})
