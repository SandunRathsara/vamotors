/** <root> prepare|verify <actual accepted parent SHA>; never reset/reseed. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import {
  expanded,
  fieldsFor,
  grantSchema,
  registryVersion,
} from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"
import { fixture, seed, envelope } from "./cycle-edits-fixture"

process.umask(0o077)
const [root, mode, parentSHA] = process.argv.slice(2)
assert.ok(
  root &&
    ["prepare", "verify"].includes(mode) &&
    /^[0-9a-f]{40}$/.test(parentSHA)
)
const migration = await privateEnvironment(join(root, "migration.env")),
  cluster = await privateEnvironment(join(root, "cluster.env")),
  source = cluster.PROJECT!
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim()
assert.equal(
  git("status", "--porcelain"),
  "",
  "Exact clean source PROJECT required"
)
if (mode === "prepare") assert.equal(git("rev-parse", "HEAD"), parentSHA)
else assert.ok(git("merge-base", "--is-ancestor", parentSHA, "HEAD") === "")
const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 1 })
const tables = [
  "Environment",
  "Settings",
  "SettingsVersion",
  "FinanceCompany",
  "FinanceContact",
  "FinancePolicyVersion",
  "Supplier",
  "SupplierContact",
  "RepairVendor",
  "VendorContact",
  "Customer",
  "Vehicle",
  "PurchaseRecord",
  "PurchasePayment",
  "MileageReading",
  "VehicleCost",
  "CostPayment",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
  "Permission",
  "Role",
  "RolePermission",
  "UserRole",
  "RateSheetVersion",
  "RateCardEntry",
  "Quote",
]
type Snapshot = {
  rows: Record<string, Record<string, unknown>[]>
  migrations: Record<string, unknown>[]
  owners: Record<string, unknown>[]
  columns: Record<string, unknown>[]
  functions: { name: string; body: string; metadata: Record<string, unknown> }[]
  grants: { roleId: string; rule: Grant; systemKey: string | null }[]
}
async function snapshot(): Promise<Snapshot> {
  const rows: Snapshot["rows"] = {}
  for (const t of tables)
    rows[t] = (
      await db.query(
        `SELECT to_jsonb(t) row FROM vamotors."${t}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows.map((r) => r.row)
  return {
    rows,
    migrations: (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
      )
    ).rows,
    owners: (
      await db.query(
        "SELECT c.relname name,pg_get_userbyid(c.relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind IN ('r','v') ORDER BY c.relname"
      )
    ).rows,
    columns: (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows,
    functions: (
      await db.query(
        "SELECT p.oid::regprocedure::text name,p.prosrc body,to_jsonb(p)-'prosrc' metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vamotors' ORDER BY p.oid"
      )
    ).rows,
    grants: (
      await db.query(
        'SELECT rp."roleId",p.rule,r."systemKey" FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" ORDER BY rp."roleId",p."ruleHash"'
      )
    ).rows,
  }
}
function atoms(grant: Grant, expand = expanded, universe = fieldsFor) {
  return expand(grant)
    .filter(
      (f: string) =>
        !universe(
          grant.subject as Parameters<typeof fieldsFor>[0],
          grant.action
        ).some((child: string) => child.startsWith(`${f}.`))
    )
    .flatMap((field: string) =>
      (field === "mileage" &&
      grant.action === "read" &&
      ["Vehicle", "PurchaseRecord"].includes(grant.subject)
        ? (grant.subject === "Vehicle"
            ? ["reading", "date", "remark", "decreaseReason"]
            : ["id", "reading", "date", "remark", "decreaseReason"]
          ).map((f) => `mileage.${f}`)
        : [field]
      ).map((field) =>
        canonical({
          subject: grant.subject,
          action: grant.action,
          field,
          conditions: grant.conditions ?? {},
        })
      )
    )
}
try {
  if (mode === "prepare") {
    const f = await fixture(root, source)
    try {
      await f.start()
      const admin = await f.login("ADMIN")
      try {
        await seed(f, admin, randomUUID().slice(0, 8))
        for (const grants of [
          [
            { subject: "Vehicle", action: "read", fields: ["*"] },
            { subject: "Vehicle", action: "create", fields: ["*"] },
            { subject: "PurchaseRecord", action: "read", fields: ["*"] },
            { subject: "PurchaseRecord", action: "update", fields: ["*"] },
            { subject: "PurchaseRecord", action: "create", fields: ["*"] },
            { subject: "Role", action: "create", fields: ["*"] },
            { subject: "RateSheet", action: "read", fields: ["*"] },
            { subject: "Quote", action: "read", fields: ["*"] },
          ],
          [
            {
              subject: "Vehicle",
              action: "read",
              fields: ["mileage", "identity", "financial"],
              conditions: { createdBy: "$actor.id" },
            },
            {
              subject: "PurchaseRecord",
              action: "read",
              fields: [
                "mileage",
                "costs",
                "basisVersions",
                "financial",
                "payments",
              ],
              conditions: { createdBy: "$actor.id" },
            },
          ],
        ])
          await f.command(
            admin,
            "saveRole",
            envelope({
              name: `Exact parent ceiling ${randomUUID()}`,
              reason: "Synthetic retained delegation population",
              grants,
            }),
            201
          )
      } finally {
        await admin.dispose()
      }
    } finally {
      await f.close()
    }
    const parent = await import(
        pathToFileURL(join(source, "lib/server/permissions.ts")).href
      ),
      before = await snapshot()
    for (const t of [
      "Settings",
      "SettingsVersion",
      "FinanceCompany",
      "FinanceContact",
      "FinancePolicyVersion",
      "Supplier",
      "SupplierContact",
      "Customer",
      "Vehicle",
      "PurchaseRecord",
      "PurchasePayment",
      "MileageReading",
      "VehicleCost",
      "CostPayment",
      "CycleBasisVersion",
      "StatusEvent",
      "CommandReceipt",
      "AuditEntry",
      "EntityReadVersion",
      "Permission",
      "RolePermission",
      "UserRole",
      "RateSheetVersion",
      "RateCardEntry",
      "Quote",
    ])
      assert.ok(
        before.rows[t].length > 0,
        `${t}: genuine NONEMPTY fixture required`
      )
    const ceilings = Object.fromEntries(
      before.rows.Role.map((r) => [
        String(r.id),
        [
          ...new Set(
            before.grants
              .filter((g) => g.roleId === r.id)
              .flatMap((g) => atoms(g.rule, parent.expanded, parent.fieldsFor))
          ),
        ].sort(),
      ])
    )
    await writeFile(
      join(root, "cycle-edits-parent-before.json"),
      JSON.stringify(
        {
          parentSHA,
          parentRegistry: parent.registryVersion,
          ...before,
          ceilings,
        },
        null,
        2
      ),
      { mode: 0o600, flag: "wx" }
    )
    console.log(
      `PASS exact ${parentSHA} NONEMPTY parent, ${before.migrations.length} migrations and v${parent.registryVersion} ceilings`
    )
  } else {
    const before = JSON.parse(
        await readFile(join(root, "cycle-edits-parent-before.json"), "utf8")
      ) as Snapshot & {
        parentSHA: string
        parentRegistry: number
        ceilings: Record<string, string[]>
      },
      after = await snapshot()
    assert.equal(before.parentSHA, parentSHA)
    assert.equal(registryVersion, before.parentRegistry + 1)
    assert.equal(after.migrations.length, before.migrations.length + 1)
    assert.deepEqual(
      after.migrations.slice(0, before.migrations.length),
      before.migrations
    )
    for (const t of tables.filter(
      (t) => !["Role", "RolePermission", "Permission"].includes(t)
    ))
      assert.deepEqual(
        after.rows[t].map(canonical).sort(),
        before.rows[t].map(canonical).sort(),
        `${t}: prior rows changed`
      )
    for (const p of before.rows.Permission)
      assert.ok(
        after.rows.Permission.some((next) => canonical(next) === canonical(p)),
        "Immutable permission changed"
      )
    assert.deepEqual(after.owners, before.owners)
    for (const grant of before.columns)
      assert.ok(
        after.columns.some((next) => canonical(next) === canonical(grant)),
        "Old runtime ACL lost"
      )
    const allowedNewColumns = [
      "Vehicle.engineNumber",
      "Vehicle.chassisNumber",
      "Vehicle.normalizedEngine",
      "Vehicle.normalizedChassis",
      "Vehicle.make",
      "Vehicle.model",
      "Vehicle.year",
      "Vehicle.colour",
      "Vehicle.fuelType",
      "Vehicle.transmission",
      "Vehicle.vin",
      "Vehicle.crNumber",
      "Vehicle.notes",
      "Vehicle.revision",
      "Vehicle.updatedAt",
      "PurchaseRecord.listedPrice",
    ].sort()
    assert.deepEqual(
      after.columns
        .filter(
          (next) =>
            !before.columns.some((old) => canonical(old) === canonical(next))
        )
        .map((g) => {
          assert.equal(g.privilege_type, "UPDATE")
          return `${g.table_name}.${g.column_name}`
        })
        .sort(),
      allowedNewColumns
    )
    for (const old of before.functions) {
      const next = after.functions.find((f) => f.name === old.name)!
      assert.ok(next)
      assert.deepEqual(
        next.metadata,
        old.metadata,
        `${old.name}: identity/owner/ACL changed`
      )
      if (
        ![
          "vamotors.purchase_vehicle_guard()",
          "vamotors.acquisition_root_guard()",
          "vamotors.check_acquisition_graph()",
          "vamotors.cycle_cost_root_graph()",
        ].includes(old.name)
      )
        assert.equal(
          next.body,
          old.body,
          `${old.name}: unrelated guard changed`
        )
    }
    for (const old of before.rows.Role) {
      const next = after.rows.Role.find((r) => r.id === old.id)!,
        { revision: oldRevision, ...a } = old,
        { revision: nextRevision, ...b } = next
      assert.equal(nextRevision, Number(oldRevision) + 1)
      assert.deepEqual(a, b)
      const population = [
        ...new Set(
          after.grants
            .filter((g) => g.roleId === old.id)
            .flatMap((g) => atoms(g.rule))
        ),
      ].sort()
      if (old.systemKey !== "ADMINISTRATOR")
        assert.deepEqual(
          population,
          before.ceilings[String(old.id)],
          "Old wildcard/compound/create/delegation ceiling widened"
        )
      else
        for (const atom of before.ceilings[String(old.id)])
          assert.ok(
            population.includes(atom),
            "Administrator prior capability lost"
          )
    }
    for (const p of after.rows.Permission) {
      grantSchema.parse(p.rule)
      assert.equal(
        createHash("sha256").update(canonical(p.rule)).digest("hex"),
        p.ruleHash
      )
    }
    await writeFile(
      join(root, "cycle-edits-upgrade-after.json"),
      JSON.stringify(
        {
          head: git("rev-parse", "HEAD"),
          parentSHA,
          registryVersion,
          ...after,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    console.log(
      `PASS genuine ${before.migrations.length}->${after.migrations.length} upgrade; old source rows/quotes/reversals/basis/ACLs/owners/ceilings exact`
    )
  }
} finally {
  await db.end()
}
