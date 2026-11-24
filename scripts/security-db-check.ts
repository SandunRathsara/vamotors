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
import { CommandError } from "../lib/server/errors"
import { runtimeConfig } from "../lib/server/config"
import { z } from "zod"
import { verifyPassword } from "better-auth/crypto"

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
    !["local", "disposable-test"].includes(runtime.APP_ENV) ||
    runtime.ENVIRONMENT_ID !== migration.ENVIRONMENT_ID
  )
    throw new Error("ISOLATION_REQUIRED")
  const migrationURL = authorizedMigration(migration)
  Object.assign(process.env, runtime)
  const db = database()
  const migrator = createDatabase(migrationURL)
  async function check(label: string, run: () => Promise<void>) {
    console.log(`CHECK ${label}`)
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
    if (response.status !== 200)
      console.error(`Credential login failed with HTTP ${response.status}`)
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
        const id = process.env.ENVIRONMENT_ID
        try {
          process.env.ENVIRONMENT_ID = randomUUID()
          await assert.rejects(
            assertEnvironment(db, true),
            rejectsCode("ENVIRONMENT_UNAVAILABLE")
          )
        } finally {
          process.env.ENVIRONMENT_ID = id
        }
        const result = await transaction(async (tx) => {
          const [row] = await tx.$queryRaw<
            { actor: string; isolation: string; timeout: string }[]
          >`SELECT current_user::text AS actor, current_setting('transaction_isolation') AS isolation, current_setting('statement_timeout') AS timeout`
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
      "real credentials/session cookies; no public signup/bootstrap/password reset",
      async () => {
        for (const path of [
          "/api/auth/sign-up/email",
          "/api/auth/bootstrap",
          "/api/auth/reset-password",
        ])
          assert.equal((await authPOST(request(path, {}))).status, 404)
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
      "runtime administrator creates real private credential account without credential disclosure",
      async () => {
        const role = await db.role.findUniqueOrThrow({
          where: { id: seedIds.readerRole },
        })
        const password = `${randomUUID()}${randomUUID()}`
        const email = `security-${randomUUID()}@example.test`
        const input = envelope(
          {
            name: "Synthetic Created Staff",
            email,
            password,
            roleIds: [role.id],
          },
          [{ type: "Role", id: role.id, revision: role.revision }]
        )
        const result = await executeAdmin(a.identity, "createUser", input)
        const serialized = JSON.stringify(result)
        assert.ok(
          !serialized.includes(password) && !serialized.includes('"password"')
        )
        const history = JSON.stringify(
          await db.auditEntry.findMany({
            where: { commandId: result.commandId },
          })
        )
        assert.ok(
          !history.includes(password) && !history.includes('"password"')
        )
        const membership = await db.auditEntry.findFirstOrThrow({
          where: {
            commandId: result.commandId,
            entityType: "UserRole",
            entityId: result.result.id,
          },
        })
        assert.deepEqual(
          (membership.fieldDiff as Record<string, unknown>).roleId,
          { before: null, after: role.id }
        )
        const subject = (await securityQuery(
          a.identity,
          "audit",
          new URLSearchParams({
            type: "UserRole",
            id: result.result.id,
            relatedId: role.id,
          })
        )) as { total: number }
        assert.equal(subject.total, 1)
        const syntheticRole = await executeAdmin(
          a.identity,
          "saveRole",
          envelope({
            name: `Audit permission ${randomUUID()}`,
            grants: [{ subject: "Customer", action: "read", fields: ["id"] }],
            reason: "Test new permission",
          })
        )
        const permission = await db.rolePermission.findFirstOrThrow({
          where: { roleId: syntheticRole.result.id },
        })
        await executeAdmin(
          a.identity,
          "saveRole",
          envelope(
            {
              id: syntheticRole.result.id,
              name: `Audit permission ${syntheticRole.result.id}`,
              grants: [],
              reason: "Test removed permission",
            },
            [
              {
                type: "Role",
                id: syntheticRole.result.id,
                revision: syntheticRole.result.revision,
              },
            ]
          )
        )
        const permissionHistory = (await securityQuery(
          a.identity,
          "audit",
          new URLSearchParams({
            type: "RolePermission",
            id: syntheticRole.result.id,
            relatedId: permission.permissionId,
          })
        )) as {
          data: {
            action: string
            fields: { path: string; before: unknown; after: unknown }[]
          }[]
        }
        assert.deepEqual(
          permissionHistory.data.map((entry) => entry.action),
          ["create", "delete"]
        )
        assert.ok(
          permissionHistory.data[1].fields.some(
            (field) =>
              field.path === "permissionId" &&
              field.before === permission.permissionId &&
              field.after === null
          )
        )
        const credential = await db.account.findFirstOrThrow({
          where: { userId: result.result.id, providerId: "credential" },
        })
        assert.equal(credential.accountId, result.result.id)
        assert.ok(credential.password)
        assert.ok(await verifyPassword({ hash: credential.password, password }))
        assert.ok(
          !(await verifyPassword({
            hash: credential.password,
            password: `${password}wrong`,
          }))
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
              // The deferred active-cycle composite relation shares this PK.
              // Assign it before constructing the circular graph.
              id: randomUUID(),
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
          // The accepted vehicle guard only attaches a
          // non-command cycle to an existing vehicle as a repurchase cycle.
          // This raw constraint fixture supplies that lawful shape; it is not
          // purchase-command acceptance.
          const cycle = await tx.purchaseRecord.create({
            data: {
              vehicleId: vehicle.id,
              cycleNumber: 2,
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
            data: { activePurchaseId: cycle.id, revision: { increment: 1 } },
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
          include: { purchases: { orderBy: { cycleNumber: "desc" } } },
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
          migrator.$transaction(async (tx) => {
            await tx.vehicle.update({
              where: { id: fixture.vehicle.id },
              data: { activePurchaseId: null },
            })
            await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE")
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
      "failed notification audit rolls back caller, notification and receipt",
      async () => {
        const roleId = randomUUID()
        const commandId = randomUUID()
        await migrator.$executeRaw`
          ALTER TABLE vamotors."AuditEntry" ADD CONSTRAINT notification_audit_probe
          CHECK (action <> 'createNotification') NOT VALID
        `
        try {
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
              await notify(
                tx,
                { commandId, userId: seedIds.admin },
                {
                  recipientUserId: seedIds.admin,
                  eventKey: `probe:${commandId}`,
                  kind: "APPROVAL_OUTCOME",
                  targetType: "Role",
                  targetId: roleId,
                }
              )
            }),
            (error: unknown) =>
              error instanceof Error &&
              error.message.includes("notification_audit_probe")
          )
        } finally {
          await migrator.$executeRaw`ALTER TABLE vamotors."AuditEntry" DROP CONSTRAINT notification_audit_probe`
        }
        assert.equal(
          await db.notification.count({
            where: { eventKey: `probe:${commandId}` },
          }),
          0
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
          // More failures than the bounded pool size: deferred checks must
          // rollback/release, not strand a connection after failed COMMIT.
          for (let attempt = 0; attempt < 6; attempt++)
            await assert.rejects(
              transaction((tx) =>
                tx.user.updateMany({
                  where: { active: true, id: { in: [ua.id, ub.id] } },
                  data: { active: false },
                })
              )
            )
          assert.equal(
            await db.user.count({
              where: { active: true, id: { in: [ua.id, ub.id] } },
            }),
            1
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
          "CREATE TABLE public.t03_forbidden_ddl (id integer)",
          "CREATE TEMP TABLE t03_forbidden_ddl (id integer)",
          "CREATE SCHEMA t03_forbidden_schema",
          "CREATE ROLE t03_forbidden_role",
          'UPDATE vamotors."Environment" SET "allowBusinessWrites" = false',
          'UPDATE vamotors."AdminGuard" SET id = 2',
          'UPDATE vamotors."AuditEntry" SET action = action',
          'DELETE FROM vamotors."AuditEntry"',
          'TRUNCATE vamotors."AuditEntry"',
          "SET ROLE vamotors_migrator",
        ]
        for (const sql of denied)
          await assert.rejects(db.$executeRawUnsafe(sql))
        const [privileges] = await db.$queryRaw<
          { elevated: boolean }[]
        >`SELECT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS elevated FROM pg_roles WHERE rolname = current_user`
        assert.equal(privileges.elevated, false)
        // Append-only trigger still protects against accidental wider ACLs.
        await assert.rejects(
          migrator.$executeRawUnsafe(
            'UPDATE vamotors."AuditEntry" SET action = action'
          )
        )
        await assert.rejects(
          migrator.$executeRawUnsafe('DELETE FROM vamotors."AuditEntry"')
        )
        await assert.rejects(
          db.role.update({
            where: { id: seedIds.administratorRole },
            data: { active: false },
          })
        )
      }
    )
    await check(
      "logout deletes real sessions; retained cookies and identities no longer authorize",
      async () => {
        for (const session of [a, b, staff]) {
          const response = await authPOST(
            request("/api/auth/sign-out", {}, session.cookie)
          )
          assert.equal(response.status, 200)
          assert.equal(
            response.headers.get("cache-control"),
            "private,no-store"
          )
          assert.ok(response.headers.getSetCookie().length)
          await assert.rejects(
            authenticate(new Headers({ cookie: session.cookie })),
            rejectsCode("UNAUTHENTICATED")
          )
          await assert.rejects(
            currentActor(db, session.identity),
            rejectsCode("UNAUTHENTICATED")
          )
        }
      }
    )
    await check(
      "enumerate committed command receipts and check transactional audit",
      async () => {
        const rows = await db.$queryRaw<
          { command: string; receipts: number; missing: number }[]
        >`
        SELECT c."commandName" AS command, count(*)::int AS receipts,
          count(*) FILTER (WHERE NOT EXISTS (
            SELECT 1 FROM vamotors."AuditEntry" a WHERE a."commandId" = c.id
          ))::int AS missing
        FROM vamotors."CommandReceipt" c
        WHERE c."commandName" NOT IN ('markNotificationRead', 'markAllNotificationsRead', 'issueInvoice')
        GROUP BY 1 ORDER BY 1
      `
        // These operations can record an idempotency receipt when there is no business change.
        assert.ok(rows.length > 0)
        for (const row of rows) {
          assert.equal(row.missing, 0, row.command)
          console.log(`AUDIT ${row.command} ${row.receipts}`)
        }
      }
    )
    console.log(
      "Bounded real-DB security checks passed; no downstream sale/import/hosted acceptance implied."
    )
  } finally {
    await Promise.all([db.$disconnect(), migrator.$disconnect()])
  }
}
main().catch((error) => {
  if (error instanceof CommandError)
    console.error(`Command failure code: ${error.code}`)
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    /^P\d{4}$/.test(String(error.code))
  )
    console.error(`Prisma failure code: ${error.code}`)
  if (error && typeof error === "object" && "meta" in error) {
    const meta = error.meta as { modelName?: string; constraint?: unknown }
    if (meta.modelName && /^[A-Za-z]+$/.test(meta.modelName))
      console.error(`Failing model: ${meta.modelName}`)
  }
  if (error instanceof Error) {
    const source = error.stack
      ?.split("\n")
      .find((line) => line.includes("scripts/security-db-check.ts:"))
    if (source) console.error(source.trim())
  }
  console.error(
    "Real-DB security checks blocked or failed; no secret-bearing errors emitted. No mock fallback."
  )
  process.exitCode = 1
})
