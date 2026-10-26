/** Run prepare on a genuine exported exact-parent installation, then upgrade
 * from current source. Does not stop/reset services or rewrite old migrations. */
import assert from "node:assert/strict"
import { randomUUID, createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import { abilityFor, grantSchema } from "../../lib/server/permissions"
import type { Grant } from "../../.planning/implementation/contracts/api"

const directory = process.argv[2]
const action = process.argv[3]
assert.ok(directory && ["prepare", "upgrade"].includes(action))
const migration = await privateEnvironment(join(directory, "migration.env"))
assert.equal(migration.APP_ENV, "local")
assert.equal(new URL(migration.DIRECT_URL!).hostname, "127.0.0.1")
const db = new pg.Client({ connectionString: migration.DIRECT_URL })
await db.connect()
try {
  if (action === "prepare") {
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL"
        )
      ).rows[0].count,
      "4"
    )
    const id = randomUUID()
    const grants: Grant[] = [
      {
        subject: "Supplier",
        action: "read",
        fields: ["*"],
        conditions: { createdBy: "$actor.id" },
      },
      { subject: "Supplier", action: "read", fields: ["contacts"] },
    ]
    await db.query("BEGIN")
    await db.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    await db.query("SELECT vamotors.lock_admin_guard()")
    await db.query('INSERT INTO vamotors."Role"(id,name) VALUES($1,$2)', [
      id,
      `Parent legacy supplier ${id}`,
    ])
    for (const rule of grants) {
      const hash = createHash("sha256").update(canonical(rule)).digest("hex")
      await db.query(
        'INSERT INTO vamotors."Permission"(id,"ruleHash",rule) VALUES($1,$2,$3) ON CONFLICT("ruleHash") DO NOTHING',
        [randomUUID(), hash, rule]
      )
      const pid = (
        await db.query(
          'SELECT id FROM vamotors."Permission" WHERE "ruleHash"=$1',
          [hash]
        )
      ).rows[0].id
      await db.query('INSERT INTO vamotors."RolePermission" VALUES($1,$2)', [
        id,
        pid,
      ])
    }
    const partyId = randomUUID(),
      contactId = randomUUID(),
      commandId = randomUUID()
    await db.query(
      "INSERT INTO vamotors.\"Supplier\"(id,name,category,\"createdBy\",\"updatedAt\") VALUES($1,'Genuine parent retained supplier','COMPANY','03000000-0000-4000-8000-000000000011',CURRENT_TIMESTAMP)",
      [partyId]
    )
    await db.query(
      "INSERT INTO vamotors.\"SupplierContact\"(id,\"supplierId\",name,phone,role,\"isPrimary\") VALUES($1,$2,'Parent retained contact','123456789','Manager',true)",
      [contactId, partyId]
    )
    const sequence = (
      await db.query(
        'UPDATE vamotors."BusinessSequence" SET value=value+1 WHERE id=1 RETURNING value'
      )
    ).rows[0].value
    await db.query(
      'INSERT INTO vamotors."CommandReceipt"(id,"environmentId","actorKey","commandName","idempotencyKey","inputHash",result,"businessSequence") VALUES($1,$2,\'OPERATOR:PARENT_TEST\',\'parentUpgradeEvidence\',$1,\'synthetic\',$3,$4)',
      [
        commandId,
        migration.ENVIRONMENT_ID,
        { type: "Supplier", id: partyId, revision: 1 },
        sequence,
      ]
    )
    await db.query(
      'INSERT INTO vamotors."AuditEntry"(id,"entityType","entityId","commandId",action,"actorKind","userId","fieldDiff") VALUES($1,\'Supplier\',$2,$3,\'create\',\'USER\',\'03000000-0000-4000-8000-000000000011\',$4)',
      [
        randomUUID(),
        partyId,
        commandId,
        { name: { before: null, after: "Genuine parent retained supplier" } },
      ]
    )
    await db.query(
      'INSERT INTO vamotors."EntityReadVersion"(id,"entityType","entityId",sequence,revision,payload,"commandId") VALUES($1,\'Supplier\',$2,$3,1,$4,$5)',
      [
        randomUUID(),
        partyId,
        sequence,
        { id: partyId, name: "Genuine parent retained supplier", revision: 1 },
        commandId,
      ]
    )
    await db.query("COMMIT")
    const permissions = (
      await db.query(
        'SELECT id,"ruleHash",rule FROM vamotors."Permission" ORDER BY id'
      )
    ).rows
    const roles = (
      await db.query('SELECT id,revision FROM vamotors."Role" ORDER BY id')
    ).rows
    const history = (
      await db.query(
        'SELECT to_jsonb(s) AS supplier,(SELECT jsonb_agg(c) FROM vamotors."SupplierContact" c WHERE c."supplierId"=s.id) AS contacts,(SELECT jsonb_agg(v) FROM vamotors."EntityReadVersion" v WHERE v."entityId"=s.id) AS versions,(SELECT jsonb_agg(a) FROM vamotors."AuditEntry" a WHERE a."entityId"=s.id) AS audits,(SELECT jsonb_agg(r) FROM vamotors."CommandReceipt" r WHERE r.id=$2) AS receipts FROM vamotors."Supplier" s WHERE id=$1',
        [partyId, commandId]
      )
    ).rows[0]
    await writeFile(
      join(directory, "party-parent-inventory.json"),
      JSON.stringify({
        role: id,
        permissions,
        roles,
        partyId,
        commandId,
        history,
      }),
      { mode: 0o600, flag: "wx" }
    )
    console.log(
      `PASS genuine parent: four applied migrations, ${permissions.length} immutable grants, ${roles.length} roles; wildcard/contact parent saved before expansion.`
    )
  } else {
    const prior = JSON.parse(
      await readFile(join(directory, "party-parent-inventory.json"), "utf8")
    )
    const admin = await privateEnvironment(join(directory, "admin.env"))
    const url = new URL(admin.ADMIN_URL!)
    url.pathname = new URL(migration.DIRECT_URL!).pathname
    const owner = new pg.Client({ connectionString: url.href })
    await owner.connect()
    try {
      await owner.query(
        "GRANT CREATE ON DATABASE vamotors_local TO vamotors_migrator"
      )
      try {
        execFileSync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            "scripts/migrate-disposable.ts",
            join(directory, "migration.env"),
          ],
          { stdio: "pipe" }
        )
      } finally {
        await owner.query(
          "REVOKE CREATE ON DATABASE vamotors_local FROM vamotors_migrator"
        )
      }
      await owner.query(
        await readFile("scripts/local-runtime-grants.sql", "utf8")
      )
    } finally {
      await owner.end()
    }
    const permissions = (
      await db.query(
        'SELECT id,"ruleHash",rule FROM vamotors."Permission" ORDER BY id'
      )
    ).rows
    for (const old of prior.permissions)
      assert.deepEqual(
        permissions.find((p) => p.id === old.id),
        old
      )
    if (prior.history) {
      const history = (
        await db.query(
          'SELECT to_jsonb(s) AS supplier,(SELECT jsonb_agg(c) FROM vamotors."SupplierContact" c WHERE c."supplierId"=s.id) AS contacts,(SELECT jsonb_agg(v) FROM vamotors."EntityReadVersion" v WHERE v."entityId"=s.id) AS versions,(SELECT jsonb_agg(a) FROM vamotors."AuditEntry" a WHERE a."entityId"=s.id) AS audits,(SELECT jsonb_agg(r) FROM vamotors."CommandReceipt" r WHERE r.id=$2) AS receipts FROM vamotors."Supplier" s WHERE id=$1',
          [prior.partyId, prior.commandId]
        )
      ).rows[0]
      assert.deepEqual(history, prior.history)
    }
    for (const row of permissions) grantSchema.parse(row.rule)
    const grants = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE rp."roleId"=$1',
        [prior.role]
      )
    ).rows.map((r) => r.rule)
    const ability = abilityFor(grants, "a")
    for (const field of [
      "type",
      "provenance",
      "directory.name",
      "directory.contacts",
    ])
      assert.equal(ability.can("read", "Supplier", field), false)
    assert.equal(ability.can("create", "Supplier"), false)
    assert.equal(ability.can("read", "RepairVendor"), false)
    assert.equal(ability.can("read", "Supplier", "contacts"), true)
    const roles = (await db.query('SELECT id,revision FROM vamotors."Role"'))
      .rows
    for (const old of prior.roles)
      assert.equal(
        roles.find((r) => r.id === old.id).revision,
        old.revision + 1
      )
    const adminGrants = (
      await db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Role" r ON r.id=rp."roleId" JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE r."systemKey"=\'ADMINISTRATOR\''
      )
    ).rows.map((r) => r.rule)
    assert.equal(
      abilityFor(adminGrants, "a").can("create", "RepairVendor", "contacts"),
      true
    )
    const guards = (
      await db.query(
        "SELECT tgname,tgenabled FROM pg_trigger WHERE tgname IN ('protected_permissions','protected_role') AND NOT tgisinternal"
      )
    ).rows
    assert.ok(guards.length >= 2 && guards.every((g) => g.tgenabled === "O"))
    console.log(
      `PASS genuine parent upgrade: ${prior.permissions.length} old permissions unchanged, ${permissions.length} revalidated, ${roles.length} revisions bumped; legacy wildcard/parent grants do not expand, Administrator only expanded; guards restored.`
    )
  }
} finally {
  await db.end()
}
