/** Accepted Vehicle status conditions use the resolved originating cycle state.
 * All state/role changes are real commands. No baseline role/user is modified. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { request } from "@playwright/test"
import type {
  Applied,
  Grant,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8)
const groups: string[] = []
let stage = "initialize",
  cycleId = "",
  repairId = ""
const grants = (status: "IN_STOCK" | "IN_REPAIR"): Grant[] => [
  { subject: "Vehicle", action: "read", fields: ["*"], conditions: { status } },
  { subject: "PurchaseRecord", action: "read", fields: ["*"] },
  { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
  { subject: "PurchaseRecord", action: "pay", fields: ["cycleId"] },
  { subject: "RepairVendor", action: "read", fields: ["*"] },
  {
    subject: "RepairRecord",
    action: "read",
    fields: ["*"],
    conditions: { createdBy: "$actor.id" },
  },
  { subject: "RepairRecord", action: "create", fields: ["*"] },
  { subject: "RepairRecord", action: "update", fields: ["*"] },
  { subject: "RepairRecord", action: "pay", fields: ["*"] },
]
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "RepairRecord",
  "RepairPayment",
  "CycleBasisVersion",
  "MileageReading",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "Notification",
  "BusinessSequence",
]
const snapshot = async () => {
  const rows: Record<string, unknown> = {}
  for (const table of tables)
    rows[table] = (
      await f.db.query(
        `SELECT to_jsonb(t)::text row FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  return JSON.stringify(rows)
}
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
try {
  await f.start()
  const admin = await f.login("ADMIN")
  const supplier = await f.command(
    admin,
    "createDirectoryParty",
    envelope({
      type: "SUPPLIER",
      values: {
        name: `Status supplier ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    }),
    201
  )
  const vendor = await f.command(
    admin,
    "createDirectoryParty",
    envelope({
      type: "REPAIR_VENDOR",
      values: {
        name: `Status workshop ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    }),
    201
  )
  cycleId = (
    await f.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.result.id, suffix, "status-owner"), [
        ref(supplier.result, "Supplier"),
      ]),
      201
    )
  ).result.id
  const current = (client = admin) =>
    f.query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${cycleId}`)
  let row = await current()
  await f.command(
    admin,
    "receiveStock",
    envelope(
      {
        cycleId,
        date: "2026-10-02",
        disposition: { kind: "HOLD", reason: "Actual inspection" },
      },
      [ref(row)]
    )
  )
  const physical = (
    await f.db.query(
      'SELECT to_jsonb(v)::text row FROM vamotors."Vehicle" v WHERE id=$1',
      [row.vehicleId]
    )
  ).rows
  let role = await f.command(
    admin,
    "saveRole",
    envelope({
      name: `Current status dispatcher ${suffix}`,
      grants: grants("IN_STOCK"),
      reason: "New role with accepted status and child own-only conditions",
    }),
    201
  )
  const email = `status-repair-${suffix}@example.test`,
    password = `${randomUUID()}${randomUUID()}`
  assert.equal(
    (
      await admin.post("/api/v1/commands/createUser", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            name: "Current status dispatcher",
            email,
            password,
            roleIds: [role.result.id],
          },
          [ref(role.result, "Role")]
        ),
      })
    ).status(),
    201
  )
  const editor = await request.newContext({ baseURL: f.origin })
  const change = async (status: "IN_STOCK" | "IN_REPAIR") => {
    role = await f.command(
      admin,
      "saveRole",
      envelope(
        {
          id: role.result.id,
          name: `Current status dispatcher ${suffix}`,
          grants: grants(status),
          reason: "Explicit current conditional authority change",
        },
        [ref(role.result, "Role")]
      )
    )
  }
  try {
    assert.equal(
      (
        await editor.post("/api/auth/sign-in/email", {
          headers: { Origin: f.origin },
          data: { email, password },
        })
      ).status(),
      200
    )
    row = await current(editor)
    const send = envelope(
      {
        cycleId,
        vendorId: vendor.result.id,
        request: "Actual conditional dispatch",
        sentDate: "2026-10-03",
      },
      [ref(row), ref(vendor.result, "RepairVendor")]
    )
    let sent: Applied
    await group(
      "actual send authorizes the originating IN_STOCK Vehicle projection and immutable child creator",
      async () => {
        sent = await f.command(editor, "sendRepair", send, 201)
        repairId = sent.result.id
        row = await current()
        assert.equal(row.status, "IN_REPAIR")
        assert.equal(row.repairs.find((r) => r.id === repairId)!.revision, 1)
      }
    )
    await group(
      "current read condition rejects old receipt replay/status after transition without effects",
      async () => {
        const before = await snapshot()
        const direct = await editor.post("/api/v1/commands/sendRepair", {
          headers: { Origin: f.origin },
          data: send,
        })
        const status = await editor.get(
          `/api/v1/queries/commandStatus?name=sendRepair&idempotencyKey=${send.idempotencyKey}`
        )
        assert.equal(direct.status(), 404)
        assert.equal(status.status(), 404)
        assert.equal((await direct.json()).error.code, "NOT_FOUND")
        assert.equal((await status.json()).error.code, "NOT_FOUND")
        assert.equal(await snapshot(), before)
      }
    )
    await group(
      "fresh IN_REPAIR authority recovers same send receipt without rerunning old status or CAS",
      async () => {
        await change("IN_REPAIR")
        const before = await snapshot()
        const direct = await f.command(editor, "sendRepair", send)
        const status = await f.query<Applied>(
          editor,
          "commandStatus",
          `?name=sendRepair&idempotencyKey=${send.idempotencyKey}`
        )
        assert.equal(direct.commandId, sent!.commandId)
        assert.equal(direct.replayed, true)
        assert.equal(status.commandId, sent!.commandId)
        assert.equal(status.replayed, true)
        assert.equal(await snapshot(), before)
      }
    )
    await group(
      "actual return uses originating IN_REPAIR authority, then explicit current IN_STOCK grant pays cash only",
      async () => {
        row = await current(editor)
        const child = row.repairs.find((r) => r.id === repairId)!
        await f.command(
          editor,
          "returnRepair",
          envelope(
            {
              repairId,
              invoiceAmount: "1000",
              invoiceDate: "2026-10-03",
              returnedDate: "2026-10-04",
              summary: "Actual condition-preserving return",
            },
            [ref(row), ref(child, "RepairRecord")]
          )
        )
        await change("IN_STOCK")
        row = await current(editor)
        const basis = row.basisVersions
        await f.command(
          editor,
          "payRepair",
          envelope(
            {
              repairId,
              payment: { amount: "400", date: "2026-09-25", method: "CASH" },
            },
            [
              ref(row),
              ref(row.repairs.find((r) => r.id === repairId)!, "RepairRecord"),
            ]
          )
        )
        row = await current(editor)
        assert.deepEqual(row.basisVersions, basis)
        assert.equal(row.financial!.basis, "11000")
        assert.equal(row.financial!.cashOut, "10400")
        assert.equal(row.available, false)
        assert.equal(row.holdReason, "RETURNED_AWAITING_RELEASE")
        assert.deepEqual(
          (
            await f.db.query(
              'SELECT to_jsonb(v)::text row FROM vamotors."Vehicle" v WHERE id=$1',
              [row.vehicleId]
            )
          ).rows,
          physical
        )
      }
    )
  } finally {
    await editor.dispose()
  }
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-conditions-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        cycleId,
        repairId,
        source: process.cwd(),
        scope:
          "Current Vehicle status/repair ownership conditions, replay/status and original-state execution only; no blanket acceptance",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
