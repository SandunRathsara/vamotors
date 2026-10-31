/** Real HTTP contenders released ONLY after PG reports their actual lock waits.
 * No timing-only race claims, fake terminal data or source-owner shortcuts. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, type APIRequestContext } from "@playwright/test"
import pg from "pg"
import type {
  CurrentActorDTO,
  Dependency,
  Grant,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { privateEnvironment } from "../../scripts/private-environment"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8)
const adminEnv = await privateEnvironment(join(root, "admin.env")),
  monitorURL = new URL(adminEnv.ADMIN_URL!)
monitorURL.pathname = "/vamotors_local"
const monitor = new pg.Pool({ connectionString: monitorURL.href, max: 1 })
const observations: unknown[] = [],
  transcript: unknown[] = [],
  groups: string[] = []
let stage = "initialize",
  cycleId = "",
  repairId = ""
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
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
async function observed(blocker: pg.PoolClient, count: number) {
  const pid = (await blocker.query("SELECT pg_backend_pid() pid")).rows[0].pid
  type Lock = {
    pid: number
    wait_event_type: string
    wait_event: string
    blockers: number[]
  }
  let rows: Lock[] = []
  await expect
    .poll(
      async () => {
        rows = (
          await monitor.query<Lock>(`SELECT a.pid,a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid) blockers
      FROM pg_stat_activity a WHERE a.datname=current_database() AND a.usename='vamotors_runtime' AND a.wait_event_type='Lock' AND a.query LIKE '%BusinessSequence%'`)
        ).rows
        const reachesBarrier = (
          row: Lock,
          seen = new Set<number>()
        ): boolean => {
          if (seen.has(row.pid)) return false
          seen.add(row.pid)
          return row.blockers.some(
            (blocker) =>
              blocker === pid ||
              rows.some(
                (candidate) =>
                  candidate.pid === blocker && reachesBarrier(candidate, seen)
              )
          )
        }
        return rows.filter((row) => reachesBarrier(row)).length
      },
      { timeout: 1000, intervals: [0, 5, 10, 20] }
    )
    .toBeGreaterThanOrEqual(count)
  observations.push({ stage, blocker: pid, waiters: rows })
}
async function pair(
  requests: { client: APIRequestContext; name: string; body: unknown }[]
) {
  const blocker = await f.db.connect()
  let pending: ReturnType<APIRequestContext["post"]>[] = []
  try {
    await blocker.query("BEGIN")
    await blocker.query(
      'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
    )
    pending = requests.map((r) =>
      r.client.post(`/api/v1/commands/${r.name}`, {
        data: r.body,
        headers: { Origin: f.origin },
      })
    )
    await observed(blocker, requests.length)
    await blocker.query("COMMIT")
    return await Promise.all(
      pending.map(async (p, index) => {
        const r = await p,
          value = await r.json()
        transcript.push({
          name: requests[index].name,
          body: requests[index].body,
          status: r.status(),
          value,
        })
        return { status: r.status(), value }
      })
    )
  } finally {
    await blocker.query("ROLLBACK")
    blocker.release()
    await Promise.allSettled(pending)
  }
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    second = await f.login("SECOND"),
    staff = await f.login("STAFF")
  const initialStaff = await f.query<CurrentActorDTO>(staff, "currentActor")
  const cmd = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const current = () =>
    f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${cycleId}`)
  const refs = (r: PurchaseCycleDTO) => [
    ref(r),
    ref(r.repairs.find((c) => c.id === repairId)!, "RepairRecord"),
  ]
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Race supplier ${suffix}`,
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
        name: `Race vendor ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    },
    [],
    201
  )
  const purchase = await cmd(
    "recordPurchase",
    purchaseInput(supplier.result.id, suffix, "races"),
    [ref(supplier.result, "Supplier")],
    201
  )
  cycleId = purchase.result.id
  let row = await current()
  await cmd(
    "receiveStock",
    {
      cycleId,
      date: "2026-10-02",
      disposition: { kind: "HOLD", reason: "Real repair contention" },
    },
    [ref(row)]
  )
  row = await current()
  const sendInput = {
    cycleId,
    vendorId: vendor.result.id,
    request: "Actual contested repair",
    sentDate: "2026-10-03",
  }
  await group(
    "observed identical-key send contenders create exactly one repair and cycle bump",
    async () => {
      const before = row.revision,
        body = envelope(sendInput, [
          ref(row),
          ref(vendor.result, "RepairVendor"),
        ])
      const result = await pair([
        { client: admin, name: "sendRepair", body },
        { client: admin, name: "sendRepair", body },
      ])
      assert.deepEqual(result.map((r) => r.status).sort(), [200, 201])
      assert.equal(result.filter((r) => r.value.replayed).length, 1)
      repairId = result[0].value.result.id
      assert.equal(result[1].value.result.id, repairId)
      row = await current()
      assert.equal(row.revision, before + 1)
      assert.equal(row.repairs.length, 1)
      assert.equal(row.repairs[0].revision, 1)
      assert.equal(row.repairs[0].invoiceAmount, undefined)
      assert.deepEqual(row.repairs[0].payments, [])
      await cmd(
        "returnRepair",
        {
          repairId,
          invoiceAmount: "1000",
          invoiceDate: "2026-10-03",
          returnedDate: "2026-10-04",
          summary: "Actual first return",
        },
        refs(row)
      )
      row = await current()
    }
  )
  await group(
    "observed distinct-key send race preserves one open repair",
    async () => {
      const before = row.revision,
        expected = [ref(row), ref(vendor.result, "RepairVendor")]
      const result = await pair([
        {
          client: admin,
          name: "sendRepair",
          body: envelope(sendInput, expected),
        },
        {
          client: second,
          name: "sendRepair",
          body: envelope(sendInput, expected),
        },
      ])
      assert.deepEqual(result.map((r) => r.status).sort(), [201, 409])
      repairId = result.find((r) => r.status === 201)!.value.result.id
      row = await current()
      assert.equal(row.revision, before + 1)
      assert.equal(row.repairs.filter((r) => !r.returnedDate).length, 1)
      assert.equal(row.repairs.length, 2)
    }
  )
  await group(
    "observed return contenders append one invoice/basis/status/notification graph",
    async () => {
      const before = row.revision,
        basisCount = row.basisVersions.length
      const input = {
        repairId,
        invoiceAmount: "1000",
        invoiceDate: "2026-10-03",
        returnedDate: "2026-10-04",
        summary: "Actual contested return",
      }
      const result = await pair([
        {
          client: admin,
          name: "returnRepair",
          body: envelope(input, refs(row)),
        },
        {
          client: second,
          name: "returnRepair",
          body: envelope(input, refs(row)),
        },
      ])
      assert.deepEqual(result.map((r) => r.status).sort(), [200, 409])
      row = await current()
      assert.equal(row.revision, before + 1)
      assert.equal(row.basisVersions.length, basisCount + 1)
      assert.equal(row.financial?.basis, "12000")
      assert.equal(row.repairs.find((r) => r.id === repairId)!.revision, 2)
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) n FROM vamotors."Notification" WHERE "targetId"=$1',
            [repairId]
          )
        ).rows[0].n,
        "2"
      )
    }
  )
  await group(
    "observed pay/pay then pay/reversal races preserve cash cap and immutable basis",
    async () => {
      const before = row.revision,
        basis = row.basisVersions
      const input = (amount: string) => ({
        repairId,
        payment: { amount, date: "2026-09-25", method: "CASH" },
      })
      const result = await pair([
        {
          client: admin,
          name: "payRepair",
          body: envelope(input("400"), refs(row)),
        },
        {
          client: second,
          name: "payRepair",
          body: envelope(input("600"), refs(row)),
        },
      ])
      assert.deepEqual(result.map((r) => r.status).sort(), [200, 409])
      row = await current()
      assert.equal(row.revision, before + 1)
      assert.deepEqual(row.basisVersions, basis)
      let repair = row.repairs.find((r) => r.id === repairId)!
      assert.equal(repair.payments.length, 1)
      const original = repair.payments[0]
      await cmd(
        "payRepair",
        input((1000n - BigInt(original.amount)).toString()),
        refs(row)
      )
      row = await current()
      const beforeCorrection = row.revision
      const correction = await pair([
        {
          client: admin,
          name: "payRepair",
          body: envelope(input("1"), refs(row)),
        },
        {
          client: second,
          name: "reversePayment",
          body: envelope(
            {
              sourceType: "REPAIR",
              sourceId: repairId,
              paymentId: original.id,
              reason: "Exact contested correction, not actual refund",
            },
            refs(row)
          ),
        },
      ])
      assert.equal(correction[1].status, 200)
      assert.ok([409, 422].includes(correction[0].status))
      row = await current()
      repair = row.repairs.find((r) => r.id === repairId)!
      assert.equal(row.revision, beforeCorrection + 1)
      assert.deepEqual(row.basisVersions, basis)
      assert.deepEqual(
        repair.payments.find((p) => p.id === original.id),
        original
      )
      assert.equal(
        repair.payments.filter((p) => p.reversalOf === original.id).length,
        1
      )
      const net = repair.payments.reduce(
        (n, p) =>
          n + (p.direction === "OUT" ? BigInt(p.amount) : -BigInt(p.amount)),
        0n
      )
      assert.equal(net, 1000n - BigInt(original.amount))
    }
  )
  await group(
    "observed execution/replay waits honor committed pay revocation and account deactivation",
    async () => {
      const reads: Grant[] = [
        "PurchaseRecord",
        "Vehicle",
        "VehicleCost",
        "RepairVendor",
        "RepairRecord",
      ].map((subject) => ({
        subject: subject as Grant["subject"],
        action: "read",
        fields: ["*"],
      }))
      const grants: Grant[] = [
        ...reads,
        { subject: "PurchaseRecord", action: "pay", fields: ["cycleId"] },
        { subject: "RepairRecord", action: "pay", fields: ["*"] },
      ]
      const user = () =>
        f.query<{ id: string; name: string; revision: number }>(
          admin,
          "user",
          `?id=${initialStaff.user.id}`
        )
      const role = await cmd(
        "saveRole",
        {
          name: `Repair race authority ${suffix}`,
          reason: "Real observed wait proof",
          grants,
        },
        [],
        201
      )
      const readRole = await cmd(
        "saveRole",
        {
          name: `Repair race read-only ${suffix}`,
          reason: "Retain read witnesses while revoking pay",
          grants: reads,
        },
        [],
        201
      )
      async function membershipBody(active: boolean, roleIds: string[]) {
        const u = await user(),
          roles = await Promise.all(
            roleIds.map((id) =>
              f.query<{ id: string; revision: number }>(
                admin,
                "role",
                `?id=${id}`
              )
            )
          )
        return envelope(
          {
            id: u.id,
            name: u.name,
            active,
            roleIds,
            reason: "Observed repair current-authority proof",
          },
          [ref(u, "User"), ...roles.map((r) => ref(r, "Role"))]
        )
      }
      async function membership(active: boolean, roleIds: string[]) {
        await f.command(
          admin,
          "updateUser",
          await membershipBody(active, roleIds)
        )
      }
      await membership(true, [role.result.id])
      row = await current()
      const appliedBody = envelope(
        {
          repairId,
          payment: { amount: "1", date: "2026-10-05", method: "CASH" },
        },
        refs(row)
      )
      await f.command(staff, "payRepair", appliedBody)
      try {
        for (const mode of [
          "revoke-execution",
          "revoke-replay",
          "deactivate-execution",
          "deactivate-replay",
        ]) {
          await membership(true, [role.result.id])
          row = await current()
          const body = mode.endsWith("replay")
            ? appliedBody
            : envelope(
                {
                  repairId,
                  payment: { amount: "1", date: "2026-10-05", method: "CASH" },
                },
                refs(row)
              )
          const blocker = await f.db.connect()
          let pending: ReturnType<APIRequestContext["post"]> | undefined
          try {
            await blocker.query("BEGIN")
            await blocker.query(
              'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
            )
            pending = staff.post("/api/v1/commands/payRepair", {
              data: body,
              headers: { Origin: f.origin },
            })
            await observed(blocker, 1)
            await membership(
              !mode.startsWith("deactivate"),
              mode.startsWith("deactivate")
                ? [role.result.id]
                : [readRole.result.id]
            )
            const before = await f.snapshot(tables)
            await blocker.query("COMMIT")
            const response = await pending,
              value = await response.json()
            transcript.push({ mode, status: response.status(), value })
            assert.equal(response.status(), 403)
            assert.equal(await f.snapshot(tables), before)
          } finally {
            await blocker.query("ROLLBACK")
            blocker.release()
            if (pending) await Promise.allSettled([pending])
          }
        }
        // commandStatus waits on the accepted auth guard, not BusinessSequence.
        // Queue a REAL audited admin mutation first, observe both lock waits,
        // then release. Exclude exactly its one receipt/audit, nothing else.
        const authWait = async (exclude: number[] = []) => {
          const deadline = Date.now() + 1200
          do {
            const rows = (
              await monitor.query(
                "SELECT a.pid,a.wait_event_type,a.wait_event,pg_blocking_pids(a.pid) blockers FROM pg_stat_activity a WHERE a.datname=current_database() AND a.usename='vamotors_runtime' AND a.wait_event_type='Lock' AND a.query LIKE '%lock_admin_guard%' AND NOT(a.pid=ANY($1::int[]))",
                [exclude]
              )
            ).rows
            if (rows.length) return rows[0]
          } while (Date.now() < deadline)
          throw Error("NO_OBSERVED_REPAIR_STATUS_AUTH_WAIT")
        }
        const excludingAuth = async (commandId?: string) => {
          const rows = JSON.parse(await f.snapshot(tables)) as Record<
            string,
            { row: { id: string; commandId?: string } }[]
          >
          if (commandId) {
            rows.CommandReceipt = rows.CommandReceipt.filter(
              ({ row }) => row.id !== commandId
            )
            rows.AuditEntry = rows.AuditEntry.filter(
              ({ row }) => row.commandId !== commandId
            )
          }
          return JSON.stringify(rows)
        }
        for (const deactivate of [false, true]) {
          await membership(true, [role.result.id])
          const mutationBody = await membershipBody(!deactivate, [
            deactivate ? role.result.id : readRole.result.id,
          ])
          const before = await excludingAuth(),
            blocker = await f.db.connect()
          let mutation: ReturnType<APIRequestContext["post"]> | undefined,
            recovery: ReturnType<APIRequestContext["get"]> | undefined
          try {
            await blocker.query("BEGIN")
            const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
              .rows[0].pid
            await blocker.query(
              'SELECT id FROM vamotors."AdminGuard" WHERE id=1 FOR UPDATE'
            )
            mutation = admin.post("/api/v1/commands/updateUser", {
              headers: { Origin: f.origin },
              data: mutationBody,
            })
            const mutationWait = await authWait()
            assert.ok(mutationWait.blockers.includes(pid))
            recovery = staff.get(
              `/api/v1/queries/commandStatus?name=payRepair&idempotencyKey=${appliedBody.idempotencyKey}`
            )
            const recoveryWait = await authWait([mutationWait.pid])
            assert.ok(recoveryWait.blockers.length)
            await blocker.query("COMMIT")
            const [changed, recovered] = await Promise.all([mutation, recovery])
            const applied = await changed.json(),
              value = await recovered.json()
            observations.push({
              mode: deactivate
                ? "deactivate-commandStatus"
                : "revoke-commandStatus",
              blocker: pid,
              mutationWait,
              recoveryWait,
              mutationCommandId: applied.commandId,
              status: recovered.status(),
              value,
            })
            assert.equal(changed.status(), 200)
            assert.equal(recovered.status(), 403)
            assert.equal(await excludingAuth(applied.commandId), before)
          } finally {
            await blocker.query("ROLLBACK")
            blocker.release()
            await Promise.allSettled(
              [mutation, recovery].filter((p) => p !== undefined)
            )
          }
        }
      } finally {
        await membership(
          true,
          initialStaff.roles.map((r) => r.id)
        )
      }
    }
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `repair-races-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        observations,
        transcript,
        cycleId,
        repairId,
        source: process.cwd(),
        scope:
          "Observed-lock repair commands/direct replay/shared commandStatus only; not all affected regressions or acceptance",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await monitor.end()
  await f.close()
}
