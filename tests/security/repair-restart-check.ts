/** Actual graceful app+PG restart with a new process/file adapter and new auth.
 * Re-read all persisted cycles/repair/vendor/notification facts and own receipts;
 * GET every linked FINAL file through200/403/404/401, not only seed examples. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import type {
  CurrentActorDTO,
  PartyDetailDTO,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture } from "./cycle-edits-fixture"
import { seedFiles, verifyFiles, type RetainedFiles } from "./cycle-edits-files"

process.umask(0o077)
const [root, exactFinal, fileManifest] = process.argv.slice(2)
assert.ok(root && exactFinal)
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  exactFinal
)
assert.equal(
  execFileSync("git", ["status", "--porcelain=v1"], {
    encoding: "utf8",
  }).trim(),
  ""
)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8)
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "RepairRecord",
  "RepairPayment",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "LeasePurchaseDetail",
  "CycleBasisVersion",
  "MileageReading",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "Notification",
  "BusinessSequence",
  "ImportBatch",
  "UploadIntent",
  "UploadAttempt",
  "Attachment",
  "UploadEvent",
  "RateSheetVersion",
  "RateCardEntry",
  "Quote",
]
const groups: string[] = []
let stage = "initialize"
async function fileFacts(
  path = f.runtime.PRIVATE_FILES_ROOT!,
  relative = ""
): Promise<unknown[]> {
  const rows: unknown[] = []
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name),
      key = join(relative, name),
      stat = await lstat(full)
    assert.equal(stat.isSymbolicLink(), false)
    rows.push({
      key,
      mode: stat.mode & 0o777,
      bytes: stat.size,
      directory: stat.isDirectory(),
      ...(stat.isFile()
        ? {
            sha256: createHash("sha256")
              .update(await readFile(full))
              .digest("hex"),
          }
        : {}),
    })
    if (stat.isDirectory()) rows.push(...(await fileFacts(full, key)))
  }
  return rows
}
const snapshot = async () => {
  const rows: Record<string, unknown> = {}
  for (const table of tables)
    rows[table] = (
      await f.db.query(
        `SELECT to_jsonb(t)::text row FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  // Native JSON text preserves bigint values past2^53 in byte comparisons.
  return JSON.stringify(rows)
}
try {
  await f.start()
  const beforeAdmin = await f.login("ADMIN"),
    beforeReviewer = await f.login("SECOND")
  let files: RetainedFiles
  if (fileManifest) {
    assert.ok(fileManifest.startsWith(`${root}/`))
    files = JSON.parse(await readFile(fileManifest, "utf8")).files
    assert.equal(files.readers.length, 3)
  } else {
    files = await seedFiles(f, beforeAdmin)
    await writeFile(
      join(root, `repair-restart-files-${suffix}.json`),
      JSON.stringify({ files }, null, 2),
      { mode: 0o600, flag: "wx" }
    )
  }
  // Include ALL final links created by later regression campaigns as well.
  files.attachments = (
    await f.db.query(
      'SELECT id,"batchId",size,sha256 FROM vamotors."Attachment" ORDER BY id'
    )
  ).rows.map((r) => ({ ...r, size: Number(r.size) }))
  const cycles = (
    await f.db.query(
      'SELECT id FROM vamotors."PurchaseRecord" WHERE "acquisitionCommandId" IS NOT NULL ORDER BY id'
    )
  ).rows.map((r) => r.id as string)
  const vendors = (
    await f.db.query('SELECT id FROM vamotors."RepairVendor" ORDER BY id')
  ).rows.map((r) => r.id as string)
  const facts = new Map<string, PurchaseCycleDTO>()
  for (const id of cycles)
    facts.set(
      id,
      await f.query<PurchaseCycleDTO>(beforeAdmin, "purchase", `?cycleId=${id}`)
    )
  const vendorFacts = new Map<string, PartyDetailDTO>()
  for (const id of vendors)
    vendorFacts.set(
      id,
      await f.query<PartyDetailDTO>(
        beforeAdmin,
        "party",
        `?type=REPAIR_VENDOR&id=${id}`
      )
    )
  const receiptFacts: { who: number; path: string; value: unknown }[] = []
  const readNotifications = async (client: typeof beforeAdmin) => {
    const rows: unknown[] = []
    let total = 0
    for (let page = 1; page === 1 || rows.length < total; page++) {
      const result = await f.query<{ data: unknown[]; total: number }>(
        client,
        "notifications",
        `?pageSize=100&page=${page}`
      )
      total = result.total
      rows.push(...result.data)
      if (!result.data.length) break
    }
    assert.equal(rows.length, total)
    return rows
  }
  const notices = await Promise.all(
    [beforeAdmin, beforeReviewer].map(readNotifications)
  )
  const statusValue = async (client: typeof beforeAdmin, path: string) => {
    const response = await client.get(path),
      value = await response.json()
    if (response.status() === 200) return { status: 200, value: value.data }
    assert.ok(
      [403, 404, 409].includes(response.status()),
      JSON.stringify(value)
    )
    return { status: response.status(), code: value.error.code }
  }
  for (const [who, client] of [beforeAdmin, beforeReviewer].entries()) {
    const actor = await f.query<CurrentActorDTO>(client, "currentActor")
    const receipts = (
      await f.db.query(
        "SELECT id,\"commandName\",\"idempotencyKey\",result FROM vamotors.\"CommandReceipt\" WHERE \"actorKey\"=$1 AND (\"commandName\" IN ('requestApproval','reviewApproval','markNotificationRead','markAllNotificationsRead','sendRepair','returnRepair','payRepair') OR (\"commandName\"='reversePayment' AND result->>'type'='RepairRecord')) ORDER BY id",
        [`USER:${actor.user.id}`]
      )
    ).rows
    for (const receipt of receipts) {
      const path = `/api/v1/queries/commandStatus?name=${receipt.commandName}&idempotencyKey=${receipt.idempotencyKey}`
      receiptFacts.push({ who, path, value: await statusValue(client, path) })
    }
  }
  const before = await snapshot()
  const beforeFiles = await fileFacts()
  stage = "actual graceful app, PostgreSQL and file-adapter restart"
  await f.restart()
  const admin = await f.login("ADMIN"),
    reviewer = await f.login("SECOND")
  groups.push(stage)
  stage =
    "new-auth retained facts and exact repair-cycle FK/vendor contributions"
  for (const id of cycles)
    assert.deepEqual(
      await f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`),
      facts.get(id)
    )
  for (const id of vendors) {
    const current = await f.query<PartyDetailDTO>(
      admin,
      "party",
      `?type=REPAIR_VENDOR&id=${id}`
    )
    assert.deepEqual(current, vendorFacts.get(id))
    assert.ok(current.type === "REPAIR_VENDOR")
    assert.equal(current.contributions.repairs.state, "PENDING_DOMAIN")
  }
  groups.push(stage)
  stage =
    "all current authorized own receipt statuses and retained notification reads"
  const statuses = receiptFacts.length
  for (const receipt of receiptFacts)
    assert.deepEqual(
      await statusValue([admin, reviewer][receipt.who], receipt.path),
      receipt.value
    )
  for (const [index, client] of [admin, reviewer].entries())
    assert.deepEqual(await readNotifications(client), notices[index])
  assert.ok(statuses > 0)
  assert.equal(await snapshot(), before)
  assert.deepEqual(await fileFacts(), beforeFiles)
  groups.push(stage)
  stage = "every linked final file query and GET200/403/404/401 after restart"
  const grid = await verifyFiles(f, files)
  assert.equal(grid.attachments.length, files.attachments.length)
  assert.equal(await snapshot(), before)
  assert.deepEqual(await fileFacts(), beforeFiles)
  groups.push(stage)
  await writeFile(
    join(root, `repair-restart-${suffix}-PASS.json`),
    JSON.stringify(
      {
        exactFinal,
        tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
          encoding: "utf8",
        }).trim(),
        groups,
        cycles: cycles.length,
        vendors: vendors.length,
        statuses,
        files: grid,
        source: process.cwd(),
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  console.log(
    `PASS actual graceful app+PG+adapter restart; new-auth ${cycles.length} cycles/${vendors.length} vendors/${statuses} receipt statuses; ALL${files.attachments.length} final files GET200/403/404/401`
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-restart-${suffix}-summary.json`),
    JSON.stringify(
      {
        exactFinal,
        stage,
        groups,
        source: process.cwd(),
        scope:
          "Runtime restart/current-authority/history/notification/all-linked-file grid only; parent alone accepts",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
