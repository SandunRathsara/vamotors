/** Focused current-field privacy, real own-only writes and durable return faults.
 * Consumes only an explicitly named retained REPAIR lifecycle in our own root. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  CurrentActorDTO,
  Dependency,
  Grant,
  PartyDetailDTO,
  PurchaseCycleDTO,
  Visible,
} from "../../.planning/implementation/contracts/api"
import { registry } from "../../lib/server/permissions"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

process.umask(0o077)
const [root, seedPath] = process.argv.slice(2)
assert.ok(root && seedPath && seedPath.startsWith(`${root}/`))
const retained = JSON.parse(await readFile(seedPath, "utf8")) as {
  cycleId: string
  repairId: string
  groups: string[]
}
assert.equal(retained.groups.length, 6)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8),
  groups: string[] = []
let stage = "initialize",
  ownCycleId = "",
  ownRepairId = ""
type Cycle = Visible<PurchaseCycleDTO> & { redactedFields: string[] }
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
const reads: Grant[] = [
  "PurchaseRecord",
  "Vehicle",
  "VehicleCost",
  "RepairVendor",
  "AuditLog",
].map((subject) => ({
  subject: subject as Grant["subject"],
  action: "read",
  fields: ["*"],
}))
const leaves = registry.RepairRecord.read.filter((f) => f !== "payments")
const childRead = (fields: readonly string[], own = false): Grant => ({
  subject: "RepairRecord",
  action: "read",
  fields: [...fields],
  ...(own ? { conditions: { createdBy: "$actor.id" as const } } : {}),
})
const writes: Grant[] = [
  { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
  { subject: "PurchaseRecord", action: "pay", fields: ["cycleId"] },
  ...["create", "update", "pay"].map((action) => ({
    subject: "RepairRecord" as const,
    action: action as Grant["action"],
    fields: ["*"],
    conditions: { createdBy: "$actor.id" as const },
  })),
]
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    staff = await f.login("STAFF")
  const initialStaff = await f.query<CurrentActorDTO>(staff, "currentActor")
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const cycle = (client = staff, id = retained.cycleId) =>
    f.query<Cycle>(client, "purchase", `?cycleId=${id}`)
  const user = () =>
    f.query<{ id: string; name: string; revision: number }>(
      admin,
      "user",
      `?id=${initialStaff.user.id}`
    )
  async function assign(grants: Grant[]) {
    const role = await cmd(
      "saveRole",
      {
        name: `Repair privacy ${suffix}-${randomUUID().slice(0, 6)}`,
        reason: "Focused current-field proof",
        grants,
      },
      [],
      201
    )
    const u = await user()
    await cmd(
      "updateUser",
      {
        id: u.id,
        name: u.name,
        active: true,
        roleIds: [role.result.id],
        reason: "Focused current repair authority",
      },
      [ref(u, "User"), ref(role.result, "Role")]
    )
  }
  try {
    await group(
      "positive full source projection and archived vendor retained link",
      async () => {
        await assign([...reads, childRead(leaves)])
        const row = await cycle()
        assert.equal(row.financial?.basis, "11500")
        assert.equal(row.financial?.repairs, "1000")
        assert.equal(row.repairs?.[0].invoiceAmount, "1000")
        assert.equal(row.repairs?.[0].payments?.length, 3)
        const vendorId = row.repairs![0].vendorId!
        const party = await f.query<PartyDetailDTO>(
          staff,
          "party",
          `?type=REPAIR_VENDOR&id=${vendorId}`
        )
        assert.ok(party.type === "REPAIR_VENDOR")
        assert.ok(
          party.contributions.repairs.links.some(
            (l) => l.id === retained.repairId
          )
        )
      }
    )
    await group(
      "missing invoice leaf omits repair/basis aggregates and audit fields, not residual zero",
      async () => {
        await assign([
          ...reads,
          childRead(leaves.filter((f) => f !== "invoiceAmount")),
        ])
        const row = await cycle()
        assert.equal(row.repairs?.[0].invoiceAmount, undefined)
        assert.equal(row.financial?.basis, undefined)
        assert.equal(row.financial?.repairs, undefined)
        assert.equal(row.basisVersions, undefined)
        assert.ok(row.redactedFields.includes("financial.repairs"))
        const vehicle = await f.query<Cycle>(
          staff,
          "vehicle",
          `?id=${row.vehicleId}`
        )
        assert.equal(vehicle.financial?.basis, undefined)
        assert.equal(vehicle.financial?.repairs, undefined)
        assert.ok(vehicle.redactedFields.includes("financial.repairs"))
        const audit = await f.query<{
          data: {
            fields?: { path: string; before?: unknown; after?: unknown }[]
          }[]
        }>(staff, "audit", `?type=RepairRecord&id=${retained.repairId}`)
        assert.ok(
          audit.data.every((e) =>
            e.fields?.every((field) => field.path !== "invoiceAmount")
          )
        )
      }
    )
    await group(
      "missing direction or parent repairs hides all contributing cash, never a partial sum",
      async () => {
        await assign([
          ...reads,
          childRead(leaves.filter((f) => f !== "payments.direction")),
        ])
        let row = await cycle()
        for (const key of ["cashIn", "cashOut", "net"] as const)
          assert.equal(row.financial?.[key], undefined)
        assert.ok(
          row.repairs?.[0].payments?.every((p) => p.direction === undefined)
        )
        const parent = registry.PurchaseRecord.read.filter(
          (f) => f !== "repairs"
        )
        await assign([
          ...reads.filter((g) => g.subject !== "PurchaseRecord"),
          ...[parent.slice(0, 80), parent.slice(80)]
            .filter((fields) => fields.length)
            .map(
              (fields): Grant => ({
                subject: "PurchaseRecord",
                action: "read",
                fields: [...fields],
              })
            ),
          childRead(leaves),
        ])
        row = await cycle()
        assert.equal(row.repairs, undefined)
        assert.equal(row.financial?.basis, undefined)
        assert.equal(row.financial?.cashOut, undefined)
        const vehicle = await f.query<Cycle>(
          staff,
          "vehicle",
          `?id=${row.vehicleId}`
        )
        assert.equal(vehicle.repairs, undefined)
        assert.ok(vehicle.redactedFields.includes("repairs"))
        assert.equal(
          (await staff.get(`/repairs/${retained.repairId}`)).status(),
          403
        )
      }
    )
    await group(
      "readiness and writes both reject hidden contributing cost populations",
      async () => {
        await assign([
          ...reads.filter((g) => g.subject !== "VehicleCost"),
          childRead(leaves),
          { subject: "PurchaseRecord", action: "pay", fields: ["cycleId"] },
          { subject: "RepairRecord", action: "pay", fields: ["*"] },
        ])
        const row = await cycle()
        assert.ok(!row.nextActions?.includes("payRepair"))
        const before = await f.snapshot(tables)
        await f.command(
          staff,
          "payRepair",
          envelope(
            {
              repairId: retained.repairId,
              payment: { amount: "1", date: "2026-10-05", method: "CASH" },
            },
            [
              ref(row as PurchaseCycleDTO),
              ref(
                row.repairs![0] as { id: string; revision: number },
                "RepairRecord"
              ),
            ]
          ),
          404
        )
        assert.equal(await f.snapshot(tables), before)
      }
    )
    await group(
      "real own-only dispatch filters someone else's repair and vendor link",
      async () => {
        await assign([...reads, childRead(leaves, true), ...writes])
        const hidden = await cycle()
        assert.deepEqual(hidden.repairs, [])
        assert.equal(hidden.financial?.repairs, undefined)
        assert.equal(hidden.financial?.cashOut, undefined)
        assert.equal(
          (await staff.get(`/repairs/${retained.repairId}`)).status(),
          404
        )
        const supplier = await cmd(
          "createDirectoryParty",
          {
            type: "SUPPLIER",
            values: {
              name: `Privacy supplier ${suffix}`,
              category: "COMPANY",
              contacts: [],
            },
          },
          [],
          201
        )
        const vendor = await cmd(
          "createDirectoryParty",
          {
            type: "REPAIR_VENDOR",
            values: {
              name: `Privacy vendor ${suffix}`,
              category: "COMPANY",
              specialisation: "Mechanical",
              contacts: [],
            },
          },
          [],
          201
        )
        const acquired = await cmd(
          "recordPurchase",
          purchaseInput(supplier.result.id, suffix, "privacy"),
          [ref(supplier.result, "Supplier")],
          201
        )
        ownCycleId = acquired.result.id
        let row = await cycle(admin, ownCycleId)
        await cmd(
          "receiveStock",
          {
            cycleId: row.id,
            date: "2026-10-02",
            disposition: { kind: "RELEASE" },
          },
          [ref(row as PurchaseCycleDTO)]
        )
        row = await cycle(admin, ownCycleId)
        const sent = await f.command(
          staff,
          "sendRepair",
          envelope(
            {
              cycleId: ownCycleId,
              vendorId: vendor.result.id,
              request: "Actual own repair",
              sentDate: "2026-10-03",
            },
            [ref(row as PurchaseCycleDTO), ref(vendor.result, "RepairVendor")]
          ),
          201
        )
        ownRepairId = sent.result.id
        const own = await cycle(staff, ownCycleId)
        assert.equal(own.repairs?.[0].id, ownRepairId)
        const previous = await cycle(admin)
        const party = await f.query<PartyDetailDTO>(
          staff,
          "party",
          `?type=REPAIR_VENDOR&id=${previous.repairs![0].vendorId}`
        )
        assert.ok(party.type === "REPAIR_VENDOR")
        assert.deepEqual(party.contributions.repairs.links, [])
      }
    )
    await group(
      "each durable return fault rolls back complete invoice/basis/status/payment/notification graph",
      async () => {
        const row = await cycle(staff, ownCycleId),
          repair = row.repairs![0]
        const body = envelope(
          {
            repairId: ownRepairId,
            invoiceAmount: "100",
            invoiceDate: "2026-10-03",
            returnedDate: "2026-10-04",
            summary: "Actual own return",
            payment: { amount: "25", date: "2026-09-25", method: "CASH" },
          },
          [
            ref(row as PurchaseCycleDTO),
            ref(repair as { id: string; revision: number }, "RepairRecord"),
          ]
        )
        const fault = `repair_fault_${suffix}`
        await f.db.query(
          `CREATE FUNCTION vamotors.${fault}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FOCUSED_REPAIR_DURABLE_FAULT' USING ERRCODE='23514'; END $$`
        )
        try {
          for (const table of [
            "BusinessSequence",
            "CommandReceipt",
            "RepairRecord",
            "PurchaseRecord",
            "RepairPayment",
            "CycleBasisVersion",
            "StatusEvent",
            "AuditEntry",
            "EntityReadVersion",
            "Notification",
          ]) {
            const before = await f.snapshot(tables)
            const event = [
              "BusinessSequence",
              "RepairRecord",
              "PurchaseRecord",
            ].includes(table)
              ? "UPDATE"
              : "INSERT"
            await f.db.query(
              `CREATE TRIGGER ${fault} BEFORE ${event} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.${fault}()`
            )
            try {
              await f.command(staff, "returnRepair", body, 500)
            } finally {
              await f.db.query(`DROP TRIGGER ${fault} ON vamotors."${table}"`)
            }
            assert.equal(await f.snapshot(tables), before, `ROLLBACK_${table}`)
            console.log(`PASS durable rollback ${table}`)
          }
        } finally {
          await f.db.query(`DROP FUNCTION vamotors.${fault}()`)
        }
        const returned = await f.command(staff, "returnRepair", body)
        const after = await cycle(staff, ownCycleId)
        assert.equal(after.repairs?.[0].revision, 2)
        assert.equal(after.financial?.basis, "10100")
        assert.equal(after.repairs?.[0].payments?.length, 1)
        const snapshot = await f.snapshot(tables)
        assert.equal(
          (await f.command(staff, "returnRepair", body)).replayed,
          true
        )
        assert.equal(await f.snapshot(tables), snapshot)
        await assign(reads)
        const revokedSnapshot = await f.snapshot(tables)
        await f.command(staff, "returnRepair", body, 404)
        assert.equal(await f.snapshot(tables), revokedSnapshot)
        assert.ok(returned.commandId)
      }
    )
    await group(
      "restricted SQL cannot mutate immutable repair cash, forge revisions or use definer/GUC authority",
      async () => {
        const before = await f.snapshot(tables)
        for (const sql of [
          `DELETE FROM vamotors."RepairPayment" WHERE "repairId"='${ownRepairId}'`,
          `SELECT xmin FROM vamotors."RepairPayment" LIMIT 1`,
          `SELECT xmin FROM vamotors."RepairRecord" LIMIT 1`,
          `UPDATE vamotors."RepairRecord" SET "invoiceAmount"=999 WHERE id='${ownRepairId}'`,
          `SELECT set_config('vamotors.repair_authorized','true',true); UPDATE vamotors."RepairRecord" SET revision=revision+1 WHERE id='${ownRepairId}'; SET CONSTRAINTS ALL IMMEDIATE`,
          `CREATE TABLE vamotors.repair_runtime_forgery (id uuid)`,
        ]) {
          const client = await f.restricted.connect()
          try {
            await client.query("BEGIN")
            await assert.rejects(client.query(sql), (e: unknown) =>
              ["23514", "42501"].includes((e as { code: string }).code)
            )
          } finally {
            await client.query("ROLLBACK")
            client.release()
          }
        }
        for (const name of [
          "check_repair_root",
          "check_repair_child",
          "check_repair_evidence",
          "repair_notification_guard",
          "acquisition_root_guard",
          "initial_cycle_transition",
          "check_stock_graph",
        ]) {
          const result = await f.restricted.query(
            "SELECT has_function_privilege(current_user,$1,'EXECUTE') allowed",
            [`vamotors.${name}()`]
          )
          assert.equal(result.rows[0].allowed, false, name)
        }
        assert.equal(await f.snapshot(tables), before)
      }
    )
    await group(
      "second real repair on held stock, zero invoice and all-returned basis reconstruction",
      async () => {
        await assign([...reads, childRead(leaves, true), ...writes])
        let row = await cycle(staff, ownCycleId)
        const vendor = await f.query<PartyDetailDTO>(
          staff,
          "party",
          `?type=REPAIR_VENDOR&id=${row.repairs![0].vendorId}`
        )
        const sent = await f.command(
          staff,
          "sendRepair",
          envelope(
            {
              cycleId: ownCycleId,
              vendorId: vendor.id,
              request: "Second actual repair",
              sentDate: "2026-10-06",
            },
            [ref(row as PurchaseCycleDTO), ref(vendor, "RepairVendor")]
          ),
          201
        )
        row = await cycle(staff, ownCycleId)
        const repair = row.repairs!.find((r) => r.id === sent.result.id)!
        const expected = [
          ref(row as PurchaseCycleDTO),
          ref(repair as { id: string; revision: number }, "RepairRecord"),
        ]
        const input = {
          repairId: repair.id,
          invoiceAmount: "0",
          invoiceDate: "2026-10-06",
          returnedDate: "2026-10-07",
          summary: "Actual no-charge return",
        }
        // Child pay alone is not applicable repair authority without parent pay.
        // An authorized Administrator performs the actual zero-invoice return.
        await assign([
          ...reads,
          childRead(leaves, true),
          { subject: "RepairRecord", action: "pay", fields: ["repairId"] },
        ])
        const before = await f.snapshot(tables)
        for (const invalid of [
          { ...input, returnedDate: "2030-01-01" },
          { ...input, returnedDate: "2026-10-05" },
          { ...input, invoiceDate: "2026-10-08" },
          { ...input, summary: " " },
          {
            ...input,
            payment: { amount: "1", date: "2026-10-06", method: "CASH" },
          },
          {
            ...input,
            payment: { amount: "0", date: "2026-10-06", method: "CASH" },
          },
        ]) {
          await f.command(
            admin,
            "returnRepair",
            envelope(invalid, expected),
            422
          )
          assert.equal(await f.snapshot(tables), before)
        }
        await f.command(admin, "returnRepair", envelope(input, expected))
        const recipients = (
          await f.db.query(
            'SELECT "recipientUserId" FROM vamotors."Notification" WHERE "targetId"=$1',
            [repair.id]
          )
        ).rows
        assert.equal(recipients.length, 2)
        assert.ok(
          recipients.every((n) => n.recipientUserId !== initialStaff.user.id)
        )
        row = await cycle(staff, ownCycleId)
        assert.equal(row.financial?.basis, "10100")
        assert.equal(row.repairs?.length, 2)
        assert.deepEqual(
          row.repairs?.find((r) => r.id === repair.id)?.payments,
          []
        )
        await cmd(
          "addCost",
          {
            cycleId: ownCycleId,
            category: "Transport",
            description: "Actual second-cycle cost",
            amount: "500",
            incurredDate: "2026-10-07",
          },
          [ref(row as PurchaseCycleDTO)],
          201
        )
        row = await cycle(admin, ownCycleId)
        assert.equal(row.financial?.basis, "10600")
        assert.equal(row.financial?.repairs, "100")
        const components = (
          await f.db.query(
            'SELECT components FROM vamotors."CycleBasisVersion" WHERE "cycleId"=$1 ORDER BY version DESC LIMIT 1',
            [ownCycleId]
          )
        ).rows[0].components
        assert.equal(components.repairs.length, 2)
      }
    )
  } finally {
    const u = await user()
    const roles = await Promise.all(
      initialStaff.roles.map((r) =>
        f.query<{ id: string; revision: number }>(admin, "role", `?id=${r.id}`)
      )
    )
    await cmd(
      "updateUser",
      {
        id: u.id,
        name: u.name,
        active: true,
        roleIds: roles.map((r) => r.id),
        reason: "Restore original staff after focused repair proof",
      },
      [ref(u, "User"), ...roles.map((r) => ref(r, "Role"))]
    )
  }
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-privacy-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        retained,
        ownCycleId,
        ownRepairId,
        scope:
          "Focused PREBASE author evidence, not complete security/race/restart/final-base acceptance",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
