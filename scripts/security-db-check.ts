/** Real DB only. No mocks, no fallback URL, no automatic migration/reset/seed. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { privateEnvironment, authorizedMigration } from "./private-environment"
import { createDatabase, database, assertEnvironment } from "../lib/server/db"
import { authenticate, currentActor } from "../lib/server/actor"
import { executeAdmin } from "../lib/server/admin"
import { securityQuery } from "../lib/server/queries"
import { project, requireFields } from "../lib/server/permissions"
import { transaction, nextBusinessSequence } from "../lib/server/transactions"
import { audit, notify } from "../lib/server/audit"
import { seedIds } from "./bootstrap-security"
import { POST as authPOST } from "../app/api/auth/[...all]/route"
import { POST as commandPOST } from "../app/api/v1/commands/[name]/route"
import { POST as resetPOST } from "../app/api/test/reset/route"
import { CommandError } from "../lib/server/errors"
import { runtimeConfig } from "../lib/server/config"
import { z } from "zod"

async function main() {
  const privateRuntime = await privateEnvironment(process.argv[2] ?? "")
  const runtime = runtimeConfig(privateRuntime)
  const migration = await privateEnvironment(process.argv[3] ?? "")
  const accounts = z
    .object({
      BOOTSTRAP_ADMIN_EMAIL: z.string(),
      BOOTSTRAP_ADMIN_PASSWORD: z.string(),
      BOOTSTRAP_SECOND_EMAIL: z.string(),
      BOOTSTRAP_SECOND_PASSWORD: z.string(),
      BOOTSTRAP_STAFF_EMAIL: z.string(),
      BOOTSTRAP_STAFF_PASSWORD: z.string(),
    })
    .parse(await privateEnvironment(process.argv[4] ?? ""))
  if (
    privateRuntime.DIRECT_URL ||
    process.env.DIRECT_URL ||
    runtime.APP_ENV !== "disposable-test" ||
    runtime.ENVIRONMENT_ID !== migration.ENVIRONMENT_ID
  )
    throw new Error("ISOLATION_REQUIRED")
  const migrationURL = authorizedMigration(migration)
  Object.assign(process.env, runtime)
  const db = database()
  const migrator = createDatabase(migrationURL)
  async function check(label: string, run: () => Promise<void>) {
    await run()
    console.log(`PASS ${label}`)
  }
  const origin = runtime.APP_ORIGIN
  const jsonHeaders = { origin, "content-type": "application/json" }
  const request = (path: string, input: unknown, cookie?: string) =>
    new Request(`${origin}${path}`, {
      method: "POST",
      headers: { ...jsonHeaders, ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(input),
    })
  async function login(email: string, password: string) {
    const response = await authPOST(
      request("/api/auth/sign-in/email", { email, password })
    )
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body, { ok: true })
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ")
    assert.ok(cookie)
    return { cookie, identity: await authenticate(new Headers({ cookie })) }
  }
  const envelope = <T>(input: T, expected: unknown[] = []) => ({
    schemaVersion: 1,
    idempotencyKey: randomUUID(),
    expected,
    input,
  })
  const rejectsCode = (code: string) => (e: unknown) =>
    e instanceof CommandError && e.code === code
  try {
    await check(
      "restricted adapter + transaction-local settings + environment identity",
      async () => {
        await assertEnvironment(db, true)
        const result = await transaction(async (tx) => {
          const [row] = await tx.$queryRaw<
            { actor: string; isolation: string; timeout: string }[]
          >`SELECT current_user AS actor, current_setting('transaction_isolation') AS isolation, current_setting('statement_timeout') AS timeout`
          return row
        })
        assert.equal(result.actor, "vamotors_runtime")
        assert.equal(result.isolation, "serializable")
        assert.equal(result.timeout, "5s")
      }
    )
    const a = await login(
      accounts.BOOTSTRAP_ADMIN_EMAIL,
      accounts.BOOTSTRAP_ADMIN_PASSWORD
    )
    const b = await login(
      accounts.BOOTSTRAP_SECOND_EMAIL,
      accounts.BOOTSTRAP_SECOND_PASSWORD
    )
    const staff = await login(
      accounts.BOOTSTRAP_STAFF_EMAIL,
      accounts.BOOTSTRAP_STAFF_PASSWORD
    )
    await check(
      "real credentials/session cookies; no public signup/bootstrap/reset",
      async () => {
        for (const path of [
          "/api/auth/sign-up/email",
          "/api/auth/bootstrap",
          "/api/auth/reset-password",
        ])
          assert.equal((await authPOST(request(path, {}))).status, 404)
        assert.equal(
          (await resetPOST(request("/api/test/reset", {}))).status,
          404
        )
        const self = await securityQuery(
          staff.identity,
          "currentActor",
          new URLSearchParams()
        )
        assert.equal((self as { user: { id: string } }).user.id, seedIds.staff)
        assert.ok(!JSON.stringify(self).includes("password"))
        assert.ok(!JSON.stringify(self).includes("token"))
        const response = await commandPOST(
          request(
            "/api/v1/commands/saveRole",
            envelope({
              name: "Denied",
              grants: [],
              reason: "Synthetic denial",
            }),
            staff.cookie
          ),
          { params: Promise.resolve({ name: "saveRole" }) }
        )
        assert.equal(response.status, 403)
      }
    )
    await check(
      "same-key concurrent commit/replay; different input denied; immutable one audit/receipt",
      async () => {
        const command = envelope({
          name: `Synthetic Replay ${randomUUID()}`,
          grants: [],
          reason: "Synthetic replay check",
        })
        const results = await Promise.all([
          executeAdmin(a.identity, "saveRole", command),
          executeAdmin(a.identity, "saveRole", command),
        ])
        assert.equal(results[0].commandId, results[1].commandId)
        assert.equal(results.filter((r) => r.replayed).length, 1)
        assert.equal(
          await db.auditEntry.count({
            where: { commandId: results[0].commandId },
          }),
          1
        )
        await assert.rejects(
          executeAdmin(a.identity, "saveRole", {
            ...command,
            input: { ...command.input, name: "Different input" },
          }),
          rejectsCode("IDEMPOTENCY_MISMATCH")
        )
      }
    )
    await check(
      "actual grants union, record/field denial and next-request revocation",
      async () => {
        const before = await currentActor(db, staff.identity)
        // Persist real source rows, not a mock authorization invariant. These are
        // constraint fixtures, NOT acceptance of the still-unimplemented purchase command.
        const fixture = await migrator.$transaction(async (tx) => {
          const sequence = await nextBusinessSequence(tx)
          const supplier = await tx.supplier.create({
            data: {
              name: "Synthetic constraint fixture supplier",
              category: "INDIVIDUAL",
              createdBy: seedIds.admin,
            },
          })
          const token = randomUUID().toUpperCase()
          const vehicle = await tx.vehicle.create({
            data: {
              engineNumber: `E-${token}`,
              chassisNumber: `C-${token}`,
              normalizedEngine: `E-${token}`,
              normalizedChassis: `C-${token}`,
              make: "Synthetic",
              model: "SecurityFixture",
              year: 2026,
              colour: "Test",
              fuelType: "OTHER",
              transmission: "OTHER",
              createdBy: seedIds.staff,
            },
          })
          const cycle = await tx.purchaseRecord.create({
            data: {
              vehicleId: vehicle.id,
              cycleNumber: 1,
              purchaseType: "CASH",
              acquisitionKind: "SUPPLIER",
              supplierId: supplier.id,
              purchaseDate: new Date("2026-01-01T00:00:00.000Z"),
              purchasePrice: 10000n,
              listedPrice: 20000n,
              createdBy: seedIds.staff,
            },
          })
          await tx.vehicle.update({
            where: { id: vehicle.id },
            data: { activePurchaseId: cycle.id },
          })
          const commandId = randomUUID()
          await tx.commandReceipt.create({
            data: {
              id: commandId,
              environmentId: runtime.ENVIRONMENT_ID,
              actorKey: `USER:${seedIds.admin}`,
              commandName: "constraintFixture",
              idempotencyKey: randomUUID(),
              inputHash: "synthetic-fixture",
              result: { id: vehicle.id },
              businessSequence: sequence,
            },
          })
          await tx.statusEvent.create({
            data: {
              cycleId: cycle.id,
              to: "PURCHASED",
              action: "recordPurchase",
              commandId,
              userId: seedIds.admin,
              occurredAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          })
          await tx.auditEntry.create({
            data: {
              entityType: "PurchaseRecord",
              entityId: cycle.id,
              commandId,
              action: "create",
              actorKind: "USER",
              userId: seedIds.admin,
              fieldDiff: { purchasePrice: { before: null, after: "10000" } },
            },
          })
          await tx.entityReadVersion.create({
            data: {
              entityType: "PurchaseRecord",
              entityId: cycle.id,
              sequence,
              revision: 1,
              commandId,
              payload: { purchasePrice: "10000" },
            },
          })
          return { vehicle, cycle }
        })
        const stored = await migrator.vehicle.findUniqueOrThrow({
          where: { id: fixture.vehicle.id },
          include: { purchases: true },
        })
        const row = {
          id: stored.id,
          revision: stored.revision,
          status: stored.purchases[0].status,
          createdBy: stored.createdBy,
          listedPrice: stored.purchases[0].listedPrice!.toString(),
          financial: { purchase: stored.purchases[0].purchasePrice.toString() },
        }
        assert.ok(project(before.ability, "Vehicle", row).financial)
        assert.ok(
          !project(before.ability, "Vehicle", {
            ...row,
            createdBy: seedIds.admin,
          }).financial
        )
        assert.throws(
          () =>
            requireFields(
              before.ability,
              "Vehicle",
              "read",
              { ...row, createdBy: seedIds.admin },
              ["listedPrice"]
            ),
          rejectsCode("FIELD_FORBIDDEN")
        )
        const role = await db.role.findUniqueOrThrow({
          where: { id: seedIds.financeRole },
          include: { permissions: { include: { permission: true } } },
        })
        const change = await executeAdmin(
          a.identity,
          "saveRole",
          envelope(
            {
              id: role.id,
              name: role.name,
              grants: [],
              reason: "Synthetic immediate revocation",
            },
            [{ type: "Role", id: role.id, revision: role.revision }]
          )
        )
        try {
          const after = await currentActor(db, staff.identity)
          assert.notEqual(before.authzRevision, after.authzRevision)
          assert.ok(!project(after.ability, "Vehicle", row).financial)
          const rsc = await securityQuery(
            staff.identity,
            "currentActor",
            new URLSearchParams()
          )
          assert.equal(
            (rsc as { authzRevision: string }).authzRevision,
            after.authzRevision
          )
        } finally {
          await executeAdmin(
            a.identity,
            "saveRole",
            envelope(
              {
                id: role.id,
                name: role.name,
                grants: role.permissions.map((p) => p.permission.rule),
                reason: "Restore synthetic grants",
              },
              [{ type: "Role", id: role.id, revision: change.result.revision }]
            )
          )
        }
        await assert.rejects(
          migrator.vehicle.create({
            data: {
              ...fixture.vehicle,
              id: randomUUID(),
              activePurchaseId: null,
              engineNumber: ` ${fixture.vehicle.engineNumber.toLowerCase()} `,
            },
          })
        )
        await assert.rejects(
          migrator.purchaseRecord.create({
            data: { ...fixture.cycle, id: randomUUID(), cycleNumber: 2 },
          })
        )
        await assert.rejects(
          migrator.purchaseRecord.update({
            where: { id: fixture.cycle.id },
            data: { status: "SOLD", closedAt: new Date() },
          })
        )
        await assert.rejects(
          migrator.vehicle.update({
            where: { id: fixture.vehicle.id },
            data: { activePurchaseId: null },
          })
        )
      }
    )
    await check(
      "forced real audit constraint failure rolls back business and command receipt",
      async () => {
        const command = envelope({
          name: `Synthetic Audit Rollback ${randomUUID()}`,
          grants: [],
          reason: "Essential audit failure",
        })
        await migrator.$executeRawUnsafe(
          `ALTER TABLE vamotors."AuditEntry" ADD CONSTRAINT t03_injected_failure CHECK (action <> 'create') NOT VALID`
        )
        try {
          await assert.rejects(executeAdmin(a.identity, "saveRole", command))
        } finally {
          await migrator.$executeRawUnsafe(
            `ALTER TABLE vamotors."AuditEntry" DROP CONSTRAINT t03_injected_failure`
          )
        }
        assert.equal(
          await db.role.count({ where: { name: command.input.name } }),
          0
        )
        assert.equal(
          await db.commandReceipt.count({
            where: { idempotencyKey: command.idempotencyKey },
          }),
          0
        )
      }
    )
    await check(
      "real notification FK failure rolls back caller transaction/audit/receipt",
      async () => {
        const roleId = randomUUID()
        const commandId = randomUUID()
        await assert.rejects(
          transaction(async (tx) => {
            await tx.$queryRaw`SELECT vamotors.lock_admin_guard()`
            await tx.role.create({
              data: {
                id: roleId,
                name: `Synthetic Notification Rollback ${roleId}`,
              },
            })
            await tx.commandReceipt.create({
              data: {
                id: commandId,
                environmentId: runtime.ENVIRONMENT_ID,
                actorKey: `USER:${seedIds.admin}`,
                commandName: "notificationRollbackProbe",
                idempotencyKey: randomUUID(),
                inputHash: "test-probe",
                result: { id: roleId },
              },
            })
            await audit(tx, {
              commandId,
              userId: seedIds.admin,
              entityType: "Role",
              entityId: roleId,
              action: "create",
              before: null,
              after: { name: "Synthetic rollback" },
            })
            await notify(tx, {
              recipientUserId: randomUUID(),
              eventKey: `probe:${commandId}`,
              kind: "APPROVAL_OUTCOME",
              targetType: "Role",
              targetId: roleId,
            })
          })
        )
        assert.equal(await db.role.count({ where: { id: roleId } }), 0)
        assert.equal(
          await db.commandReceipt.count({ where: { id: commandId } }),
          0
        )
        assert.equal(await db.auditEntry.count({ where: { commandId } }), 0)
      }
    )
    await check(
      "concurrent last-admin self-deactivation preserves one; next request/replay denied",
      async () => {
        const role = await db.role.findUniqueOrThrow({
          where: { id: seedIds.administratorRole },
        })
        const ua = await db.user.findUniqueOrThrow({
          where: { id: seedIds.admin },
        })
        const ub = await db.user.findUniqueOrThrow({
          where: { id: seedIds.second },
        })
        const command = (u: typeof ua) =>
          envelope(
            {
              id: u.id,
              name: u.name,
              active: false,
              roleIds: [role.id],
              reason: "Synthetic last-admin race",
            },
            [
              { type: "User", id: u.id, revision: u.authzRevision },
              { type: "Role", id: role.id, revision: role.revision },
            ]
          )
        const ca = command(ua)
        const cb = command(ub)
        const results = await Promise.allSettled([
          executeAdmin(a.identity, "updateUser", ca),
          executeAdmin(b.identity, "updateUser", cb),
        ])
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1)
        const loser = results.find(
          (r) => r.status === "rejected"
        ) as PromiseRejectedResult
        assert.ok(rejectsCode("LAST_ADMIN")(loser.reason))
        const disabled = await db.user.findFirstOrThrow({
          where: { active: false, id: { in: [ua.id, ub.id] } },
        })
        const dead = disabled.id === ua.id ? a : b
        const alive = disabled.id === ua.id ? b : a
        try {
          await assert.rejects(
            currentActor(db, dead.identity),
            rejectsCode("ACCOUNT_INACTIVE")
          )
          await assert.rejects(
            executeAdmin(
              dead.identity,
              "updateUser",
              disabled.id === ua.id ? ca : cb
            ),
            rejectsCode("ACCOUNT_INACTIVE")
          )
          // Direct SQL cannot remove final admin either (DB trigger, not service).
          await assert.rejects(
            db.user.updateMany({
              where: { active: true, id: { in: [ua.id, ub.id] } },
              data: { active: false },
            })
          )
        } finally {
          await executeAdmin(
            alive.identity,
            "updateUser",
            envelope(
              {
                id: disabled.id,
                name: disabled.name,
                active: true,
                roleIds: [role.id],
                reason: "Restore synthetic administrator",
              },
              [
                {
                  type: "User",
                  id: disabled.id,
                  revision: disabled.authzRevision,
                },
                { type: "Role", id: role.id, revision: role.revision },
              ]
            )
          )
        }
      }
    )
    await check(
      "runtime denied DDL/environment/guard/audit mutations and role escalation",
      async () => {
        const denied = [
          "CREATE TABLE vamotors.t03_forbidden_ddl (id integer)",
          'UPDATE vamotors."Environment" SET "allowBusinessWrites" = false',
          'UPDATE vamotors."AdminGuard" SET id = 2',
          'UPDATE vamotors."AuditEntry" SET action = action',
          'DELETE FROM vamotors."AuditEntry"',
          'TRUNCATE vamotors."AuditEntry"',
          "SET ROLE vamotors_migrator",
        ]
        for (const sql of denied)
          await assert.rejects(db.$executeRawUnsafe(sql))
        await assert.rejects(
          db.role.update({
            where: { id: seedIds.administratorRole },
            data: { active: false },
          })
        )
      }
    )
    console.log(
      "Bounded real-DB security checks passed; no downstream sale/import/hosted acceptance implied."
    )
  } finally {
    await Promise.all([db.$disconnect(), migrator.$disconnect()])
  }
}
main().catch(() => {
  console.error(
    "Real-DB security checks blocked or failed; no secret-bearing errors emitted. No mock fallback."
  )
  process.exitCode = 1
})
