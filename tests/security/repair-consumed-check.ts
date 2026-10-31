/** Existing cost/terms owners must not consume hidden new repair contributors. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  CurrentActorDTO,
  Grant,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const [root, summaryPath] = process.argv.slice(2)
assert.ok(root && summaryPath.startsWith(`${root}/`))
const seed = JSON.parse(await readFile(summaryPath, "utf8")) as {
  cycleId: string
  groups: string[]
}
assert.equal(seed.groups.length, 6)
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
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
  "Notification",
]
let before = "",
  after = "",
  stage = "initialize"
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    staff = await f.login("STAFF")
  const initialStaff = await f.query<CurrentActorDTO>(staff, "currentActor")
  const user = () =>
    f.query<{ id: string; name: string; revision: number }>(
      admin,
      "user",
      `?id=${initialStaff.user.id}`
    )
  const grants: Grant[] = [
    ...["PurchaseRecord", "Vehicle", "VehicleCost"].map((subject) => ({
      subject: subject as Grant["subject"],
      action: "read" as const,
      fields: ["*"],
    })),
    { subject: "VehicleCost", action: "create", fields: ["*"] },
    {
      subject: "PurchaseRecord",
      action: "update",
      fields: ["cycleId", "reason", "patch.purchaseDate"],
    },
  ]
  const role = await f.command(
    admin,
    "saveRole",
    envelope({
      name: `Consumed repair source ${suffix}`,
      reason: "Current-field negative proof",
      grants,
    }),
    201
  )
  let u = await user()
  await f.command(
    admin,
    "updateUser",
    envelope(
      {
        id: u.id,
        name: u.name,
        active: true,
        roleIds: [role.result.id],
        reason: "No RepairRecord read authority",
      },
      [ref(u, "User"), ref(role.result, "Role")]
    )
  )
  try {
    const row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${seed.cycleId}`
    )
    const cost = {
      cycleId: row.id,
      category: "Transport",
      description: "Actual bounded source-read probe",
      amount: "1",
      incurredDate: "2026-10-07",
    }
    before = await f.snapshot(tables)
    stage = "cost rebuild cannot consume unreadable repair invoices or cash"
    await f.command(staff, "addCost", envelope(cost, [ref(row)]), 404)
    after = await f.snapshot(tables)
    assert.equal(after, before)
    stage = "purchase chronology cannot consume unreadable persisted sent dates"
    await f.command(
      staff,
      "editPurchase",
      envelope(
        {
          cycleId: row.id,
          patch: { purchaseDate: "2026-09-30" },
          cashCorrections: [],
          reason: "Current chronology needs complete repair sources",
        },
        [
          ref(row),
          {
            type: "Vehicle",
            id: row.vehicleId,
            revision: row.identityRevision,
          },
        ]
      ),
      404
    )
    after = await f.snapshot(tables)
    assert.equal(after, before)
    stage = "positive Administrator rebuild retains every actual repair invoice"
    await f.command(admin, "addCost", envelope(cost, [ref(row)]), 201)
    const changed = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${seed.cycleId}`
    )
    assert.equal(
      BigInt(changed.financial!.basis),
      BigInt(row.financial!.basis) + 1n
    )
    assert.equal(changed.financial?.repairs, row.financial?.repairs)
    console.log(
      "PASS hidden repair sources deny both existing-owner writes without effects; authorized cost rebuild retains all invoices"
    )
  } finally {
    after = await f.snapshot(tables)
    u = await user()
    const roles = await Promise.all(
      initialStaff.roles.map((r) =>
        f.query<{ id: string; revision: number }>(admin, "role", `?id=${r.id}`)
      )
    )
    await f.command(
      admin,
      "updateUser",
      envelope(
        {
          id: u.id,
          name: u.name,
          active: true,
          roleIds: roles.map((r) => r.id),
          reason: "Restore initial staff after consumed-source proof",
        },
        [ref(u, "User"), ...roles.map((r) => ref(r, "Role"))]
      )
    )
  }
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-consumed-${suffix}.json`),
    JSON.stringify(
      {
        stage,
        seed,
        before,
        after,
        source: process.cwd(),
        scope:
          "Focused PREBASE source-consumption proof; failures/facts retained, never reverted",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
