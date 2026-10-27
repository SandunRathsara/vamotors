/** Run prepare on a genuine exact-parent installation, then verify after upgrade. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import {
  grantSchema,
  expanded,
  attenuation,
} from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"
process.umask(0o077)
const root = process.argv[2],
  mode = process.argv[3]
assert.ok(root && ["prepare", "verify"].includes(mode))
const env = await privateEnvironment(join(root, "migration.env"))
assert.equal(env.APP_ENV, "local")
assert.equal(new URL(env.DIRECT_URL!).hostname, "127.0.0.1")
const db = new pg.Client({ connectionString: env.DIRECT_URL })
await db.connect()
const inventory = async () => ({
  migrations: (
    await db.query(
      "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name"
    )
  ).rows,
  columns: (
    await db.query(
      "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
    )
  ).rows,
  grants: (
    await db.query(
      'SELECT "roleId","permissionId" FROM vamotors."RolePermission" ORDER BY "roleId","permissionId"'
    )
  ).rows,
})
const tables = [
  "Settings",
  "SettingsVersion",
  "FinanceCompany",
  "FinancePolicyVersion",
  "FinanceContact",
  "Supplier",
  "SupplierContact",
  "Customer",
  "Vehicle",
  "PurchaseRecord",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "Permission",
]
const rows = async () =>
  Object.fromEntries(
    await Promise.all(
      tables.map(async (t) => [
        t,
        (
          await db.query(
            `SELECT to_jsonb(t) AS row FROM vamotors."${t}" t ORDER BY id`
          )
        ).rows.map((r) => r.row),
      ])
    )
  )
try {
  if (mode === "prepare") {
    const before = await inventory()
    assert.equal(before.migrations.length, 7)
    assert.equal(
      (
        await db.query(
          "SELECT to_regclass('vamotors.\"PurchasePayment\"') AS t"
        )
      ).rows[0].t,
      null
    )
    const ids = Object.fromEntries(
      [
        "role",
        "identityRole",
        "supplier",
        "contact",
        "customer",
        "company",
        "financeContact",
        "policy",
        "vehicle",
        "purchase",
        "command",
        "version",
      ].map((k) => [k, randomUUID()])
    )
    const actor = "03000000-0000-4000-8000-000000000011"
    await db.query("BEGIN")
    await db.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    await db.query("SELECT vamotors.lock_admin_guard()")
    await db.query('INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)', [
      ids.role,
      `T05a genuine-parent ceiling ${ids.role}`,
    ])
    const grants: Grant[] = [
      {
        subject: "Vehicle",
        action: "read",
        fields: ["financial"],
        conditions: { createdBy: "$actor.id" },
      },
      { subject: "Vehicle", action: "read", fields: ["*"] },
      { subject: "PurchaseRecord", action: "read", fields: ["*"] },
    ]
    for (const rule of grants) {
      const hash = createHash("sha256").update(canonical(rule)).digest("hex")
      await db.query(
        'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
        [randomUUID(), hash, rule]
      )
      await db.query(
        'INSERT INTO vamotors."RolePermission" SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
        [ids.role, hash]
      )
    }
    await db.query('INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)', [
      ids.identityRole,
      `T05a genuine-parent identity ${ids.identityRole}`,
    ])
    for (const rule of [
      { subject: "Vehicle", action: "read", fields: ["id", "identity"] },
      { subject: "PurchaseRecord", action: "read", fields: ["id"] },
    ]) {
      const hash = createHash("sha256").update(canonical(rule)).digest("hex")
      await db.query(
        'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
        [randomUUID(), hash, rule]
      )
      await db.query(
        'INSERT INTO vamotors."RolePermission" SELECT $1,id FROM vamotors."Permission" WHERE "ruleHash"=$2',
        [ids.identityRole, hash]
      )
    }
    await db.query(
      'INSERT INTO vamotors."Supplier"(id,name,category,"createdBy","updatedAt") VALUES($1,\'Retained T05a parent supplier\',\'COMPANY\',$2,CURRENT_TIMESTAMP)',
      [ids.supplier, actor]
    )
    await db.query(
      "INSERT INTO vamotors.\"SupplierContact\"(id,\"supplierId\",name,phone,role,\"isPrimary\") VALUES($1,$2,'Retained supplier contact','0112345678','Agent',true)",
      [ids.contact, ids.supplier]
    )
    await db.query(
      'INSERT INTO vamotors."Customer"(id,"fullName","callingName","nicOrPassport","normalizedIdentity",address,phone,"createdBy","updatedAt") VALUES($1,\'Retained parent\',\'Retained\',$2,$2,\'Synthetic address\',\'0112345678\',$3,CURRENT_TIMESTAMP)',
      [ids.customer, `PARENT-${ids.customer.toUpperCase()}`, actor]
    )
    await db.query(
      'INSERT INTO vamotors."FinancePolicyVersion"(id,"companyId",version,values) VALUES($1,$2,1,$3)',
      [
        ids.policy,
        ids.company,
        {
          path: "APPLICATION",
          commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
          processingFee: "250000",
          reconciliationMethod: "PER_DEAL",
        },
      ]
    )
    await db.query(
      'INSERT INTO vamotors."FinanceCompany"(id,name,"currentPolicyId","createdBy","updatedAt") VALUES($1,\'Retained shared finance\',$2,$3,CURRENT_TIMESTAMP)',
      [ids.company, ids.policy, actor]
    )
    await db.query(
      "INSERT INTO vamotors.\"FinanceContact\"(id,\"companyId\",name,phone,role) VALUES($1,$2,'Retained finance contact','0112345678','Agent')",
      [ids.financeContact, ids.company]
    )
    await db.query(
      'INSERT INTO vamotors."Vehicle"(id,"engineNumber","chassisNumber","normalizedEngine","normalizedChassis",make,model,year,colour,"fuelType",transmission,"createdBy","updatedAt","activePurchaseId") VALUES($1,$2,$2,$2,$2,\'Synthetic\',\'Genuine parent fixture\',2026,\'Blue\',\'PETROL\',\'AUTOMATIC\',$3,CURRENT_TIMESTAMP,$4)',
      [ids.vehicle, ids.vehicle.toUpperCase(), actor, ids.purchase]
    )
    await db.query(
      'INSERT INTO vamotors."PurchaseRecord"(id,"vehicleId","cycleNumber","purchaseType","acquisitionKind","supplierId","purchaseDate","purchasePrice","createdBy","updatedAt") VALUES($1,$2,1,\'CASH\',\'SUPPLIER\',$3,\'2026-10-01\',10000,$4,CURRENT_TIMESTAMP)',
      [ids.purchase, ids.vehicle, ids.supplier, actor]
    )
    const sequence = (
      await db.query(
        'UPDATE vamotors."BusinessSequence" SET value=value+1 WHERE id=1 RETURNING value'
      )
    ).rows[0].value
    await db.query(
      'INSERT INTO vamotors."CommandReceipt"(id,"environmentId","actorKey","commandName","idempotencyKey","inputHash",result,"businessSequence") VALUES($1,$2,$3,\'T05aParentFixture\',$1,\'synthetic-fixture\',$4,$5)',
      [
        ids.command,
        env.ENVIRONMENT_ID,
        `USER:${actor}`,
        { type: "PurchaseRecord", id: ids.purchase, revision: 1 },
        sequence,
      ]
    )
    await db.query(
      'INSERT INTO vamotors."AuditEntry"(id,"entityType","entityId","commandId",action,"actorKind","userId","fieldDiff") VALUES($1,\'PurchaseRecord\',$2,$3,\'fixture\',\'USER\',$4,$5)',
      [
        randomUUID(),
        ids.purchase,
        ids.command,
        actor,
        { purchasePrice: { before: null, after: "10000" } },
      ]
    )
    await db.query(
      'INSERT INTO vamotors."EntityReadVersion"(id,"entityType","entityId",sequence,revision,payload,"commandId") VALUES($1,\'PurchaseRecord\',$2,$3,1,$4,$5)',
      [
        ids.version,
        ids.purchase,
        sequence,
        { id: ids.purchase, purchasePrice: "10000" },
        ids.command,
      ]
    )
    await db.query("SET CONSTRAINTS ALL IMMEDIATE")
    await db.query("COMMIT")
    await writeFile(
      join(root, "t05a-parent-before.json"),
      JSON.stringify({
        parent: "7573c54532c5f80edef3d8eaa452720d018f5d1b",
        ids,
        grants,
        rows: await rows(),
        inventory: await inventory(),
      }),
      { mode: 0o600 }
    )
    console.log(
      "PASS genuine seven-migration exact-parent fixture and pre-upgrade inventory retained"
    )
  } else {
    const before = JSON.parse(
        await readFile(join(root, "t05a-parent-before.json"), "utf8")
      ),
      after = await rows(),
      inv = await inventory()
    assert.equal(inv.migrations.length, 9)
    assert.deepEqual(inv.migrations.slice(0, 7), before.inventory.migrations)
    for (const table of tables)
      for (const original of before.rows[table]) {
        const row = after[table].find(
          (r: { id: string }) => r.id === original.id
        )
        assert.ok(row, `retained_${table}`)
        assert.deepEqual(
          Object.fromEntries(Object.keys(original).map((k) => [k, row[k]])),
          original,
          `unchanged_${table}`
        )
      }
    const grants = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE rp."roleId"=$1',
        [before.ids.role]
      )
    ).rows.map((r) => grantSchema.parse(r.rule) as Grant)
    for (const g of grants) {
      assert.ok(!g.fields.includes("*"))
      assert.ok(!g.fields.includes("financial"))
      if (g.subject === "PurchaseRecord")
        for (const f of expanded(g))
          assert.ok(
            ["id", "purchaseDate", "status", "purchasePrice"].includes(f)
          )
      if (g.subject === "Vehicle")
        for (const f of expanded(g))
          assert.ok(
            ![
              "identityRevision",
              "financial.cashOut",
              "financial.currency",
              "mileage",
              "provenance",
            ].includes(f)
          )
    }
    assert.equal(
      attenuation(
        grants,
        [],
        [{ subject: "PurchaseRecord", action: "read", fields: ["payments"] }],
        "03000000-0000-4000-8000-000000000011"
      ).covered,
      false
    )
    const adminGrants = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" WHERE r."systemKey"=\'ADMINISTRATOR\''
      )
    ).rows.map((r) => grantSchema.parse(r.rule) as Grant)
    assert.ok(
      adminGrants.some(
        (g) => g.subject === "PurchaseRecord" && g.action === "create"
      )
    )
    assert.ok(
      adminGrants.some((g) => g.subject === "Vehicle" && g.action === "create")
    )
    assert.equal(
      (await db.query('SELECT count(*) FROM vamotors."PurchasePayment"'))
        .rows[0].count,
      "0"
    )
    await writeFile(
      join(root, "t05a-upgrade-after.json"),
      JSON.stringify({
        parent: before.parent,
        candidate: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        preservedTables: tables,
        frozenGrants: grants,
        inventory: inv,
        result: "PASS — author evidence only",
      }),
      { mode: 0o600 }
    )
    console.log(
      "PASS exact-parent upgrade: immutable rows/hashes, Settings/finance/contacts/purchase preserved; wildcard/compound/delegated ceilings frozen; only Administrator expanded"
    )
  }
} finally {
  await db.end()
}
