/** T11b/T12 real-DB lifecycle: production HTTP, native PG, private files. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type APIRequestContext } from "@playwright/test"
import sharp from "sharp"
import { fixture, envelope, ref } from "./brokerage-fixture"
import type {
  BrokerageDTO,
  CustomerDTO,
  PartyDTO,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"

import { purchaseInput } from "./cycle-edits-fixture"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root, process.cwd(), process.env.BROKERAGE_UPGRADE_FROM)
const suffix = randomUUID().slice(0, 8)
const groups: string[] = []
let stage = "initialize"
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
const settings = () =>
  f.query<{ id: string; revision: number }>(admin, "settings")
const dealOf = (client: APIRequestContext, id: string) =>
  f.query<BrokerageDTO & { redactedFields?: string[] }>(
    client,
    "brokerageDeal",
    `?id=${id}`
  )
const listDeals = (client: APIRequestContext, params = "") =>
  f.query<{ data: BrokerageDTO[]; total: number }>(
    client,
    "brokerage",
    `?page=1&pageSize=100${params}`
  )
const image = async (colour: { r: number; g: number; b: number }) =>
  sharp({
    create: { width: 24, height: 24, channels: 3, background: colour },
  })
    .png()
    .toBuffer()
let admin: APIRequestContext
let second: APIRequestContext
let staff: APIRequestContext

async function financeCompany(
  client: APIRequestContext,
  name: string,
  path: "APPLICATION" | "REFERRAL"
) {
  const s = await settings()
  const created = await f.command(
    client,
    "createFinanceCompany",
    envelope(
      {
        name,
        contacts: [
          {
            name: `${name} agent`,
            phone: "0112345678",
            role: "Processing",
            primary: true,
          },
        ],
        policy: {
          path,
          commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
          processingFee: "250000",
          reconciliationMethod: "PERIOD_NOTICE",
        },
      },
      [ref(s, "Settings")]
    ),
    201
  )
  return created
}
async function publishSheet(
  client: APIRequestContext,
  company: { id: string; revision: number },
  model: string,
  maximum = "12000000"
) {
  return f.command(
    client,
    "publishRates",
    envelope(
      {
        companyId: company.id,
        make: "Broker",
        model,
        year: 2026,
        validFrom: "2026-01-01",
        validThrough: "2027-12-31",
        maximum,
        cards: [
          { principal: "10000000", months: 12, installment: "900000" },
          { principal: "9500000", months: 12, installment: "860000" },
          { principal: "10500000", months: 12, installment: "940000" },
        ],
      },
      [ref(company, "FinanceCompany")]
    ),
    201
  )
}
async function select(
  client: APIRequestContext,
  sheet: { id: string; revision?: number },
  company: { id: string; revision: number },
  model: string,
  principal: string,
  installment: string,
  charges: { category: string; amount: string }[] = [
    { category: "Document charge", amount: "500" },
  ]
) {
  const s = await settings()
  const quote = await f.command(
    client,
    "selectQuote",
    envelope(
      {
        sheetId: sheet.id,
        cardId: (
          await f.db.query(
            'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1 AND principal=$2',
            [sheet.id, principal]
          )
        ).rows[0].id,
        vehicle: {
          make: "Broker",
          model,
          year: 2026,
          description: "External vehicle, never owned inventory",
        },
        charges,
      },
      [
        { type: "RateSheet", id: sheet.id, revision: 1 },
        ref(company, "FinanceCompany"),
        ref(s, "Settings"),
      ]
    ),
    201
  )
  return quote
}
async function customer(client: APIRequestContext, tag: string) {
  return f.command(
    client,
    "createCustomer",
    envelope(
      {
        fullName: `Brokerage ${tag} ${suffix}`,
        callingName: tag,
        nicOrPassport: `BRK-${tag}-${suffix}`,
        address: "Synthetic brokerage address",
        phone: "0112345678",
      },
      []
    ),
    201
  )
}
async function contacts(client: APIRequestContext, companyId: string) {
  const party = await f.query<PartyDTO>(
    client,
    "party",
    `?type=FINANCE_COMPANY&id=${companyId}`
  )
  return party.contacts
}
const contactId = (rows: { id?: string }[]) => rows[0].id!
const photoColors = [
  { r: 20, g: 20, b: 20 },
  { r: 40, g: 40, b: 40 },
  { r: 60, g: 60, b: 60 },
  { r: 80, g: 80, b: 80 },
  { r: 100, g: 100, b: 100 },
  { r: 120, g: 120, b: 120 },
  { r: 140, g: 140, b: 140 },
  { r: 160, g: 160, b: 160 },
  { r: 180, g: 180, b: 180 },
]
const categories = [
  "FRONT",
  "BACK",
  "LEFT",
  "RIGHT",
  "CHASSIS",
  "ENGINE",
  "METER",
  "DEALER_WITH_VEHICLE",
  "CUSTOMER_WITH_VEHICLE",
] as const

async function uploadDealFile(
  client: APIRequestContext,
  dealId: string,
  purpose: string,
  filename: string,
  colour: { r: number; g: number; b: number },
  category?: string
) {
  const deal = await dealOf(client, dealId)
  return f.upload(client, {
    type: "BROKERAGE_DEAL",
    id: dealId,
    revision: deal.revision!,
    purpose,
    filename,
    contentType: "image/png",
    bytes: await image(colour),
    ...(category ? { category } : {}),
  })
}

try {
  admin = await f.login(
    f.accounts.BOOTSTRAP_ADMIN_EMAIL,
    f.accounts.BOOTSTRAP_ADMIN_PASSWORD
  )
  second = await f.login(
    f.accounts.BOOTSTRAP_SECOND_EMAIL,
    f.accounts.BOOTSTRAP_SECOND_PASSWORD
  )
  staff = await f.login(
    f.accounts.BOOTSTRAP_STAFF_EMAIL,
    f.accounts.BOOTSTRAP_STAFF_PASSWORD
  )

  const applicationCompany = await financeCompany(
    admin,
    `Application finance ${suffix}`,
    "APPLICATION"
  )
  const referralCompany = await financeCompany(
    admin,
    `Referral finance ${suffix}`,
    "REFERRAL"
  )
  const applicationSheet = await publishSheet(
    admin,
    applicationCompany.result,
    `App${suffix}`
  )
  const referralSheet = await publishSheet(
    admin,
    referralCompany.result,
    `Ref${suffix}`,
    "12000000"
  )
  const applicationQuote = await select(
    admin,
    applicationSheet.result,
    applicationCompany.result,
    `App${suffix}`,
    "10000000",
    "900000"
  )
  const referralQuote = await select(
    admin,
    referralSheet.result,
    referralCompany.result,
    `Ref${suffix}`,
    "10000000",
    "900000"
  )
  const applicationCustomer = await customer(admin, "app")
  const referralCustomer = await customer(admin, "ref")

  let applicationDealId = ""
  let applicationHash = ""
  const guarantors = [
    {
      name: "Guarantor One",
      identity: `G1-${suffix}`,
      address: "Guarantor address one",
      phone: "0112345678",
    },
    {
      name: "Guarantor Two",
      identity: `G2-${suffix}`,
      address: "Guarantor address two",
      phone: "0112345679",
    },
  ]

  await group(
    "Chromium intake, eligibility, inspection and guarantor documents",
    async () => {
      const browser = await chromium.launch({
        executablePath: process.env.BROKERAGE_CHROMIUM,
      })
      try {
        const page = await browser.newPage({
          storageState: await admin.storageState(),
        })
        page.setDefaultTimeout(15_000)
        const visible = expect.configure({ timeout: 15_000 })
        const browserCustomer = await customer(admin, "browser")
        await page.goto(
          `${f.origin}/lease-comparison?quote=${applicationQuote.result.id}`
        )
        await page.getByRole("link", { name: "Open brokerage intake" }).click()
        await visible(page.getByLabel("Quote ID", { exact: true })).toHaveValue(
          applicationQuote.result.id
        )
        await page.getByRole("button", { name: "Load live quote" }).click()
        await page
          .getByLabel("Customer", { exact: true })
          .selectOption(browserCustomer.result.id)
        for (const [key, value] of Object.entries(guarantors[0])) {
          await page.getByLabel(`Guarantor 1 ${key}`).fill(value)
        }
        await visible(page.getByText(/12 months.*APPLICATION/)).toBeVisible()
        const intake = page.waitForResponse((r) =>
          r.url().endsWith("/commands/openBrokerage")
        )
        await page
          .getByRole("button", { name: "Persist brokerage deal" })
          .click()
        const opened = await intake
        assert.equal(opened.status(), 201, await opened.text())
        const { result } = await opened.json()
        await page.goto(`${f.origin}/lease-deals/${result.id}`)
        for (const target of ["CUSTOMER", "GUARANTOR", "VEHICLE"]) {
          await page.getByLabel("Target", { exact: true }).selectOption(target)
          const agent = contactId(
            await contacts(admin, applicationCompany.result.id)
          )
          await page.locator("#elig-contact").selectOption(agent)
          await page
            .locator("#elig-feedback")
            .fill(`${target} confirmed in Chromium`)
          const eligibility = page.waitForResponse((r) =>
            r.url().endsWith("/commands/recordEligibility")
          )
          await page.getByRole("button", { name: "Record eligibility" }).click()
          const recorded = await eligibility
          assert.equal(recorded.status(), 200, await recorded.text())
          await visible(
            page.getByRole("button", { name: "Record eligibility" })
          ).toBeEnabled()
        }
        for (const [index, category] of categories.entries()) {
          await page.locator(`#photo-${category}`).setInputFiles({
            name: `${category}.png`,
            mimeType: "image/png",
            buffer: await image(photoColors[index]!),
          })
          await visible(
            page.locator(`#photo-${category}`).locator("..")
          ).toContainText("Persisted")
        }
        await page
          .getByRole("button", { name: "Record inspection evidence" })
          .click()
        await visible(page.getByRole("heading", { level: 1 })).toContainText(
          "INSPECTED"
        )
        await page.getByLabel("Gross", { exact: true }).fill("100000.00")
        await page.locator("#fac-fee").fill("200.00")
        await page.locator("#fac-reason").fill("Customer requested funding")
        await page.getByRole("button", { name: "Request facility" }).click()
        const payout = page.getByRole("button", { name: "Disburse facility" })
        await visible(payout).toBeEnabled()
        await payout.click()
        await visible(
          page.getByText(/DISBURSED.*principal outstanding/)
        ).toBeVisible()
        await page.locator("#rec-principal").fill("99800.00")
        await page.getByRole("button", { name: "Record recovery" }).click()
        await visible(
          page.getByText(/RECOVERED.*principal outstanding/)
        ).toBeVisible()
        const guarantorDocument = page.getByRole("group", {
          name: /GUARANTOR_ID.*Guarantor One/,
        })
        await guarantorDocument.getByLabel(/attachment/).setInputFiles({
          name: "guarantor.png",
          mimeType: "image/png",
          buffer: await image(photoColors[0]!),
        })
        await visible(guarantorDocument).toContainText("1 file(s)")
        async function saveChecklist() {
          const response = page.waitForResponse((r) =>
            r.url().endsWith("/commands/setChecklist")
          )
          await page.getByRole("button", { name: "Save checklist" }).click()
          const saved = await response
          assert.equal(saved.status(), 200, await saved.text())
          await visible(page.getByText("Saved", { exact: true })).toBeVisible()
        }
        await saveChecklist()
        const current = await dealOf(admin, result.id)
        const guarantorId = current.guarantors?.[0]?.id
        assert.equal(
          current.checklist?.find((item) => item.kind === "GUARANTOR_ID")
            ?.participantId,
          guarantorId
        )
        const verification = page.getByRole("button", {
          name: "Verify documents",
        })
        const agent = contactId(
          await contacts(admin, applicationCompany.result.id)
        )
        await page.locator("#verify-contact").selectOption(agent)
        await page
          .locator("#verify-feedback")
          .fill("A replacement ID is needed")
        await page.getByLabel("Verification outcome").selectOption("ISSUES")
        await page
          .getByLabel(`GUARANTOR_ID:${guarantorId}`, { exact: true })
          .fill("ID unreadable")
        await verification.click()
        await visible(
          page.getByText(/ISSUES.*A replacement ID is needed/)
        ).toBeVisible()
        for (const kind of [
          "CUSTOMER_ID",
          "PASSPORT_PHOTOS",
          "BANK_PASSBOOK",
          "ADDRESS_PROOF",
          "REGISTRATION_BOOK",
          "REVENUE_LICENSE",
          "TRANSFER_PAPER",
          "PREVIOUS_OWNER_ID",
        ]) {
          const row = page.getByRole("group", { name: kind, exact: true })
          await row.getByLabel(/attachment/).setInputFiles({
            name: `${kind}.png`,
            mimeType: "image/png",
            buffer: await image(photoColors[1]!),
          })
          await visible(row).toContainText("1 file(s)")
        }
        for (const kind of ["RELATIONSHIP_PROOF", "DELETION_LETTER"]) {
          await page
            .getByLabel(`${kind} applicability`)
            .selectOption("NOT_REQUIRED")
          await page
            .getByLabel(`${kind} not required reason`)
            .fill("Finance company confirmed not needed")
        }
        await page
          .getByRole("group", { name: "EXTRA_KEY" })
          .getByLabel("collected")
          .check()
        await saveChecklist()
        await page.getByLabel("Verification outcome").selectOption("RESOLVED")
        await page
          .locator("#verify-feedback")
          .fill("Finance company confirmed readable ID")
        await verification.click()
        await visible(page.getByRole("heading", { level: 1 })).toContainText(
          "DOCUMENTS_READY"
        )
        await page.locator("#inform-contact").selectOption(agent)
        await page
          .getByLabel("File reference", { exact: true })
          .fill("BROWSER-FILE")
        await page
          .locator("#inform-feedback")
          .fill("Finance company supplied file number")
        await page.getByRole("button", { name: "Inform company" }).click()
        await visible(
          page.getByText(/File reference: BROWSER-FILE/)
        ).toBeVisible()
        await page.goto(`${f.origin}/lease-dispatch`)
        await page
          .getByRole("checkbox", { name: `Select ${result.id}` })
          .check()
        await page
          .getByLabel("Courier", { exact: true })
          .fill("Chromium courier")
        await page
          .getByRole("button", { name: "Dispatch selected deals" })
          .click()
        await visible(
          page.getByRole("checkbox", { name: `Select ${result.id}` })
        ).toHaveCount(0)
        await page.goto(`${f.origin}/lease-deals/${result.id}`)
        await visible(page.getByRole("heading", { level: 1 })).toContainText(
          "DISPATCHED"
        )
        const download = page.waitForEvent("download")
        await page
          .getByRole("group", { name: "CUSTOMER_ID", exact: true })
          .getByRole("button", { name: "Download file 1" })
          .click()
        assert.equal((await download).suggestedFilename(), "CUSTOMER_ID.png")
      } finally {
        await browser.close()
      }
    }
  )

  await group(
    "open APPLICATION deal from live quote with two guarantors",
    async () => {
      const before = await f.db.query(
        'SELECT count(*) FROM vamotors."Customer"'
      )
      const created = await f.command(
        admin,
        "openBrokerage",
        envelope(
          {
            customerId: applicationCustomer.result.id,
            guarantors,
            quoteId: applicationQuote.result.id,
          },
          [
            {
              type: "Customer",
              id: applicationCustomer.result.id,
              revision: 1,
            },
            { type: "Quote", id: applicationQuote.result.id, revision: 1 },
            ref(applicationCompany.result, "FinanceCompany"),
            ref(await settings(), "Settings"),
          ]
        ),
        201
      )
      applicationDealId = created.result.id
      const deal = await dealOf(admin, applicationDealId)
      assert.equal(deal.path, "APPLICATION")
      assert.equal(deal.state, "INTAKE")
      assert.equal(deal.guarantors?.length, 2)
      assert.equal(deal.quote?.principal, "10000000")
      assert.equal(deal.approvedLoan, "10000000")
      assert.equal(deal.processingFee, "250000")
      assert.equal(deal.originalQuoteId, applicationQuote.result.id)
      assert.equal(
        (await f.db.query('SELECT count(*) FROM vamotors."Customer"')).rows[0]
          .count,
        before.rows[0].count
      )
    }
  )

  await group(
    "zero guarantor intake rejected without a partial deal",
    async () => {
      const before = await f.db.query(
        'SELECT count(*) FROM vamotors."BrokerageDeal"'
      )
      const response = await admin.post("/api/v1/commands/openBrokerage", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            customerId: applicationCustomer.result.id,
            guarantors: [],
            quoteId: applicationQuote.result.id,
          },
          [
            {
              type: "Customer",
              id: applicationCustomer.result.id,
              revision: 1,
            },
            { type: "Quote", id: applicationQuote.result.id, revision: 1 },
            ref(applicationCompany.result, "FinanceCompany"),
            ref(await settings(), "Settings"),
          ]
        ),
      })
      assert.equal(response.status(), 422)
      assert.equal(
        (await f.db.query('SELECT count(*) FROM vamotors."BrokerageDeal"'))
          .rows[0].count,
        before.rows[0].count
      )
    }
  )

  await group(
    "eligibility rechecks retain rejection until both guarantors clear",
    async () => {
      const contactIdForCheck = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      let deal = await dealOf(admin, applicationDealId)
      const [first, second] = deal.guarantors!.map((guarantor) => guarantor.id)
      for (const [target, outcome, guarantorId, expectedState] of [
        ["CUSTOMER", "CONFIRMED", undefined, "ELIGIBILITY_PENDING"],
        ["GUARANTOR", "REJECTED", first, "REJECTED"],
        ["GUARANTOR", "REJECTED", second, "REJECTED"],
        ["GUARANTOR", "CONFIRMED", first, "REJECTED"],
        ["GUARANTOR", "CONFIRMED", second, "ELIGIBILITY_PENDING"],
        ["VEHICLE", "CONFIRMED", undefined, "ELIGIBLE"],
      ] as const) {
        await f.command(
          admin,
          "recordEligibility",
          envelope(
            {
              dealId: applicationDealId,
              target,
              outcome,
              ...(guarantorId ? { guarantorId } : {}),
              contactId: contactIdForCheck,
              checkedAt: new Date().toISOString(),
              feedback: `${target} ${outcome}`,
            },
            [
              ref(deal, "BrokerageDeal"),
              ref(applicationCompany.result, "FinanceCompany"),
            ]
          )
        )
        deal = await dealOf(admin, applicationDealId)
        assert.equal(deal.state, expectedState)
      }
      assert.equal(deal.eligibility?.length, 6)
      await f.command(
        admin,
        "setChecklist",
        envelope(
          {
            dealId: applicationDealId,
            items: [],
          },
          [ref(deal, "BrokerageDeal")]
        ),
        409,
        "INVALID_STATE"
      )
    }
  )

  await group("nine real private inspection photos and evidence", async () => {
    const urls = []
    for (const [index, category] of categories.entries()) {
      const uploaded = await uploadDealFile(
        admin,
        applicationDealId,
        "INSPECTION",
        `${category.toLowerCase()}.png`,
        photoColors[index]!,
        category
      )
      urls.push({ category, attachmentId: uploaded.attachmentId })
    }
    const deal = await dealOf(admin, applicationDealId)
    await f.command(
      admin,
      "recordInspection",
      envelope({ dealId: applicationDealId, photos: urls }, [
        ref(deal, "BrokerageDeal"),
      ])
    )
    const after = await dealOf(admin, applicationDealId)
    assert.equal(after.state, "INSPECTED")
    assert.equal(after.photos?.length, 9)
    assert.deepEqual(
      [...new Set(after.photos?.map((photo) => photo.category))].sort(),
      [...categories].sort()
    )
  })

  await group(
    "loan adjustment flags reselection and quote replacement preserves history",
    async () => {
      let deal = await dealOf(admin, applicationDealId)
      const contact = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      await f.command(
        admin,
        "adjustLoan",
        envelope(
          {
            dealId: applicationDealId,
            amount: "9500000",
            contactId: contact,
            feedback: "Lender feedback reduced approved amount",
            confirmedAt: new Date().toISOString(),
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(applicationCompany.result, "FinanceCompany"),
          ]
        )
      )
      deal = await dealOf(admin, applicationDealId)
      assert.equal(deal.approvedLoan, "9500000")
      assert.equal(deal.quoteStatus, "RESELECTION_REQUIRED")
      assert.equal(deal.quoteHistory?.length, 1)
      const replacement = await select(
        admin,
        applicationSheet.result,
        applicationCompany.result,
        `App${suffix}`,
        "9500000",
        "860000"
      )
      deal = await dealOf(admin, applicationDealId)
      await f.command(
        admin,
        "replaceDealQuote",
        envelope(
          {
            dealId: applicationDealId,
            quoteId: replacement.result.id,
            reason: "Reselect exact card for approved principal",
            contactId: contact,
            confirmedAt: new Date().toISOString(),
          },
          [
            ref(deal, "BrokerageDeal"),
            { type: "Quote", id: replacement.result.id, revision: 1 },
            ref(applicationCompany.result, "FinanceCompany"),
          ]
        )
      )
      const after = await dealOf(admin, applicationDealId)
      assert.equal(after.quoteStatus, "SUPPORTED")
      assert.equal(after.quoteHistory?.length, 2)
      assert.equal(after.originalQuoteId, applicationQuote.result.id)
      assert.equal(after.quote?.principal, "9500000")
      assert.equal(after.state, "INSPECTED")
    }
  )

  await group(
    "14-item checklist with conditional not-required reasons and attachments",
    async () => {
      const deal = await dealOf(admin, applicationDealId)
      const guarantorIds = deal.guarantors!.map((g) => g.id!)
      const docs: Record<string, string[]> = {}
      const specific = [
        ["CUSTOMER_ID", "PARTICIPANT_DOCUMENT", undefined],
        ["PASSPORT_PHOTOS", "PARTICIPANT_DOCUMENT", undefined],
        ["BANK_PASSBOOK", "PARTICIPANT_DOCUMENT", undefined],
        ["ADDRESS_PROOF", "PARTICIPANT_DOCUMENT", undefined],
        ["GUARANTOR_ID", "PARTICIPANT_DOCUMENT", guarantorIds[0]],
        ["GUARANTOR_ID", "PARTICIPANT_DOCUMENT", guarantorIds[1]],
        ["REGISTRATION_BOOK", "VEHICLE_DOCUMENT", undefined],
        ["REVENUE_LICENSE", "VEHICLE_DOCUMENT", undefined],
        ["TRANSFER_PAPER", "VEHICLE_DOCUMENT", undefined],
        ["PREVIOUS_OWNER_ID", "VEHICLE_DOCUMENT", undefined],
        ["PROCESSING_DOCUMENT", "PROCESSING_DOCUMENT", undefined],
      ] as const
      for (const [kind, purpose, participant] of specific) {
        const uploaded = await uploadDealFile(
          admin,
          applicationDealId,
          purpose,
          `${kind.toLowerCase()}-${participant ?? "x"}.png`,
          { r: 30, g: 90, b: 150 }
        )
        const key = `${kind}:${participant ?? ""}`
        docs[key] = [uploaded.attachmentId]
      }
      const current = await dealOf(admin, applicationDealId)
      const items = [
        ...[
          "CUSTOMER_ID",
          "PASSPORT_PHOTOS",
          "BANK_PASSBOOK",
          "ADDRESS_PROOF",
          "REGISTRATION_BOOK",
          "REVENUE_LICENSE",
          "TRANSFER_PAPER",
          "PREVIOUS_OWNER_ID",
          "EXTRA_KEY",
        ].map((kind) => ({
          kind,
          applicability: "REQUIRED",
          collected: true,
          quantity: kind === "PASSPORT_PHOTOS" ? 4 : 0,
          attachmentIds: kind === "EXTRA_KEY" ? [] : (docs[`${kind}:`] ?? []),
        })),
        ...guarantorIds.map((id) => ({
          kind: "GUARANTOR_ID",
          participantId: id,
          applicability: "REQUIRED",
          collected: true,
          quantity: 0,
          attachmentIds: docs[`GUARANTOR_ID:${id}`] ?? [],
        })),
        {
          kind: "RELATIONSHIP_PROOF",
          applicability: "NOT_REQUIRED",
          reason: "Guarantors are immediate family",
          collected: false,
          quantity: 0,
          attachmentIds: [],
        },
        {
          kind: "DELETION_LETTER",
          applicability: "NOT_REQUIRED",
          reason: "Vehicle is not under lease",
          collected: false,
          quantity: 0,
          attachmentIds: [],
        },
        {
          kind: "AFFIDAVIT",
          applicability: "OPTIONAL",
          collected: false,
          quantity: 0,
          attachmentIds: [],
        },
        {
          kind: "PROCESSING_DOCUMENT",
          label: "Company processing note",
          applicability: "REQUIRED",
          collected: true,
          quantity: 0,
          attachmentIds: docs["PROCESSING_DOCUMENT:"] ?? [],
        },
      ]
      await f.command(
        admin,
        "setChecklist",
        envelope({ dealId: applicationDealId, items }, [
          ref(current, "BrokerageDeal"),
        ])
      )
      const after = await dealOf(admin, applicationDealId)
      assert.equal(after.checklist?.length, 15)
      const passport = after.checklist?.find(
        (i) => i.kind === "PASSPORT_PHOTOS"
      )
      assert.ok(passport)
      assert.equal(passport.quantity, 4)
      assert.equal(passport.attachmentIds?.length, 1)
      assert.equal(
        after.checklist?.find((i) => i.kind === "EXTRA_KEY")?.attachmentIds
          ?.length,
        0
      )
      assert.equal(
        after.checklist?.find((i) => i.kind === "RELATIONSHIP_PROOF")?.reason,
        "Guarantors are immediate family"
      )
    }
  )

  await group(
    "clean document verification then company informed with file reference",
    async () => {
      const preview = await admin.post("/api/v1/queries/dispatchPreview", {
        headers: { Origin: f.origin },
        data: { sourceIds: [{ type: "BROKERAGE", id: applicationDealId }] },
      })
      const body = await preview.json()
      assert.equal(preview.status(), 200)
      applicationHash = body.data[0].checklistHash
      const contact = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      let deal = await dealOf(admin, applicationDealId)
      await f.command(
        admin,
        "verifyDocuments",
        envelope(
          {
            dealId: applicationDealId,
            checklistHash: applicationHash,
            outcome: "CLEAN",
            issues: [],
            contactId: contact,
            confirmedAt: new Date().toISOString(),
            feedback: "All required documents verified clean",
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(applicationCompany.result, "FinanceCompany"),
          ]
        )
      )
      deal = await dealOf(admin, applicationDealId)
      assert.equal(deal.state, "DOCUMENTS_READY")
      await f.command(
        admin,
        "informCompany",
        envelope(
          {
            dealId: applicationDealId,
            contactId: contact,
            informedAt: new Date().toISOString(),
            fileReference: `FILE-${suffix}`,
            feedback: "Company informed with file reference",
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(applicationCompany.result, "FinanceCompany"),
          ]
        )
      )
      deal = await dealOf(admin, applicationDealId)
      assert.equal(deal.fileReference, `FILE-${suffix}`)
      assert.equal(deal.state, "DOCUMENTS_READY")
    }
  )

  await group(
    "dispatch blocker and delay inquiry retain finance feedback",
    async () => {
      const contact = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      for (const kind of ["BLOCKER", "DELAY_INQUIRY"] as const) {
        const deal = await dealOf(admin, applicationDealId)
        await f.command(
          admin,
          "openIssue",
          envelope(
            {
              dealId: deal.id,
              kind,
              text: `${kind} reported`,
              at: new Date().toISOString(),
              ...(kind === "BLOCKER" ? { blocksStep: "DISPATCH" } : {}),
            },
            [ref(deal, "BrokerageDeal")]
          )
        )
        const opened = await dealOf(admin, applicationDealId)
        const issue = opened.issues?.find((item) => item.kind === kind)
        assert.ok(issue?.id)
        if (kind === "BLOCKER") {
          const response = await admin.post("/api/v1/queries/dispatchPreview", {
            headers: { Origin: f.origin },
            data: { sourceIds: [{ type: "BROKERAGE", id: applicationDealId }] },
          })
          assert.equal(response.status(), 200)
          const { data } = await response.json()
          assert.equal(data[0].ready, false)
          assert.ok(
            data[0].blockers.some(
              (item: { code: string }) => item.code === "OBLIGATION_OPEN"
            )
          )
        }
        await f.command(
          admin,
          "recordIssueFeedback",
          envelope(
            {
              issueId: issue.id,
              contactId: contact,
              at: new Date().toISOString(),
              feedback: "Company resolved the report",
              resolve: true,
            },
            [
              ref(opened, "BrokerageDeal"),
              ref(applicationCompany.result, "FinanceCompany"),
            ]
          )
        )
        const after = await dealOf(admin, applicationDealId)
        const resolved = after.issues?.find((item) => item.id === issue.id)
        assert.ok(resolved?.resolvedAt)
        assert.equal(resolved.feedback?.[0]?.contactId, contact)
      }
    }
  )

  let incompleteDealId = ""
  await group("incomplete dispatch batch rejected atomically", async () => {
    const created = await f.command(
      admin,
      "openBrokerage",
      envelope(
        {
          customerId: applicationCustomer.result.id,
          guarantors,
          quoteId: applicationQuote.result.id,
        },
        [
          { type: "Customer", id: applicationCustomer.result.id, revision: 1 },
          { type: "Quote", id: applicationQuote.result.id, revision: 1 },
          ref(applicationCompany.result, "FinanceCompany"),
          ref(await settings(), "Settings"),
        ]
      ),
      201
    )
    incompleteDealId = created.result.id
    const ready = await dealOf(admin, applicationDealId)
    const incomplete = await dealOf(admin, incompleteDealId)
    const previewResponse = await admin.post(
      "/api/v1/queries/dispatchPreview",
      {
        headers: { Origin: f.origin },
        data: {
          sourceIds: [
            { type: "BROKERAGE", id: applicationDealId },
            { type: "BROKERAGE", id: incompleteDealId },
          ],
        },
      }
    )
    const preview = (await previewResponse.json()).data
    const beforeDeals = await f.db.query(
      'SELECT count(*) FROM vamotors."DispatchBatch"'
    )
    const response = await admin.post("/api/v1/commands/dispatchBatch", {
      headers: { Origin: f.origin },
      data: envelope(
        {
          sourceIds: preview.map(
            (row: { id: string; revision: number; checklistHash: string }) => ({
              type: "BROKERAGE",
              id: row.id,
              revision: row.revision,
              checklistHash: row.checklistHash,
            })
          ),
          handedOverAt: new Date().toISOString(),
          courier: "Synthetic courier",
        },
        [ref(ready, "BrokerageDeal"), ref(incomplete, "BrokerageDeal")]
      ),
    })
    assert.equal(response.status(), 422, JSON.stringify(await response.json()))
    assert.equal(
      (await f.db.query('SELECT count(*) FROM vamotors."DispatchBatch"'))
        .rows[0].count,
      beforeDeals.rows[0].count
    )
    assert.equal(
      (await dealOf(admin, applicationDealId)).state,
      "DOCUMENTS_READY"
    )
    assert.equal((await dealOf(admin, incompleteDealId)).state, "INTAKE")
  })

  await group(
    "valid dispatch creates batch and commission entitlement once",
    async () => {
      const previewResponse = await admin.post(
        "/api/v1/queries/dispatchPreview",
        {
          headers: { Origin: f.origin },
          data: { sourceIds: [{ type: "BROKERAGE", id: applicationDealId }] },
        }
      )
      const preview = (await previewResponse.json()).data[0]
      assert.equal(preview.ready, true, JSON.stringify(preview.blockers))
      const deal = await dealOf(admin, applicationDealId)
      const applied = await f.command(
        admin,
        "dispatchBatch",
        envelope(
          {
            sourceIds: [
              {
                type: "BROKERAGE",
                id: applicationDealId,
                revision: preview.revision,
                checklistHash: preview.checklistHash,
              },
            ],
            handedOverAt: new Date().toISOString(),
            courier: "Synthetic courier",
            tracking: `TRK-${suffix}`,
          },
          [ref(deal, "BrokerageDeal")]
        ),
        201
      )
      assert.equal(applied.result.type, "DispatchBatch")
      const batch = await f.db.query(
        'SELECT id, courier, tracking FROM vamotors."DispatchBatch" WHERE id=$1',
        [applied.result.id]
      )
      assert.equal(batch.rows.length, 1)
      assert.equal(batch.rows[0].tracking, `TRK-${suffix}`)
      assert.equal(
        Number(
          (
            await f.db.query(
              'SELECT count(*) FROM vamotors."DispatchItem" WHERE "batchId"=$1',
              [applied.result.id]
            )
          ).rows[0].count
        ),
        1
      )
      const entitlements = await f.db.query(
        'SELECT "expectedAmount", "sentDateSource", state FROM vamotors."CommissionEntitlement" WHERE "brokerageDealId"=$1',
        [applicationDealId]
      )
      assert.equal(entitlements.rows.length, 1)
      assert.equal(entitlements.rows[0].expectedAmount, "95000")
      assert.equal(entitlements.rows[0].sentDateSource, "DISPATCH")
      assert.equal(entitlements.rows[0].state, "OPEN")
      const after = await dealOf(admin, applicationDealId)
      assert.equal(after.state, "DISPATCHED")
    }
  )

  await group(
    "complete brokerage records processing outcome without cash",
    async () => {
      const deal = await dealOf(admin, applicationDealId)
      const contact = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      await f.command(
        admin,
        "completeBrokerage",
        envelope(
          {
            dealId: applicationDealId,
            contactId: contact,
            at: new Date().toISOString(),
            feedback: "Lender processing completed",
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(applicationCompany.result, "FinanceCompany"),
          ]
        )
      )
      const after = await dealOf(admin, applicationDealId)
      assert.equal(after.state, "COMPLETED")
      assert.equal(
        Number(
          (
            await f.db.query(
              'SELECT count(*) FROM vamotors."BrokerageFeeReceipt" WHERE "dealId"=$1',
              [applicationDealId]
            )
          ).rows[0].count
        ),
        0
      )
    }
  )

  // ── Referral path ─────────────────────────────────────────────────────────
  let referralDealId = ""
  await group("REFERRAL path rejects Application-only commands", async () => {
    const created = await f.command(
      admin,
      "openBrokerage",
      envelope(
        {
          customerId: referralCustomer.result.id,
          guarantors,
          quoteId: referralQuote.result.id,
        },
        [
          { type: "Customer", id: referralCustomer.result.id, revision: 1 },
          { type: "Quote", id: referralQuote.result.id, revision: 1 },
          ref(referralCompany.result, "FinanceCompany"),
          ref(await settings(), "Settings"),
        ]
      ),
      201
    )
    referralDealId = created.result.id
    const contact = contactId(await contacts(admin, referralCompany.result.id))
    let deal = await dealOf(admin, referralDealId)
    for (const target of ["CUSTOMER", "GUARANTOR", "GUARANTOR"] as const) {
      deal = await dealOf(admin, referralDealId)
      await f.command(
        admin,
        "recordEligibility",
        envelope(
          {
            dealId: referralDealId,
            target,
            ...(target === "GUARANTOR"
              ? {
                  guarantorId: (deal.guarantors ?? [])[
                    deal.eligibility?.length === 1 ? 1 : 0
                  ]?.id,
                }
              : {}),
            outcome: "CONFIRMED",
            contactId: contact,
            checkedAt: new Date().toISOString(),
            feedback: `${target} confirmed`,
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(referralCompany.result, "FinanceCompany"),
          ]
        )
      )
    }
    deal = await dealOf(admin, referralDealId)
    assert.equal(deal.path, "REFERRAL")
    assert.equal(deal.state, "ELIGIBLE")
    const inspectionUpload = await admin.post("/api/v1/commands/initUpload", {
      headers: { Origin: f.origin },
      data: envelope(
        {
          target: { type: "BROKERAGE_DEAL", id: referralDealId },
          purpose: "INSPECTION",
          filename: "front.png",
          contentType: "image/png",
          size: 10,
          sha256: "a".repeat(64),
          category: "FRONT",
        },
        [ref(deal, "BrokerageDeal")]
      ),
    })
    assert.equal(inspectionUpload.status(), 409)
    assert.equal((await inspectionUpload.json()).error?.code, "PATH_MISMATCH")
    for (const [name, input] of [
      [
        "recordInspection",
        {
          dealId: referralDealId,
          photos: [{ category: "FRONT", attachmentId: randomUUID() }],
        },
      ],
      ["setChecklist", { dealId: referralDealId, items: [] }],
      [
        "verifyDocuments",
        {
          dealId: referralDealId,
          checklistHash: "a".repeat(64),
          outcome: "CLEAN",
          issues: [],
          contactId: contact,
          confirmedAt: new Date().toISOString(),
          feedback: "x",
        },
      ],
      [
        "informCompany",
        {
          dealId: referralDealId,
          contactId: contact,
          informedAt: new Date().toISOString(),
          fileReference: "X",
          feedback: "x",
        },
      ],
    ] as const) {
      const response = await admin.post(`/api/v1/commands/${name}`, {
        headers: { Origin: f.origin },
        data: envelope(input, [
          ref(deal, "BrokerageDeal"),
          ref(referralCompany.result, "FinanceCompany"),
        ]),
      })
      const value = await response.json()
      assert.equal(response.status(), 409, `${name}: ${JSON.stringify(value)}`)
      assert.equal(value.error?.code, "PATH_MISMATCH", name)
    }
  })

  await group(
    "referDeal creates commission expectation; non-remittance is referral-only",
    async () => {
      const contact = contactId(
        await contacts(admin, referralCompany.result.id)
      )
      const deal = await dealOf(admin, referralDealId)
      const applied = await f.command(
        admin,
        "referDeal",
        envelope(
          {
            dealId: referralDealId,
            contactId: contact,
            referredAt: new Date().toISOString(),
            sentContact: { name: "Referred Customer", phone: "0112345678" },
            feedback: "Handed over to company agent",
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(referralCompany.result, "FinanceCompany"),
          ]
        )
      )
      assert.equal(applied.result.type, "BrokerageDeal")
      const after = await dealOf(admin, referralDealId)
      assert.equal(after.state, "REFERRED")
      assert.equal(
        (
          await f.db.query(
            'SELECT "expectedAmount","sentDateSource" FROM vamotors."CommissionEntitlement" WHERE "brokerageDealId"=$1',
            [referralDealId]
          )
        ).rows[0].sentDateSource,
        "REFERRAL"
      )
      await f.command(
        admin,
        "openIssue",
        envelope(
          {
            dealId: referralDealId,
            kind: "NON_REMITTANCE",
            text: "Customer reported that the lease amount was not remitted",
            at: new Date().toISOString(),
          },
          [ref(after, "BrokerageDeal")]
        )
      )
      const complaint = await dealOf(admin, referralDealId)
      const issue = complaint.issues?.find(
        (item) => item.kind === "NON_REMITTANCE"
      )
      assert.ok(issue?.id)
      await f.command(
        admin,
        "recordIssueFeedback",
        envelope(
          {
            issueId: issue.id,
            contactId: contact,
            at: new Date().toISOString(),
            feedback: "Lender confirmed the customer payment date",
            resolve: true,
          },
          [
            ref(complaint, "BrokerageDeal"),
            ref(referralCompany.result, "FinanceCompany"),
          ]
        )
      )
      assert.ok(
        (await dealOf(admin, referralDealId)).issues?.find(
          (item) => item.id === issue.id
        )?.resolvedAt
      )
      const rejected = await admin.post("/api/v1/commands/openIssue", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            dealId: applicationDealId,
            kind: "NON_REMITTANCE",
            text: "Should be referral-only",
            at: new Date().toISOString(),
          },
          [ref(await dealOf(admin, applicationDealId), "BrokerageDeal")]
        ),
      })
      assert.equal(rejected.status(), 409)
      assert.equal((await rejected.json()).error?.code, "PATH_MISMATCH")
    }
  )

  await group(
    "fully withheld facility settles without a fabricated payment",
    async () => {
      const deal = await dealOf(admin, referralDealId)
      const baseTerms = {
        gross: deal.approvedLoan,
        fee: "0",
        feeMode: "WITHHELD",
        separatelyRecoverableCharges: "0",
      }
      await f.command(
        admin,
        "requestFacility",
        envelope(
          {
            dealId: deal.id,
            reason: "Initial request",
            terms: { ...baseTerms, deductions: [] },
          },
          [ref(deal, "BrokerageDeal")]
        )
      )
      const initial = await dealOf(admin, deal.id)
      assert.ok(initial.facility)
      await f.command(
        admin,
        "requestFacility",
        envelope(
          {
            dealId: deal.id,
            reason: "Verify a valid zero payout after amending the request",
            terms: {
              ...baseTerms,
              deductions: [
                {
                  label: "Settlement",
                  amount: deal.approvedLoan,
                  handling: "WITHHELD",
                  recipient: "Lender",
                },
                {
                  label: "Waived charge",
                  amount: "0",
                  handling: "PAID_BY_DEALERSHIP",
                  recipient: "Lender",
                },
              ],
            },
          },
          [ref(initial, "BrokerageDeal"), ref(initial.facility, "CashFacility")]
        )
      )
      const requested = await dealOf(admin, deal.id)
      assert.ok(requested.facility)
      await f.command(
        admin,
        "disburseFacility",
        envelope(
          {
            dealId: deal.id,
            payment: null,
            separatelyPaidDeductions: [],
          },
          [
            ref(requested, "BrokerageDeal"),
            ref(requested.facility, "CashFacility"),
          ]
        )
      )
      const settled = await dealOf(admin, deal.id)
      assert.equal((settled.facility as { state?: string }).state, "RECOVERED")
      assert.deepEqual(settled.facility?.payments, [])
    }
  )

  await group(
    "referral rejection is retained, hidden by default and direct next step fails",
    async () => {
      const contact = contactId(
        await contacts(admin, referralCompany.result.id)
      )
      const deal = await dealOf(admin, referralDealId)
      await f.command(
        admin,
        "rejectDeal",
        envelope(
          {
            dealId: referralDealId,
            contactId: contact,
            at: new Date().toISOString(),
            reason: "Company declined after referral",
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(referralCompany.result, "FinanceCompany"),
          ]
        )
      )
      const after = await dealOf(admin, referralDealId)
      assert.equal(after.state, "REJECTED")
      const defaults = await listDeals(admin)
      assert.ok(!defaults.data.some((row) => row.id === referralDealId))
      const all = await listDeals(admin, "&includeRejected=true")
      assert.ok(all.data.some((row) => row.id === referralDealId))
      const filtered = await listDeals(admin, "&status=REJECTED")
      assert.ok(filtered.data.some((row) => row.id === referralDealId))
      const response = await admin.post("/api/v1/commands/referDeal", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            dealId: referralDealId,
            contactId: contact,
            referredAt: new Date().toISOString(),
            sentContact: { name: "x", phone: "0112345678" },
            feedback: "x",
          },
          [
            ref(after, "BrokerageDeal"),
            ref(referralCompany.result, "FinanceCompany"),
          ]
        ),
      })
      assert.equal(response.status(), 409)
    }
  )

  // ── Cash facility ─────────────────────────────────────────────────────────
  let facilityDealId = ""
  let facilityId = ""
  await group(
    "facility request produces no cash; disbursement follows common eligibility",
    async () => {
      const quote = await select(
        admin,
        applicationSheet.result,
        applicationCompany.result,
        `App${suffix}`,
        "10000000",
        "900000"
      )
      const created = await f.command(
        admin,
        "openBrokerage",
        envelope(
          {
            customerId: applicationCustomer.result.id,
            guarantors,
            quoteId: quote.result.id,
          },
          [
            {
              type: "Customer",
              id: applicationCustomer.result.id,
              revision: 1,
            },
            { type: "Quote", id: quote.result.id, revision: 1 },
            ref(applicationCompany.result, "FinanceCompany"),
            ref(await settings(), "Settings"),
          ]
        ),
        201
      )
      facilityDealId = created.result.id
      const contact = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      let deal = await dealOf(admin, facilityDealId)
      for (const target of ["CUSTOMER", "GUARANTOR", "GUARANTOR"] as const) {
        deal = await dealOf(admin, facilityDealId)
        await f.command(
          admin,
          "recordEligibility",
          envelope(
            {
              dealId: facilityDealId,
              target,
              ...(target === "GUARANTOR"
                ? {
                    guarantorId: (deal.guarantors ?? [])[
                      deal.eligibility?.length === 1 ? 1 : 0
                    ]?.id,
                  }
                : {}),
              outcome: "CONFIRMED",
              contactId: contact,
              checkedAt: new Date().toISOString(),
              feedback: `${target} confirmed`,
            },
            [
              ref(deal, "BrokerageDeal"),
              ref(applicationCompany.result, "FinanceCompany"),
            ]
          )
        )
      }
      deal = await dealOf(admin, facilityDealId)
      const cashBefore = await f.db.query(
        'SELECT count(*) FROM vamotors."FacilityPayment"'
      )
      const requested = await f.command(
        admin,
        "requestFacility",
        envelope(
          {
            dealId: facilityDealId,
            terms: {
              gross: "10000000",
              deductions: [
                {
                  label: "Withheld fee",
                  amount: "1000000",
                  recipient: "Company",
                  handling: "WITHHELD",
                },
                {
                  label: "Dealer paid",
                  amount: "500000",
                  recipient: "Agent",
                  handling: "PAID_BY_DEALERSHIP",
                },
              ],
              fee: "200000",
              feeMode: "WITHHELD",
              separatelyRecoverableCharges: "500000",
            },
            reason: "Requested facility terms",
          },
          [ref(deal, "BrokerageDeal")]
        )
      )
      assert.equal(requested.result.type, "BrokerageDeal")
      const facility = await f.db.query(
        'SELECT * FROM vamotors."CashFacility" WHERE "dealId"=$1',
        [facilityDealId]
      )
      assert.equal(facility.rows.length, 1)
      facilityId = facility.rows[0].id
      assert.equal(facility.rows[0].net, "8800000")
      assert.equal(facility.rows[0].state, "REQUESTED")
      assert.equal(
        (await f.db.query('SELECT count(*) FROM vamotors."FacilityPayment"'))
          .rows[0].count,
        cashBefore.rows[0].count
      )
      deal = await dealOf(admin, facilityDealId)
      const disbursed = await f.command(
        admin,
        "disburseFacility",
        envelope(
          {
            dealId: facilityDealId,
            payment: {
              amount: "8800000",
              date: new Date().toISOString().slice(0, 10),
              method: "BANK_TRANSFER",
              reference: "PAYOUT-1",
            },
            separatelyPaidDeductions: [
              {
                index: 1,
                payment: {
                  amount: "500000",
                  date: new Date().toISOString().slice(0, 10),
                  method: "CASH",
                  reference: "AGENT-1",
                },
              },
            ],
          },
          [
            ref(deal, "BrokerageDeal"),
            { type: "CashFacility", id: facilityId, revision: 1 },
          ]
        )
      )
      assert.equal(disbursed.result.type, "BrokerageDeal")
      const payments = await f.db.query(
        'SELECT direction, component, amount FROM vamotors."FacilityPayment" WHERE "facilityId"=$1 ORDER BY component',
        [facilityId]
      )
      assert.deepEqual(
        payments.rows.map((row) => [row.direction, row.component, row.amount]),
        [
          ["OUT", "DEDUCTION", "500000"],
          ["OUT", "PAYOUT", "8800000"],
        ]
      )
      assert.equal(
        (
          await f.db.query(
            'SELECT state FROM vamotors."CashFacility" WHERE id=$1',
            [facilityId]
          )
        ).rows[0].state,
        "DISBURSED"
      )
      const vendor = await f.query<BrokerageDTO>(
        admin,
        "brokerageDeal",
        `?id=${facilityDealId}`
      )
      assert.equal(vendor.facility?.net, "8800000")
      assert.equal(vendor.facility?.principalOutstanding, "8800000")
    }
  )

  await group(
    "partial then full recovery, over-recovery rejected 422, rejection preserves debt",
    async () => {
      let deal = await dealOf(admin, facilityDealId)
      const contact = contactId(
        await contacts(admin, applicationCompany.result.id)
      )
      const facilityRevision = () =>
        f.db
          .query('SELECT revision FROM vamotors."CashFacility" WHERE id=$1', [
            facilityId,
          ])
          .then((r) => Number(r.rows[0].revision))
      const recover = (input: Record<string, unknown>, revision: number) =>
        f.command(
          admin,
          "recoverFacility",
          envelope(
            {
              dealId: facilityDealId,
              principal: null,
              chargeRecovery: null,
              fee: null,
              ...input,
            },
            [
              ref(deal, "BrokerageDeal"),
              { type: "CashFacility", id: facilityId, revision },
            ]
          )
        )
      await recover(
        {
          principal: {
            amount: "4000000",
            date: new Date().toISOString().slice(0, 10),
            method: "BANK_TRANSFER",
            reference: "REC-1",
          },
        },
        await facilityRevision()
      )
      deal = await dealOf(admin, facilityDealId)
      assert.equal(
        (deal.facility as unknown as { state?: string }).state,
        "PARTIAL"
      )
      assert.equal(deal.facility?.principalOutstanding, "4800000")
      const over = await admin.post("/api/v1/commands/recoverFacility", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            dealId: facilityDealId,
            principal: {
              amount: "4800001",
              date: new Date().toISOString().slice(0, 10),
              method: "BANK_TRANSFER",
            },
            chargeRecovery: null,
            fee: null,
          },
          [
            ref(deal, "BrokerageDeal"),
            {
              type: "CashFacility",
              id: facilityId,
              revision: await facilityRevision(),
            },
          ]
        ),
      })
      assert.equal(over.status(), 422)
      assert.equal((await over.json()).error?.code, "BALANCE_MISMATCH")
      // Reject while debt remains, then recover after rejection.
      const rejected = await f.command(
        admin,
        "rejectDeal",
        envelope(
          {
            dealId: facilityDealId,
            contactId: contact,
            at: new Date().toISOString(),
            reason: "Company rejected while facility debt remains",
          },
          [
            ref(deal, "BrokerageDeal"),
            ref(applicationCompany.result, "FinanceCompany"),
          ]
        )
      )
      assert.equal(rejected.result.type, "BrokerageDeal")
      const rejectedDeal = await dealOf(admin, facilityDealId)
      assert.equal(rejectedDeal.state, "REJECTED")
      assert.equal(rejectedDeal.facility?.principalOutstanding, "4800000")
      deal = rejectedDeal
      await recover(
        {
          principal: {
            amount: "4800000",
            date: new Date().toISOString().slice(0, 10),
            method: "BANK_TRANSFER",
            reference: "REC-2",
          },
          chargeRecovery: {
            amount: "500000",
            date: new Date().toISOString().slice(0, 10),
            method: "CASH",
            reference: "REC-C",
          },
        },
        await facilityRevision()
      )
      const recovered = await dealOf(admin, facilityDealId)
      assert.equal(
        (recovered.facility as unknown as { state?: string }).state,
        "RECOVERED"
      )
      assert.equal(recovered.facility?.principalOutstanding, "0")
    }
  )

  // ── Security, files, replay, redaction ───────────────────────────────────
  await group(
    "private file download authorization and restart retention",
    async () => {
      const attachmentId = (
        await f.db.query(
          'SELECT id FROM vamotors."Attachment" WHERE "brokerageDealId"=$1 AND purpose=$2 LIMIT 1',
          [applicationDealId, "INSPECTION"]
        )
      ).rows[0].id as string
      const download = await f.query<{ url: string; sha256: string }>(
        admin,
        "download",
        `?attachmentId=${attachmentId}`
      )
      const bytes = await admin.get(download.url)
      assert.equal(bytes.status(), 200)
      assert.equal(bytes.headers()["cache-control"], "private,no-store")
      const staffResponse = await staff.get(
        `/api/v1/queries/download?attachmentId=${attachmentId}`
      )
      assert.equal(staffResponse.status(), 404)
      await f.restart()
      const after = await second.get(
        `/api/v1/queries/download?attachmentId=${attachmentId}`
      )
      assert.equal(after.status(), 200)
      const url = (await after.json()).data.url
      assert.equal((await second.get(url)).status(), 200)
    }
  )

  await group(
    "field-level CASL redaction and replay authority before mismatch",
    async () => {
      const readerPassword = `Pw-${randomUUID()}-Reader1`
      const role = await f.command(
        admin,
        "saveRole",
        envelope(
          {
            name: `Brokerage reader ${suffix}`,
            grants: [
              {
                action: "read",
                subject: "BrokerageDeal",
                fields: [
                  "id",
                  "revision",
                  "state",
                  "path",
                  "customerId",
                  "companyId",
                ],
              },
            ],
            reason: "Least-privilege brokerage read test",
          },
          []
        ),
        201
      )
      const created = await f.command(
        admin,
        "createUser",
        envelope(
          {
            name: `Brokerage reader ${suffix}`,
            email: `brokerage-reader-${suffix}@example.test`,
            password: readerPassword,
            roleIds: [role.result.id],
          },
          [ref(role.result, "Role")]
        ),
        201
      )
      assert.equal(
        (created as unknown as { password?: string }).password,
        undefined
      )
      const reader = await f.login(
        `brokerage-reader-${suffix}@example.test`,
        readerPassword
      )
      const visible = await dealOf(reader, applicationDealId)
      assert.equal(visible.id, applicationDealId)
      assert.equal(visible.state, "COMPLETED")
      assert.equal(visible.approvedLoan, undefined)
      assert.equal(visible.processingFee, undefined)
      assert.equal(visible.quote, undefined)
      assert.equal(visible.facility, undefined)
      assert.ok(visible.redactedFields?.includes("approvedLoan"))
      const listed = await listDeals(reader)
      assert.ok(listed.data.some((row) => row.id === applicationDealId))

      // Current authority is rechecked before comparing a stored input hash.
      const writerPassword = `Pw-${randomUUID()}-Writer1`
      const writerRole = await f.command(
        admin,
        "saveRole",
        envelope(
          {
            name: `Brokerage writer ${suffix}`,
            grants: [
              { action: "read", subject: "BrokerageDeal", fields: ["*"] },
              { action: "update", subject: "BrokerageDeal", fields: ["*"] },
            ],
            reason: "Replay authority test role",
          },
          []
        ),
        201
      )
      await f.command(
        admin,
        "createUser",
        envelope(
          {
            name: `Brokerage writer ${suffix}`,
            email: `brokerage-writer-${suffix}@example.test`,
            password: writerPassword,
            roleIds: [writerRole.result.id],
          },
          [ref(writerRole.result, "Role")]
        ),
        201
      )
      const writer = await f.login(
        `brokerage-writer-${suffix}@example.test`,
        writerPassword
      )
      const target = await dealOf(writer, incompleteDealId)
      const body = envelope(
        { dealId: incompleteDealId, amount: "300000", reason: "Writer fee" },
        [ref(target, "BrokerageDeal")]
      )
      await f.command(writer, "setProcessingFee", body)
      const current = await dealOf(writer, incompleteDealId)
      const restrictedRole = await f.command(
        admin,
        "saveRole",
        envelope(
          {
            id: writerRole.result.id,
            name: `Brokerage writer ${suffix}`,
            grants: [
              { action: "read", subject: "BrokerageDeal", fields: ["*"] },
              {
                action: "update",
                subject: "BrokerageDeal",
                fields: ["dealId"],
              },
            ],
            reason: "Limit the role to the deal identifier",
          },
          [ref(writerRole.result, "Role")]
        )
      )
      await f.command(
        writer,
        "openIssue",
        envelope(
          {
            dealId: current.id,
            kind: "DELAY_INQUIRY",
            text: "An unauthorized field change",
            at: new Date().toISOString(),
          },
          [ref(current, "BrokerageDeal")]
        ),
        403,
        "FIELD_FORBIDDEN"
      )
      const revoked = await f.command(
        admin,
        "saveRole",
        envelope(
          {
            id: writerRole.result.id,
            name: `Brokerage writer ${suffix}`,
            grants: [],
            reason: "Revoke brokerage authority before replay",
          },
          [ref(restrictedRole.result, "Role")]
        )
      )
      assert.equal(revoked.result.type, "Role")
      const replayAfterRevocation = await writer.post(
        "/api/v1/commands/setProcessingFee",
        { headers: { Origin: f.origin }, data: body }
      )
      assert.equal(replayAfterRevocation.status(), 404)
      assert.equal(
        (await replayAfterRevocation.json()).error?.code,
        "NOT_FOUND"
      )
    }
  )

  await group(
    "replay same key, mismatch different input, commandStatus receipt",
    async () => {
      const deal = await dealOf(admin, applicationDealId)
      const key = randomUUID()
      const body = envelope(
        {
          dealId: applicationDealId,
          amount: "0",
          reason: "No-op fee override",
        },
        [ref(deal, "BrokerageDeal")]
      )
      body.idempotencyKey = key
      // On a COMPLETED deal this must fail; use the still-INTAKE incomplete deal.
      const target = await dealOf(admin, incompleteDealId)
      const base = envelope(
        { dealId: incompleteDealId, amount: "250000", reason: "Same-key fee" },
        [ref(target, "BrokerageDeal")]
      )
      const first = await f.command(admin, "setProcessingFee", base)
      const replay = await f.command(admin, "setProcessingFee", base)
      assert.equal(replay.replayed, true)
      assert.equal(replay.commandId, first.commandId)
      const mismatch = await admin.post("/api/v1/commands/setProcessingFee", {
        headers: { Origin: f.origin },
        data: {
          ...base,
          input: { ...(base.input as Record<string, unknown>), amount: "1" },
        },
      })
      assert.equal(mismatch.status(), 409)
      assert.equal((await mismatch.json()).error?.code, "IDEMPOTENCY_MISMATCH")
      const status = await f.query<{ status: string; result?: { id: string } }>(
        admin,
        "commandStatus",
        `?name=setProcessingFee&idempotencyKey=${base.idempotencyKey}`
      )
      assert.equal(status.status, "APPLIED")
      assert.equal(status.result?.id, incompleteDealId)
    }
  )

  await group("audit exposes persisted deal and facility history", async () => {
    const audit = await f.query<{ data: { fields: unknown[] }[] }>(
      admin,
      "audit",
      `?type=BrokerageDeal&id=${applicationDealId}&page=1&pageSize=100`
    )
    assert.ok(audit.data.length > 0)
    const facilityAudit = await f.query<{ data: unknown[] }>(
      admin,
      "audit",
      `?type=CashFacility&id=${facilityId}&page=1&pageSize=100`
    )
    assert.ok(facilityAudit.data.length > 0)
  })

  await group(
    "finance company brokerage contribution is READY with scoped links",
    async () => {
      const party = await f.query<
        PartyDTO & { contributions?: Record<string, unknown> }
      >(
        admin,
        "party",
        `?type=FINANCE_COMPANY&id=${applicationCompany.result.id}`
      )
      const brokerage = party.contributions?.brokerage as
        | { state: string; links: { id: string }[] }
        | undefined
      assert.equal(brokerage?.state, "READY")
      assert.ok(brokerage?.links.some((link) => link.id === applicationDealId))
    }
  )

  await group(
    "real lease pages render and detail preflight hides absent ids",
    async () => {
      const listPage = await admin.get("/lease-deals")
      assert.equal(listPage.status(), 200)
      assert.match(listPage.headers()["cache-control"], /no-store/)
      const detailPage = await admin.get(`/lease-deals/${applicationDealId}`)
      assert.equal(detailPage.status(), 200)
      assert.match(detailPage.headers()["cache-control"], /no-store/)
      const dispatchPage = await admin.get("/lease-dispatch")
      assert.equal(dispatchPage.status(), 200)
      const absent = await admin.get(`/lease-deals/${randomUUID()}`)
      assert.equal(absent.status(), 404)
    }
  )

  await group(
    "sale receipts and facility payments coexist in cash and customer history",
    async () => {
      const supplier = await f.command(
        admin,
        "createDirectoryParty",
        envelope({
          type: "SUPPLIER",
          values: {
            name: `Combined supplier ${suffix}`,
            category: "COMPANY",
            contacts: [],
          },
        }),
        201
      )
      const purchase = await f.command(
        admin,
        "recordPurchase",
        envelope(purchaseInput(supplier.result.id, suffix, "combined", 500), [
          ref(supplier.result, "Supplier"),
        ]),
        201
      )
      const cycleOf = () =>
        f.query<PurchaseCycleDTO>(
          admin,
          "purchase",
          `?cycleId=${purchase.result.id}`
        )
      await f.command(
        admin,
        "receiveStock",
        envelope(
          {
            cycleId: purchase.result.id,
            date: "2026-10-02",
            disposition: { kind: "RELEASE" },
          },
          [ref(await cycleOf(), "PurchaseRecord")]
        )
      )
      const customerOf = () =>
        f.query<CustomerDTO>(
          admin,
          "customer",
          `?id=${applicationCustomer.result.id}`
        )
      const sale = await f.command(
        admin,
        "completeImmediate",
        envelope(
          {
            cycleId: purchase.result.id,
            customerId: applicationCustomer.result.id,
            kind: "CASH",
            price: "15000",
            date: "2026-10-03",
            mileage: 520,
            method: "CASH",
          },
          [
            ref(await cycleOf(), "PurchaseRecord"),
            ref(await customerOf(), "Customer"),
          ]
        ),
        201
      )

      const movements = await f.restricted.query(
        `SELECT "sourceType", direction, amount FROM vamotors."CashMovement"
       WHERE ("sourceType" = 'SALE' AND "sourceId" = $1)
          OR ("sourceType" = 'FACILITY' AND "sourceId" = $2)`,
        [sale.result.id, facilityId]
      )
      assert.ok(
        movements.rows.some(
          (row) =>
            row.sourceType === "SALE" &&
            row.direction === "IN" &&
            row.amount === "15000"
        )
      )
      assert.ok(
        movements.rows.some(
          (row) =>
            row.sourceType === "FACILITY" &&
            row.direction === "OUT" &&
            row.amount === "8800000"
        )
      )
      const linked = await customerOf()
      assert.ok(
        linked.links?.some(
          (link) => link.type === "SALE" && link.id === sale.result.id
        )
      )
      assert.ok(
        linked.links?.some(
          (link) => link.type === "BROKERAGE" && link.id === applicationDealId
        )
      )
    }
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  if (error instanceof Error && error.stack) console.error(error.stack)
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `brokerage-${suffix}-summary.json`),
    JSON.stringify({ stage, groups, source: process.cwd() }, null, 2),
    { mode: 0o600 }
  ).catch(() => undefined)
  await f.close().catch(() => undefined)
}
