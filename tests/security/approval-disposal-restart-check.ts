/** Real post-application app/PG/file restart with NEW authentication, never reseeding. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, writeFile, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import type { APIRequestContext } from "@playwright/test"
import type {
  Applied,
  Pending,
  DownloadDTO,
  PurchaseCycleDTO,
  CurrentActorDTO,
} from "../../.planning/implementation/contracts/api"
import { privateEnvironment } from "../../scripts/private-environment"
import { fixture } from "./cycle-edits-fixture"

const root = process.argv[2]
const { PROJECT } = await privateEnvironment(join(root, "cluster.env"))
const f = await fixture(root, PROJECT)
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex")
async function graph() {
  const result: Record<string, unknown> = {}
  const tables = (
    await f.db.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND relkind='r' AND relname NOT IN ('AdminGuard','session','verification') ORDER BY relname"
    )
  ).rows
  for (const { relname } of tables) {
    assert.match(relname, /^[a-zA-Z_][a-zA-Z0-9_]*$/)
    result[relname] = (
      await f.db.query(
        `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') sha256 FROM vamotors."${relname}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows
  }
  return result
}
async function files(
  directory = f.runtime.PRIVATE_FILES_ROOT!,
  prefix = ""
): Promise<unknown[]> {
  const result: unknown[] = []
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name),
      stat = await lstat(path),
      relative = join(prefix, name)
    assert.ok(!stat.isSymbolicLink())
    assert.equal(stat.mode & 0o077, 0)
    result.push({
      path: relative,
      mode: stat.mode & 0o777,
      ...(stat.isFile()
        ? { size: stat.size, sha256: hash(await readFile(path)) }
        : { directory: true }),
    })
    if (stat.isDirectory()) result.push(...(await files(path, relative)))
  }
  return result
}
async function reads(admin: APIRequestContext, second: APIRequestContext) {
  const targets = (
    await f.db.query(
      'SELECT DISTINCT ON (p."purchaseType",coalesce(d."institutionType",\'\')) p.id FROM vamotors."PurchaseRecord" p LEFT JOIN vamotors."LeasePurchaseDetail" d ON d."purchaseRecordId"=p.id WHERE p.status=\'WRITTEN_OFF\' AND p."acquisitionCommandId" IS NOT NULL ORDER BY p."purchaseType",coalesce(d."institutionType",\'\'),p.id'
    )
  ).rows
  assert.ok(targets.length)
  const cycles = []
  for (const { id } of targets) {
    const row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${id}`
    )
    assert.equal(row.status, "WRITTEN_OFF")
    assert.ok(row.closedAt && row.disposal)
    cycles.push(row)
    assert.equal(
      (
        await admin.get(
          `/approvals/${row.disposal!.approval.kind === "CURRENT" ? row.disposal!.approval.approvalId : "invalid"}`
        )
      ).status(),
      200
    )
  }
  const recoveries = [],
    notifications = []
  for (const client of [admin, second]) {
    const actor = await f.query<CurrentActorDTO>(client, "currentActor")
    const receipt = (
      await f.db.query(
        'SELECT id,"commandName","idempotencyKey" FROM vamotors."CommandReceipt" WHERE "actorKey"=$1 AND "commandName" IN (\'requestApproval\',\'reviewApproval\') ORDER BY "committedAt" DESC,id LIMIT 1',
        [`USER:${actor.user.id}`]
      )
    ).rows[0]
    assert.ok(receipt)
    const status = await f.query<Applied | Pending>(
      client,
      "commandStatus",
      `?name=${receipt.commandName}&idempotencyKey=${receipt.idempotencyKey}`
    )
    assert.equal(status.commandId, receipt.id)
    recoveries.push(status)
    const { asOf: unused, ...notice } = await f.query<Record<string, unknown>>(
      client,
      "notifications",
      "?pageSize=100"
    )
    void unused
    notifications.push(notice)
  }
  const downloads = []
  for (const row of (
    await f.db.query(
      'SELECT id,size::text,sha256 FROM vamotors."Attachment" ORDER BY id'
    )
  ).rows) {
    const d = await f.query<DownloadDTO>(
      admin,
      "download",
      `?attachmentId=${row.id}`
    )
    const response = await admin.get(d.url)
    assert.equal(response.status(), 200)
    assert.match(
      response.headers()["cache-control"],
      /private.*no-store|no-store.*private/
    )
    const bytes = await response.body()
    assert.equal(hash(bytes), row.sha256)
    assert.equal(bytes.length, Number(row.size))
    downloads.push({ id: row.id, sha256: row.sha256, size: bytes.length })
  }
  assert.ok(downloads.length)
  return { cycles, recoveries, notifications, downloads }
}
try {
  const before = await graph(),
    native = await files()
  await f.start()
  let admin = await f.login("ADMIN"),
    second = await f.login("SECOND")
  let original
  try {
    original = await reads(admin, second)
  } finally {
    await admin.dispose()
    await second.dispose()
  }
  assert.deepEqual(await graph(), before)
  await f.restart()
  admin = await f.login("ADMIN")
  second = await f.login("SECOND")
  try {
    assert.deepEqual(await reads(admin, second), original)
  } finally {
    await admin.dispose()
    await second.dispose()
  }
  assert.deepEqual(await graph(), before)
  assert.deepEqual(await files(), native)
  await writeFile(
    join(root, `approval-disposal-postapply-restart-${randomUUID()}.json`),
    JSON.stringify(
      {
        source: PROJECT,
        head: execFileSync("git", ["-C", PROJECT!, "rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        status: "PASS",
        retainedGraph: before,
        native,
        reads: original,
      },
      null,
      2
    ),
    { flag: "wx", mode: 0o600 }
  )
  console.log(
    "PASS post-application app/PG/native-file restart: exact entire graph/modes/bytes, fresh actors, terminal variants, notifications, commandStatus and authenticated downloads"
  )
} finally {
  await f.close()
}
