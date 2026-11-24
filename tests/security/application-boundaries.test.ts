import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { adminList } from "@/lib/server/admin-list"
import { administratorGrants } from "@/lib/server/permissions"
import { safeReturnPath } from "@/lib/security-client"
import {
  legacyAPIs,
  reportingAPIs,
  reportingPages,
  unavailablePages,
  persistedRepairPages,
  methods,
  persistedRateAPIs,
  persistedRatePages,
  privateAttachmentAPIs,
  importStagingPages,
  approvalPages,
  brokeragePages,
  salesPages,
} from "./route-inventory"

const invoiceDownload = "/api/v1/sales/[saleId]/invoices/[version]"

function files(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(root, entry.name))
      : [join(root, entry.name)]
  )
}
describe("global entry-point inventory", () => {
  it("covers every API route and method, with no reachable mock imports", () => {
    const actual = files("app/api")
      .filter((p) => p.endsWith("/route.ts"))
      .map((p) => p.slice(3, -9))
      .sort()
    expect(actual).toEqual(
      [
        ...legacyAPIs,
        ...reportingAPIs,
        ...Object.keys(persistedRateAPIs),
        ...Object.keys(privateAttachmentAPIs),
        invoiceDownload,
        "/api/auth/[...all]",
        "/api/v1/commands/[name]",
        "/api/v1/queries/[name]",
        "/api/test/reset",
      ].sort()
    )
    for (const route of legacyAPIs) {
      const text = readFileSync(`app${route}/route.ts`, "utf8")
      for (const method of methods)
        expect(text).toContain(`unavailable as ${method}`)
      expect(text).not.toMatch(/mock-data|from ["']\.\/prototype["'](?!\s*$)/m)
    }
    for (const route of reportingAPIs) {
      const text = readFileSync(`app${route}/route.ts`, "utf8")
      expect(text).toContain("export async function GET")
      expect(text).toContain("@/lib/server/report-http")
      expect(text).not.toMatch(/mock-data|prototype/)
    }
    for (const [route, method] of Object.entries(persistedRateAPIs)) {
      const text = readFileSync(`app${route}/route.ts`, "utf8")
      expect(text).toContain(`export async function ${method}`)
      expect(text).toContain("await authenticate(request.headers)")
      expect(text).toContain("await rateRead(")
      expect(text).toContain("noStoreJSON(")
      if (method === "POST") expect(text).toContain("sameOrigin(request)")
      expect(text).not.toMatch(/mock-data|prototype/)
    }
    for (const [route, method] of Object.entries({
      ...privateAttachmentAPIs,
      [invoiceDownload]: "GET",
    })) {
      const text = readFileSync(`app${route}/route.ts`, "utf8")
      expect(text).toContain(`export async function ${method}`)
      expect(text).toContain("await authenticate(request.headers)")
      expect(text).toContain('dynamic = "force-dynamic"')
      expect(text).toContain("endpoint(")
      if (method === "PUT") expect(text).toContain("sameOrigin(request)")
      expect(text).not.toMatch(/mock-data|prototype/)
    }
  })
  it("covers every page, including detail RSCs, not only its layout", () => {
    const actual = files("app/(app)")
      .filter((p) => p.endsWith("/page.tsx"))
      .map((p) => p.slice(9, -9))
      .sort()
    expect(actual).toEqual(
      [
        ...unavailablePages,
        ...reportingPages,
        ...persistedRatePages,
        ...importStagingPages,
        ...persistedRepairPages,
        ...approvalPages,
        ...brokeragePages,
        ...salesPages,
        "/dashboard",
        "/users",
        "/customers",
        "/customers/[id]",
        "/third-parties",
        "/third-parties/[id]",
        "/settings",
        "/purchases",
        "/purchases/[id]",
        "/vehicles",
        "/vehicles/[id]",
      ].sort()
    )
    for (const path of unavailablePages)
      expect(readFileSync(`app/(app)${path}/page.tsx`, "utf8").trim()).toBe(
        'export { UnavailablePage as default } from "@/lib/server/pages"'
      )
    for (const path of brokeragePages)
      expect(readFileSync(`app/(app)${path}/page.tsx`, "utf8")).toContain(
        "await pageActor()"
      )
    expect(readFileSync("app/(app)/users/page.tsx", "utf8")).toContain(
      "await pageActor(true)"
    )
    expect(readFileSync("app/(app)/repairs/page.tsx", "utf8")).toContain(
      "await pageActor()"
    )
    expect(readFileSync("app/(app)/repairs/[id]/page.tsx", "utf8")).toMatch(
      /await repairPagePurchase\(\s*await authenticate\(await headers\(\)\),\s*id\s*\)/
    )
    expect(readFileSync("proxy.ts", "utf8")).toContain(
      "await repairPagePurchase(await authenticate(request.headers), repair[1])"
    )
    for (const path of [
      "/customers",
      "/customers/[id]",
      "/third-parties",
      "/third-parties/[id]",
      "/settings",
      "/purchases",
      "/purchases/[id]",
      "/vehicles",
      "/vehicles/[id]",
      "/approvals",
      ...persistedRatePages,
      ...importStagingPages,
    ])
      expect(readFileSync(`app/(app)${path}/page.tsx`, "utf8")).toContain(
        "await pageActor()"
      )
    expect(readFileSync("app/page.tsx", "utf8")).toContain("await pageActor()")
    const approvalDetail = readFileSync(
      "app/(app)/approvals/[id]/page.tsx",
      "utf8"
    )
    expect(approvalDetail).toContain(
      "authenticatedApprovalDetail(await headers(), id)"
    )
    const owner = readFileSync("lib/server/approvals.ts", "utf8")
    expect(owner).toContain(
      "approvalDetail(tx, await currentActor(tx, identity), approvalId)"
    )
    expect(readFileSync("proxy.ts", "utf8")).toContain(
      "authenticatedApprovalDetail(request.headers, approval[1])"
    )
    expect(approvalDetail).not.toMatch(/approvalQuery|pageSize|commandReceipt/)
    expect(existsSync("app/(app)/approvals/loading.tsx")).toBe(false)
    expect(readFileSync("lib/server/pages.tsx", "utf8")).not.toMatch(
      /\bcache\(/
    )
  })
  it("permits only safe local return paths", () => {
    for (const path of [
      "//evil.test",
      "https://evil.test",
      "/api/users",
      "/%2f%2fevil.test",
      "/users?x=1",
      null,
    ])
      expect(safeReturnPath(path)).toBe("/dashboard")
    expect(safeReturnPath("/users")).toBe("/users")
  })
})
describe("authorized administrative list planning", () => {
  const actor = { userId: "a", grants: administratorGrants }
  it("uses inclusive Colombo creation-day bounds", () => {
    const result = adminList(actor, "User", {
      from: "2026-10-26",
      through: "2026-10-26",
    })
    expect(JSON.stringify(result.where)).toContain("2026-10-25T18:30:00.000Z")
    expect(JSON.stringify(result.where)).toContain("2026-10-26T18:30:00.000Z")
  })
  it("combines scope/filter before count/page and uses deterministic allowlisted ordering", () => {
    const result = adminList(actor, "User", {
      q: "Alice",
      active: "false",
      roleId: "00000000-0000-4000-8000-000000000001",
      page: "2",
      sort: '[{"field":"name","direction":"desc"}]',
    })
    expect(result.paging).toEqual({
      skip: 20,
      take: 20,
      orderBy: [{ name: "desc" }, { id: "asc" }],
    })
    expect(result.where.AND).toHaveLength(2)
    expect(JSON.stringify(result.where)).toContain('"active":false')
    expect(JSON.stringify(result.where)).toContain('"roleId"')
  })
  it("denies secret/unsupported sort, unknown and duplicate keys, invalid dates/boolean", () => {
    const cases: Record<string, string>[] = [
      { sort: '[{"field":"password","direction":"asc"}]' },
      { email: "x" },
      { active: "yes" },
      { from: "2026-02-30" },
      { from: "2026-10-26", through: "2026-01-01" },
      {
        sort: '[{"field":"name","direction":"asc"},{"field":"name","direction":"desc"}]',
      },
    ]
    for (const input of cases)
      expect(() => adminList(actor, "User", input)).toThrow()
  })
  it("never sorts/searches/filters a field the actor cannot read", () => {
    const limited = {
      userId: "a",
      grants: [
        {
          subject: "User" as const,
          action: "read" as const,
          fields: ["id", "name"],
        },
      ],
    }
    expect(() =>
      adminList(limited, "User", {
        sort: '[{"field":"email","direction":"asc"}]',
      })
    ).toThrow("FIELD_FORBIDDEN")
    expect(() => adminList(limited, "User", { q: "secret" })).toThrow(
      "FIELD_FORBIDDEN"
    )
    expect(() => adminList(limited, "User", { active: "true" })).toThrow(
      "FIELD_FORBIDDEN"
    )
    expect(() => adminList(limited, "User", {})).not.toThrow()
  })
})
