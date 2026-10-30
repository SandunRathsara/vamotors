import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { subject } from "@casl/ability"
import { approvalEnvelope, approvalInputs } from "@/lib/server/validators"
import {
  abilityFor,
  attenuation,
  grantSchema,
  registry,
  registryVersion,
} from "@/lib/server/permissions"

const id = "00000000-0000-4000-8000-000000000001"
const input = {
  proposal: {
    kind: "WRITE_OFF",
    input: {
      cycleId: id,
      date: "2026-10-01",
      reason: "Actual disposal",
      method: "SCRAPPED",
      proceeds: "0",
    },
  },
  reason: "Independent request",
}

describe("bounded WRITE_OFF protocol and accepted555 permissions", () => {
  it("keeps every accepted555 subject/action/field byte-identical, adding only two owners", () => {
    const old = Object.fromEntries(
      Object.entries(registry).filter(
        ([name]) => !["ApprovalRequest", "Disposal"].includes(name)
      )
    )
    // Derived from exact accepted555, not the candidate's current expected value.
    expect(createHash("sha256").update(JSON.stringify(old)).digest("hex")).toBe(
      "924b4897630bebcd0fd549d9f5f1a78315963ea9e4e3f08e4cc477868dc8a8c2"
    )
    expect(registryVersion).toBe(12)
    expect(
      registry.PurchaseRecord.read.filter((f) => f.startsWith("disposal"))
    ).toEqual(["disposal"])
  })
  it("does not infer new child grants or delegation from the existing compound parent", () => {
    const grants = [
      {
        subject: "PurchaseRecord" as const,
        action: "read" as const,
        fields: ["*"],
      },
    ]
    const ability = abilityFor(grants, id)
    expect(ability.can("read", "PurchaseRecord", "disposal")).toBe(true)
    expect(ability.can("read", "Disposal", "proceeds")).toBe(false)
    expect(
      attenuation(
        grants,
        [],
        [{ subject: "Disposal", action: "read", fields: ["proceeds"] }],
        id
      ).covered
    ).toBe(false)
    const own = abilityFor(
      [
        {
          subject: "Disposal",
          action: "read",
          fields: ["proceeds"],
          conditions: { createdBy: "$actor.id" },
        },
      ],
      id
    )
    expect(
      own.can("read", subject("Disposal", { createdBy: id }), "proceeds")
    ).toBe(true)
    expect(
      own.can("read", subject("Disposal", { createdBy: "foreign" }), "proceeds")
    ).toBe(false)
    expect(
      grantSchema.safeParse({
        subject: "ApprovalRequest",
        action: "approve",
        fields: ["decision"],
        conditions: { state: "PENDING" },
      }).success
    ).toBe(false)
  })
  it("enables only strict WRITE_OFF input and requires a real rejection note", () => {
    expect(approvalInputs.requestApproval.safeParse(input).success).toBe(true)
    for (const proposal of [
      { kind: "REPAIR" },
      { kind: "DISCOUNT" },
      { kind: "REFUND" },
      { kind: "SALE_EDIT" },
      { ...input.proposal, actorId: id },
    ])
      expect(
        approvalInputs.requestApproval.safeParse({ ...input, proposal }).success
      ).toBe(false)
    for (const patch of [
      { proceeds: "-1" },
      { proceeds: "00" },
      { date: "2026-02-30" },
      { method: "CASH" },
      { bypass: true },
    ])
      expect(
        approvalInputs.requestApproval.safeParse({
          ...input,
          proposal: {
            ...input.proposal,
            input: { ...input.proposal.input, ...patch },
          },
        }).success
      ).toBe(false)
    expect(
      approvalInputs.reviewApproval.safeParse({
        approvalId: id,
        decision: "REJECT",
        note: "   ",
      }).success
    ).toBe(false)
    expect(
      approvalInputs.reviewApproval.parse({
        approvalId: id,
        decision: "REJECT",
        note: " Actual rejection ",
      }).note
    ).toBe("Actual rejection")
    const body = {
      schemaVersion: 1,
      idempotencyKey: id,
      expected: [{ type: "PurchaseRecord", id, revision: 1 }],
      input,
    }
    expect(approvalEnvelope("requestApproval").safeParse(body).success).toBe(
      true
    )
    expect(
      approvalEnvelope("requestApproval").safeParse({
        ...body,
        expected: [...body.expected, ...body.expected],
      }).success
    ).toBe(false)
  })
})
