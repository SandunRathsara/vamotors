/** Exact immutable opposite + distinct replacement on retained actual liability. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { PurchaseCycleDTO } from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const [root, summaryPath] = process.argv.slice(2)
assert.ok(root && summaryPath.startsWith(`${root}/`))
const seed = JSON.parse(await readFile(summaryPath, "utf8")) as {
  cycleId: string
  repairId: string
  groups: string[]
}
assert.equal(seed.groups.length, 6)
const f = await fixture(root),
  groups: string[] = []
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "RepairRecord",
  "RepairPayment",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
  "Notification",
]
let stage = "initialize"
try {
  await f.start()
  const admin = await f.login("ADMIN")
  const current = () =>
    f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${seed.cycleId}`)
  let row = await current(),
    repair = row.repairs.find((r) => r.id === seed.repairId)!
  const original = repair.payments.find(
    (p) =>
      p.direction === "OUT" &&
      !p.reversalOf &&
      !repair.payments.some((r) => r.reversalOf === p.id)
  )!
  assert.ok(original)
  const originalRow = (
    await f.db.query(
      'SELECT to_jsonb(p) row FROM vamotors."RepairPayment" p WHERE id=$1',
      [original.id]
    )
  ).rows[0].row
  const refs = () => [ref(row), ref(repair, "RepairRecord")]
  const beforeRevision = row.revision,
    beforeChildRevision = repair.revision,
    basis = row.basisVersions,
    invoice = repair.invoiceAmount,
    availability = row.available
  const input = {
    sourceType: "REPAIR",
    sourceId: seed.repairId,
    paymentId: original.id,
    reason:
      "Correct wrong actual entry with distinct replacement; not actual refund",
    replacement: {
      amount: "400",
      date: "2026-09-20",
      method: "CASH",
      reference: "ACTUAL-REPLACEMENT",
    },
  }
  const body = { ...envelope(input, refs()), input }
  stage = "exact immutable opposite and distinct replacement"
  const applied = await f.command(admin, "reversePayment", body)
  row = await current()
  repair = row.repairs.find((r) => r.id === seed.repairId)!
  assert.equal(row.revision, beforeRevision + 1)
  assert.equal(repair.revision, beforeChildRevision + 1)
  assert.deepEqual(row.basisVersions, basis)
  assert.equal(repair.invoiceAmount, invoice)
  assert.equal(row.available, availability)
  assert.equal(repair.invoiceDate, "2026-10-03")
  assert.deepEqual(
    (
      await f.db.query(
        'SELECT to_jsonb(p) row FROM vamotors."RepairPayment" p WHERE id=$1',
        [original.id]
      )
    ).rows[0].row,
    originalRow
  )
  const written = (
    await f.db.query(
      'SELECT *,"occurredDate"::text "actualDate" FROM vamotors."RepairPayment" WHERE "commandId"=$1 ORDER BY direction',
      [applied.commandId]
    )
  ).rows
  assert.equal(written.length, 2)
  const opposite = written.find((p) => p.direction === "IN")!,
    replacement = written.find((p) => p.direction === "OUT")!
  assert.equal(opposite.reversalOf, original.id)
  assert.equal(opposite.amount, String(originalRow.amount))
  for (const field of ["method", "currency", "scale", "reference"])
    assert.equal(opposite[field], originalRow[field])
  assert.equal(opposite.actualDate, original.date)
  assert.equal(replacement.amount, "400")
  assert.equal(replacement.method, "CASH")
  assert.equal(replacement.reference, "ACTUAL-REPLACEMENT")
  assert.equal(replacement.actualDate, "2026-09-20")
  assert.equal(replacement.currency, opposite.currency)
  assert.equal(replacement.scale, opposite.scale)
  assert.equal(replacement.reason, opposite.reason)
  assert.equal(replacement.lineKey, `replace:${original.id}`)
  assert.notEqual(replacement.id, opposite.id)
  assert.notEqual(replacement.id, original.id)
  assert.equal(replacement.repairId, seed.repairId)
  assert.equal(replacement.cycleId, seed.cycleId)
  groups.push(stage)
  stage =
    "same-key replay and negative lineage/source/currency/bounds attempts have no effects"
  const before = await f.snapshot(tables)
  assert.equal((await f.command(admin, "reversePayment", body)).replayed, true)
  assert.equal(await f.snapshot(tables), before)
  const wrong = [
    { input: { ...body.input, sourceId: randomUUID() }, status: 404 },
    { input: { ...body.input, paymentId: opposite.id }, status: 409 },
    { input: body.input, status: 409 },
    {
      input: {
        ...body.input,
        paymentId: replacement.id,
        replacement: { ...body.input.replacement, amount: "0" },
      },
      status: 422,
    },
    {
      input: {
        ...body.input,
        paymentId: replacement.id,
        replacement: { ...body.input.replacement, currency: "USD" },
      },
      status: 422,
    },
    {
      input: {
        ...body.input,
        paymentId: replacement.id,
        replacement: { ...body.input.replacement, amount: "1001" },
      },
      status: 422,
    },
    {
      input: {
        ...body.input,
        paymentId: replacement.id,
        replacement: { ...body.input.replacement, date: "2030-01-01" },
      },
      status: 422,
    },
  ]
  for (const attempt of wrong) {
    await f.command(
      admin,
      "reversePayment",
      envelope(attempt.input, refs()),
      attempt.status
    )
    assert.equal(await f.snapshot(tables), before)
  }
  groups.push(stage)
  console.log(
    `PASS ${groups.length} native repair correction groups; immutable exact opposite, distinct replacement, replay and ${wrong.length} no-effect negative probes`
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-correction-${randomUUID()}.json`),
    JSON.stringify(
      {
        seed,
        stage,
        groups,
        source: process.cwd(),
        scope:
          "Focused PREBASE author proof, not old terminal liability/final integration",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
