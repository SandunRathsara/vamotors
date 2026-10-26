// @vitest-environment node
import { describe, it, expect } from "vitest"
import { customerCommands, customerEnvelope } from "../../lib/server/validators"
import {
  abilityFor,
  attenuation,
  expanded,
  grantSchema,
  registry,
  permissionRegistryDTO,
} from "../../lib/server/permissions"
import type {
  Commands,
  Envelope,
  CustomerInput,
  Grant,
} from "../../.planning/implementation/contracts/api"
const id = "03000000-0000-4000-8000-000000000011"
const input: CustomerInput = {
  fullName: "Synthetic Customer",
  callingName: "Synthetic",
  nicOrPassport: "TEST-001",
  address: "Synthetic address",
  phone: "+94 77 123 4567",
  email: "customer@example.test",
  drivingLicence: "TEST-LICENCE",
  notes: "Synthetic notes",
}
describe("customer wire and permission boundaries", () => {
  it("implements exact create/update/archive inputs and rejects browser ownership", () => {
    const commands: {
      [N in keyof typeof customerCommands]: Envelope<Commands[N]>
    } = {
      createCustomer: {
        schemaVersion: 1,
        idempotencyKey: id,
        expected: [],
        input,
      },
      updateCustomer: {
        schemaVersion: 1,
        idempotencyKey: id,
        expected: [{ type: "Customer", id, revision: 1 }],
        input: { id, values: input, reason: "Correction" },
      },
      archiveParty: {
        schemaVersion: 1,
        idempotencyKey: id,
        expected: [{ type: "Customer", id, revision: 1 }],
        input: { type: "CUSTOMER", id, active: false, reason: "Archive" },
      },
    }
    for (const name of Object.keys(commands) as (keyof typeof commands)[])
      expect(customerEnvelope(name).safeParse(commands[name]).success).toBe(
        true
      )
    expect(
      customerEnvelope("createCustomer").safeParse({
        ...commands.createCustomer,
        input: { ...input, createdBy: id },
      }).success
    ).toBe(false)
    expect(
      customerCommands.archiveParty.safeParse({
        ...commands.archiveParty.input,
        type: "SUPPLIER",
      }).success
    ).toBe(false)
    expect(
      customerEnvelope("updateCustomer").safeParse({
        ...commands.updateCustomer,
        expected: [
          commands.updateCustomer.expected[0],
          commands.updateCustomer.expected[0],
        ],
      }).success
    ).toBe(false)
  })
  it("validates all required/optional fields, nulls, bounded identity/phone/email", () => {
    for (const patch of [
      { fullName: " " },
      { callingName: "" },
      { nicOrPassport: "x".repeat(101) },
      { address: "" },
      { phone: "xx" },
      { email: "bad" },
      { notes: null },
      { drivingLicence: "x".repeat(101) },
    ])
      expect(
        customerCommands.createCustomer.safeParse({ ...input, ...patch })
          .success
      ).toBe(false)
    expect(customerCommands.createCustomer.parse(input)).toEqual(input)
  })
  it("has exact write universes and no invented notification/delete capability", () => {
    expect([...registry.Customer.create].sort()).toEqual(
      Object.keys(input).sort()
    )
    expect([...registry.Customer.update]).toEqual([...registry.Customer.create])
    expect(registry.Customer.archive).toEqual(["active"])
    const entries = permissionRegistryDTO().subjects
    expect(
      entries
        .find((s) => s.subject === "Customer")!
        .actions.find((a) => a.action === "read")!
        .fields.find((f) => f.path === "links")!.dataType
    ).toBe("ARRAY")
    expect(
      entries
        .find((s) => s.subject === "PurchaseRecord")!
        .actions[0].fields.find((f) => f.path === "purchasePrice")!.dataType
    ).toBe("MONEY")
    for (const field of ["createdBy", "revision", "links", "provenance"])
      expect(
        grantSchema.safeParse({
          subject: "Customer",
          action: "update",
          fields: [field],
        }).success
      ).toBe(false)
  })
  it("freezing old read grants prevents wildcard expansion/delegation escalation", () => {
    const old: Grant = {
      subject: "Customer",
      action: "read",
      fields: [
        "id",
        "revision",
        "fullName",
        "callingName",
        "nicOrPassport",
        "address",
        "phone",
        "email",
        "drivingLicence",
        "notes",
        "active",
      ],
    }
    expect(expanded(old)).not.toContain("links")
    expect(expanded(old)).not.toContain("provenance")
    for (const proposed of [
      { subject: "Customer", action: "create", fields: ["fullName"] },
      { subject: "Customer", action: "read", fields: ["links"] },
      { subject: "PurchaseRecord", action: "read", fields: ["id"] },
    ] as Grant[])
      expect(attenuation([old], [], [proposed], id).covered).toBe(false)
    expect(abilityFor([old], id).can("create", "Customer")).toBe(false)
  })
})
