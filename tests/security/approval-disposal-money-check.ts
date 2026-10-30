/** Reuse the genuine exact236 C-99 cash witness only AFTER upgrade retention/repeat. */
import assert from "node:assert/strict"
import { readFile, writeFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import type {
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { privateEnvironment } from "../../scripts/private-environment"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

const root = process.argv[2]
const { PROJECT } = await privateEnvironment(join(root, "cluster.env"))
const f = await fixture(root, PROJECT)
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "LeasePurchaseDetail",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "MileageReading",
  "CycleBasisVersion",
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
const groups: unknown[] = []
try {
  const before = JSON.parse(
    await readFile(
      join(root, "approval-disposal-parent236-before.json"),
      "utf8"
    )
  )
  // A core-state sentinel alone is insufficient: require two completed native
  // retention/restart PASS receipts before consuming the immutable old witness.
  await readFile(join(root, "approval-disposal-upgrade-repeat-state.json"))
  const completed = (await readdir(root)).filter((name) =>
    /^approval-disposal-upgrade-verify-[a-f0-9-]+\.json$/.test(name)
  )
  assert.ok(
    completed.length >= 2,
    "Completed upgrade AND repeat verification required"
  )
  for (const name of completed)
    assert.equal(
      JSON.parse(await readFile(join(root, name), "utf8")).status,
      "PASS"
    )
  assert.equal(
    (
      await f.db.query(
        "SELECT count(*)::integer n FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL"
      )
    ).rows[0].n,
    17
  )
  await f.start()
  const admin = await f.login("ADMIN"),
    reviewer = await f.login("SECOND")
  try {
    const current = (id: string) =>
      f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`)
    const pending = async (row: PurchaseCycleDTO, proceeds: string) => {
      const body = envelope(
        {
          proposal: {
            kind: "WRITE_OFF",
            input: {
              cycleId: row.id,
              date: "2026-10-04",
              reason: "Actual boundary disposal",
              method: "AUCTIONED",
              proceeds,
              receipt: {
                amount: proceeds,
                date: "2026-10-05",
                method: "BANK_TRANSFER",
                reference: "Actual boundary funds",
              },
            },
          },
          reason: "Actual source-cumulative boundary proof",
        },
        [
          ref(row),
          {
            type: "Vehicle",
            id: row.vehicleId,
            revision: row.identityRevision,
          },
        ]
      )
      const result = (await f.command(
        admin,
        "requestApproval",
        body,
        202
      )) as unknown as Pending
      return envelope({ approvalId: result.approvalId, decision: "APPROVE" }, [
        { type: "ApprovalRequest", id: result.approvalId, revision: 1 },
        ...body.expected,
      ])
    }
    const row = await current(before.retained.grossCycle)
    assert.equal(row.financial!.cashIn, "9999999999999900")
    assert.equal(row.financial!.cashOut, "9999999999999900")
    const overflow = await pending(row, "100")
    for (let retry = 0; retry < 2; retry++) {
      const graph = await f.snapshot(tables)
      const response = await reviewer.post("/api/v1/commands/reviewApproval", {
        headers: { Origin: f.origin },
        data: overflow,
      })
      assert.equal(response.status(), 422)
      assert.equal((await response.json()).error.code, "MONEY_OVERFLOW")
      assert.equal(await f.snapshot(tables), graph)
      groups.push({
        group: "actual C+1 review has zero graph/sequence/receipt delta",
        retry,
        idempotencyKey: overflow.idempotencyKey,
        status: 422,
      })
    }
    const exact = await pending(row, "99")
    const applied = await f.command(reviewer, "reviewApproval", exact)
    const after = await current(row.id)
    assert.equal(after.financial!.cashIn, "9999999999999999")
    assert.equal(after.financial!.cashOut, row.financial!.cashOut)
    assert.equal(after.financial!.net, "99")
    assert.deepEqual(after.payments, row.payments)
    assert.deepEqual(after.outstanding, row.outstanding)
    assert.equal(
      (
        await f.db.query(
          'SELECT "netLoss"::text loss FROM vamotors."Disposal" WHERE "cycleId"=$1',
          [row.id]
        )
      ).rows[0].loss,
      "99999999999900"
    )
    groups.push({
      group:
        "actual C is accepted with exactly IN99 and retained source balances",
      cycleId: row.id,
      commandId: applied.commandId,
    })
    const suffix = randomUUID().slice(0, 8)
    const supplier = await f.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Actual A boundary ${suffix}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    const created = await f.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.result.id, suffix, "A"), [
        ref(supplier.result, "Supplier"),
      ]),
      201
    )
    const source = await current(created.result.id)
    const max = await pending(source, "99999999999999")
    await f.command(reviewer, "reviewApproval", max)
    const terminal = await current(source.id)
    assert.equal(terminal.disposal!.payments[0].amount, "99999999999999")
    assert.equal(
      (
        await f.db.query(
          'SELECT "netLoss"::text loss FROM vamotors."Disposal" WHERE "cycleId"=$1',
          [source.id]
        )
      ).rows[0].loss,
      "-99999999989999"
    )
    groups.push({
      group: "actual A proceeds accepted and signed gain exact",
      cycleId: source.id,
    })
  } finally {
    await admin.dispose()
    await reviewer.dispose()
  }
} finally {
  await f.close()
  await writeFile(
    join(root, `approval-disposal-money-${randomUUID()}.json`),
    JSON.stringify({ source: PROJECT, groups }, null, 2),
    { mode: 0o600, flag: "wx" }
  )
}
console.log(
  "PASS actual A, C, C+1/422 with exact no-effects snapshots and same-key failure retry"
)
