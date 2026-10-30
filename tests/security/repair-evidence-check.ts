/** Native restricted-role adversarial transactions. Every probe rolls back;
 * specifically prove that standalone evidence cannot bypass the root graph. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"

process.umask(0o077)
const [root, summaryPath] = process.argv.slice(2)
assert.ok(root && summaryPath.startsWith(`${root}/`))
const seed = JSON.parse(await readFile(summaryPath, "utf8")) as {
  cycleId: string
  repairId: string
  groups: string[]
}
assert.equal(seed.groups.length, 6)
const runtime = await privateEnvironment(join(root, "runtime.env"))
const db = new pg.Client({ connectionString: runtime.DATABASE_URL })
const observations: { name: string; rejected: boolean; code?: string }[] = []
try {
  await db.connect()
  const probe = async (name: string, run: () => Promise<void>) => {
    await db.query("BEGIN")
    try {
      await run()
      await db.query("SET CONSTRAINTS ALL IMMEDIATE")
      observations.push({ name, rejected: false })
    } catch (error) {
      const code = (error as { code?: string }).code
      assert.ok(
        ["23514", "42501"].includes(code ?? ""),
        `UNEXPECTED_SQLSTATE_${code}`
      )
      observations.push({ name, rejected: true, code })
    } finally {
      await db.query("ROLLBACK")
    }
  }
  await probe("standalone repair receipt", async () => {
    await db.query(
      'UPDATE vamotors."BusinessSequence" SET value=value+1 WHERE id=1'
    )
    await db.query(
      `INSERT INTO vamotors."CommandReceipt"(id,"environmentId","actorKey","commandName","idempotencyKey","inputHash",result,"businessSequence")
      SELECT $1,$2,'USER:'||r."createdBy"::text,'payRepair',$3,repeat('0',64),jsonb_build_object('type','RepairRecord','id',r.id,'revision',r.revision+1),(SELECT value FROM vamotors."BusinessSequence" WHERE id=1) FROM vamotors."RepairRecord" r WHERE id=$4`,
      [randomUUID(), runtime.ENVIRONMENT_ID, randomUUID(), seed.repairId]
    )
  })
  await probe("orphan repair read-version", async () => {
    await db.query(
      `INSERT INTO vamotors."EntityReadVersion"(id,"entityType","entityId",sequence,revision,payload,"commandId")
      SELECT $1,e."entityType",e."entityId",c."businessSequence",e.revision,e.payload,c.id
      FROM vamotors."EntityReadVersion" e CROSS JOIN LATERAL (
        SELECT x.id,x."businessSequence" FROM vamotors."CommandReceipt" x WHERE x."businessSequence" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM vamotors."EntityReadVersion" old WHERE old."entityType"='RepairRecord' AND old."entityId"=$2 AND old.sequence=x."businessSequence") ORDER BY x."businessSequence" LIMIT 1
      ) c WHERE e."entityType"='RepairRecord' AND e."entityId"=$2 ORDER BY e.sequence DESC LIMIT 1`,
      [randomUUID(), seed.repairId]
    )
  })
  await probe("orphan repair audit", async () => {
    await db.query(
      `INSERT INTO vamotors."AuditEntry"(id,"entityType","entityId","commandId",action,"actorKind","userId","fieldDiff")
      SELECT $1,"entityType","entityId","commandId",action,"actorKind","userId","fieldDiff" FROM vamotors."AuditEntry" WHERE "entityType"='RepairRecord' AND "entityId"=$2 ORDER BY "recordedAt" DESC LIMIT 1`,
      [randomUUID(), seed.repairId]
    )
  })
  await probe(
    "child plus root revisions with no root versions/audit/cash",
    async () => {
      const sequence = (
        await db.query(
          'UPDATE vamotors."BusinessSequence" SET value=value+1 WHERE id=1 RETURNING value'
        )
      ).rows[0].value
      const commandId = randomUUID()
      await db.query(
        `INSERT INTO vamotors."CommandReceipt"(id,"environmentId","actorKey","commandName","idempotencyKey","inputHash",result,"businessSequence")
      SELECT $1,$2,'USER:'||r."createdBy"::text,'payRepair',$3,repeat('0',64),jsonb_build_object('type','RepairRecord','id',r.id,'revision',r.revision+1),$4::bigint FROM vamotors."RepairRecord" r WHERE id=$5`,
        [
          commandId,
          runtime.ENVIRONMENT_ID,
          randomUUID(),
          sequence,
          seed.repairId,
        ]
      )
      await db.query(
        'UPDATE vamotors."RepairRecord" SET revision=revision+1 WHERE id=$1',
        [seed.repairId]
      )
      await db.query(
        'UPDATE vamotors."PurchaseRecord" SET revision=revision+1 WHERE id=$1',
        [seed.cycleId]
      )
      await db.query(
        `INSERT INTO vamotors."EntityReadVersion"(id,"entityType","entityId",sequence,revision,payload,"commandId")
      SELECT $1,'RepairRecord',r.id,$2::bigint,r.revision,jsonb_set(e.payload,'{revision}',to_jsonb(r.revision)),$3 FROM vamotors."RepairRecord" r JOIN LATERAL (SELECT payload FROM vamotors."EntityReadVersion" WHERE "entityType"='RepairRecord' AND "entityId"=r.id ORDER BY sequence DESC LIMIT 1) e ON true WHERE r.id=$4`,
        [randomUUID(), sequence, commandId, seed.repairId]
      )
    }
  )
  assert.ok(
    observations.every((o) => o.rejected),
    `UNGUARDED_REPAIR_EVIDENCE: ${observations
      .filter((o) => !o.rejected)
      .map((o) => o.name)
      .join(", ")}`
  )
  console.log(
    `PASS ${observations.length} native repair evidence forgery probes, all rolled back`
  )
} catch (error) {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : `Evidence probe failed, SQLSTATE ${(error as { code?: string }).code ?? "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-evidence-${randomUUID()}.json`),
    JSON.stringify({ seed, observations, source: process.cwd() }, null, 2),
    { mode: 0o600, flag: "wx" }
  )
  await db.end()
}
