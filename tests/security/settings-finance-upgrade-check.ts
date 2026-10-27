/** Prepare on the genuine five-migration parent BEFORE applying T04c. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import {
  abilityFor,
  grantSchema,
  fieldsFor,
} from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const directory = process.argv[2],
  action = process.argv[3]
assert.ok(directory && ["prepare", "verify"].includes(action))
const env = await privateEnvironment(join(directory, "migration.env"))
assert.equal(env.APP_ENV, "local")
assert.equal(new URL(env.DIRECT_URL!).hostname, "127.0.0.1")
const db = new pg.Client({ connectionString: env.DIRECT_URL })
await db.connect()
const inventory = async () => ({
  permissions: (
    await db.query(
      'SELECT id,"ruleHash",rule FROM vamotors."Permission" ORDER BY id'
    )
  ).rows,
  roles: (await db.query('SELECT id,revision FROM vamotors."Role" ORDER BY id'))
    .rows,
  grants: (
    await db.query(
      'SELECT "roleId","permissionId" FROM vamotors."RolePermission" ORDER BY "roleId","permissionId"'
    )
  ).rows,
  tables: (
    await db.query(
      "SELECT relname,relacl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind='r' ORDER BY relname"
    )
  ).rows,
  columns: (
    await db.query(
      "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
    )
  ).rows,
})
try {
  if (action === "prepare") {
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL"
        )
      ).rows[0].count,
      "5"
    )
    assert.equal(
      (await db.query("SELECT to_regclass('vamotors.\"Settings\"') AS t"))
        .rows[0].t,
      null
    )
    const role = randomUUID(),
      supplier = randomUUID(),
      contact = randomUUID(),
      vehicle = randomUUID(),
      purchase = randomUUID()
    const grants: Grant[] = [
      {
        subject: "Supplier",
        action: "read",
        fields: ["*"],
        conditions: { createdBy: "$actor.id" },
      },
      {
        subject: "RepairVendor",
        action: "read",
        fields: ["directory.contacts"],
      },
      { subject: "RepairVendor", action: "read", fields: ["*"] },
    ]
    await db.query("BEGIN")
    await db.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    await db.query("SELECT vamotors.lock_admin_guard()")
    await db.query('INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)', [
      role,
      `T04c genuine parent custom ${role}`,
    ])
    for (const rule of grants) {
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
    const actor = "03000000-0000-4000-8000-000000000011"
    await db.query(
      'INSERT INTO vamotors."Supplier"(id,name,category,"createdBy","updatedAt") VALUES($1,\'T04c retained genuine parent\',\'COMPANY\',$2,CURRENT_TIMESTAMP)',
      [supplier, actor]
    )
    await db.query(
      "INSERT INTO vamotors.\"SupplierContact\"(id,\"supplierId\",name,phone,role,\"isPrimary\") VALUES($1,$2,'Retained parent contact','0112345678','Agent',true)",
      [contact, supplier]
    )
    await db.query(
      'INSERT INTO vamotors."Vehicle"(id,"engineNumber","chassisNumber","normalizedEngine","normalizedChassis",make,model,year,colour,"fuelType",transmission,"createdBy","updatedAt","activePurchaseId") VALUES($1,$2,$3,$2,$3,\'Synthetic\',\'Parent currency fixture\',2026,\'Test\',\'OTHER\',\'OTHER\',$4,CURRENT_TIMESTAMP,$5)',
      [
        vehicle,
        `E-${vehicle.toUpperCase()}`,
        `C-${vehicle.toUpperCase()}`,
        actor,
        purchase,
      ]
    )
    await db.query(
      'INSERT INTO vamotors."PurchaseRecord"(id,"vehicleId","cycleNumber","purchaseType","acquisitionKind","supplierId","purchaseDate","purchasePrice","createdBy","updatedAt") VALUES($1,$2,1,\'CASH\',\'SUPPLIER\',$3,\'2026-01-01\',10000,$4,CURRENT_TIMESTAMP)',
      [purchase, vehicle, supplier, actor]
    )
    await db.query("SET CONSTRAINTS ALL IMMEDIATE")
    await db.query("COMMIT")
    const retained = (
      await db.query(
        'SELECT to_jsonb(s) AS supplier,(SELECT to_jsonb(c) FROM vamotors."SupplierContact" c WHERE id=$2) AS contact,(SELECT to_jsonb(p) FROM vamotors."PurchaseRecord" p WHERE id=$3) AS purchase FROM vamotors."Supplier" s WHERE id=$1',
        [supplier, contact, purchase]
      )
    ).rows[0]
    await writeFile(
      join(directory, "t04c-parent-inventory.json"),
      JSON.stringify(
        {
          source: "08d17063bfe3cbec37cd995bdb7c44bf057412ba",
          role,
          supplier,
          contact,
          purchase,
          retained,
          ...(await inventory()),
        },
        null,
        2
      ),
      { mode: 0o600, flag: "wx" }
    )
    console.log(
      "PASS genuine 08d17063 parent: five applied migrations, retained purchase/contact and persisted custom wildcard/compound grants inventoried before upgrade."
    )
  } else {
    const before = JSON.parse(
      await readFile(join(directory, "t04c-parent-inventory.json"), "utf8")
    )
    const after = await inventory()
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL"
        )
      ).rows[0].count,
      "6"
    )
    for (const row of before.permissions)
      assert.deepEqual(
        after.permissions.find((p) => p.id === row.id),
        row
      )
    const retained = (
      await db.query(
        'SELECT to_jsonb(s) AS supplier,(SELECT to_jsonb(c) FROM vamotors."SupplierContact" c WHERE id=$2) AS contact,(SELECT to_jsonb(p) FROM vamotors."PurchaseRecord" p WHERE id=$3) AS purchase FROM vamotors."Supplier" s WHERE id=$1',
        [before.supplier, before.contact, before.purchase]
      )
    ).rows[0]
    assert.deepEqual(retained, before.retained)
    for (const row of before.roles)
      assert.equal(
        after.roles.find((r) => r.id === row.id).revision,
        row.revision + 1
      )
    for (const p of after.permissions) {
      grantSchema.parse(p.rule)
      assert.equal(
        createHash("sha256").update(canonical(p.rule)).digest("hex"),
        p.ruleHash
      )
    }
    const grants = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE rp."roleId"=$1',
        [before.role]
      )
    ).rows.map((r) => r.rule)
    const ability = abilityFor(grants, "a")
    assert.equal(
      ability.can("read", "Supplier", "contributions.purchases"),
      false
    )
    assert.equal(
      ability.can("read", "RepairVendor", "contributions.repairs"),
      false
    )
    assert.equal(
      ability.can("read", "RepairVendor", "directory.contacts"),
      true
    )
    assert.equal(ability.can("read", "Settings"), false)
    assert.equal(ability.can("create", "FinanceCompany"), false)
    const admin = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Role" r ON r.id=rp."roleId" JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE r."systemKey"=\'ADMINISTRATOR\''
      )
    ).rows.map((r) => r.rule)
    const adminAbility = abilityFor(admin, "a")
    for (const type of [
      "Supplier",
      "RepairVendor",
      "Settings",
      "FinanceCompany",
    ] as const)
      for (const field of fieldsFor(type, "read"))
        assert.equal(adminAbility.can("read", type, field), true)
    assert.equal(adminAbility.can("update", "Settings"), false)
    const guards = (
      await db.query(
        "SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('protected_permissions','protected_role') AND NOT tgisinternal"
      )
    ).rows
    assert.ok(guards.length >= 2 && guards.every((g) => g.tgenabled === "O"))
    await writeFile(
      join(directory, "t04c-upgraded-inventory.json"),
      JSON.stringify(after, null, 2),
      { mode: 0o600 }
    )
    console.log(
      `PASS upgrade: ${before.permissions.length} immutable old permissions retained; ${after.permissions.length} validated; role revisions advanced; custom grants frozen, Administrator deliberately expanded; retained purchase/contact unchanged; guards restored.`
    )
  }
} finally {
  await db.end()
}
