/** Real production HTTP/PG current-requester receipt recovery, not business reexecution.
 * <own-root> probe|all. probe reproduces rejected92 in seconds after fixture prep.
 * No mocked authority, SQL business seeds, lowered caps or borrowed sessions.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { APIRequestContext, APIResponse } from "@playwright/test"
import pg from "pg"
import type {
  Applied,
  Pending,
  CurrentActorDTO,
  Grant,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fieldsFor } from "../../lib/server/permissions"
import { privateEnvironment } from "../../scripts/private-environment"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

const [root, mode = "all"] = process.argv.slice(2)
assert.ok(root && ["probe", "all"].includes(mode))
const f = await fixture(root),
  run = randomUUID()
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
const events: unknown[] = [],
  failures: string[] = []
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "LeasePurchaseDetail",
  "VehicleCost",
  "PurchasePayment",
  "CostPayment",
  "CycleBasisVersion",
  "MileageReading",
  "StatusEvent",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "CommandReceipt",
  "Notification",
  "BusinessSequence",
]
const save = () =>
  writeFile(
    join(root, `requester-replay-${run}.json`),
    JSON.stringify(
      { sha, source: process.cwd(), origin: f.origin, mode, events, failures },
      null,
      2
    ),
    { mode: 0o600 }
  )
async function snapshot(excludeAuthCommand?: string) {
  const value: Record<string, unknown> = {}
  for (const table of tables) {
    const exclude =
      excludeAuthCommand && ["AuditEntry", "CommandReceipt"].includes(table)
    value[table] = (
      await f.db.query(
        `SELECT id,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS sha256 FROM vamotors."${table}" t${exclude ? ` WHERE "${table === "AuditEntry" ? "commandId" : "id"}"<>$1::uuid` : ""} ORDER BY id`,
        exclude ? [excludeAuthCommand] : []
      )
    ).rows
  }
  return value // AdminGuard is mutable auth synchronization, never business immutability.
}
const reads: Grant[] = (
  [
    "PurchaseRecord",
    "Vehicle",
    "VehicleCost",
    "Supplier",
    "ApprovalRequest",
    "Disposal",
  ] as const
).map((subject) => ({ subject, action: "read", fields: ["*"] }))
const without = (
  grants: Grant[],
  subject: Grant["subject"],
  action: Grant["action"],
  path: string
): Grant[] =>
  grants.flatMap((g) => {
    if (g.subject !== subject || g.action !== action) return [g]
    const fields = fieldsFor(
      subject as Parameters<typeof fieldsFor>[0],
      action
    ).filter((f) => f !== path && !path.startsWith(`${f}.`))
    // Preserve the existing 100-fields/Grant wire limit without changing the ceiling.
    return Array.from({ length: Math.ceil(fields.length / 100) }, (_, n) => ({
      ...g,
      fields: fields.slice(n * 100, (n + 1) * 100),
    }))
  })
const cycleRefs = (row: PurchaseCycleDTO) => [
  ref(row),
  {
    type: "Vehicle" as const,
    id: row.vehicleId,
    revision: row.identityRevision,
  },
]
let admin: APIRequestContext | undefined,
  reviewer: APIRequestContext | undefined,
  requester: APIRequestContext | undefined
let originalRequester: CurrentActorDTO | undefined,
  originalReviewer: CurrentActorDTO | undefined
try {
  assert.notEqual(new URL(f.origin).port, "8000")
  await f.start()
  admin = await f.login("ADMIN")
  reviewer = await f.login("SECOND")
  requester = await f.login("STAFF")
  const control = admin,
    reviewClient = reviewer
  originalRequester = await f.query<CurrentActorDTO>(requester, "currentActor")
  originalReviewer = await f.query<CurrentActorDTO>(reviewer, "currentActor")
  const requesterId = originalRequester.user.id,
    reviewerId = originalReviewer.user.id
  const authority: Grant[] = [
    ...reads,
    {
      subject: "PurchaseRecord",
      action: "update",
      fields: ["cycleId"],
      conditions: { createdBy: "$actor.id" },
    },
    {
      subject: "Disposal",
      action: "create",
      fields: ["*"],
      conditions: { createdBy: "$actor.id" },
    },
    {
      subject: "Disposal",
      action: "pay",
      fields: ["*"],
      conditions: { createdBy: "$actor.id" },
    },
    {
      subject: "ApprovalRequest",
      action: "create",
      fields: ["*"],
      conditions: { createdBy: "$actor.id" },
    },
  ]
  const reviewAuthority: Grant[] = [
    ...authority
      .filter(
        (g) => !(g.subject === "ApprovalRequest" && g.action === "create")
      )
      .map((g) =>
        g.subject === "PurchaseRecord" && g.action === "update"
          ? { ...g, conditions: undefined }
          : g
      ),
    { subject: "ApprovalRequest", action: "approve", fields: ["*"] },
  ]
  const role = async (tag: string, grants: Grant[]) =>
    (
      await f.command(
        control,
        "saveRole",
        envelope({
          name: `Replay ${run} ${tag}`,
          grants,
          reason: "Bounded current-requester HTTP regression",
        }),
        201
      )
    ).result
  const roles = {
    seed: await role("lawful own source creation", [
      ...authority,
      { subject: "PurchaseRecord", action: "create", fields: ["*"] },
      { subject: "Vehicle", action: "create", fields: ["*"] },
    ]),
    full: await role("originating", authority),
    zero: await role(
      "zero has no pay grant",
      authority.filter((g) => g.action !== "pay")
    ),
    read: await role("read only", reads),
    field: await role(
      "missing proceeds leaf",
      without(authority, "Disposal", "create", "proceeds")
    ),
    consumed: await role(
      "missing consumed basis",
      without(authority, "PurchaseRecord", "read", "financial.basis")
    ),
    noRequestCreate: await role(
      "domain only",
      authority.filter(
        (g) => !(g.subject === "ApprovalRequest" && g.action === "create")
      )
    ),
    wrongCondition: await role(
      "actual source condition mismatch",
      authority.map((g) =>
        g.subject === "Vehicle" && g.action === "read"
          ? { ...g, conditions: { createdBy: "$actor.id", status: "IN_STOCK" } }
          : g
      )
    ),
    reviewer: await role("separate reviewer", reviewAuthority),
    reviewerScoped: await role(
      "foreign saved request hidden",
      reviewAuthority.map((g) =>
        g.subject === "ApprovalRequest" && g.action === "read"
          ? { ...g, conditions: { createdBy: "$actor.id" } }
          : g
      )
    ),
  }
  async function userBody(id: string, active: boolean, roleIds?: string[]) {
    const user = await f.query<{
      id: string
      revision: number
      name: string
      roles: { id: string }[]
    }>(control, "user", `?id=${id}`)
    const currentRoles = await Promise.all(
      (roleIds ?? user.roles.map((v) => v.id)).map((id) =>
        f.query<{ id: string; revision: number }>(control, "role", `?id=${id}`)
      )
    )
    return envelope(
      {
        id,
        name: user.name,
        active,
        roleIds: currentRoles.map((v) => v.id),
        reason: "Actual same-session requester/reviewer authority change",
      },
      [ref(user, "User"), ...currentRoles.map((v) => ref(v, "Role"))]
    )
  }
  const change = async (id: string, active: boolean, roleIds?: string[]) =>
    f.command(control, "updateUser", await userBody(id, active, roleIds))
  await change(reviewerId, true, [roles.reviewer.id])
  const supplier = (
    await f.command(
      control,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Replay source ${run}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
  ).result
  async function prepare(
    proceeds: "0" | "2000",
    decision: "APPROVE" | "REJECT"
  ) {
    await change(requesterId, true, [roles.seed.id])
    const made = await f.command(
      requester!,
      "recordPurchase",
      envelope(purchaseInput(supplier.id, run, randomUUID()), [
        ref(supplier, "Supplier"),
      ]),
      201
    )
    assert.equal(
      (
        await f.db.query(
          'SELECT "createdBy" FROM vamotors."PurchaseRecord" WHERE id=$1',
          [made.result.id]
        )
      ).rows[0].createdBy,
      requesterId
    )
    await change(requesterId, true, [
      proceeds === "0" ? roles.zero.id : roles.full.id,
    ])
    let cycle = await f.query<PurchaseCycleDTO>(
      control,
      "purchase",
      `?cycleId=${made.result.id}`
    )
    await f.command(
      control,
      "addCost",
      envelope(
        {
          cycleId: cycle.id,
          category: "Other",
          description: "Real unpaid incurred invoice",
          amount: "500",
          incurredDate: "2026-10-02",
        },
        [ref(cycle)]
      ),
      201
    )
    cycle = await f.query<PurchaseCycleDTO>(
      requester!,
      "purchase",
      `?cycleId=${cycle.id}`
    )
    const request = envelope(
      {
        proposal: {
          kind: "WRITE_OFF",
          input: {
            cycleId: cycle.id,
            date: "2026-10-04",
            reason: "Actual original-entry disposal",
            method: "OTHER",
            proceeds,
            ...(proceeds === "0"
              ? {}
              : {
                  receipt: {
                    amount: proceeds,
                    date: "2026-10-05",
                    method: "CASH",
                    reference: "Real bounded proceeds",
                  },
                }),
          },
        },
        reason: "Separate originating request",
      },
      cycleRefs(cycle)
    )
    const before = await snapshot()
    const response = await requester!.post("/api/v1/commands/requestApproval", {
      headers: { Origin: f.origin },
      data: request,
    })
    const pending: Pending = await response.json(),
      after = await snapshot()
    events.push({
      kind: "pending",
      proceeds,
      decision,
      request,
      status: response.status(),
      pending,
      before,
      after,
    })
    assert.equal(response.status(), 202)
    assert.equal(pending.businessEffect, false)
    for (const t of tables.slice(0, 9)) assert.deepEqual(after[t], before[t])
    const review = envelope(
      {
        approvalId: pending.approvalId,
        decision,
        ...(decision === "REJECT" ? { note: "Actual separate rejection" } : {}),
      },
      [
        { type: "ApprovalRequest", id: pending.approvalId, revision: 1 },
        ...cycleRefs(cycle),
      ]
    )
    return { proceeds, decision, cycle, request, pending, review }
  }
  async function complete(
    proceeds: "0" | "2000",
    decision: "APPROVE" | "REJECT"
  ) {
    const p = await prepare(proceeds, decision),
      before = await snapshot()
    const applied = await f.command(reviewClient, "reviewApproval", p.review)
    const terminal = await f.query<PurchaseCycleDTO>(
      control,
      "purchase",
      `?cycleId=${p.cycle.id}`
    )
    if (decision === "APPROVE") {
      assert.equal(terminal.status, "WRITTEN_OFF")
      assert.ok(terminal.closedAt)
      assert.equal(terminal.financial?.basis, "10500")
      assert.equal(terminal.disposal?.proceeds, proceeds)
      assert.equal(terminal.disposal?.payments.length, proceeds === "0" ? 0 : 1)
      const facts = (
        await f.db.query(
          'SELECT "netLoss"::text,"approvalKind" FROM vamotors."Disposal" WHERE "cycleId"=$1',
          [terminal.id]
        )
      ).rows
      assert.deepEqual(facts, [
        {
          netLoss: proceeds === "0" ? "10500" : "8500",
          approvalKind: "CURRENT",
        },
      ])
      assert.equal(
        (
          await f.db.query(
            'SELECT "activePurchaseId" FROM vamotors."Vehicle" WHERE id=$1',
            [terminal.vehicleId]
          )
        ).rows[0].activePurchaseId,
        null
      )
      events.push({ kind: "approved", ...p, applied, terminal, facts })
    } else {
      const after = await snapshot()
      for (const t of tables.slice(0, 9)) assert.deepEqual(after[t], before[t])
      assert.equal(terminal.status, "PURCHASED")
      assert.equal(terminal.disposal, null)
      // New lawful business revision AFTER rejection must not turn replay into CAS.
      await f.command(
        control,
        "setListedPrice",
        envelope(
          {
            cycleId: terminal.id,
            amount: "15001",
            reason: "Real later unrelated-to-receipt cycle revision",
          },
          [ref(terminal)]
        )
      )
      events.push({ kind: "rejected", ...p, applied, terminal, before, after })
    }
    return { ...p, applied }
  }
  type Scenario = Awaited<ReturnType<typeof complete>>
  const changed = (s: Scenario) => ({
    ...s.review,
    input: {
      approvalId: s.pending.approvalId,
      decision: s.decision,
      note: "Different envelope must remain behind current authority",
    },
  })
  async function inspect(
    label: string,
    run: () => Promise<APIResponse>,
    expectedStatus: number,
    code?: string,
    identity?: Applied,
    query = false
  ) {
    const before = await snapshot(),
      response = await run(),
      value = await response.json(),
      after = await snapshot()
    const result = query ? value.data : value
    const pass =
      response.status() === expectedStatus &&
      (!code || value.error?.code === code)
    events.push({
      kind: "observation",
      label,
      status: response.status(),
      value,
      expectedStatus,
      code,
      pass,
      before,
      after,
      zeroEffects: JSON.stringify(before) === JSON.stringify(after),
    })
    await save()
    // Always capture/assert all 17 populations BEFORE classifying the HTTP signal.
    assert.deepEqual(
      after,
      before,
      `${label}: unconditional domain/audit/receipt/sequence/notification zero effects`
    )
    assert.match(response.headers()["cache-control"], /no-store/)
    if (!pass)
      failures.push(
        `${label}: ${response.status()} ${value.error?.code ?? result?.status}`
      )
    if (pass && identity) {
      assert.equal(result.commandId, identity.commandId)
      assert.deepEqual(result.result, identity.result)
      assert.equal(result.replayed, true)
    }
    console.log(
      JSON.stringify({
        label,
        expectedStatus,
        status: response.status(),
        code: value.error?.code,
        zeroEffects: true,
        pass,
      })
    )
    return value
  }
  const post = (
    client: APIRequestContext,
    body: unknown,
    name = "reviewApproval"
  ) =>
    client.post(`/api/v1/commands/${name}`, {
      headers: { Origin: f.origin },
      data: body,
    })
  const status = (
    client: APIRequestContext,
    key: string,
    name = "reviewApproval"
  ) =>
    client.get(
      `/api/v1/queries/commandStatus?name=${name}&idempotencyKey=${key}`
    )
  async function pair(
    s: Scenario,
    label: string,
    expectedStatus = 200,
    code?: string,
    client = reviewClient
  ) {
    await inspect(
      `${label}:review`,
      () => post(client, s.review),
      expectedStatus,
      code,
      expectedStatus === 200 ? s.applied : undefined
    )
    await inspect(
      `${label}:commandStatus`,
      () => status(client, s.review.idempotencyKey),
      expectedStatus,
      code,
      expectedStatus === 200 ? s.applied : undefined,
      true
    )
  }
  const positive = await complete("2000", "APPROVE")
  await pair(positive, "authorized original receipt after terminal revision")
  // Losing workflow-create blocks the requester's own receipt, but not the
  // reviewer's receipt while the originator still has domain authority.
  await change(requesterId, true, [roles.noRequestCreate.id])
  await pair(positive, "only ApprovalRequest.create revoked")
  await inspect(
    "requester's own receipt still requires workflow-create",
    () =>
      status(requester!, positive.request.idempotencyKey, "requestApproval"),
    403,
    "FORBIDDEN",
    undefined,
    true
  )
  await change(requesterId, true, [roles.full.id])
  const beforeRevocation = await f.query<CurrentActorDTO>(
    requester,
    "currentActor"
  )
  await change(requesterId, true, [roles.read.id])
  const revokedActor = await f.query<CurrentActorDTO>(requester, "currentActor")
  assert.ok(!revokedActor.presentationGrants.some((g) => g.action !== "read"))
  assert.notEqual(revokedActor.authzRevision, beforeRevocation.authzRevision)
  events.push({
    kind: "actual-read-only-requester",
    before: beforeRevocation,
    actor: revokedActor,
  })
  await inspect(
    "requester own identical request correctly denied",
    () => post(requester!, positive.request, "requestApproval"),
    403,
    "FORBIDDEN"
  )
  const readableHistory = await f.query<PurchaseCycleDTO>(
    requester,
    "purchase",
    `?cycleId=${positive.cycle.id}`
  )
  assert.equal(readableHistory.status, "WRITTEN_OFF")
  assert.equal(readableHistory.disposal?.proceeds, "2000")
  events.push({
    kind: "revoked-originator-authorized-history-still-readable",
    row: readableHistory,
  })
  await pair(
    positive,
    "requester originating actions revoked",
    409,
    "APPROVAL_STALE"
  )
  await inspect(
    "changed envelope after requester revocation",
    () => post(reviewClient, changed(positive)),
    409,
    "APPROVAL_STALE"
  )
  await change(requesterId, false, [roles.full.id])
  const inactiveUser = await f.query<{ active: boolean }>(
    control,
    "user",
    `?id=${requesterId}`
  )
  assert.equal(inactiveUser.active, false)
  events.push({ kind: "actual-inactive-requester", user: inactiveUser })
  await pair(
    positive,
    "requester inactive with originating role retained",
    409,
    "APPROVAL_STALE"
  )
  await change(requesterId, true, [roles.full.id])
  await pair(positive, "restored actual originating authority")

  if (mode === "all") {
    const scenarios = [
      positive,
      await complete("2000", "REJECT"),
      await complete("0", "APPROVE"),
      await complete("0", "REJECT"),
    ]
    for (const s of scenarios) {
      const full = s.proceeds === "0" ? roles.zero : roles.full
      const tag = `${s.decision}/${s.proceeds}`
      await change(requesterId, true, [full.id])
      await pair(s, `${tag} positive current receipt`)
      const fingerprint = (
        await f.query<CurrentActorDTO>(requester, "currentActor")
      ).authzRevision
      for (const [label, role, ownCode] of [
        ["action", roles.read, "FORBIDDEN"],
        ["required submitted leaf", roles.field, "FIELD_FORBIDDEN"],
        ["consumed basis read", roles.consumed, "FIELD_FORBIDDEN"],
        [
          "real current source condition mismatch",
          roles.wrongCondition,
          "NOT_FOUND",
        ],
      ] as const) {
        await change(requesterId, true, [role.id])
        assert.notEqual(
          (await f.query<CurrentActorDTO>(requester, "currentActor"))
            .authzRevision,
          fingerprint
        )
        await pair(s, `${tag} remove ${label}`, 409, "APPROVAL_STALE")
        await inspect(
          `${tag} changed body after ${label} removal`,
          () => post(reviewClient, changed(s)),
          409,
          "APPROVAL_STALE"
        )
        await inspect(
          `${tag} own request replay after ${label} removal`,
          () => post(requester!, s.request, "requestApproval"),
          ownCode === "NOT_FOUND" ? 404 : 403,
          ownCode
        )
        await change(requesterId, true, [full.id])
        await pair(s, `${tag} restored ${label}`)
      }
      await change(requesterId, false, [full.id])
      const inactive = await f.query<{ active: boolean }>(
        control,
        "user",
        `?id=${requesterId}`
      )
      assert.equal(inactive.active, false)
      await pair(s, `${tag} inactive`, 409, "APPROVAL_STALE")
      await change(requesterId, true, [full.id])
      await pair(s, `${tag} reactivated`)
      // Normal review's originator check is DOMAIN authority, not ApprovalRequest.create.
      await change(requesterId, true, [roles.noRequestCreate.id])
      await pair(s, `${tag} no invented workflow-create requirement`)
      await inspect(
        `${tag} own request still needs workflow-create`,
        () => post(requester!, s.request, "requestApproval"),
        403,
        "FORBIDDEN"
      )
      await change(requesterId, true, [full.id])
      await inspect(
        `${tag} authorized changed body`,
        () => post(reviewClient, changed(s)),
        409,
        "IDEMPOTENCY_MISMATCH"
      )
      await change(reviewerId, true, [roles.read.id])
      await pair(s, `${tag} reviewer action revoked`, 403, "FORBIDDEN")
      await inspect(
        `${tag} reviewer denial before mismatch`,
        () => post(reviewClient, changed(s)),
        403,
        "FORBIDDEN"
      )
      await change(reviewerId, true, [roles.reviewerScoped.id])
      await pair(
        s,
        `${tag} saved request outside reviewer record scope`,
        404,
        "NOT_FOUND"
      )
      await change(reviewerId, true, [roles.reviewer.id])
      await pair(s, `${tag} reviewer restored`)
      const foreign = await inspect(
        `${tag} foreign actor command key`,
        () => status(control, s.review.idempotencyKey),
        200,
        undefined,
        undefined,
        true
      )
      assert.equal(foreign.data.status, "NOT_COMMITTED")
      const unknown = await inspect(
        `${tag} scoped unknown key`,
        () => status(reviewClient, randomUUID()),
        200,
        undefined,
        undefined,
        true
      )
      assert.equal(unknown.data.status, "NOT_COMMITTED")
      await inspect(
        `${tag} unsupported command name`,
        () => status(reviewClient, s.review.idempotencyKey, "payPurchase"),
        422,
        "INVALID_INPUT"
      )
      await inspect(
        `${tag} new key unknown approval`,
        () =>
          post(
            reviewClient,
            envelope({ approvalId: randomUUID(), decision: "APPROVE" })
          ),
        404,
        "NOT_FOUND"
      )
    }
    await change(requesterId, true, [roles.full.id])
    const pending = await prepare("2000", "APPROVE")
    await change(requesterId, true, [roles.read.id])
    await inspect(
      "ordinary pending review current requester baseline",
      () => post(reviewClient, pending.review),
      409,
      "APPROVAL_STALE"
    )
    await change(requesterId, true, [roles.full.id])
    await f.command(reviewClient, "reviewApproval", pending.review)

    const env = await privateEnvironment(join(root, "admin.env")),
      url = new URL(env.ADMIN_URL!)
    url.pathname = new URL(f.runtime.DATABASE_URL!).pathname
    const monitor = new pg.Pool({ connectionString: url.href, max: 1 })
    const runtimeUser = decodeURIComponent(
      new URL(f.runtime.DATABASE_URL!).username
    )
    async function observedWait(exclude: number[] = []) {
      const deadline = Date.now() + 1200
      do {
        const rows = (
          await monitor.query(
            "SELECT a.pid,a.wait_event_type,a.wait_event,l.locktype,l.mode,pg_blocking_pids(a.pid) AS blockers FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid AND NOT l.granted WHERE a.datname=current_database() AND a.usename=$1 AND a.wait_event_type='Lock' AND a.query LIKE '%lock_admin_guard%' AND NOT(a.pid=ANY($2::int[]))",
            [runtimeUser, exclude]
          )
        ).rows
        if (rows.length) return rows[0]
        // Only actual DB wait observations, no sleeps/timing guesses or job polling.
      } while (Date.now() < deadline)
      throw Error("NO_OBSERVED_AUTH_GUARD_WAIT")
    }
    try {
      for (const entry of ["review", "commandStatus"])
        for (const deactivate of [false, true]) {
          await change(requesterId, true, [roles.full.id])
          const mutationBody = await userBody(requesterId, !deactivate, [
            deactivate ? roles.full.id : roles.read.id,
          ])
          const before = await snapshot(),
            blocker = await f.db.connect()
          let mutation: Promise<APIResponse> | undefined,
            recovery: Promise<APIResponse> | undefined
          try {
            await blocker.query("BEGIN")
            const blockerPid = Number(
              (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0]
                .pid
            )
            await blocker.query(
              'SELECT id FROM vamotors."AdminGuard" WHERE id=1 FOR UPDATE'
            )
            mutation = post(control, mutationBody, "updateUser")
            const mutationWait = await observedWait()
            assert.ok(mutationWait.blockers.includes(blockerPid))
            recovery =
              entry === "review"
                ? post(reviewClient, positive.review)
                : status(reviewClient, positive.review.idempotencyKey)
            const recoveryWait = await observedWait([mutationWait.pid])
            assert.ok(recoveryWait.blockers.length)
            await blocker.query("COMMIT")
            const [mutated, recovered] = await Promise.all([mutation, recovery])
            const applied: Applied = await mutated.json(),
              result = await recovered.json()
            assert.equal(mutated.status(), 200)
            // Account for EXACTLY the one real admin mutation; no other exemption.
            // Auth commands do not allocate business sequence or notification rows.
            const after = await snapshot(applied.commandId)
            events.push({
              kind: "observed-auth-wait",
              entry,
              deactivate,
              blockerPid,
              mutationWait,
              recoveryWait,
              mutationCommandId: applied.commandId,
              status: recovered.status(),
              result,
              before,
              after,
              excludedOnlyActualAuthMutation: true,
            })
            await save()
            assert.deepEqual(after, before)
            assert.equal(
              (
                await f.db.query(
                  'SELECT count(*)::int AS n FROM vamotors."CommandReceipt" WHERE id=$1',
                  [applied.commandId]
                )
              ).rows[0].n,
              1
            )
            const audits = await f.db.query(
              'SELECT "entityType", action FROM vamotors."AuditEntry" WHERE "commandId"=$1 ORDER BY "entityType", action',
              [applied.commandId]
            )
            assert.deepEqual(audits.rows, [
              { entityType: "User", action: "update" },
              ...(deactivate
                ? []
                : [
                    { entityType: "UserRole", action: "create" },
                    { entityType: "UserRole", action: "delete" },
                  ]),
            ])
            assert.equal(recovered.status(), 409)
            assert.equal(result.error.code, "APPROVAL_STALE")
            await pair(
              positive,
              `${entry} ${deactivate ? "deactivation" : "revocation"} won actual auth wait`,
              409,
              "APPROVAL_STALE"
            )
            console.log(
              `PASS observed ${entry} auth-lock ${deactivate ? "deactivation" : "revocation"} winner; only real admin command changed populations`
            )
          } finally {
            await blocker.query("ROLLBACK")
            blocker.release()
            await Promise.allSettled(
              [mutation, recovery].filter((v) => v !== undefined)
            )
          }
        }
    } finally {
      await monitor.end()
    }
    // Invalidate the ORIGINAL same session once, after all same-cookie controls.
    // No redundant logins or rate-limit bypass: all four receipts must recover
    // with that originator logged out; subsequent changes use the real admin.
    await change(requesterId, true, [roles.full.id])
    assert.equal(
      (
        await requester!.post("/api/auth/sign-out", {
          headers: { Origin: f.origin },
          data: {},
        })
      ).status(),
      200
    )
    await inspect(
      "original requester session logged out",
      () => post(requester!, positive.request, "requestApproval"),
      401,
      "UNAUTHENTICATED"
    )
    for (const s of scenarios)
      await pair(
        s,
        `${s.decision}/${s.proceeds} active authorized requester LOGGED OUT`
      )
    // A short REAL app+PG restart tests durable denial and original receipt recovery.
    await change(requesterId, false, [roles.full.id])
    const before = await snapshot()
    await f.restart()
    const fresh = await f.login("SECOND")
    try {
      await pair(
        positive,
        "fresh-auth requester denial survives app+PG restart",
        409,
        "APPROVAL_STALE",
        fresh
      )
      assert.deepEqual(await snapshot(), before)
      await change(requesterId, true, [roles.full.id])
      await pair(
        positive,
        "fresh-auth original receipt recovers after real restoration",
        200,
        undefined,
        fresh
      )
    } finally {
      await fresh.dispose()
    }
    events.push({
      kind: "restart-PASS",
      originalCommandId: positive.applied.commandId,
    })
  }
  assert.deepEqual(
    failures,
    [],
    "Current requester authority must gate BOTH review replay and commandStatus"
  )
  events.push({ kind: "PASS" })
  console.log(
    `PASS ${mode} current-requester recovery/zero effects, no old CAS/business reexecution`
  )
} catch (error) {
  events.push({
    kind: "FAIL",
    error: error instanceof Error ? error.stack : String(error),
  })
  throw error
} finally {
  try {
    if (admin)
      for (const actor of [originalRequester, originalReviewer]) {
        if (!actor) continue
        const user = await f.query<{
          id: string
          revision: number
          name: string
        }>(admin, "user", `?id=${actor.user.id}`)
        const roles = await Promise.all(
          actor.roles.map((v) =>
            f.query<{ id: string; revision: number }>(
              admin!,
              "role",
              `?id=${v.id}`
            )
          )
        )
        await f.command(
          admin,
          "updateUser",
          envelope(
            {
              id: user.id,
              name: user.name,
              active: true,
              roleIds: roles.map((v) => v.id),
              reason: "Restore original owned fixture authority",
            },
            [ref(user, "User"), ...roles.map((v) => ref(v, "Role"))]
          )
        )
      }
    if (requester)
      await requester.post("/api/auth/sign-out", {
        headers: { Origin: f.origin },
        data: {},
      })
  } finally {
    await save()
    for (const client of [admin, reviewer, requester]) await client?.dispose()
    await f.close()
  }
}
