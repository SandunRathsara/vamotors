/** Native HTTP regression for executeRepair's trusted-prior branch (T08-P2-001).
 * prepare once, check repeatedly against SAME receipts; no mocked replay engine.
 * Usage: node --import tsx tests/security/repair-replay-authority-check.ts ROOT prepare|check|locks|restart
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { APIRequestContext, APIResponse } from "@playwright/test"
import pg from "pg"
import type {
  Applied,
  CurrentActorDTO,
  Grant,
  PurchaseCycleDTO,
  RoleDTO,
  UserAdminDTO,
} from "../../.planning/implementation/contracts/api"
import { fieldsFor } from "../../lib/server/permissions"
import { privateEnvironment } from "../../scripts/private-environment"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

const [root, mode = "check"] = process.argv.slice(2)
assert.ok(root && ["prepare", "check", "locks", "restart"].includes(mode))
const f = await fixture(root),
  run = randomUUID()
const names = [
  "sendRepair",
  "returnRepair",
  "payRepair",
  "reversePayment",
] as const
type Name = (typeof names)[number]
type Body = ReturnType<typeof envelope>
type Retained = {
  original: CurrentActorDTO
  roleId: string
  cycleId: string
  repairId: string
  alternate: { cycleId: string; repairId: string; paymentId: string }
  bodies: Record<Name, Body>
  applied: Record<Name, Applied>
  grants: Grant[]
}
const factsPath = join(root, "repair-replay-authority-facts.json")
const events: unknown[] = [],
  failures: string[] = []
let facts: Retained, admin: APIRequestContext, staff: APIRequestContext
let stage = "start",
  restored = false
const clients: APIRequestContext[] = []
const excluded = ["session", "Session", "AdminGuard"]
// Snapshot ALL rows, not WHERE test-owned. Auth-session churn and guard generation
// are excluded explicitly; bigint/date facts are native PG text, never JS numbers.
async function snapshot(authCommand?: string) {
  const tables = (
    await f.db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='vamotors' AND tablename<>ALL($1::text[]) ORDER BY tablename",
      [excluded]
    )
  ).rows.map((r) => r.tablename)
  const rows: Record<string, unknown> = {}
  for (const t of tables) {
    if (
      authCommand &&
      [
        "user",
        "User",
        "UserRole",
        "Role",
        "RolePermission",
        "Permission",
      ].includes(t)
    )
      continue
    const where =
      authCommand && ["CommandReceipt", "AuditEntry"].includes(t)
        ? ` WHERE "${t === "AuditEntry" ? "commandId" : "id"}"<>$1::uuid`
        : ""
    rows[t] = (
      await f.db.query(
        `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') hash FROM vamotors."${t}" t${where} ORDER BY hash`,
        where ? [authCommand] : []
      )
    ).rows
  }
  return rows
}
function expectStatus(
  label: string,
  response: {
    status: number
    value: { error?: { code?: string }; data?: { status?: string } }
  },
  status: number,
  code?: string
) {
  if (
    response.status !== status ||
    (code && response.value?.error?.code !== code)
  )
    failures.push(
      `${label}: expected ${status}/${code ?? ""}, got ${response.status}/${response.value?.error?.code ?? response.value?.data?.status ?? ""}`
    )
}
async function read(response: APIResponse) {
  assert.match(response.headers()["cache-control"], /no-store/)
  return { status: response.status(), value: await response.json() }
}
const post = (client: APIRequestContext, name: Name, body: Body) =>
  client.post(`/api/v1/commands/${name}`, {
    headers: { Origin: f.origin },
    data: body,
  })
const statusPath = (name: Name) =>
  `/api/v1/queries/commandStatus?name=${name}&idempotencyKey=${facts.bodies[name].idempotencyKey}`
async function unchanged(
  label: string,
  request: () => Promise<APIResponse>,
  status: number,
  code?: string
) {
  const before = await snapshot(),
    response = await read(await request()),
    after = await snapshot()
  events.push({ label, before, after, response })
  // Effect assertion MUST precede status assertions, even on expected RED.
  assert.deepEqual(
    after,
    before,
    `${label}: unconditional native graph changed`
  )
  expectStatus(label, response, status, code)
  return response.value
}
const current = (id = facts.cycleId) =>
  f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`)
async function roleBody(grants: Grant[]) {
  const r = await f.query<RoleDTO>(admin, "role", `?id=${facts.roleId}`)
  return envelope(
    {
      id: r.id,
      name: r.name,
      reason: "Replay current-authority regression",
      grants,
    },
    [ref(r, "Role")]
  )
}
async function role(grants: Grant[]) {
  return f.command(admin, "saveRole", await roleBody(grants))
}
async function membershipBody(active: boolean, roleIds: string[]) {
  const u = await f.query<UserAdminDTO>(
    admin,
    "user",
    `?id=${facts.original.user.id}`
  )
  const roles = await Promise.all(
    roleIds.map((id) => f.query<RoleDTO>(admin, "role", `?id=${id}`))
  )
  return envelope(
    {
      id: u.id,
      name: u.name,
      active,
      roleIds,
      reason: "Bounded replay test membership; restore captured original",
    },
    [ref(u, "User"), ...roles.map((r) => ref(r, "Role"))]
  )
}
async function membership(active: boolean, roleIds: string[]) {
  return f.command(admin, "updateUser", await membershipBody(active, roleIds))
}
const action = (name: Name) =>
  name === "sendRepair" ? "create" : name === "returnRepair" ? "update" : "pay"
function restricted(
  name: Name,
  kind: "read" | "action" | "field" | "other-target"
): Grant[] {
  if (kind === "read")
    return facts.grants.filter(
      (g) => !(g.subject === "RepairRecord" && g.action === "read")
    )
  if (kind === "other-target")
    return facts.grants.map((g) =>
      g.subject === "Vehicle" && g.action === "read"
        ? {
            ...g,
            conditions: { status: "IN_STOCK" },
          }
        : g
    )
  if (kind === "action")
    return facts.grants.filter(
      (g) => !(g.subject === "RepairRecord" && g.action === action(name))
    )
  const leaf =
    name === "sendRepair"
      ? "request"
      : name === "returnRepair"
        ? "summary"
        : name === "payRepair"
          ? "payment.reference"
          : "reason"
  return facts.grants.map((g) =>
    g.subject === "RepairRecord" && g.action === action(name)
      ? {
          ...g,
          fields: fieldsFor("RepairRecord", g.action).filter(
            (p) => p !== leaf && !leaf.startsWith(p + ".")
          ),
        }
      : g
  )
}
function altered(name: Name, kind: "payload" | "refs" | "target") {
  const b = structuredClone(facts.bodies[name])
  const i = b.input as {
    cycleId?: string
    sourceId?: string
    paymentId?: string
    repairId?: string
    request?: string
    summary?: string
    reason?: string
    payment?: { reference?: string }
  }
  if (kind === "refs")
    b.expected = b.expected.map((r) => ({ ...r, revision: r.revision + 1 }))
  else if (kind === "target") {
    b.expected = []
    if (name === "sendRepair") i.cycleId = facts.alternate.cycleId
    else if (name === "reversePayment") {
      i.sourceId = facts.alternate.repairId
      i.paymentId = facts.alternate.paymentId
    } else i.repairId = facts.alternate.repairId
  } else if (name === "sendRepair") i.request = "Valid changed request"
  else if (name === "returnRepair") i.summary = "Valid changed return"
  else if (name === "payRepair" && i.payment)
    i.payment.reference = "Valid changed cash reference"
  else i.reason = "Valid changed correction reason"
  return b
}
async function replay(name: Name, client = staff) {
  const r = await unchanged(
    `${name} identical`,
    () => post(client, name, facts.bodies[name]),
    200
  )
  const s = await unchanged(
    `${name} exact-key recovery`,
    () => client.get(statusPath(name)),
    200
  )
  const row = await current(),
    repair = row.repairs.find((r) => r.id === facts.repairId)!
  for (const value of [r, s.data]) {
    assert.equal(value.replayed, true)
    assert.equal(value.commandId, facts.applied[name].commandId)
    assert.deepEqual(value.result, facts.applied[name].result)
    assert.deepEqual(value.affected, [ref(row), ref(repair, "RepairRecord")])
  }
}
async function prepare() {
  assert.equal(
    await readFile(factsPath).then(
      () => true,
      () => false
    ),
    false,
    "Never replace retained facts"
  )
  const original = await f.query<CurrentActorDTO>(staff, "currentActor")
  const grants: Grant[] = [
    ...(
      [
        "PurchaseRecord",
        "Vehicle",
        "VehicleCost",
        "RepairVendor",
        "RepairRecord",
      ] as const
    ).map((subject) => ({ subject, action: "read" as const, fields: ["*"] })),
    { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
    { subject: "PurchaseRecord", action: "pay", fields: ["cycleId"] },
    ...(["create", "update", "pay"] as const).map((action) => ({
      subject: "RepairRecord" as const,
      action,
      fields: ["*"],
    })),
  ]
  const cmd = (
    name: string,
    input: unknown,
    expected: Body["expected"] = [],
    code = 200
  ) => f.command(admin, name, envelope(input, expected), code)
  const r = await cmd(
    "saveRole",
    { name: `Replay ${run}`, reason: "Isolated new role only", grants },
    [],
    201
  )
  facts = {
    original,
    grants,
    roleId: r.result.id,
    cycleId: "",
    repairId: "",
    alternate: { cycleId: "", repairId: "", paymentId: "" },
    bodies: {} as Retained["bodies"],
    applied: {} as Retained["applied"],
  }
  await membership(true, [facts.roleId])
  const supplier = await cmd(
    "createDirectoryParty",
    {
      type: "SUPPLIER",
      values: {
        name: `Replay supplier ${run}`,
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
        name: `Replay vendor ${run}`,
        category: "COMPANY",
        contacts: [],
      },
    },
    [],
    201
  )
  async function cycle(tag: string) {
    const c = await cmd(
      "recordPurchase",
      purchaseInput(supplier.result.id, run.slice(0, 8), tag),
      [ref(supplier.result, "Supplier")],
      201
    )
    const row = await current(c.result.id)
    await cmd(
      "receiveStock",
      {
        cycleId: row.id,
        date: "2026-10-02",
        disposition: { kind: "HOLD", reason: "Actual repair inspection" },
      },
      [ref(row)]
    )
    return current(row.id)
  }
  let row = await cycle("trusted")
  facts.cycleId = row.id
  const key = randomUUID() // Same literal key across FOUR command scopes.
  facts.bodies.sendRepair = envelope(
    {
      cycleId: row.id,
      vendorId: vendor.result.id,
      sentDate: "2026-10-03",
      request: "Actual trusted work",
    },
    [ref(row), ref(vendor.result, "RepairVendor")],
    key
  )
  facts.applied.sendRepair = await f.command(
    staff,
    "sendRepair",
    facts.bodies.sendRepair,
    201
  )
  facts.repairId = facts.applied.sendRepair.result.id
  row = await current()
  const refs = () => [
    ref(row),
    ref(row.repairs.find((r) => r.id === facts.repairId)!, "RepairRecord"),
  ]
  facts.bodies.returnRepair = envelope(
    {
      repairId: facts.repairId,
      returnedDate: "2026-10-04",
      invoiceDate: "2026-10-03",
      invoiceAmount: "1000",
      summary: "Actual returned work",
      payment: {
        amount: "100",
        date: "2026-09-25",
        method: "CASH",
        reference: "Return cash",
      },
    },
    refs(),
    key
  )
  facts.applied.returnRepair = await f.command(
    staff,
    "returnRepair",
    facts.bodies.returnRepair
  )
  row = await current()
  facts.bodies.payRepair = envelope(
    {
      repairId: facts.repairId,
      payment: {
        amount: "300",
        date: "2026-10-05",
        method: "BANK_TRANSFER",
        reference: "Actual cash",
      },
    },
    refs(),
    key
  )
  facts.applied.payRepair = await f.command(
    staff,
    "payRepair",
    facts.bodies.payRepair
  )
  row = await current()
  const payment = row.repairs[0].payments.find((p) => p.amount === "300")!
  facts.bodies.reversePayment = envelope(
    {
      sourceType: "REPAIR",
      sourceId: facts.repairId,
      paymentId: payment.id,
      reason: "Correct original entry, not refund",
      replacement: {
        amount: "200",
        date: "2026-10-05",
        method: "BANK_TRANSFER",
        reference: "Actual replacement",
      },
    },
    refs(),
    key
  )
  facts.applied.reversePayment = await f.command(
    staff,
    "reversePayment",
    facts.bodies.reversePayment
  )
  const other = await cycle("other")
  facts.alternate.cycleId = other.id
  const sent = await cmd(
    "sendRepair",
    {
      cycleId: other.id,
      vendorId: vendor.result.id,
      sentDate: "2026-10-03",
      request: "Other actor target",
    },
    [ref(other), ref(vendor.result, "RepairVendor")],
    201
  )
  let alt = await current(other.id)
  await cmd(
    "returnRepair",
    {
      repairId: sent.result.id,
      returnedDate: "2026-10-04",
      invoiceDate: "2026-10-03",
      invoiceAmount: "1000",
      summary: "Actual other work",
      payment: { amount: "100", date: "2026-10-04", method: "CASH" },
    },
    [ref(alt), ref(alt.repairs[0], "RepairRecord")]
  )
  alt = await current(other.id)
  facts.alternate.repairId = sent.result.id
  facts.alternate.paymentId = alt.repairs[0].payments[0].id
  await cmd(
    "archiveParty",
    {
      type: "REPAIR_VENDOR",
      id: vendor.result.id,
      active: false,
      reason: "Historical vendor retained",
    },
    [ref(vendor.result, "RepairVendor")]
  )
  row = await current()
  const cycleRefs = [
    ref(row),
    {
      type: "Vehicle" as const,
      id: row.vehicleId,
      revision: row.identityRevision,
    },
  ]
  const response = await admin.post("/api/v1/commands/requestApproval", {
    headers: { Origin: f.origin },
    data: envelope(
      {
        proposal: {
          kind: "WRITE_OFF",
          input: {
            cycleId: row.id,
            date: "2026-10-06",
            reason: "Actual separately reviewed closure",
            method: "OTHER",
            proceeds: "0",
          },
        },
        reason: "Real close, not fabricated terminal state",
      },
      cycleRefs
    ),
  })
  assert.equal(response.status(), 202)
  const pending = await response.json(),
    reviewer = await f.login("SECOND")
  clients.push(reviewer)
  await f.command(
    reviewer,
    "reviewApproval",
    envelope({ approvalId: pending.approvalId, decision: "APPROVE" }, [
      { type: "ApprovalRequest", id: pending.approvalId, revision: 1 },
      ...cycleRefs,
    ])
  )
  row = await current()
  assert.ok(row.closedAt)
  assert.equal(row.status, "WRITTEN_OFF")
  await writeFile(factsPath, JSON.stringify(facts, null, 2), {
    mode: 0o600,
    flag: "wx",
  })
  events.push({
    ordinaryFirstExecutions: names.map((n) => ({
      name: n,
      body: facts.bodies[n],
      applied: facts.applied[n],
    })),
    realLaterClosure: row,
  })
  console.log(
    "PASS four ordinary executions, later revisions/return/actual close/vendor archive retained"
  )
}
async function check() {
  await membership(true, [facts.roleId])
  await role(facts.grants)
  const other = await f.login("SECOND")
  clients.push(other)
  for (const name of names) {
    stage = `${name} authorized/scoped controls`
    await replay(name)
    for (const kind of ["payload", "refs"] as const)
      await unchanged(
        `${name} authorized changed ${kind}`,
        () => post(staff, name, altered(name, kind)),
        409,
        "IDEMPOTENCY_MISMATCH"
      )
    const scoped = await unchanged(
      `${name} foreign actor status`,
      () => other.get(statusPath(name)),
      200
    )
    assert.equal(scoped.data.status, "NOT_COMMITTED")
    await unchanged(
      `${name} other actor committed-key does not replay`,
      () => post(other, name, facts.bodies[name]),
      409
    )
    for (const kind of ["read", "action", "field", "other-target"] as const) {
      stage = `${name} ${kind} denial`
      await role(restricted(name, kind))
      const status = kind === "read" || kind === "other-target" ? 404 : 403
      const code =
        status === 404
          ? "NOT_FOUND"
          : kind === "field"
            ? "FIELD_FORBIDDEN"
            : "FORBIDDEN"
      await unchanged(
        `${stage} identical`,
        () => post(staff, name, facts.bodies[name]),
        status,
        code
      )
      await unchanged(
        `${stage} recovery`,
        () => staff.get(statusPath(name)),
        status,
        code
      )
      for (const variant of ["payload", "refs", "target"] as const)
        await unchanged(
          `${stage} changed ${variant}`,
          () => post(staff, name, altered(name, variant)),
          status,
          code
        )
      if (kind === "read") {
        const fresh = {
          ...altered(name, "payload"),
          idempotencyKey: randomUUID(),
        }
        await unchanged(
          `${stage} fresh key`,
          () => post(staff, name, fresh),
          404,
          "NOT_FOUND"
        )
      }
      if (kind === "other-target") {
        const visible = await f.query<PurchaseCycleDTO>(
          staff,
          "purchase",
          `?cycleId=${facts.alternate.cycleId}`
        )
        assert.ok(
          visible.repairs.some((r) => r.id === facts.alternate.repairId),
          "Attacker-selected alternate target must actually be readable"
        )
      }
      await role(facts.grants)
    }
    await membership(false, [facts.roleId])
    for (const b of [facts.bodies[name], altered(name, "payload")])
      await unchanged(
        `${name} inactive`,
        () => post(staff, name, b),
        403,
        "ACCOUNT_INACTIVE"
      )
    await unchanged(
      `${name} inactive status`,
      () => staff.get(statusPath(name)),
      403,
      "ACCOUNT_INACTIVE"
    )
    await membership(true, [facts.roleId])
    const fresh = { ...altered(name, "target"), idempotencyKey: randomUUID() }
    await unchanged(
      `${name} fresh missing refs`,
      () => post(staff, name, fresh),
      428,
      "REVISION_REQUIRED"
    )
  }
  const wrong = envelope(
    {
      sourceType: "REPAIR",
      sourceId: facts.repairId,
      paymentId: facts.alternate.paymentId,
      reason: "Explicit wrong typed owner",
    },
    [{ type: "PurchaseRecord", id: facts.repairId, revision: 1 }]
  )
  await unchanged(
    "fresh wrong typed owner",
    () => post(staff, "reversePayment", wrong),
    422,
    "INVALID_INPUT"
  )
  const anon = await import("@playwright/test").then((p) =>
    p.request.newContext({ baseURL: f.origin })
  )
  clients.push(anon)
  await unchanged(
    "anonymous401",
    () => post(anon, "sendRepair", facts.bodies.sendRepair),
    401,
    "UNAUTHENTICATED"
  )
  // Wrong app environment fails closed before looking up any receipt. No DB or
  // receipt environment is edited, copied or temporarily relabeled for this probe.
  await f.stop()
  const originalEnvironment = f.runtime.ENVIRONMENT_ID
  try {
    f.runtime.ENVIRONMENT_ID = randomUUID()
    await f.start()
    await unchanged(
      "environment-bound status",
      () => staff.get(statusPath("sendRepair")),
      503,
      "ENVIRONMENT_UNAVAILABLE"
    )
    await unchanged(
      "environment-bound POST",
      () => post(staff, "sendRepair", altered("sendRepair", "payload")),
      503,
      "ENVIRONMENT_UNAVAILABLE"
    )
  } finally {
    await f.stop()
    f.runtime.ENVIRONMENT_ID = originalEnvironment
    await f.start()
  }
}
async function locks() {
  const env = await privateEnvironment(join(root, "admin.env")),
    url = new URL(env.ADMIN_URL!)
  url.pathname = "/vamotors_local"
  const monitor = new pg.Pool({ connectionString: url.href, max: 1 })
  async function wait(fragment: string, exclude: number[] = []) {
    const deadline = Date.now() + 1800
    do {
      const rows = (
        await monitor.query(
          "SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers FROM pg_stat_activity WHERE datname=current_database() AND usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE $1 AND NOT(pid=ANY($2::int[]))",
          [`%${fragment}%`, exclude]
        )
      ).rows
      if (rows.length) return rows[0]
    } while (Date.now() < deadline)
    throw Error(`NO_OBSERVED_WAIT:${fragment}`)
  }
  try {
    await membership(true, [facts.roleId])
    for (const name of names)
      for (const kind of ["read", "action", "inactive"] as const) {
        await role(facts.grants)
        await membership(true, [facts.roleId])
        stage = `${name} POST post-wait ${kind}`
        const postMutationBody =
          kind === "inactive"
            ? await membershipBody(false, [facts.roleId])
            : await roleBody(restricted(name, kind))
        const postBefore = await snapshot(
          "00000000-0000-4000-8000-000000000000"
        )
        const blocker = await f.db.connect()
        let pending: Promise<APIResponse> | undefined
        try {
          await blocker.query("BEGIN")
          const pid = (await blocker.query("SELECT pg_backend_pid() pid"))
            .rows[0].pid
          await blocker.query(
            'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
          )
          pending = post(staff, name, altered(name, "payload"))
          const observed = await wait("BusinessSequence")
          assert.ok(observed.blockers.includes(pid))
          const applied = await f.command(
            admin,
            kind === "inactive" ? "updateUser" : "saveRole",
            postMutationBody
          )
          await blocker.query("COMMIT")
          const response = await read(await pending),
            after = await snapshot(applied.commandId)
          events.push({
            stage,
            pid,
            observed,
            authCommand: applied.commandId,
            before: postBefore,
            after,
            response,
          })
          assert.deepEqual(after, postBefore)
          expectStatus(
            stage,
            response,
            kind === "read" ? 404 : 403,
            kind === "read"
              ? "NOT_FOUND"
              : kind === "inactive"
                ? "ACCOUNT_INACTIVE"
                : "FORBIDDEN"
          )
        } finally {
          await blocker.query("ROLLBACK")
          blocker.release()
          if (pending) await Promise.allSettled([pending])
        }
        await membership(true, [facts.roleId])
        await role(facts.grants)
        stage = `${name} commandStatus post-wait ${kind}`
        const statusMutationBody =
          kind === "inactive"
            ? await membershipBody(false, [facts.roleId])
            : await roleBody(restricted(name, kind))
        // Compare all business/source populations; only the known real audited
        // mutation's exact receipt/audit + auth tables are excluded below.
        const before = await snapshot("00000000-0000-4000-8000-000000000000")
        const guard = await f.db.connect()
        let mutation: Promise<Applied> | undefined,
          recovery: Promise<APIResponse> | undefined
        try {
          await guard.query("BEGIN")
          const pid = (await guard.query("SELECT pg_backend_pid() pid")).rows[0]
            .pid
          await guard.query(
            'SELECT id FROM vamotors."AdminGuard" WHERE id=1 FOR UPDATE'
          )
          mutation = f.command(
            admin,
            kind === "inactive" ? "updateUser" : "saveRole",
            statusMutationBody
          )
          const writer = await wait("lock_admin_guard")
          assert.ok(writer.blockers.includes(pid))
          recovery = staff.get(statusPath(name))
          const reader = await wait("lock_admin_guard", [writer.pid])
          assert.ok(reader.blockers.length)
          await guard.query("COMMIT")
          const applied = await mutation,
            response = await read(await recovery),
            after = await snapshot(applied.commandId)
          events.push({
            stage,
            pid,
            writer,
            reader,
            authCommand: applied.commandId,
            authExclusions: [
              "User",
              "UserRole",
              "Role",
              "RolePermission",
              "Permission",
              "exact mutation CommandReceipt/AuditEntry",
            ],
            before,
            after,
            response,
          })
          assert.deepEqual(after, before)
          expectStatus(
            stage,
            response,
            kind === "read" ? 404 : 403,
            kind === "read"
              ? "NOT_FOUND"
              : kind === "inactive"
                ? "ACCOUNT_INACTIVE"
                : "FORBIDDEN"
          )
        } finally {
          await guard.query("ROLLBACK")
          guard.release()
          await Promise.allSettled(
            [mutation, recovery].filter((p) => p !== undefined)
          )
        }
      }
  } finally {
    await monitor.end()
  }
}
try {
  assert.notEqual(new URL(f.origin).port, "8000")
  await f.start()
  admin = await f.login("ADMIN")
  staff = await f.login("STAFF")
  clients.push(admin, staff)
  if (mode === "prepare") await prepare()
  else {
    facts = JSON.parse(await readFile(factsPath, "utf8"))
    if (mode === "check") await check()
    if (mode === "locks") await locks()
    if (mode === "restart") {
      await membership(true, [facts.roleId])
      await role(facts.grants)
      const before = await snapshot(),
        row = await current()
      await f.restart()
      staff = await f.login("STAFF")
      admin = await f.login("ADMIN")
      clients.push(staff, admin)
      assert.deepEqual(await current(), row)
      assert.deepEqual(await snapshot(), before)
      for (const name of names) await replay(name)
    }
  }
  assert.deepEqual(failures, [], "Native replay authority regression")
  console.log(
    `PASS ${mode}: actual four-owner executeRepair/current commandStatus authority`
  )
} catch (error) {
  failures.push(error instanceof Error ? error.message : "UNKNOWN")
  console.error(`FAIL ${stage}: ${failures.join("; ")}`)
  process.exitCode = 1
} finally {
  if (facts! && admin!) {
    await role(facts.grants)
    await membership(
      facts.original.user.active,
      facts.original.roles.map((r) => r.id)
    )
    const actual = await f.query<UserAdminDTO>(
      admin,
      "user",
      `?id=${facts.original.user.id}`
    )
    assert.deepEqual(
      actual.roles.map((r) => r.id).sort(),
      facts.original.roles.map((r) => r.id).sort()
    )
    restored = true
  }
  await Promise.all(clients.map((c) => c.dispose()))
  await f.close()
  await writeFile(
    join(root, `repair-replay-authority-${mode}-${run}.json`),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        mode,
        stage,
        excluded,
        snapshotSemantics:
          "ALL unconditional native rows including migrations/auth/source; PG JSON-text sha256 ordering. Only Session/AdminGuard excluded normally; lock mutation exclusions explicitly retained.",
        events,
        failures,
        restored,
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
}
