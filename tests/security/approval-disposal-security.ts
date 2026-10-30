/** Current-authority, field privacy, rollback and restricted-SQL proof on real owners. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect, type APIRequestContext } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  ApprovalDTO,
  CurrentActorDTO,
  Grant,
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fieldsFor } from "../../lib/server/permissions"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8),
  groups: unknown[] = []
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "LeasePurchaseDetail",
  "MileageReading",
  "PurchasePayment",
  "VehicleCost",
  "CostPayment",
  "CycleBasisVersion",
  "StatusEvent",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "Notification",
  "AuditEntry",
  "EntityReadVersion",
  "CommandReceipt",
  "BusinessSequence",
]
let stage = "initialize",
  admin!: APIRequestContext,
  second!: APIRequestContext,
  staff!: APIRequestContext,
  original!: CurrentActorDTO
const reads: Grant[] = (
  [
    "PurchaseRecord",
    "Vehicle",
    "VehicleCost",
    "Supplier",
    "FinanceCompany",
    "ApprovalRequest",
    "Disposal",
    "Notification",
    "AuditLog",
  ] as const
).map((subject) => ({ subject, action: "read", fields: ["*"] }))
const authority: Grant[] = [
  ...reads,
  { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
  { subject: "Disposal", action: "create", fields: ["*"] },
  { subject: "Disposal", action: "pay", fields: ["*"] },
  { subject: "ApprovalRequest", action: "create", fields: ["*"] },
  { subject: "ApprovalRequest", action: "approve", fields: ["*"] },
  { subject: "Notification", action: "update", fields: ["readAt"] },
]
const cycleRefs = (row: PurchaseCycleDTO) => [
  ref(row),
  {
    type: "Vehicle" as const,
    id: row.vehicleId,
    revision: row.identityRevision,
  },
]
const current = (id: string, actor = admin) =>
  f.query<PurchaseCycleDTO>(actor, "purchase", `?cycleId=${id}`)
const propose = (row: PurchaseCycleDTO) =>
  envelope(
    {
      proposal: {
        kind: "WRITE_OFF",
        input: {
          cycleId: row.id,
          date: "2026-10-04",
          reason: "PRIVATE_DISPOSAL_REASON",
          method: "SCRAPPED",
          proceeds: "2000",
          receipt: {
            amount: "2000",
            date: "2026-10-05",
            method: "BANK_TRANSFER",
            reference: "PRIVATE_RECEIPT_REFERENCE",
          },
        },
      },
      reason: "PRIVATE_REQUEST_REASON",
    },
    cycleRefs(row)
  )
async function pending(row: PurchaseCycleDTO, actor = admin) {
  const body = propose(row),
    p = (await f.command(
      actor,
      "requestApproval",
      body,
      202
    )) as unknown as Pending
  return {
    body,
    p,
    review: envelope({ approvalId: p.approvalId, decision: "APPROVE" }, [
      { type: "ApprovalRequest" as const, id: p.approvalId, revision: 1 },
      ...cycleRefs(row),
    ]),
  }
}
async function userChange(id: string, active: boolean, roleIds?: string[]) {
  const user = await f.query<{
    id: string
    revision: number
    name: string
    roles: { id: string }[]
  }>(admin, "user", `?id=${id}`)
  const roles = await Promise.all(
    (roleIds ?? user.roles.map((r) => r.id)).map((id) =>
      f.query<{ id: string; revision: number }>(admin, "role", `?id=${id}`)
    )
  )
  await f.command(
    admin,
    "updateUser",
    envelope(
      {
        id,
        name: user.name,
        active,
        roleIds: roles.map((r) => r.id),
        reason: "Synthetic bounded authority proof",
      },
      [ref(user, "User"), ...roles.map((r) => ref(r, "Role"))]
    )
  )
}
async function assign(grants: Grant[]) {
  const role = await f.command(
    admin,
    "saveRole",
    envelope({
      name: `Writeoff-${suffix}-${randomUUID()}`,
      grants,
      reason: "Synthetic current authority",
    }),
    201
  )
  await userChange(original.user.id, true, [role.result.id])
}
async function denied(
  actor: APIRequestContext,
  name: string,
  body: unknown,
  status: number,
  code: string
) {
  const before = await f.snapshot(tables),
    response = await actor.post(`/api/v1/commands/${name}`, {
      data: body,
      headers: { Origin: f.origin },
    }),
    value = await response.json()
  assert.equal(response.status(), status, JSON.stringify(value))
  assert.equal(value.error.code, code)
  assert.equal(await f.snapshot(tables), before)
  return value
}
async function group(name: string, run: () => Promise<void>) {
  if (process.argv[3] && !name.includes(process.argv[3])) {
    groups.push({
      group: name,
      skipped: true,
      reason: "Explicit diagnostic group filter",
    })
    return
  }
  stage = name
  await run()
  groups.push({ group: name, pass: true })
  console.log(`PASS ${name}`)
}
const without = (
  grants: Grant[],
  subject: Grant["subject"],
  action: Grant["action"],
  path: string
): Grant[] =>
  grants.map((g) =>
    g.subject === subject && g.action === action
      ? {
          ...g,
          fields: fieldsFor(
            subject as Parameters<typeof fieldsFor>[0],
            action
          ).filter((f) => f !== path && !path.startsWith(`${f}.`)),
        }
      : g
  )
try {
  await f.start()
  admin = await f.login("ADMIN")
  second = await f.login("SECOND")
  staff = await f.login("STAFF")
  original = await f.query<CurrentActorDTO>(staff, "currentActor")
  const secondActor = await f.query<CurrentActorDTO>(second, "currentActor")
  const supplier = await f.command(
    admin,
    "createDirectoryParty",
    envelope({
      type: "SUPPLIER",
      values: {
        name: `Writeoff security ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    }),
    201
  )
  const make = async (tag: string) => {
    const created = await f.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.result.id, suffix, tag), [
        ref(supplier.result, "Supplier"),
      ]),
      201
    )
    return current(created.result.id)
  }
  await group(
    "P3 each consumed/requested field denied independently and positive complementary staff authority",
    async () => {
      const row = await make("leaves")
      await f.command(
        admin,
        "addCost",
        envelope(
          {
            cycleId: row.id,
            category: "Other",
            description: "Consumed actual cost",
            amount: "500",
            incurredDate: "2026-10-03",
            payment: { amount: "200", date: "2026-10-03", method: "CASH" },
          },
          [ref(row)]
        ),
        201
      )
      const source = await current(row.id),
        body = propose(source)
      for (const [subject, action, paths] of [
        [
          "PurchaseRecord",
          "read",
          [
            "id",
            "revision",
            "vehicleId",
            "identityRevision",
            "status",
            "available",
            "closedAt",
            "purchaseDate",
            "purchasePrice",
            "purchaseType",
            "listedPrice",
            "financial.basis",
            "financial.currency",
            "financial.scale",
            "financial.cashIn",
            "financial.cashOut",
            "payments.amount",
            "payments.direction",
            "basisVersions.id",
            "basisVersions.total",
            "costs.amount",
            "costs.payments.amount",
            "costs.payments.direction",
          ],
        ],
        ["Vehicle", "read", ["id", "identityRevision"]],
        [
          "VehicleCost",
          "read",
          ["amount", "payments.amount", "payments.direction"],
        ],
        ["PurchaseRecord", "update", ["cycleId"]],
        [
          "Disposal",
          "create",
          [
            "cycleId",
            "date",
            "reason",
            "method",
            "proceeds",
            "receipt.amount",
            "receipt.date",
            "receipt.method",
            "receipt.reference",
          ],
        ],
        [
          "Disposal",
          "pay",
          [
            "receipt.amount",
            "receipt.date",
            "receipt.method",
            "receipt.reference",
          ],
        ],
        [
          "ApprovalRequest",
          "create",
          [
            "proposal",
            "proposal.kind",
            "proposal.input.cycleId",
            "proposal.input.date",
            "proposal.input.reason",
            "proposal.input.method",
            "proposal.input.proceeds",
            "proposal.input.receipt.amount",
            "proposal.input.receipt.date",
            "proposal.input.receipt.method",
            "proposal.input.receipt.reference",
            "reason",
          ],
        ],
      ] as [Grant["subject"], Grant["action"], string[]][])
        for (const path of paths) {
          await assign(without(authority, subject, action, path))
          await denied(staff, "requestApproval", body, 403, "FIELD_FORBIDDEN")
        }
      await assign(authority)
      const p = await pending(source, staff)
      await f.command(second, "reviewApproval", p.review)
      const after = await current(source.id)
      assert.equal(after.status, "WRITTEN_OFF")
      await assign(without(authority, "Disposal", "create", "proceeds"))
      await denied(staff, "requestApproval", p.body, 403, "FIELD_FORBIDDEN")
      await assign(authority)
      assert.equal(
        (
          (await f.command(
            staff,
            "requestApproval",
            p.body,
            202
          )) as unknown as Pending
        ).approvalId,
        p.p.approvalId
      )
    }
  )
  await group(
    "P3 typed lease consumed leaves and linked company authority for requester and reviewer",
    async () => {
      const settings = await f.query<{ id: string; revision: number }>(
        admin,
        "settings"
      )
      const finance = await f.command(
        admin,
        "createFinanceCompany",
        envelope(
          {
            name: `Lease authority ${suffix}`,
            contacts: [],
            policy: {
              path: "APPLICATION",
              commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
              processingFee: "250000",
              reconciliationMethod: "PERIOD_NOTICE",
            },
          },
          [ref(settings, "Settings")]
        ),
        201
      )
      for (const institutionType of [
        "FINANCE_COMPANY",
        "BANK",
        "PRIVATE_PARTY",
      ]) {
        const result = await f.command(
          admin,
          "recordPurchase",
          envelope(
            {
              ...purchaseInput(supplier.result.id, suffix, institutionType),
              purchaseType: "LEASE_SETTLEMENT",
              purchasePrice: undefined,
              settlement: {
                institutionType,
                ...(institutionType === "FINANCE_COMPANY"
                  ? { companyId: finance.result.id }
                  : { institutionName: `Actual ${institutionType}` }),
                reference: "PRIVATE_LEASE_TERMS",
                amount: "6000",
                cashToSeller: "4000",
              },
            },
            [
              ref(supplier.result, "Supplier"),
              ...(institutionType === "FINANCE_COMPANY"
                ? [ref(finance.result, "FinanceCompany")]
                : []),
            ]
          ),
          201
        )
        const row = await current(result.result.id)
        const p = await pending(row)
        const leaves: [Grant["subject"], string][] = Object.keys(
          row.settlement!
        ).map((key) => ["PurchaseRecord", `settlement.${key}`])
        if (institutionType === "FINANCE_COMPANY")
          leaves.push(["FinanceCompany", "id"], ["FinanceCompany", "name"])
        for (const [subject, field] of leaves) {
          await assign(without(authority, subject, "read", field))
          await denied(
            staff,
            "requestApproval",
            propose(row),
            403,
            "FIELD_FORBIDDEN"
          )
          await denied(
            staff,
            "reviewApproval",
            p.review,
            403,
            "FIELD_FORBIDDEN"
          )
        }
        await assign(authority)
        const requester = await pending(row, staff)
        await f.command(second, "reviewApproval", requester.review)
        assert.deepEqual((await current(row.id)).settlement, row.settlement)
      }
    }
  )
  await group(
    "P3 current requester revocation/deactivation makes a pending request stale",
    async () => {
      for (const deactivate of [false, true]) {
        await assign(authority)
        const row = await make(`requester-${deactivate}`),
          p = await pending(row, staff)
        if (deactivate) await userChange(original.user.id, false)
        else await assign(reads)
        await denied(second, "reviewApproval", p.review, 409, "APPROVAL_STALE")
        await assign(authority)
        await f.command(second, "reviewApproval", p.review)
      }
    }
  )
  await group(
    "P3 required separate reviewer is atomic and Administrator has no self-review exception",
    async () => {
      await assign(reads)
      const row = await make("eligible"),
        body = propose(row)
      try {
        await userChange(secondActor.user.id, false)
        const value = await denied(
          admin,
          "requestApproval",
          body,
          409,
          "OBLIGATION_OPEN"
        )
        assert.equal(value.error.message, "Configure a separate reviewer")
      } finally {
        await userChange(secondActor.user.id, true)
      }
      const p = await pending(row)
      await denied(admin, "reviewApproval", p.review, 403, "SELF_REVIEW")
    }
  )
  await group(
    "P3 parent/child disposal and audit privacy with financial positive controls",
    async () => {
      const row = await make("privacy"),
        p = await pending(row)
      await f.command(second, "reviewApproval", p.review)
      await assign(reads)
      const positive = await current(row.id, staff)
      assert.equal(positive.disposal!.proceeds, "2000")
      assert.equal(positive.disposal!.payments[0].amount, "2000")
      assert.equal(positive.financial!.cashIn, "2000")
      for (const [subject, field] of [
        ["PurchaseRecord", "disposal"],
        ["Disposal", "payments.amount"],
        ["Disposal", "payments.direction"],
      ] as const) {
        await assign(without(reads, subject, "read", field))
        const value = await current(row.id, staff)
        assert.equal(value.financial?.cashIn, undefined)
        assert.equal(value.financial?.cashOut, undefined)
        assert.equal(value.financial?.net, undefined)
        if (subject === "PurchaseRecord")
          assert.equal(value.disposal, undefined)
        else
          assert.equal(
            value.disposal!.payments[0][
              field === "payments.amount" ? "amount" : "direction"
            ],
            undefined
          )
      }
      await assign(without(reads, "Disposal", "read", "proceeds"))
      const list = await f.query<{ data: ApprovalDTO[] }>(
        staff,
        "approvals",
        "?pageSize=100"
      )
      const visible = list.data.find((a) => a.id === p.p.approvalId)!
      assert.ok(visible)
      assert.equal(visible.payloadHash, undefined)
      if (visible.proposal.kind === "WRITE_OFF")
        assert.equal(visible.proposal.input.proceeds, undefined)
      const audit = await f.query<unknown>(
        staff,
        "audit",
        `?type=Disposal&id=${positive.disposal!.id}`
      )
      assert.ok(!JSON.stringify(audit).includes('"path":"proceeds"'))
      await assign(reads.filter((g) => g.subject !== "Disposal"))
      const hidden = await current(row.id, staff)
      assert.equal(hidden.disposal, undefined)
      assert.equal(hidden.financial?.net, undefined)
      const response = await staff.get(
        `/api/v1/queries/audit?type=Disposal&id=${positive.disposal!.id}`
      )
      assert.equal(response.status(), 404)
      await assign(
        reads.map((g) =>
          g.subject === "ApprovalRequest"
            ? { ...g, conditions: { createdBy: "$actor.id" } }
            : g
        )
      )
      const foreign = await staff.get(`/approvals/${p.p.approvalId}`)
      const html = await foreign.text()
      await writeFile(
        join(root, `approval-foreign-rsc-${Date.now()}.json`),
        JSON.stringify(
          {
            status: foreign.status(),
            body: html,
            containsPrivateReason: html.includes("PRIVATE_REQUEST_REASON"),
            containsNotFound: html.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
          },
          null,
          2
        ),
        { mode: 0o600 }
      )
      assert.equal(foreign.status(), 404)
      assert.ok(!html.includes("PRIVATE_REQUEST_REASON"))
    }
  )
  await group(
    "P3 write-off reason and receipt-reference privacy across parent audit history",
    async () => {
      const row = await make("parent-audit"),
        p = await pending(row)
      await f.command(second, "reviewApproval", p.review)
      for (const [leaf, marker] of [
        ["reason", "PRIVATE_DISPOSAL_REASON"],
        ["payments.reference", "PRIVATE_RECEIPT_REFERENCE"],
      ]) {
        await assign(reads)
        const targets = [
          { type: "PurchaseRecord", id: row.id },
          { type: "Vehicle", id: row.vehicleId },
        ]
        for (const target of targets) {
          const positive = await f.query<unknown>(
            staff,
            "audit",
            `?type=${target.type}&id=${target.id}&pageSize=100`
          )
          if (leaf === "reason" || target.type === "PurchaseRecord")
            assert.ok(
              JSON.stringify(positive).includes(marker),
              `positive ${target.type} ${leaf}`
            )
        }
        await assign(without(reads, "Disposal", "read", leaf))
        for (const target of targets) {
          const hidden = await f.query<unknown>(
            staff,
            "audit",
            `?type=${target.type}&id=${target.id}&pageSize=100`
          )
          assert.ok(
            !JSON.stringify(hidden).includes(marker),
            `hidden ${target.type} ${leaf} leaked through historical parent audit`
          )
        }
      }
    }
  )
  await group(
    "P5 two separate reviewers, approve-reject race, duplicate request and competing proposals",
    async () => {
      await assign(authority)
      for (const reject of [false, true]) {
        const row = await make(`race-${reject}`),
          body = propose(row)
        const requests = (await Promise.all([
          f.command(staff, "requestApproval", body, 202),
          f.command(staff, "requestApproval", body, 202),
        ])) as unknown as Pending[]
        assert.equal(requests[0].approvalId, requests[1].approvalId)
        assert.equal(requests[0].commandId, requests[1].commandId)
        assert.equal(requests.filter((r) => !r.replayed).length, 1)
        const input = {
          approvalId: requests[0].approvalId,
          decision: "APPROVE",
        }
        const expected = [
          {
            type: "ApprovalRequest" as const,
            id: requests[0].approvalId,
            revision: 1,
          },
          ...cycleRefs(row),
        ]
        const responses = await Promise.all(
          [admin, second].map((client, index) =>
            client.post("/api/v1/commands/reviewApproval", {
              headers: { Origin: f.origin },
              data: envelope(
                reject && index
                  ? {
                      ...input,
                      decision: "REJECT",
                      note: "Actual competing rejection",
                    }
                  : input,
                expected
              ),
            })
          )
        )
        assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409])
        const values = await Promise.all(responses.map((r) => r.json()))
        assert.equal(values.find((v) => !v.ok).error.code, "ALREADY_REVIEWED")
        const state = (
          await f.db.query(
            'SELECT state FROM vamotors."ApprovalRequest" WHERE id=$1',
            [requests[0].approvalId]
          )
        ).rows[0].state
        assert.equal(
          (await current(row.id)).status,
          state === "APPROVED" ? "WRITTEN_OFF" : "PURCHASED"
        )
      }
      const row = await make("competing"),
        first = await pending(row, staff),
        secondProposal = await pending(row, staff)
      await f.command(admin, "reviewApproval", first.review)
      await denied(
        second,
        "reviewApproval",
        secondProposal.review,
        409,
        "APPROVAL_STALE"
      )
    }
  )
  await group(
    "P3/P5 observed sequence wait rechecks current execution and replay authority",
    async () => {
      const env = await privateEnvironment(join(root, "admin.env")),
        url = new URL(env.ADMIN_URL!)
      url.pathname = "/vamotors_local"
      const monitor = new pg.Pool({ connectionString: url.href, max: 1 })
      try {
        for (const name of ["requestApproval", "reviewApproval"]) {
          await assign(authority)
          const row = await make(`locked-${name}`),
            committed =
              name === "requestApproval"
                ? propose(row)
                : (await pending(row)).review
          await f.command(
            staff,
            name,
            committed,
            name === "requestApproval" ? 202 : 200
          )
          for (const replay of [false, true]) {
            await assign(authority)
            const source = await make(`wait-${randomUUID().slice(0, 8)}`)
            const body = replay
              ? committed
              : name === "requestApproval"
                ? propose(source)
                : (await pending(source)).review
            const blocker = await f.db.connect()
            try {
              await blocker.query("BEGIN")
              await blocker.query(
                'SELECT value FROM vamotors."BusinessSequence" WHERE id=1 FOR UPDATE'
              )
              const response = staff.post(`/api/v1/commands/${name}`, {
                data: body,
                headers: { Origin: f.origin },
              })
              await expect
                .poll(
                  async () =>
                    Number(
                      (
                        await monitor.query(
                          "SELECT count(*) FROM pg_stat_activity WHERE usename='vamotors_runtime' AND wait_event_type='Lock' AND query LIKE '%BusinessSequence%'"
                        )
                      ).rows[0].count
                    ),
                  { timeout: 1200 }
                )
                .toBeGreaterThan(0)
              await assign(reads)
              const before = await f.snapshot(tables)
              await blocker.query("COMMIT")
              assert.equal((await response).status(), 403)
              assert.equal(await f.snapshot(tables), before)
              groups.push({
                group: "observed lock revocation",
                command: name,
                replay,
                observedBusinessSequenceWait: true,
                pass: true,
              })
            } finally {
              await blocker.query("ROLLBACK")
              blocker.release()
            }
          }
        }
      } finally {
        await monitor.end()
      }
    }
  )
  await group(
    "P6 every essential request/review write and deferred failure has zero delta and same-key recovery",
    async () => {
      await assign(reads)
      for (const name of ["requestApproval", "reviewApproval"])
        for (const [table, operation, predicate] of [
          ["BusinessSequence", "UPDATE", "true"],
          ["CommandReceipt", "INSERT", "true"],
          [
            "ApprovalRequest",
            name === "requestApproval" ? "INSERT" : "UPDATE",
            "true",
          ],
          ["AuditEntry", "INSERT", `NEW."entityType"='ApprovalRequest'`],
          ["EntityReadVersion", "INSERT", `NEW."entityType"='ApprovalRequest'`],
          ["Notification", "INSERT", "true"],
          ...(name === "reviewApproval"
            ? [
                ["PurchaseRecord", "UPDATE", "true"],
                ["Vehicle", "UPDATE", "true"],
                ["Disposal", "INSERT", "true"],
                ["DisposalReceipt", "INSERT", "true"],
                ["StatusEvent", "INSERT", "true"],
                ["AuditEntry", "INSERT", `NEW."entityType"='PurchaseRecord'`],
                ["AuditEntry", "INSERT", `NEW."entityType"='Vehicle'`],
                ["AuditEntry", "INSERT", `NEW."entityType"='Disposal'`],
                [
                  "EntityReadVersion",
                  "INSERT",
                  `NEW."entityType"='PurchaseRecord'`,
                ],
                ["EntityReadVersion", "INSERT", `NEW."entityType"='Vehicle'`],
              ]
            : []),
          [
            "ApprovalRequest",
            name === "requestApproval" ? "INSERT" : "UPDATE",
            "deferred",
          ],
        ]) {
          const row = await make(`fault-${randomUUID().slice(0, 8)}`)
          const body =
            name === "requestApproval"
              ? propose(row)
              : (await pending(row)).review
          const actor = name === "requestApproval" ? admin : second
          try {
            await f.db.query(
              `CREATE FUNCTION vamotors.writeoff_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate === "deferred" ? "true" : predicate} THEN RAISE EXCEPTION 'SYNTHETIC_WRITEOFF_FAULT'; END IF; RETURN NEW; END $$`
            )
            await f.db.query(
              predicate === "deferred"
                ? `CREATE CONSTRAINT TRIGGER writeoff_test_fault AFTER ${operation} ON vamotors."${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.writeoff_test_fault()`
                : `CREATE TRIGGER writeoff_test_fault BEFORE ${operation} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.writeoff_test_fault()`
            )
            await denied(actor, name, body, 500, "INTERNAL_ERROR")
          } finally {
            await f.db.query(
              `DROP TRIGGER IF EXISTS writeoff_test_fault ON vamotors."${table}"`
            )
            await f.db.query(
              "DROP FUNCTION IF EXISTS vamotors.writeoff_test_fault()"
            )
          }
          await f.command(
            actor,
            name,
            body,
            name === "requestApproval" ? 202 : 200
          )
        }
    }
  )
} catch (error) {
  groups.push({
    group: stage,
    pass: false,
    error: error instanceof Error ? error.message : "UNKNOWN",
  })
  throw error
} finally {
  if (original && admin)
    await userChange(
      original.user.id,
      true,
      original.roles.map((r) => r.id)
    )
  for (const client of [admin, second, staff]) await client?.dispose()
  await f.close()
  await writeFile(
    join(root, `approval-disposal-security-${Date.now()}.json`),
    JSON.stringify({ source: process.cwd(), groups }, null, 2) + "\n",
    { mode: 0o600 }
  )
}
