/** Run prepare on exact dispatched six-migration parent, then verify after setup.
 * Own local root only. Retained synthetic fixtures are never reseeded/reset. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import { abilityFor, grantSchema } from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const [directory, action] = process.argv.slice(2)
assert.ok(directory && ["prepare", "verify"].includes(action))
const env = await privateEnvironment(join(directory, "migration.env"))
assert.equal(env.APP_ENV, "local")
assert.equal(new URL(env.DIRECT_URL!).hostname, "127.0.0.1")
const db = new pg.Client({ connectionString: env.DIRECT_URL })
await db.connect()
const retained = async () =>
  Object.fromEntries(
    await Promise.all(
      [
        "Settings",
        "SettingsVersion",
        "FinanceCompany",
        "FinancePolicyVersion",
        "FinanceContact",
        "SupplierContact",
        "VendorContact",
        "PurchaseRecord",
      ].map(async (table) => [
        table,
        (
          await db.query(
            `SELECT to_jsonb(t) AS row FROM vamotors."${table}" t ORDER BY id`
          )
        ).rows.map((r) => r.row),
      ])
    )
  )
const permissions = async () =>
  (
    await db.query(
      'SELECT id,"ruleHash",rule FROM vamotors."Permission" ORDER BY id'
    )
  ).rows
const roles = async () =>
  (
    await db.query(
      'SELECT id,revision,"systemKey" FROM vamotors."Role" ORDER BY id'
    )
  ).rows
const memberships = async () =>
  (
    await db.query(
      'SELECT "roleId","permissionId" FROM vamotors."RolePermission" ORDER BY "roleId","permissionId"'
    )
  ).rows
try {
  if (action === "prepare") {
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL"
        )
      ).rows[0].count,
      "6"
    )
    const role = randomUUID(),
      company = randomUUID(),
      policy = randomUUID(),
      contact = randomUUID()
    const rules: Grant[] = [
      { subject: "Settings", action: "read", fields: ["*"] },
      { subject: "Settings", action: "read", fields: ["company"] },
      {
        subject: "FinanceCompany",
        action: "read",
        fields: ["policy"],
        conditions: { createdBy: "$actor.id" },
      },
    ]
    await db.query("BEGIN")
    await db.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    await db.query("SELECT vamotors.lock_admin_guard()")
    await db.query('INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)', [
      role,
      `T04d old wildcard/compound ceiling ${role}`,
    ])
    for (const rule of rules) {
      const hash = createHash("sha256").update(canonical(rule)).digest("hex")
      await db.query(
        'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
        [randomUUID(), hash, rule]
      )
      await db.query(
        'INSERT INTO vamotors."RolePermission" SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
        [role, hash]
      )
    }
    // Deliberately distinct CAS revision and policy snapshot number, before
    // new command code runs; this is an owner-created local test fixture.
    await db.query('UPDATE vamotors."Settings" SET revision=revision+10')
    await db.query(
      'INSERT INTO vamotors."FinanceCompany"(id,name,"createdBy","currentPolicyId","updatedAt") VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [
        company,
        "Synthetic retained pre-T04d finance",
        "03000000-0000-4000-8000-000000000011",
        policy,
      ]
    )
    await db.query(
      'INSERT INTO vamotors."FinancePolicyVersion"(id,"companyId",version,values) VALUES($1,$2,1,$3)',
      [
        policy,
        company,
        {
          path: "APPLICATION",
          commission: { basis: "FIXED", fixed: "12345", rateBps: 12 },
          processingFee: "123",
          reconciliationMethod: "PER_DEAL",
        },
      ]
    )
    await db.query(
      'INSERT INTO vamotors."FinanceContact"(id,"companyId",name,phone,role,"isPrimary") VALUES($1,$2,$3,$4,$5,true)',
      [contact, company, "Synthetic retained contact", "0112345678", "Agent"]
    )
    await db.query("COMMIT")
    const snapshot = {
      source: "fb94f61d925bf59f3542594b6972c327e4fcc3c1",
      retained: await retained(),
      permissions: await permissions(),
      roles: await roles(),
      memberships: await memberships(),
      role,
      rules,
    }
    await writeFile(
      join(directory, "t04d-parent-inventory.json"),
      JSON.stringify(snapshot, null, 2),
      { mode: 0o600, flag: "wx" }
    )
    console.log(
      "PASS genuine six-migration parent fixtures and private inventory retained"
    )
  } else {
    const snapshot = JSON.parse(
      await readFile(join(directory, "t04d-parent-inventory.json"), "utf8")
    )
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL"
        )
      ).rows[0].count,
      "7"
    )
    assert.deepEqual(await retained(), snapshot.retained)
    const now = await permissions()
    for (const permission of snapshot.permissions)
      assert.deepEqual(
        now.find((p) => p.id === permission.id),
        permission
      )
    for (const p of now) {
      grantSchema.parse(p.rule)
      assert.equal(
        createHash("sha256").update(canonical(p.rule)).digest("hex"),
        p.ruleHash
      )
    }
    const members = await memberships()
    for (const m of snapshot.memberships)
      assert.ok(
        members.some(
          (n) => n.roleId === m.roleId && n.permissionId === m.permissionId
        )
      )
    const newMembers = members.filter(
      (m) =>
        !snapshot.memberships.some(
          (n: typeof m) =>
            m.roleId === n.roleId && m.permissionId === n.permissionId
        )
    )
    assert.equal(newMembers.length, 1)
    const admin = (await roles()).find((r) => r.systemKey === "ADMINISTRATOR")!
    assert.equal(newMembers[0].roleId, admin.id)
    assert.deepEqual(
      now
        .find((p) => p.id === newMembers[0].permissionId)
        .rule.fields.includes("*"),
      false
    )
    for (const role of snapshot.roles)
      assert.equal(
        (await roles()).find((r) => r.id === role.id).revision,
        role.revision + (role.id === admin.id ? 1 : 0)
      )
    assert.equal(
      abilityFor(snapshot.rules, "actor").can("update", "Settings"),
      false
    )
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('vamotors_runtime','vamotors.\"SettingsVersion\"','UPDATE') AS allowed"
        )
      ).rows[0].allowed,
      false
    )
    await writeFile(
      join(directory, "t04d-upgrade-result.json"),
      JSON.stringify(
        {
          passed: true,
          parent: snapshot.source,
          retainedTables: Object.keys(snapshot.retained),
          oldPermissions: snapshot.permissions.length,
          addedAdministratorMemberships: newMembers.length,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    console.log(
      "PASS retained rows, immutable permissions, old ceilings, explicit Administrator update grant and seven ordered migrations"
    )
  }
} finally {
  await db.end()
}
