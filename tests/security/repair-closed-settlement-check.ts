/** Closed existing lease restatement uses its actual settlement input authority,
 * not an invented patch.purchasePrice grant for the derived total. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { request } from "@playwright/test"
import type {
  CurrentActorDTO,
  Grant,
  Pending,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  suffix = randomUUID().slice(0, 8)
let stage = "initialize",
  cycleId = ""
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    reviewer = await f.login("SECOND")
  const settings = await f.query<{ id: string; revision: number }>(
    admin,
    "settings"
  )
  const supplier = await f.command(
    admin,
    "createDirectoryParty",
    envelope({
      type: "SUPPLIER",
      values: {
        name: `Closed lease supplier ${suffix}`,
        category: "COMPANY",
        contacts: [],
      },
    }),
    201
  )
  const company = await f.command(
    admin,
    "createFinanceCompany",
    envelope(
      {
        name: `Closed lease company ${suffix}`,
        contacts: [],
        policy: {
          path: "APPLICATION",
          commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
          processingFee: "0",
          reconciliationMethod: "PERIOD_NOTICE",
        },
      },
      [ref(settings, "Settings")]
    ),
    201
  )
  const terms = {
    institutionType: "FINANCE_COMPANY",
    companyId: company.result.id,
    reference: "Original actual terms",
    amount: "6000",
    cashToSeller: "4000",
  }
  cycleId = (
    await f.command(
      admin,
      "recordPurchase",
      envelope(
        {
          ...purchaseInput(supplier.result.id, suffix, "closed-lease"),
          purchaseType: "LEASE_SETTLEMENT",
          purchasePrice: undefined,
          settlement: terms,
        },
        [
          ref(supplier.result, "Supplier"),
          ref(company.result, "FinanceCompany"),
        ]
      ),
      201
    )
  ).result.id
  const row = await f.query<PurchaseCycleDTO>(
    admin,
    "purchase",
    `?cycleId=${cycleId}`
  )
  const roots = [
    ref(row),
    {
      type: "Vehicle" as const,
      id: row.vehicleId,
      revision: row.identityRevision,
    },
  ]
  const pending = (await f.command(
    admin,
    "requestApproval",
    envelope(
      {
        proposal: {
          kind: "WRITE_OFF",
          input: {
            cycleId,
            date: "2026-10-05",
            reason: "Actual current lease disposal",
            method: "SCRAPPED",
            proceeds: "0",
          },
        },
        reason: "Independent actual review",
      },
      roots
    ),
    202
  )) as unknown as Pending
  await f.command(
    reviewer,
    "reviewApproval",
    envelope({ approvalId: pending.approvalId, decision: "APPROVE" }, [
      ref(
        { id: pending.approvalId, revision: pending.revision },
        "ApprovalRequest"
      ),
      ...roots,
    ])
  )
  const grants: Grant[] = [
    ...[
      "PurchaseRecord",
      "Vehicle",
      "Disposal",
      "Supplier",
      "FinanceCompany",
    ].map((subject) => ({
      subject: subject as Grant["subject"],
      action: "read" as const,
      fields: ["*"],
    })),
    {
      subject: "PurchaseRecord",
      action: "update",
      fields: ["cycleId", "reason", "patch.settlement"],
    },
  ]
  const role = await f.command(
    admin,
    "saveRole",
    envelope({
      name: `Actual closed settlement editor ${suffix}`,
      grants,
      reason: "No derived-price grant or old role mutation",
    }),
    201
  )
  const email = `closed-lease-${suffix}@example.test`,
    password = `${randomUUID()}${randomUUID()}`
  assert.equal(
    (
      await admin.post("/api/v1/commands/createUser", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            name: "Closed financial editor",
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
    const actor = await f.query<CurrentActorDTO>(editor, "currentActor")
    assert.ok(
      !actor.presentationGrants.some(
        (g) =>
          g.subject === "PurchaseRecord" &&
          g.action === "update" &&
          g.fields.includes("patch.purchasePrice")
      )
    )
    const current = await f.query<PurchaseCycleDTO>(
      editor,
      "purchase",
      `?cycleId=${cycleId}`
    )
    assert.ok(current.nextActions.includes("editPurchase"))
    const original = (
      await f.db.query(
        'SELECT to_jsonb(d)::text row FROM vamotors."Disposal" d WHERE "cycleId"=$1',
        [cycleId]
      )
    ).rows
    stage =
      "actual closed settlement-only current authority, derived total and immutable original disposal"
    await f.command(
      editor,
      "editPurchase",
      envelope(
        {
          cycleId,
          patch: {
            settlement: {
              ...terms,
              reference: "Reasoned actual corrected terms",
              amount: "7000",
            },
          },
          cashCorrections: [],
          reason: "Actual closed settlement correction",
        },
        [
          ref(current),
          {
            type: "Vehicle",
            id: current.vehicleId,
            revision: current.identityRevision,
          },
          ref(company.result, "FinanceCompany"),
        ]
      )
    )
    const after = await f.query<PurchaseCycleDTO>(
      editor,
      "purchase",
      `?cycleId=${cycleId}`
    )
    assert.equal(after.status, "WRITTEN_OFF")
    assert.equal(after.purchasePrice, "11000")
    assert.equal(after.financial!.basis, "11000")
    assert.equal(
      after.disposal!.basisVersionId,
      current.disposal!.basisVersionId
    )
    assert.equal(
      after.basisVersions.find((b) => b.id === after.disposal!.basisVersionId)!
        .total,
      "10000"
    )
    assert.equal(
      after.basisVersions.at(-1)!.reason,
      "Actual closed settlement correction"
    )
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT to_jsonb(d)::text row FROM vamotors."Disposal" d WHERE "cycleId"=$1',
          [cycleId]
        )
      ).rows,
      original
    )
    console.log(
      "PASS real approved closed lease settlement-only editor; derived price/current basis updated, original Disposal/basis immutable, no old role/user changed"
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
    join(root, `repair-closed-settlement-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        cycleId,
        source: process.cwd(),
        scope:
          "Named closed settlement current-field authority only, no final acceptance",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
