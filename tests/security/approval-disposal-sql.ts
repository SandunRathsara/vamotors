/** Restricted-runtime statements always roll back, even if a guard is missing. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fixture } from "./cycle-edits-fixture"

const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  results: unknown[] = []
const tables = [
  "PurchaseRecord",
  "Vehicle",
  "StatusEvent",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "Notification",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
]
async function denied(
  label: string,
  sql: string,
  values: unknown[] = [],
  codes = ["23514", "42501", "23503", "23505", "P0001"]
) {
  const before = await f.snapshot(tables),
    client = await f.restricted.connect()
  let code: string | undefined
  try {
    await client.query("BEGIN")
    await client.query(sql, values)
    await client.query("SET CONSTRAINTS ALL IMMEDIATE")
  } catch (error) {
    code = (error as { code?: string }).code
  } finally {
    await client.query("ROLLBACK")
    client.release()
  }
  results.push({
    label,
    code: code ?? "UNEXPECTED_ACCEPTANCE_ROLLED_BACK",
    pass: !!code && codes.includes(code),
  })
  assert.equal(await f.snapshot(tables), before)
  assert.ok(
    code && codes.includes(code),
    `${label}: ${code ?? "statement accepted without required source proof"}`
  )
}
try {
  const {
    rows: [row],
  } = await f.db.query(
    'SELECT p.id,p."vehicleId",p.status,p."acquisitionCommandId",p."createdBy",p."purchaseDate" FROM vamotors."PurchaseRecord" p WHERE p."acquisitionCommandId" IS NOT NULL AND p."closedAt" IS NULL ORDER BY p."createdAt" DESC LIMIT 1'
  )
  assert.ok(
    row,
    "Needs retained real acquired open cycle; never fabricate a terminal fixture"
  )
  await denied(
    "standalone approvedWriteOff history cannot borrow an acquisition receipt",
    'INSERT INTO vamotors."StatusEvent"(id,"cycleId","from","to",action,"commandId","userId","occurredAt") VALUES($1,$2,$3,\'WRITTEN_OFF\',\'approvedWriteOff\',$4,$5,$6)',
    [
      randomUUID(),
      row.id,
      row.status,
      row.acquisitionCommandId,
      row.createdBy,
      row.purchaseDate,
    ]
  )
  await denied(
    "arbitrary close without approval owner evidence",
    'UPDATE vamotors."PurchaseRecord" SET status=\'WRITTEN_OFF\',available=false,"closedAt"=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=$1',
    [row.id]
  )
  await denied(
    "arbitrary active pointer clear without approval evidence",
    'UPDATE vamotors."Vehicle" SET "activePurchaseId"=NULL,revision=revision+1 WHERE id=$1',
    [row.vehicleId]
  )
  for (const table of [
    "ApprovalRequest",
    "Disposal",
    "DisposalReceipt",
    "StatusEvent",
    "CommandReceipt",
    "AuditEntry",
    "EntityReadVersion",
  ]) {
    await denied(
      `${table} history DELETE denied`,
      `DELETE FROM vamotors."${table}"`
    )
    await denied(
      `${table} history TRUNCATE denied`,
      `TRUNCATE vamotors."${table}"`
    )
  }
  await denied(
    "business DDL denied",
    "CREATE TABLE vamotors.writeoff_runtime_escape(id integer)",
    [],
    ["42501"]
  )
  await denied(
    "trigger disabling denied",
    'ALTER TABLE vamotors."ApprovalRequest" DISABLE TRIGGER ALL',
    [],
    ["42501"]
  )
  await denied(
    "replication-role trigger bypass denied",
    "SET LOCAL session_replication_role=replica",
    [],
    ["42501"]
  )
  await denied(
    "new source rows immutable",
    'UPDATE vamotors."Disposal" SET proceeds=proceeds+1'
  )
  await denied(
    "decision without receipt graph denied",
    'UPDATE vamotors."ApprovalRequest" SET state=\'REJECTED\',revision=revision+1,"reviewedBy"=$1,"reviewedAt"=CURRENT_TIMESTAMP,"reviewNote"=\'forged\',"reviewerName"=\'forged\',"reviewCommandId"=$2 WHERE state=\'PENDING\'',
    [row.createdBy, row.acquisitionCommandId]
  )
} finally {
  await f.close()
  await writeFile(
    join(root, `approval-disposal-sql-${Date.now()}.json`),
    JSON.stringify({ source: process.cwd(), results }, null, 2) + "\n",
    { mode: 0o600 }
  )
}
console.log(JSON.stringify({ pass: true, statements: results.length }))
