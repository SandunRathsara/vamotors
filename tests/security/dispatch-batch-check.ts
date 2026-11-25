/** Real PostgreSQL and production HTTP coverage for LBRK-21. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { APIRequestContext } from "@playwright/test"
import type {
  BrokerageDTO,
  Dependency,
  PartyDTO,
} from "../../.planning/implementation/contracts/api"
import type {
  reconciliationRead,
  reconciliationView,
} from "../../lib/server/reconciliation"
import { fixture, envelope, ref } from "./brokerage-fixture"

const [root] = process.argv.slice(2)
assert.ok(root)
const f = await fixture(root)
const suffix = randomUUID().slice(0, 8)
const dealOf = (client: APIRequestContext, id: string) =>
  f.query<BrokerageDTO>(client, "brokerageDeal", `?id=${id}`)
try {
  const admin = await f.login(
    f.accounts.BOOTSTRAP_ADMIN_EMAIL,
    f.accounts.BOOTSTRAP_ADMIN_PASSWORD
  )
  const second = await f.login(
    f.accounts.BOOTSTRAP_SECOND_EMAIL,
    f.accounts.BOOTSTRAP_SECOND_PASSWORD
  )
  const command = (
    name: string,
    input: unknown,
    expected: Dependency[] = [],
    status = 200
  ) => f.command(admin, name, envelope(input, expected), status)
  const settings = async () =>
    ref(
      await f.query<{ id: string; revision: number }>(admin, "settings"),
      "Settings"
    )
  const company = ref(
    (
      await command(
        "createFinanceCompany",
        {
          name: `Dispatch finance ${suffix}`,
          contacts: [
            {
              name: "Synthetic contact",
              phone: "0112345678",
              role: "Processing",
              primary: true,
            },
          ],
          policy: {
            path: "APPLICATION",
            commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
            processingFee: "0",
            reconciliationMethod: "PERIOD_NOTICE",
          },
        },
        [await settings()],
        201
      )
    ).result,
    "FinanceCompany"
  )
  const party = await f.query<PartyDTO>(
    admin,
    "party",
    `?type=FINANCE_COMPANY&id=${company.id}`
  )
  const agentId = party.contacts[0]?.id
  assert.ok(agentId)
  const vehicle = { make: "Broker", model: `Dispatch ${suffix}`, year: 2026 }
  const sheet = ref(
    (
      await command(
        "publishRates",
        {
          companyId: company.id,
          ...vehicle,
          validFrom: "2026-01-01",
          validThrough: "2099-12-31",
          maximum: "100000",
          cards: [{ principal: "100000", months: 12, installment: "10000" }],
        },
        [company],
        201
      )
    ).result,
    "RateSheet"
  )
  const {
    rows: [card],
  } = await f.db.query(
    'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1',
    [sheet.id]
  )
  async function openDeal(tag: string) {
    const buyer = ref(
      (
        await command(
          "createCustomer",
          {
            fullName: `Synthetic ${tag}`,
            callingName: tag,
            nicOrPassport: `P-${suffix}-${tag}`,
            address: "Synthetic address",
            phone: "0771234567",
          },
          [],
          201
        )
      ).result,
      "Customer"
    )
    const quote = ref(
      (
        await command(
          "selectQuote",
          {
            sheetId: sheet.id,
            cardId: card.id,
            vehicle: { ...vehicle, description: "External vehicle" },
            charges: [],
          },
          [sheet, company, await settings()],
          201
        )
      ).result,
      "Quote"
    )
    return (
      await command(
        "openBrokerage",
        {
          customerId: buyer.id,
          quoteId: quote.id,
          guarantors: [
            {
              name: "Synthetic guarantor",
              identity: `G-${suffix}`,
              address: "Synthetic address",
              phone: "0771234568",
            },
          ],
        },
        [buyer, quote, company, await settings()],
        201
      )
    ).result.id
  }
  type Member = {
    id: string
    revision: number
    ready: boolean
    checklistHash: string
  }
  async function preview(ids: string[]) {
    const response = await admin.post("/api/v1/queries/dispatchPreview", {
      headers: { Origin: f.origin },
      data: { sourceIds: ids.map((id) => ({ type: "BROKERAGE", id })) },
    })
    assert.equal(response.status(), 200)
    const { data } = await response.json()
    assert.equal(data.length, ids.length)
    return data as Member[]
  }
  const evidence = await readFile("public/pwa-icon-192.png")
  async function prepareDeal(tag: string) {
    const id = await openDeal(tag)
    const now = new Date().toISOString()
    const guarantorId = (await dealOf(admin, id)).guarantors![0]!.id
    const dealCommand = async (
      name: string,
      input: object,
      companyEvidence = false
    ) =>
      command(name, { dealId: id, ...input }, [
        ref(await dealOf(admin, id), "BrokerageDeal"),
        ...(companyEvidence ? [company] : []),
      ])
    const upload = async (purpose: string, kind: string, category?: string) =>
      (
        await f.upload(admin, {
          type: "BROKERAGE_DEAL",
          id,
          revision: (await dealOf(admin, id)).revision!,
          purpose,
          filename: `${kind}.png`,
          contentType: "image/png",
          bytes: evidence,
          category,
        })
      ).attachmentId
    for (const target of ["CUSTOMER", "GUARANTOR", "VEHICLE"]) {
      await dealCommand(
        "recordEligibility",
        {
          target,
          outcome: "CONFIRMED",
          contactId: agentId,
          checkedAt: now,
          feedback: "Confirmed",
          ...(target === "GUARANTOR" ? { guarantorId } : {}),
        },
        true
      )
    }
    const photos = []
    for (const category of [
      "FRONT",
      "BACK",
      "LEFT",
      "RIGHT",
      "CHASSIS",
      "ENGINE",
      "METER",
      "DEALER_WITH_VEHICLE",
      "CUSTOMER_WITH_VEHICLE",
    ])
      photos.push({
        category,
        attachmentId: await upload("INSPECTION", category, category),
      })
    await dealCommand("recordInspection", { photos })
    const items: object[] = []
    for (const [purpose, kinds] of [
      [
        "PARTICIPANT_DOCUMENT",
        [
          "CUSTOMER_ID",
          "PASSPORT_PHOTOS",
          "BANK_PASSBOOK",
          "ADDRESS_PROOF",
          "GUARANTOR_ID",
        ],
      ],
      [
        "VEHICLE_DOCUMENT",
        [
          "REGISTRATION_BOOK",
          "REVENUE_LICENSE",
          "TRANSFER_PAPER",
          "PREVIOUS_OWNER_ID",
        ],
      ],
    ] as const) {
      const attachmentId = await upload(purpose, purpose.toLowerCase())
      for (const kind of kinds) {
        items.push({
          kind,
          applicability: "REQUIRED",
          collected: true,
          quantity: kind === "PASSPORT_PHOTOS" ? 4 : 0,
          attachmentIds: [attachmentId],
          ...(kind === "GUARANTOR_ID" ? { participantId: guarantorId } : {}),
        })
      }
    }
    for (const kind of ["RELATIONSHIP_PROOF", "DELETION_LETTER"])
      items.push({
        kind,
        applicability: "NOT_REQUIRED",
        reason: "Company confirmed not required",
        collected: false,
        quantity: 0,
        attachmentIds: [],
      })
    items.push({
      kind: "EXTRA_KEY",
      applicability: "REQUIRED",
      collected: true,
      quantity: 0,
      attachmentIds: [],
    })
    await dealCommand("setChecklist", { items })
    const [member] = await preview([id])
    await dealCommand(
      "verifyDocuments",
      {
        checklistHash: member!.checklistHash,
        outcome: "CLEAN",
        issues: [],
        contactId: agentId,
        confirmedAt: now,
        feedback: "Verified",
      },
      true
    )
    await dealCommand(
      "informCompany",
      {
        contactId: agentId,
        informedAt: now,
        fileReference: `FILE-${tag}-${suffix}`,
        feedback: "Company informed",
      },
      true
    )
    return id
  }
  const readyDeals: string[] = []
  for (const tag of ["first", "second", "third", "fourth", "fifth"])
    readyDeals.push(await prepareDeal(tag))
  const incompleteId = await openDeal("incomplete")
  const firstReadyId = readyDeals[0]!
  const dispatchRequest = (
    members: Member[],
    handedOverAt: string,
    tracking?: string
  ) =>
    envelope(
      {
        sourceIds: members.map(({ id, revision, checklistHash }) => ({
          type: "BROKERAGE",
          id,
          revision,
          checklistHash,
        })),
        handedOverAt,
        courier: "Synthetic courier",
        tracking,
      },
      members.map((member) => ref(member, "BrokerageDeal"))
    )
  const dispatchCounts = async () =>
    (
      await f.db.query(
        `SELECT
          (SELECT count(*) FROM vamotors."DispatchBatch") AS batches,
          (SELECT count(*) FROM vamotors."DispatchItem") AS items,
          (SELECT count(*) FROM vamotors."CommissionEntitlement") AS entitlements,
          (SELECT count(*) FROM vamotors."CommandReceipt" WHERE "commandName" = 'dispatchBatch') AS receipts,
          (SELECT count(*) FROM vamotors."AuditEntry" WHERE action = 'dispatchBatch') AS audits`
      )
    ).rows
  const before = await dispatchCounts()
  const mixed = await preview([firstReadyId, incompleteId])
  await f.command(
    admin,
    "dispatchBatch",
    dispatchRequest(mixed, new Date().toISOString()),
    422,
    "CHECKLIST_INCOMPLETE"
  )
  assert.deepEqual(await dispatchCounts(), before)
  assert.equal((await dealOf(admin, firstReadyId)).state, "DOCUMENTS_READY")
  assert.equal((await dealOf(admin, incompleteId)).state, "INTAKE")
  console.log("PASS incomplete member rejects the whole batch")
  const dispatchedBatches: {
    asOfDate: string
    tracking: string
    entitlements: {
      id: string
      brokerageDealId: string
      expectedAmount: string
      revision: number
    }[]
  }[] = []
  for (const ids of [readyDeals.slice(0, 2), readyDeals.slice(2)]) {
    const members = await preview(ids)
    assert.ok(
      members.every((member) => member.ready),
      JSON.stringify(members)
    )
    const handedOverAt = new Date().toISOString()
    const tracking = `TRK-${ids.length}-${suffix}`
    const body = dispatchRequest(members, handedOverAt, tracking)
    const applied = await f.command(admin, "dispatchBatch", body, 201)
    assert.equal(applied.result.type, "DispatchBatch")
    const replay = await f.command(admin, "dispatchBatch", body, 200)
    assert.equal(replay.replayed, true)
    assert.equal(replay.commandId, applied.commandId)
    assert.deepEqual(replay.result, applied.result)

    const batch = await f.db.query(
      `SELECT id, courier, tracking, "handedOverAt" AT TIME ZONE 'UTC' AS "handedOverAt",
              "createdBy" = (SELECT id FROM vamotors."user" WHERE email=$2) AS sender
       FROM vamotors."DispatchBatch" WHERE "commandId"=$1`,
      [applied.commandId, f.accounts.BOOTSTRAP_ADMIN_EMAIL]
    )
    assert.deepEqual(batch.rows, [
      {
        id: applied.result.id,
        courier: "Synthetic courier",
        tracking,
        handedOverAt: new Date(handedOverAt),
        sender: true,
      },
    ])
    const items = await f.db.query(
      `SELECT "brokerageDealId", "sentAt" AT TIME ZONE 'UTC' AS "sentAt"
       FROM vamotors."DispatchItem" WHERE "batchId"=$1 ORDER BY "brokerageDealId"`,
      [applied.result.id]
    )
    assert.deepEqual(
      items.rows,
      [...ids].sort().map((id) => ({
        brokerageDealId: id,
        sentAt: new Date(handedOverAt),
      }))
    )
    for (const member of members) {
      const deal = await dealOf(second, member.id)
      assert.equal(deal.state, "DISPATCHED")
      assert.equal(deal.revision, member.revision + 1)
    }
    const entitlements = await f.db.query<{
      id: string
      brokerageDealId: string
      expectedAmount: string
      revision: number
    }>(
      'SELECT id, "brokerageDealId", "expectedAmount", revision FROM vamotors."CommissionEntitlement" WHERE "commandId"=$1 ORDER BY "brokerageDealId"',
      [applied.commandId]
    )
    assert.deepEqual(
      entitlements.rows.map((row) => row.brokerageDealId),
      [...ids].sort()
    )
    assert.ok(entitlements.rows.every((row) => row.revision === 1))
    const counts = await f.db.query(
      'SELECT (SELECT count(*) FROM vamotors."CommandReceipt" WHERE "idempotencyKey"=$2) AS receipts, (SELECT count(*) FROM vamotors."AuditEntry" WHERE "commandId"=$1) AS audits, (SELECT count(*) FROM vamotors."EntityReadVersion" WHERE "commandId"=$1) AS versions',
      [applied.commandId, body.idempotencyKey]
    )
    assert.deepEqual(counts.rows, [
      {
        receipts: "1",
        audits: String(1 + ids.length),
        versions: String(1 + ids.length * 2),
      },
    ])

    const asOfDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
    }).format(new Date(handedOverAt))
    dispatchedBatches.push({
      tracking,
      asOfDate,
      entitlements: entitlements.rows,
    })
    console.log(
      `PASS ${ids.length} deals dispatch once and replay without extra writes`
    )
  }
  for (const { asOfDate, tracking, entitlements } of dispatchedBatches) {
    const companyId = company.id
    const pending = await f.query<
      Awaited<ReturnType<typeof reconciliationView>>
    >(admin, "reconciliation", `?companyId=${companyId}&asOfDate=${asOfDate}`)
    for (const row of entitlements) {
      const item = pending.data.find(
        (item) => item.sourceId === row.brokerageDealId
      )
      assert.equal(item?.entitlementId, row.id)
    }
    const draft = await command(
      "stageRemittance",
      {
        companyId,
        reference: tracking,
      },
      [pending.company],
      201
    )
    const notice = await f.upload(admin, {
      type: "REMITTANCE",
      id: draft.result.id,
      revision: draft.result.revision,
      purpose: "RECONCILIATION_NOTICE",
      filename: "bank-notice.png",
      contentType: "image/png",
      bytes: evidence,
    })
    type Detail = Extract<
      Awaited<ReturnType<typeof reconciliationRead>>,
      { receipt: unknown }
    >
    const remittance = () =>
      f.query<Detail>(admin, "remittance", `?id=${draft.result.id}`)
    const staged = await remittance()
    const lines = entitlements.map((row) => ({
      key: row.id,
      description: "Brokerage commission",
      amount: row.expectedAmount,
      source: { type: "BROKERAGE", id: row.brokerageDealId },
    }))
    const received = await command(
      "recordRemittance",
      {
        draftId: draft.result.id,
        companyId,
        noticeAttachmentId: notice.attachmentId,
        lines,
        payment: {
          amount: lines
            .reduce((total, line) => total + BigInt(line.amount), 0n)
            .toString(),
          date: asOfDate,
          method: "BANK_TRANSFER",
          reference: tracking,
        },
      },
      [staged.company, ref(staged, "Remittance")]
    )
    const recorded = await remittance()
    const run = await command(
      "reconcile",
      {
        companyId,
        asOfDate,
        allocations: recorded.lines.map((line) => ({
          entitlementId: line.key,
          remittanceId: received.result.id,
          amount: line.amount,
          noticeLineId: line.id,
        })),
        resolutions: [],
      },
      [
        recorded.company,
        ref(received.result, "Remittance"),
        ...entitlements.map((row) => ref(row, "CommissionEntitlement")),
      ]
    )
    assert.equal(run.result.type, "ReconciliationRun")
    const reconciled = await remittance()
    assert.deepEqual(
      reconciled.allocations.map((row) => row.entitlement.id).sort(),
      entitlements.map((row) => row.id).sort()
    )
    assert.equal(reconciled.unallocated, "0")
    console.log(
      `PASS remittance allocates to all ${entitlements.length} dispatched entitlements`
    )
  }
} finally {
  await f.close()
}
