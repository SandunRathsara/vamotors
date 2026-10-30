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
  codes = ["23514", "42501", "23503", "23505", "P0001"],
  expectedConstraint?:string
) {
  if(process.argv[3]&&!label.includes(process.argv[3])){
    results.push({label,skipped:true,reason:"Explicit affected-probe filter"})
    return
  }
  const before = await f.snapshot(tables),
    client = await f.restricted.connect()
  let code: string | undefined, constraint:string|undefined
  try {
    await client.query("BEGIN")
    await client.query(sql, values)
    await client.query("SET CONSTRAINTS ALL IMMEDIATE")
  } catch (error) {
    code = (error as { code?: string }).code
    constraint=(error as {constraint?:string}).constraint
  } finally {
    await client.query("ROLLBACK")
    client.release()
  }
  results.push({
    label,
    code: code ?? "UNEXPECTED_ACCEPTANCE_ROLLED_BACK",
    constraint,
    pass: !!code && codes.includes(code),
  })
  assert.equal(await f.snapshot(tables), before)
  assert.ok(
    code && codes.includes(code),
    `${label}: ${code ?? "statement accepted without required source proof"}`
  )
  if(expectedConstraint)assert.equal(constraint,expectedConstraint)
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
  const {rows:[pending]}=await f.db.query(`SELECT a.id,a."cycleId",a."requestCommandId",p."acquisitionCommandId",b.id basis,b.total
    FROM vamotors."ApprovalRequest" a JOIN vamotors."PurchaseRecord" p ON p.id=a."cycleId" JOIN vamotors."Vehicle" v ON v.id=p."vehicleId"
    JOIN LATERAL(SELECT id,total FROM vamotors."CycleBasisVersion" WHERE "cycleId"=p.id ORDER BY version DESC LIMIT 1)b ON true
    WHERE a.state='PENDING' AND p."closedAt" IS NULL
    AND a.expected=jsonb_build_array(jsonb_build_object('type','PurchaseRecord','id',p.id,'revision',p.revision),jsonb_build_object('type','Vehicle','id',v.id,'revision',v.revision))
    ORDER BY a."requestedAt" DESC,a.id LIMIT 1`)
  assert.ok(pending,"Needs an actual current pending proposal, not a fabricated owner")
  for(const column of ["proposal","expected","snapshot","payloadHash","requestedBy","requiredRecipientIds"])
    await denied(`NEW immutable ${column} ACL`, `UPDATE vamotors."ApprovalRequest" SET "${column}"="${column}" WHERE id=$1`,[pending.id],["42501"])
  await denied("NEW reviewer cannot be overwritten outside guarded decision",'UPDATE vamotors."ApprovalRequest" SET "reviewedBy"=$1 WHERE id=$2',[row.createdBy,pending.id],["23514"])
  await denied("NEW proposal insert cannot borrow an old acquisition receipt",`INSERT INTO vamotors."ApprovalRequest" SELECT (jsonb_populate_record(NULL::vamotors."ApprovalRequest",to_jsonb(a)||jsonb_build_object('id',$1::uuid,'requestCommandId',$2::uuid))).* FROM vamotors."ApprovalRequest" a WHERE id=$3`,[randomUUID(),pending.acquisitionCommandId,pending.id],["23514"])
  await denied("NEW notification cannot be forged for an old owner",`INSERT INTO vamotors."Notification"(id,"recipientUserId","eventKey",kind,"targetType","targetId") VALUES($1,$2,$3,'APPROVAL_REQUIRED','ApprovalRequest',$4)`,[randomUUID(),row.createdBy,`forged:${randomUUID()}`,pending.id],["23514"])
  await denied("NEW notification read needs its own current receipt and audit",`UPDATE vamotors."Notification" SET "readAt"=CURRENT_TIMESTAMP,revision=revision+1 WHERE id=(SELECT id FROM vamotors."Notification" WHERE "readAt" IS NULL ORDER BY id LIMIT 1)`,[],["23514"])
  for(const kind of ["CURRENT","IMPORTED"])
    await denied(`NEW ${kind} disposal cannot apply a pending request`, `INSERT INTO vamotors."Disposal"(id,"cycleId","approvalId","approvalKind","occurredDate",reason,method,proceeds,"basisVersionId","netLoss","createdBy","commandId") VALUES($1,$2,$3,$4,'2026-10-04','forged','OTHER',0,$5,$6,$7,$8)`,[randomUUID(),pending.cycleId,pending.id,kind,pending.basis,pending.total,row.createdBy,pending.requestCommandId],["23514"])
  const {rows:[zero]}=await f.db.query('SELECT d.id,d."cycleId",d."commandId",b.currency,b.scale FROM vamotors."Disposal" d JOIN vamotors."CycleBasisVersion" b ON b.id=d."basisVersionId" WHERE d.proceeds=0 ORDER BY d."recordedAt" DESC LIMIT 1')
  assert.ok(zero,"Needs a real approved zero-proceeds owner")
  const insertReceipt=`INSERT INTO vamotors."DisposalReceipt"(id,"disposalId","cycleId",amount,direction,category,"occurredDate",method,currency,scale,"commandId","lineKey") VALUES($1,$2,$3,$4,'IN','DISPOSAL','2026-10-05','CASH',$5,$6,$7,'proceeds')`
  await denied("NEW zero disposal rejects an extra positive cash fact",insertReceipt,[randomUUID(),zero.id,zero.cycleId,"1",zero.currency,zero.scale,zero.commandId],["23514"])
  await denied("NEW actual receipt A+1 is a check-bound rejection",insertReceipt,[randomUUID(),zero.id,zero.cycleId,"100000000000000",zero.currency,zero.scale,zero.commandId],["23514"],"DisposalReceipt_amount_check")
  await denied("NEW definer helper is not a callable runtime escape","SELECT vamotors.approval_canonical('{}'::jsonb)",[],["42501"])
} finally {
  await f.close()
  await writeFile(
    join(root, `approval-disposal-sql-${Date.now()}.json`),
    JSON.stringify({ source: process.cwd(), results }, null, 2) + "\n",
    { mode: 0o600 }
  )
}
console.log(JSON.stringify({ pass: true, scope:process.argv[3]??"all",attempted:results.filter(row=>!Object.hasOwn(row as object,"skipped")).length,skipped:results.filter(row=>Object.hasOwn(row as object,"skipped")).length }))
