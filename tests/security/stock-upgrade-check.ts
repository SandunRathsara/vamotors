/** Genuine nine-migration dispatched-parent -> stock candidate, no reset/reseed. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
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

process.umask(0o077)
const [root, mode] = process.argv.slice(2)
assert.ok(root && ["prepare", "verify"].includes(mode))
const env = await privateEnvironment(join(root, "migration.env"))
const db = new pg.Pool({ connectionString: env.DIRECT_URL, max: 1 })
const tables = [
  "Environment",
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
]
type Snapshot = {
  migrations: { migration_name: string; checksum: string }[]
  rows: Record<string, Record<string, unknown>[]>
  grants: { roleId: string; rule: Grant; systemKey: string | null }[]
}
async function snapshot(): Promise<Snapshot> {
  const rows: Snapshot["rows"] = {}
  for (const table of tables)
    rows[table] = (
      await db.query(
        `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows.map((r) => r.row)
  return {
    migrations: (
      await db.query(
        "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
      )
    ).rows,
    rows,
    grants: (
      await db.query(
        'SELECT rp."roleId",p.rule,r."systemKey" FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" ORDER BY rp."roleId",p."ruleHash"'
      )
    ).rows,
  }
}
const atoms = (g: Grant) =>
  expanded(g)
    .filter(
      (f) =>
        !fieldsFor(g.subject as Parameters<typeof fieldsFor>[0], g.action).some(
          (child) => child.startsWith(`${f}.`)
        )
    )
    .map((field) =>
      canonical({
        subject: g.subject,
        action: g.action,
        field,
        conditions: g.conditions ?? {},
      })
    )
try {
  if (mode === "prepare") {
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: (await privateEnvironment(join(root, "cluster.env"))).PROJECT,
        encoding: "utf8",
      }).trim(),
      "db2580dd7fa722489c591f3f9ed8ed0ea4d26a72"
    )
    assert.equal((await snapshot()).migrations.length, 9)
    assert.ok(
      Number(
        (
          await db.query(
            'SELECT count(*) FROM vamotors."PurchaseRecord" WHERE "acquisitionCommandId" IS NOT NULL AND status=\'PURCHASED\''
          )
        ).rows[0].count
      ) > 0,
      "Run the parent production acquisition campaign before prepare"
    )
    // Synthetic retained v6 wildcard/compound and create/delegation ceilings.
    const client = await db.connect()
    try {
      await client.query("BEGIN")
      await client.query("SELECT vamotors.lock_admin_guard()")
      for (const [name, grants] of [
        [
          "v6 stock wildcard ceiling",
          [
            { subject: "PurchaseRecord", action: "create", fields: ["*"] },
            { subject: "PurchaseRecord", action: "read", fields: ["*"] },
            { subject: "Vehicle", action: "read", fields: ["*"] },
            { subject: "Role", action: "create", fields: ["name", "grants"] },
          ],
        ],
        [
          "v6 stock conditional compounds",
          [
            {
              subject: "PurchaseRecord",
              action: "read",
              fields: ["identity", "financial"],
              conditions: { createdBy: "$actor.id" },
            },
            {
              subject: "Vehicle",
              action: "read",
              fields: ["identity", "financial"],
            },
            { subject: "Vehicle", action: "create", fields: ["*"] },
          ],
        ],
      ] as [string, Grant[]][]) {
        const roleId = randomUUID()
        await client.query(
          'INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)',
          [roleId, `${name} ${roleId}`]
        )
        for (const rule of grants) {
          const hash = createHash("sha256")
            .update(canonical(rule))
            .digest("hex")
          await client.query(
            'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
            [randomUUID(), hash, rule]
          )
          await client.query(
            'INSERT INTO vamotors."RolePermission"("roleId","permissionId") SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
            [roleId, hash]
          )
        }
      }
      await client.query("SET CONSTRAINTS ALL IMMEDIATE")
      await client.query("COMMIT")
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
    const before = await snapshot()
    await writeFile(
      join(root, "t05b-parent-before.json"),
      JSON.stringify(before, null, 2),
      { mode: 0o600 }
    )
    console.log(
      "PASS exact dispatched parent, nine migrations, genuine acquisitions and retained v6 ceilings prepared"
    )
  } else {
    const before = JSON.parse(
        await readFile(join(root, "t05b-parent-before.json"), "utf8")
      ) as Snapshot,
      after = await snapshot()
    assert.equal(after.migrations.length, 10)
    assert.deepEqual(after.migrations.slice(0, 9), before.migrations)
    for (const table of tables.filter(
      (t) => !["Role", "RolePermission", "Permission"].includes(t)
    ))
      assert.deepEqual(
        after.rows[table],
        before.rows[table],
        `${table}: retained rows changed`
      )
    for (const old of before.rows.Permission)
      assert.ok(
        after.rows.Permission.some((p) => canonical(p) === canonical(old)),
        "Original immutable permission changed"
      )
    for (const old of before.rows.Role) {
      const row = after.rows.Role.find((r) => r.id === old.id)!
      assert.equal(row.revision, Number(old.revision) + 1)
      const { revision: unused1, ...a } = row,
        { revision: unused2, ...b } = old
      void unused1
      void unused2
      assert.deepEqual(a, b)
      const oldGrants = before.grants.filter((g) => g.roleId === old.id),
        newGrants = after.grants.filter((g) => g.roleId === old.id)
      const population = (grants: typeof oldGrants, stock = false) =>
        [
          ...new Set(
            grants
              .filter(
                (g) =>
                  stock ||
                  g.rule.subject !== "PurchaseRecord" ||
                  !["receive", "release", "update"].includes(g.rule.action)
              )
              .flatMap((g) => atoms(g.rule))
          ),
        ].sort()
      assert.deepEqual(
        population(newGrants),
        population(oldGrants),
        "Old field/population ceiling changed"
      )
      const newStock = newGrants.filter(
        (g) =>
          g.rule.subject === "PurchaseRecord" &&
          ["receive", "release", "update"].includes(g.rule.action)
      )
      assert.equal(newStock.length, old.systemKey === "ADMINISTRATOR" ? 3 : 0)
      assert.ok(newStock.every((g) => !g.rule.fields.includes("*")))
    }
    for (const row of after.rows.Permission) {
      grantSchema.parse(row.rule)
      assert.equal(
        createHash("sha256").update(canonical(row.rule)).digest("hex"),
        row.ruleHash
      )
    }
    assert.equal(registryVersion, 7)
    const grants = (
      await db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows
    const mutable = grants.filter(
      (g) =>
        ["PurchaseRecord", "Vehicle"].includes(g.table_name) &&
        g.privilege_type === "UPDATE"
    )
    assert.deepEqual(
      mutable.map((g) => `${g.table_name}.${g.column_name}`).sort(),
      [
        "PurchaseRecord.available",
        "PurchaseRecord.holdReason",
        "PurchaseRecord.receivedDate",
        "PurchaseRecord.revision",
        "PurchaseRecord.status",
        "PurchaseRecord.updatedAt",
      ].sort()
    )
    await writeFile(
      join(root, "t05b-upgrade-after.json"),
      JSON.stringify(
        {
          head: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          ...after,
          grants,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    console.log(
      "PASS ten migrations; nine checksums/all retained rows/money/history unchanged; old ceilings frozen; explicit Administrator stock operations; exact six UPDATE columns"
    )
  }
} finally {
  await db.end()
}
