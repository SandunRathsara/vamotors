// @vitest-environment node
import { describe, expect, it } from "vitest"
import type { Grant } from "../../.planning/implementation/contracts/api"
import {
  attenuation,
  configurableRegistry,
  fieldsFor,
  grantSchema,
  normalizedGrants,
} from "../../lib/server/permissions"

const customer = (
  fields: string[],
  conditions?: Grant["conditions"]
): Grant => ({
  subject: "Customer",
  action: "read",
  fields,
  ...(conditions ? { conditions } : {}),
})
const vehicle = (
  fields: string[],
  conditions?: Grant["conditions"]
): Grant => ({
  subject: "Vehicle",
  action: "read",
  fields,
  ...(conditions ? { conditions } : {}),
})
const own = { createdBy: "$actor.id" as const }
const decide = (
  ceiling: Grant[],
  next: Grant[],
  before: Grant[] = [],
  recipient?: string
) => attenuation(ceiling, before, next, "grantor", recipient)

describe("bounded per-field conjunction attenuation", () => {
  it("uses distinct field witnesses without sharing their conditions", () => {
    const ceiling = [customer(["phone"], own), customer(["fullName"])]
    expect(
      decide(ceiling, [customer(["phone", "fullName"], own)]).covered
    ).toBe(false)
    expect(
      decide(
        [vehicle(["identity"], { status: "Available" }), vehicle(["status"])],
        [vehicle(["identity", "status"], { status: "Available" })]
      ).covered
    ).toBe(true)
  })
  it("does not merge conjunctions for the same field", () => {
    expect(
      decide(
        [
          vehicle(["identity"], { status: "Available" }),
          vehicle(["identity"], { status: "Sold" }),
        ],
        [vehicle(["identity"])]
      ).covered
    ).toBe(false)
  })
  it("requires identical subject and action", () => {
    expect(
      decide(
        [customer(["*"])],
        [{ subject: "User", action: "read", fields: ["name"] }]
      ).covered
    ).toBe(false)
    expect(
      decide(
        [{ subject: "User", action: "update", fields: ["name"] }],
        [{ subject: "User", action: "create", fields: ["name"] }]
      ).covered
    ).toBe(false)
  })
  it("expands wildcard and parent but never leaf to sibling/parent", () => {
    expect(
      decide([vehicle(["financial"])], [vehicle(["financial.purchase"])])
        .covered
    ).toBe(true)
    expect(
      decide([vehicle(["financial.purchase"])], [vehicle(["financial"])])
        .covered
    ).toBe(false)
    expect(
      decide(
        [vehicle(["financial.purchase"])],
        [vehicle(["financial.repairs"])]
      ).covered
    ).toBe(false)
    expect(decide([vehicle(["*"])], [vehicle(["financial"])]).covered).toBe(
      true
    )
  })
  it("empty fields grant nothing, omitted fields/unknown grammar fail validation", () => {
    expect(decide([], [customer([])]).covered).toBe(true)
    for (const invalid of [
      { subject: "Customer", action: "read" },
      { ...customer(["phone"]), inverted: true },
      customer(["unknown"]),
      { ...customer(["phone"]), conditions: { createdBy: { $ne: "x" } } },
      { ...customer(["phone"]), conditions: { status: "Available" } },
    ])
      expect(grantSchema.safeParse(invalid).success).toBe(false)
  })
  it("literal equalities narrow; removal/change broadens", () => {
    expect(
      decide(
        [vehicle(["identity"])],
        [vehicle(["identity"], { status: "Available" })]
      ).covered
    ).toBe(true)
    expect(
      decide(
        [vehicle(["identity"], { status: "Available" })],
        [vehicle(["identity"])]
      ).covered
    ).toBe(false)
    expect(
      decide(
        [vehicle(["identity"], { status: "Available" })],
        [vehicle(["identity"], { status: "Sold" })]
      ).covered
    ).toBe(false)
  })
  it("does not launder own-only authority through a recipient or self assignment", () => {
    for (const recipient of [undefined, "other", "grantor"])
      expect(
        decide(
          [customer(["phone"], own)],
          [customer(["phone"], own)],
          [],
          recipient
        ).covered
      ).toBe(false)
    expect(
      decide([customer(["phone"])], [customer(["phone"], own)], [], "other")
        .covered
    ).toBe(true)
  })
  it("applies the same holder binding to notification recipients", () => {
    const notification: Grant = {
      subject: "Notification",
      action: "read",
      fields: ["kind"],
      conditions: { recipientUserId: "$actor.id" },
    }
    expect(decide([notification], [notification], [], "other").covered).toBe(
      false
    )
    expect(
      decide(
        [{ ...notification, conditions: undefined }],
        [notification],
        [],
        "other"
      ).covered
    ).toBe(true)
  })
  it("proves semantic reductions without possession of removed authority", () => {
    expect(decide([], [customer(["phone"], own)], [customer(["*"])])).toEqual({
      reduction: true,
      covered: true,
    })
    expect(decide([], [], [customer(["*"])])).toEqual({
      reduction: true,
      covered: true,
    })
    expect(
      decide([], [customer(["phone"], own)], [customer(["phone"], own)])
    ).toEqual({ reduction: true, covered: true })
  })
  it("removal plus addition/broadened predicate is not reduction", () => {
    expect(
      decide(
        [],
        [vehicle(["identity"], { status: "Sold" })],
        [vehicle(["identity", "status"], { status: "Available" })]
      )
    ).toEqual({ reduction: false, covered: false })
    expect(
      decide([], [customer(["phone"])], [customer(["phone"], own)])
    ).toEqual({ reduction: false, covered: false })
  })
  it("reauthorizes full proposed changed scope, not unrelated untouched scopes", () => {
    const stronger = customer(["phone"])
    expect(
      decide(
        [vehicle(["identity"])],
        [stronger, vehicle(["identity"])],
        [stronger]
      )
    ).toEqual({ reduction: false, covered: true })
    expect(
      decide(
        [vehicle(["identity"], { status: "Sold" })],
        [
          vehicle(["identity"], { status: "Available" }),
          vehicle(["identity"], { status: "Sold" }),
        ],
        [vehicle(["identity"], { status: "Available" })]
      ).covered
    ).toBe(false)
  })
  it("registry expansion makes an old enumerated ceiling insufficient for parent", () => {
    const ceiling = [
      vehicle([
        "financial.purchase",
        "financial.repairs",
        "financial.additionalCosts",
        "financial.basis",
        "financial.originalProfit",
        "financial.restatedProfit",
        "financial",
      ]),
    ]
    // A parent ceiling grows too: revalidation must cover ALL stored grants.
    const oldLeaves = ceiling.map((g) => ({
      ...g,
      fields: g.fields.filter((f) => f !== "financial"),
    }))
    const universe = (
      type: Parameters<typeof fieldsFor>[0],
      action: string
    ) => [
      ...fieldsFor(type, action),
      ...(type === "Vehicle" ? ["financial.future"] : []),
    ]
    expect(
      attenuation(
        oldLeaves,
        [],
        [vehicle(["financial"])],
        "grantor",
        undefined,
        universe
      ).covered
    ).toBe(false)
  })
  it("normalizes positive rule and field sets, not array order", () => {
    expect(
      normalizedGrants([
        customer(["phone", "fullName"]),
        customer(["phone", "fullName"]),
      ])
    ).toBe(normalizedGrants([customer(["fullName", "phone"])]))
  })
  it("registry omits conditional-only fields and never disguises them as unconditional grammar", () => {
    const dto = configurableRegistry(
      [customer(["phone"], own), customer(["fullName"])],
      "grantor",
      false
    )
    expect(dto.subjects.map((s) => s.subject)).toEqual(["Customer"])
    expect(dto.subjects[0].actions[0].fields.map((f) => f.path)).toEqual([
      "fullName",
    ])
    expect(configurableRegistry([], "grantor", false).subjects).toEqual([])
  })
})
