// Run only with a dedicated local cluster and test app. This check injects a temporary constraint.
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { chromium, expect } from "@playwright/test"
import { authorizedMigration, privateEnvironment } from "./private-environment"
import { importTemplateColumns } from "../lib/server/import-parsers"
import { buildXlsx } from "../lib/server/import-template"
import { historicalCommitmentRows } from "../tests/fixtures/historical-commitments"
import type { ImportType } from "../.planning/implementation/contracts/api"

const origin = process.argv[2]!
assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/)
assert.notEqual(new URL(origin).port, "8000")
const accounts = await privateEnvironment(process.argv[3]!)
const migration = authorizedMigration(
  await privateEnvironment(join(dirname(process.argv[3]!), "migration.env"))
)
const suffix = randomUUID().slice(0, 8)
const types = [
  "SUPPLIERS",
  "CUSTOMERS",
  "REPAIR_VENDORS",
  "VEHICLES",
  "REPAIRS",
  "SALES",
] as const
const namespace = `integration-${suffix}`
function csv(type: ImportType, ...rows: Record<string, string>[]) {
  const columns = importTemplateColumns(type)
  const encode = (data: string[]) =>
    data.map((s) => `"${s.replace(/"/g, '""')}"`).join(",")
  return Buffer.from(
    [
      encode(columns.map((c) => c.name)),
      ...rows.map((row) =>
        encode(columns.map((col) => row[col.name] ?? col.example))
      ),
      "",
    ].join("\n")
  )
}
async function login(prefix: string) {
  const response = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: accounts[`BOOTSTRAP_${prefix}_EMAIL`],
      password: accounts[`BOOTSTRAP_${prefix}_PASSWORD`],
    }),
  })
  assert.equal(response.status, 200)
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
}
const cookie = await login("ADMIN")
const staff = await login("STAFF")
async function command(
  name: string,
  input: unknown,
  expected: unknown[] = [],
  status = 200,
  as = cookie,
  idempotencyKey = randomUUID()
) {
  const response = await fetch(`${origin}/api/v1/commands/${name}`, {
    method: "POST",
    headers: { origin, cookie: as, "Content-Type": "application/json" },
    body: JSON.stringify({ schemaVersion: 1, idempotencyKey, expected, input }),
  })
  const body = await response.json()
  assert.equal(response.status, status, JSON.stringify(body))
  return body
}
async function query(name: string, params: Record<string, string>) {
  const response = await fetch(
    `${origin}/api/v1/queries/${name}?${new URLSearchParams(params)}`,
    { headers: { cookie } }
  )
  assert.equal(response.status, 200)
  return (await response.json()).data
}
const fixture = {
  SUPPLIERS: csv("SUPPLIERS", {
    name: `Historical supplier ${suffix}`,
    nicOrRegNumber: suffix,
  }),
  CUSTOMERS: csv("CUSTOMERS", { nicOrPassport: `P${suffix}` }),
  REPAIR_VENDORS: buildXlsx([
    {
      name: "REPAIR_VENDORS",
      rows: [
        importTemplateColumns("REPAIR_VENDORS").map((c) => c.name),
        importTemplateColumns("REPAIR_VENDORS").map((c) =>
          c.name === "nicOrRegNumber"
            ? `V${suffix}`
            : c.name === "sourceKey"
              ? "vnd-001"
              : c.name === "isActive"
                ? "false"
                : c.example
        ),
      ],
    },
  ]),
  VEHICLES: csv("VEHICLES", {
    engineNumber: `ENG-${suffix}`,
    chassisNumber: `CHS-${suffix}`,
    status: "SOLD",
    available: "false",
    closedAt: "2026-01-20T12:00:00.000Z",
  }),
  REPAIRS: csv("REPAIRS", { legacyOriginalId: suffix }),
  SALES: csv("SALES", {
    legacyOriginalId: suffix,
    completionBasisRepairs: '[{"sourceKey":"rep-001","amount":"45000.00"}]',
  }),
}
const batch = (await command("stageImport", { types, namespace }, [], 201))
  .result
const refs = [batch]
async function upload(
  type: ImportType,
  bytes: Buffer,
  label = type.toLowerCase(),
  target = batch
) {
  const xlsx = type === "REPAIR_VENDORS"
  const contentType = xlsx
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv"
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  const ready = await command(
    "initUpload",
    {
      target: { type: "IMPORT_BATCH", id: target.id },
      purpose: "IMPORT_SOURCE",
      filename: `${label}.${xlsx ? "xlsx" : "csv"}`,
      contentType,
      sha256,
      size: bytes.length,
    },
    [target],
    201
  )
  const response = await fetch(`${origin}${ready.putUrl}`, {
    method: "PUT",
    headers: { origin, cookie, ...ready.requiredHeaders },
    body: new Uint8Array(bytes),
  })
  assert.ok(response.ok, `PUT ${response.status}`)
  const result = await command("completeUpload", { uploadId: ready.uploadId }, [
    target,
    { type: "UploadIntent", id: ready.uploadId, revision: ready.revision },
  ])
  target.revision = result.affected.find(
    (ref: { type: string }) => ref.type === "ImportBatch"
  ).revision
  return { type, attachmentId: result.result.id }
}
const sources = []
for (const type of types)
  sources.push(
    await upload(
      type,
      type === "CUSTOMERS" ? csv(type, { phone: "bad" }) : fixture[type]
    )
  )
const previewInput = {
  batchId: batch.id,
  namespace,
  sources,
  templateVersion: 1,
}
await command("previewImport", previewInput, refs, 404, staff)
const invalid = await command("previewImport", previewInput, refs)
assert.equal(invalid.valid, false)
assert.ok(
  invalid.errors.some(
    (e: { rowNumber: number; field: string }) =>
      e.rowNumber === 2 && e.field === "phone"
  )
)
sources[1] = await upload("CUSTOMERS", fixture.CUSTOMERS, "fixed-customers")
const preview = await command("previewImport", previewInput, refs)
assert.equal(preview.valid, true, JSON.stringify(preview.errors))
assert.equal(preview.controlTotals.purchase, "500000000")
assert.equal(preview.controlTotals.cost, "7000000")
assert.equal(preview.controlTotals.cashOut, "507000000")
assert.equal(preview.controlTotals.cashIn, "580000000")
batch.revision = preview.revision
const confirmation = {
  batchId: batch.id,
  previewHash: preview.previewHash,
  controlTotals: preview.controlTotals,
}
const key = randomUUID()
const sql = new pg.Client({ connectionString: migration })
await sql.connect()
try {
  const counts = () =>
    sql.query(`SELECT
    (SELECT count(*) FROM vamotors."Customer") AS customers,
    (SELECT count(*) FROM vamotors."PurchaseRecord") AS cycles,
    (SELECT count(*) FROM vamotors."CashMovement") AS movements,
    (SELECT count(*) FROM vamotors."ImportSourceRow") AS provenance,
    (SELECT value FROM vamotors."BusinessSequence" WHERE id=1) AS sequence`)
  const before = (await counts()).rows[0]
  // Fail the final sale command after the earlier domain commands have run.
  await sql.query(`ALTER TABLE vamotors."SaleCase"
    ADD CONSTRAINT t16_check_rollback CHECK (reference <> 'INV-HIST-001') NOT VALID`)
  try {
    const failed = await command("confirmImport", confirmation, refs, 422)
    assert.equal(failed.error.code, "IMPORT_CONSTRAINT")
    assert.match(failed.error.message, /SALES/)
    assert.deepEqual((await counts()).rows[0], before)
    assert.equal(
      (await query("importBatchFiles", { id: batch.id })).state,
      "VALIDATED"
    )
    console.log(
      "PASS late sale failure rolled back earlier records, cash, sequence, and provenance"
    )
  } finally {
    await sql.query(
      'ALTER TABLE vamotors."SaleCase" DROP CONSTRAINT t16_check_rollback'
    )
  }
} finally {
  await sql.end()
}
const start = performance.now()
const applied = await command(
  "confirmImport",
  confirmation,
  refs,
  200,
  cookie,
  key
)
assert.equal(applied.status, "APPLIED")
console.log(`Commit finished in ${Math.round(performance.now() - start)} ms.`)
assert.equal(
  (await command("confirmImport", confirmation, refs, 200, cookie, key))
    .replayed,
  true
)
assert.equal(
  (await command("confirmImport", confirmation, refs, 409)).error.code,
  "IMPORT_DUPLICATE"
)
const committed = await query("importBatchFiles", { id: batch.id })
assert.equal(committed.state, "COMMITTED")
assert.equal(committed.importedRecords.length, types.length)
const archivedVendor = committed.importedRecords.find(
  (record: { type: string }) => record.type === "RepairVendor"
)
assert.equal(
  (
    await query("party", {
      type: "REPAIR_VENDOR",
      id: new URL(archivedVendor.href, origin).pathname.split("/").at(-1)!,
    })
  ).active,
  false
)
const purchase = committed.importedRecords.find(
  (record: { type: string }) => record.type === "PurchaseRecord"
)
const actual = await query("purchase", {
  cycleId: purchase.href.split("/").at(-1),
})
assert.equal(actual.financial.basis, "507000000")
assert.equal(actual.financial.net, "73000000")
assert.equal(actual.provenance.imported, true)
console.log(
  "PASS six-type HTTP historical graph, CSV/XLSX, permissions, replacement, money, replay and provenance"
)

const duplicateBatch = (
  await command(
    "stageImport",
    {
      namespace: `duplicates-${suffix}`,
      types: ["SUPPLIERS"],
    },
    [],
    201
  )
).result
for (const [bytes, field] of [
  [fixture.SUPPLIERS, "file"],
  [
    csv("SUPPLIERS", {
      name: `Historical supplier ${suffix}`,
      nicOrRegNumber: suffix,
      sourceKey: "different-key",
    }),
    "nicOrRegNumber",
  ],
] as const) {
  const source = await upload(
    "SUPPLIERS",
    bytes,
    `duplicate-${field}`,
    duplicateBatch
  )
  const rejected = await command(
    "previewImport",
    {
      batchId: duplicateBatch.id,
      namespace: `duplicates-${suffix}`,
      sources: [source],
      templateVersion: 1,
    },
    [duplicateBatch]
  )
  assert.equal(rejected.valid, false)
  assert.ok(
    rejected.errors.some(
      (error: { field: string; code: string }) =>
        error.field === field && error.code === "IMPORT_DUPLICATE"
    )
  )
}

async function oneFile(type: ImportType, bytes: Buffer) {
  const namespace = `${type.toLowerCase()}-${suffix}`
  const target = (
    await command("stageImport", { namespace, types: [type] }, [], 201)
  ).result
  const source = await upload(type, bytes, type.toLowerCase(), target)
  const preview = await command(
    "previewImport",
    {
      batchId: target.id,
      namespace,
      sources: [source],
      templateVersion: 1,
    },
    [target]
  )
  assert.equal(preview.valid, true, JSON.stringify(preview.errors))
  target.revision = preview.revision
  await command(
    "confirmImport",
    {
      batchId: target.id,
      previewHash: preview.previewHash,
      controlTotals: preview.controlTotals,
    },
    [target]
  )
  const { importedRecords } = await query("importBatchFiles", { id: target.id })
  assert.equal(importedRecords.length, 1)
  return importedRecords[0]
}
const finance = await oneFile(
  "FINANCE_COMPANIES",
  csv("FINANCE_COMPANIES", {
    name: `Import Finance ${suffix}`,
    financePolicy:
      '{"path":"REFERRAL","commission":{"basis":"FIXED","fixed":"10000","rateBps":0},"processingFee":"0","reconciliationMethod":"PERIOD_NOTICE"}',
  })
)
const financeId = new URL(finance.href, origin).pathname.split("/").at(-1)!
const financeRef = { type: "FinanceCompany", id: financeId, revision: 1 }
const settings = await query("settings", {})
const model = `Historic ${suffix}`
const sheet = (
  await command(
    "publishRates",
    {
      companyId: financeId,
      make: "Synthetic",
      model,
      year: 2024,
      validFrom: "2020-01-01",
      validThrough: "2029-12-31",
      maximum: "1200000",
      cards: [{ principal: "1000000", months: 12, installment: "90000" }],
    },
    [financeRef],
    201
  )
).result
const quoteDb = new pg.Client({ connectionString: migration })
await quoteDb.connect()
let cardId: string
try {
  cardId = (
    await quoteDb.query(
      'SELECT id FROM vamotors."RateCardEntry" WHERE "sheetVersionId"=$1',
      [sheet.id]
    )
  ).rows[0].id
} finally {
  await quoteDb.end()
}
const quote = (
  await command(
    "selectQuote",
    {
      sheetId: sheet.id,
      cardId,
      vehicle: {
        make: "Synthetic",
        model,
        year: 2024,
        description: "Historical external vehicle",
      },
      charges: [],
    },
    [
      sheet,
      financeRef,
      { type: "Settings", id: settings.id, revision: settings.revision },
    ],
    201
  )
).result
const customerRecord = committed.importedRecords.find(
  (record: { type: string }) => record.type === "Customer"
)
const financeParty = await query("party", {
  type: "FINANCE_COMPANY",
  id: financeId,
})
const contactId = financeParty.contacts[0].id
const checkedAt = "2026-01-15T09:00:00.000Z"
const history = [
  {
    command: "recordEligibility",
    input: {
      target: "CUSTOMER",
      outcome: "CONFIRMED",
      contactId,
      checkedAt,
      feedback: "Historical confirmation",
    },
  },
  {
    command: "recordEligibility",
    input: {
      target: "GUARANTOR",
      guarantorIdentity: "812345678V",
      outcome: "CONFIRMED",
      contactId,
      checkedAt,
      feedback: "Historical confirmation",
    },
  },
  {
    command: "referDeal",
    input: {
      contactId,
      referredAt: "2026-01-16T09:00:00.000Z",
      sentContact: { name: "Synthetic Buyer", phone: "0771234567" },
      feedback: "Historical referral",
    },
  },
  {
    command: "completeBrokerage",
    input: {
      contactId,
      at: "2026-01-17T09:00:00.000Z",
      feedback: "Historical completion",
    },
  },
]
const brokerage = await oneFile(
  "BROKERAGE",
  csv("BROKERAGE", {
    customerSourceKey: "",
    customerExistingId: customerRecord.href.split("/").at(-1),
    quoteId: quote.id,
    history: JSON.stringify(history),
  })
)
const importedDeal = await query("brokerageDeal", {
  id: brokerage.href.split("/").at(-1),
})
assert.equal(importedDeal.provenance.imported, true)
assert.equal(importedDeal.state, "COMPLETED")
console.log("PASS finance-company and quote-backed brokerage intake imports")

const tradeNamespace = `trade-in-${suffix}`
const trade = (
  await command(
    "stageImport",
    {
      namespace: tradeNamespace,
      types: ["VEHICLES", "SALES"],
    },
    [],
    201
  )
).result
const supplierRecord = committed.importedRecords.find(
  (record: { type: string }) => record.type === "Supplier"
)
const recordId = (href: string) =>
  new URL(href, origin).pathname.split("/").at(-1)!
const vehicleSource = await upload(
  "VEHICLES",
  csv(
    "VEHICLES",
    {
      engineNumber: `SOLD-${suffix}`,
      chassisNumber: `SOLD-CH-${suffix}`,
      status: "SOLD",
      available: "false",
      closedAt: "2026-01-20T12:00:00.000Z",
      supplierSourceKey: "",
      supplierExistingId: recordId(supplierRecord.href),
      additionalCosts: "[]",
    },
    {
      sourceKey: "incoming",
      cycleSourceKey: "incoming-cycle",
      engineNumber: `INCOMING-${suffix}`,
      chassisNumber: `INCOMING-CH-${suffix}`,
      supplierSourceKey: "",
      sellerCustomerExistingId: recordId(customerRecord.href),
      tradeInSaleSourceKey: "case-001",
      purchaseDate: "2026-01-20",
      purchasePrice: "1000000.00",
      listedPrice: "",
      receivedDate: "2026-01-20",
      mileage: '[{"reading":60000,"date":"2026-01-20"}]',
      payments: "[]",
      additionalCosts: "[]",
      notes: "",
    }
  ),
  "trade-vehicles",
  trade
)
const tradeSource = await upload(
  "SALES",
  csv("SALES", {
    kind: "TRADE_IN",
    reference: `TRADE-${suffix}`,
    customerSourceKey: "",
    customerExistingId: recordId(customerRecord.href),
    tradeInDescription: "Synthetic trade-in vehicle",
    tradeInValue: "1000000.00",
    tradeInAcquiredCycleSourceKey: "incoming-cycle",
    completionBasisCosts: "[]",
    payments:
      '[{"sourceKey":"trade-residual","amount":"4800000.00","date":"2026-01-20","method":"BANK_TRANSFER","direction":"IN","category":"SALE"}]',
  }),
  "trade-sale",
  trade
)
const tradePreview = await command(
  "previewImport",
  {
    batchId: trade.id,
    namespace: tradeNamespace,
    sources: [vehicleSource, tradeSource],
    templateVersion: 1,
  },
  [trade]
)
assert.equal(tradePreview.valid, true, JSON.stringify(tradePreview.errors))
assert.equal(tradePreview.controlTotals.cashOut, "500000000")
assert.equal(tradePreview.controlTotals.cashIn, "480000000")
trade.revision = tradePreview.revision
await command(
  "confirmImport",
  {
    batchId: trade.id,
    previewHash: tradePreview.previewHash,
    controlTotals: tradePreview.controlTotals,
  },
  [trade]
)
const tradeBatch = await query("importBatchFiles", { id: trade.id })
const intake = tradeBatch.importedRecords.find(
  (record: { sourceKey: string }) => record.sourceKey === "incoming"
)
const intakePurchase = await query("purchase", {
  cycleId: recordId(intake.href),
})
assert.equal(intakePurchase.acquisitionKind, "TRADE_IN")
assert.equal(intakePurchase.financial.cashOut, "0")
assert.equal(intakePurchase.financial.basis, "100000000")
console.log(
  "PASS immediate trade-in sale, linked intake, and noncash consideration"
)

const report = await fetch(
  `${origin}/api/reports/sales?from=2026-01-20&through=2026-01-20`,
  { headers: { cookie } }
)
assert.equal(report.status, 200)
const reportRows = (await report.json()).data.data as {
  saleId: string
  financial: { basis: string; restatedProfit: string }
}[]
const reviewer = await login("SECOND")
const ref = (type: string, row: { id: string; revision: number }) => ({
  type,
  id: row.id,
  revision: row.revision,
})
for (const [records, basis, profit] of [
  [committed.importedRecords, "507000000", "73000000"],
  [tradeBatch.importedRecords, "500000000", "80000000"],
] as const) {
  const imported = records.find(
    (record: { type: string }) => record.type === "SaleCase"
  )
  const sale = await query("sale", { id: recordId(imported.href) })
  assert.equal(sale.provenance.imported, true)
  const invoice = sale.invoices[0]
  assert.equal(invoice.state, "PENDING")
  const cycle = await query("purchase", { cycleId: sale.cycleId })
  const issued = await command(
    "issueInvoice",
    {
      saleId: sale.id,
      saleRevision: sale.revision,
      regenerate: false,
    },
    [
      { type: "SaleCase", id: sale.id, revision: sale.revision },
      { type: "PurchaseRecord", id: cycle.id, revision: cycle.revision },
      { type: "InvoiceVersion", id: invoice.id, revision: invoice.revision },
    ]
  )
  assert.equal(issued.status, "APPLIED")
  const updated = await query("sale", { id: sale.id })
  const ready = updated.invoices.find(
    (version: { id: string }) => version.id === issued.result.id
  )
  assert.equal(ready?.state, "READY")
  assert.equal(ready.saleRevision, sale.revision)
  const pdf = await fetch(
    `${origin}/api/v1/sales/${sale.id}/invoices/${ready.version}`,
    { headers: { cookie } }
  )
  assert.equal(pdf.status, 200)
  assert.equal(pdf.headers.get("content-type"), "application/pdf")
  const firstPdf = Buffer.from(await pdf.arrayBuffer())
  assert.ok(firstPdf.subarray(0, 5).equals(Buffer.from("%PDF-")))
  const reported = reportRows.find((row) => row.saleId === sale.id)
  assert.equal(reported?.financial.basis, basis)
  assert.equal(reported?.financial.restatedProfit, profit)

  const reference = `HISTORICAL-CORRECTION-${suffix}`
  const reason = "Correct the imported sale reference"
  const deps = [ref("SaleCase", sale), ref("PurchaseRecord", cycle)]
  const pending = await command(
    "requestApproval",
    {
      reason,
      proposal: {
        kind: "SALE_EDIT",
        operation: "EDIT_COMPLETION",
        input: {
          saleId: sale.id,
          reason,
          patch: { reference },
          cashCorrections: [],
        },
      },
    },
    deps,
    202
  )
  const approvals = await query("approvals", { pageSize: "100" })
  const approval = approvals.data.find(
    (row: { id: string }) => row.id === pending.approvalId
  )
  assert.ok(approval)
  await command(
    "reviewApproval",
    { approvalId: approval.id, decision: "APPROVE" },
    [ref("ApprovalRequest", approval), ...approval.expected],
    200,
    reviewer
  )
  const corrected = await query("sale", { id: sale.id })
  const correctedCycle = await query("purchase", { cycleId: sale.cycleId })
  assert.equal(corrected.reference, reference)
  assert.deepEqual(corrected.provenance, sale.provenance)
  const queued = corrected.invoices.find(
    (row: { saleRevision: number }) => row.saleRevision === corrected.revision
  )
  assert.equal(queued?.state, "PENDING")
  await command(
    "issueInvoice",
    {
      saleId: corrected.id,
      saleRevision: corrected.revision,
      regenerate: false,
    },
    [
      ref("SaleCase", corrected),
      ref("PurchaseRecord", correctedCycle),
      ref("InvoiceVersion", queued),
    ]
  )
  const restated = await query("sale", { id: sale.id })
  assert.ok(
    restated.invoices.some(
      (row: { saleRevision: number; state: string }) =>
        row.saleRevision === corrected.revision && row.state === "READY"
    )
  )
  const original = await fetch(
    `${origin}/api/v1/sales/${sale.id}/invoices/${ready.version}`,
    { headers: { cookie } }
  )
  assert.equal(original.status, 200)
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), firstPdf)
}
console.log(
  "PASS imported cash and trade-in sales retain basis, profit, provenance, and original invoices through approved corrections and invoice restatement"
)

const availableRecord = await oneFile(
  "VEHICLES",
  csv("VEHICLES", {
    engineNumber: `AVAILABLE-${suffix}`,
    chassisNumber: `AVAILABLE-CH-${suffix}`,
    supplierSourceKey: "",
    supplierExistingId: recordId(supplierRecord.href),
    additionalCosts: "[]",
  })
)
const available = await query("purchase", {
  cycleId: recordId(availableRecord.href),
})
assert.equal(available.status, "IN_STOCK")
assert.equal(available.available, true)
const customer = await query("customer", { id: recordId(customerRecord.href) })
await command(
  "placeReservation",
  {
    cycleId: available.id,
    customerId: customer.id,
    price: "550000000",
    receipt: {
      amount: "5000000",
      date: new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Colombo",
      }).format(new Date()),
      method: "CASH",
    },
  },
  [
    { type: "PurchaseRecord", id: available.id, revision: available.revision },
    { type: "Customer", id: customer.id, revision: customer.revision },
    { type: "Settings", id: settings.id, revision: settings.revision },
  ]
)
const reserved = await query("purchase", { cycleId: available.id })
assert.equal(reserved.status, "ADVANCE_PLACED")
assert.equal(reserved.available, false)
console.log(
  "PASS an imported available cycle accepts a reservation and becomes unavailable"
)

const commitmentRows = historicalCommitmentRows({
  prefix: `historical-${suffix}`,
  companyId: financeId,
  customerId: recordId(customerRecord.href),
  supplierId: recordId(
    committed.importedRecords
      .find((record: { type: string }) => record.type === "Supplier")
      .href.split("?")[0]
  ),
})
async function commitHistory(
  name: string,
  files: Partial<Record<ImportType, Record<string, string>[]>>,
  cashIn: string,
  cashOut: string,
  namespace = `${name}-${suffix}`
) {
  const types = Object.keys(files) as ImportType[]
  const batch = (await command("stageImport", { namespace, types }, [], 201))
    .result
  const sources = []
  for (const type of types)
    sources.push(
      await upload(type, csv(type, ...files[type]!), type.toLowerCase(), batch)
    )
  const preview = await command(
    "previewImport",
    {
      batchId: batch.id,
      namespace,
      sources,
      templateVersion: 1,
    },
    [batch]
  )
  assert.equal(preview.valid, true, JSON.stringify(preview.errors))
  assert.equal(preview.controlTotals.cashIn, cashIn)
  assert.equal(preview.controlTotals.cashOut, cashOut)
  batch.revision = preview.revision
  const start = performance.now()
  await command(
    "confirmImport",
    {
      batchId: batch.id,
      previewHash: preview.previewHash,
      controlTotals: preview.controlTotals,
    },
    [batch]
  )
  const ms = performance.now() - start
  assert.ok(ms < 10000)
  console.log(`PASS ${name} import in ${Math.round(ms)} ms`)
  return (await query("importBatchFiles", { id: batch.id })).importedRecords
}
async function withBankNotice<Row extends Record<string, string>>(row: Row) {
  const currentFinance = await query("party", {
    type: "FINANCE_COMPANY",
    id: financeId,
  })
  const { result: draft } = await command(
    "stageRemittance",
    {
      companyId: financeId,
      reference: row.reference,
    },
    [ref("FinanceCompany", currentFinance)],
    201
  )
  const notice = await readFile("public/pwa-icon-192.png")
  const ready = await command(
    "initUpload",
    {
      target: { type: "REMITTANCE", id: draft.id },
      purpose: "RECONCILIATION_NOTICE",
      filename: "historical-notice.png",
      contentType: "image/png",
      sha256: createHash("sha256").update(notice).digest("hex"),
      size: notice.length,
    },
    [draft],
    201
  )
  const uploaded = await fetch(`${origin}${ready.putUrl}`, {
    method: "PUT",
    headers: { origin, cookie, ...ready.requiredHeaders },
    body: new Uint8Array(notice),
  })
  assert.ok(uploaded.ok)
  const { result: attachment } = await command(
    "completeUpload",
    { uploadId: ready.uploadId },
    [
      draft,
      { type: "UploadIntent", id: ready.uploadId, revision: ready.revision },
    ]
  )
  return {
    ...row,
    amount: "500100.00",
    draftId: draft.id,
    noticeAttachmentId: attachment.id,
    noticeLines: JSON.stringify([
      {
        key: "lease",
        amount: "500000.00",
        description: "Vehicle principal instalment",
      },
      {
        key: "brokerage",
        amount: "100.00",
        description: "Brokerage commission",
      },
    ]),
    allocations: JSON.stringify([
      {
        type: "SALES",
        sourceKey: "lease-001",
        amount: "500000.00",
        noticeLineKey: "lease",
      },
      {
        type: "BROKERAGE",
        existingId: importedDeal.id,
        amount: "100.00",
        noticeLineKey: "brokerage",
      },
    ]),
  }
}
const leaseNamespace = `lease-and-remittance-${suffix}`
const commitmentRecords = await commitHistory(
  "historical-lease",
  {
    VEHICLES: commitmentRows.VEHICLES.slice(0, 1),
    ADVANCES: commitmentRows.ADVANCES.slice(0, 1),
    SALES: commitmentRows.SALES,
  },
  "450000000",
  "750000000",
  leaseNamespace
)
await commitHistory(
  "historical-remittance",
  {
    REMITTANCES: [await withBankNotice(commitmentRows.REMITTANCES[0])],
  },
  "50010000",
  "0",
  leaseNamespace
)
const reversedRemittance = await withBankNotice({
  ...commitmentRows.REMITTANCES[0],
  sourceKey: "returned-transfer",
  reference: `RETURN-${suffix}`,
})
await commitHistory(
  "historical-remittance-reversal",
  {
    REMITTANCES: [
      {
        ...reversedRemittance,
        amount: "100.00",
        noticeLines: JSON.stringify([
          {
            key: "lease",
            amount: "100.00",
            description: "Returned lender transfer",
          },
        ]),
        allocations: JSON.stringify([
          {
            type: "SALES",
            sourceKey: "lease-001",
            amount: "100.00",
            noticeLineKey: "lease",
          },
        ]),
        reversalDate: "2026-02-01",
        reversalReason: "Historical bank transfer reversal",
      },
    ],
  },
  "10000",
  "10000",
  leaseNamespace
)
const leaseRecord = commitmentRecords.find(
  (row: { type: string }) => row.type === "SaleCase"
)
const lease = await query("sale", { id: recordId(leaseRecord.href) })
assert.equal(lease.provenance.imported, true)
assert.equal(lease.state, "COMPLETED")
assert.equal(lease.reservation.effectiveStatus, "CONVERTED")
assert.equal(lease.finance.lenderOutstanding, "300000000")
const leaseCycle = await query("purchase", { cycleId: lease.cycleId })
assert.equal(leaseCycle.financial.net, "-300000000")
const leaseReport = await fetch(
  `${origin}/api/reports/sales?from=2026-01-20&through=2026-01-20`,
  { headers: { cookie } }
)
assert.equal(leaseReport.status, 200)
const leaseReportRow = (await leaseReport.json()).data.data.find(
  (row: { saleId: string }) => row.saleId === lease.id
)
assert.equal(leaseReportRow?.financial.restatedProfit, "50000000")
const leaseInvoice = lease.invoices[0]
const issuedLeaseInvoice = await command(
  "issueInvoice",
  {
    saleId: lease.id,
    saleRevision: lease.revision,
    regenerate: false,
  },
  [
    ref("SaleCase", lease),
    ref("PurchaseRecord", leaseCycle),
    ref("InvoiceVersion", leaseInvoice),
  ]
)
assert.equal(issuedLeaseInvoice.status, "APPLIED")
const historicalSaleIds = [lease.id]
const historicalCycleIds = [lease.cycleId]
for (const [i, outcome] of [
  [1, "REFUNDED"],
  [2, "CANCELLED"],
  [3, "EXPIRED"],
] as const) {
  const records = await commitHistory(
    `advance-${outcome.toLowerCase()}`,
    {
      VEHICLES: [commitmentRows.VEHICLES[i]],
      ADVANCES: [commitmentRows.ADVANCES[i]],
    },
    "50000000",
    i === 1 ? "540000000" : "500000000"
  )
  const record = records.find(
    (row: { sourceKey: string }) => row.sourceKey === `deposit-${i}`
  )
  const sale = await query("sale", { id: recordId(record.href) })
  historicalSaleIds.push(sale.id)
  historicalCycleIds.push(sale.cycleId)
  assert.equal(sale.reservation.effectiveStatus, outcome)
  assert.equal(sale.provenance.imported, true)
}
const totalsDB = new pg.Client({ connectionString: migration })
await totalsDB.connect()
try {
  const ledger = await totalsDB.query(
    `SELECT
    (SELECT sum(CASE WHEN a."reversalOf" IS NULL THEN a.amount ELSE -a.amount END)::text FROM vamotors."CommissionAllocation" a
      JOIN vamotors."CommissionEntitlement" e ON a."entitlementId"=e.id WHERE e."saleCaseId"=$1) AS allocated,
    (SELECT "expectedAmount"::text FROM vamotors."CommissionEntitlement" WHERE "saleCaseId"=$1) AS commission`,
    [lease.id]
  )
  assert.deepEqual(ledger.rows[0], {
    allocated: "50000000",
    commission: "10000",
  })
  const brokerLedger = await totalsDB.query(
    `SELECT e.state, e."expectedAmount"::text AS expected, a.amount::text AS allocated, l.key AS line
     FROM vamotors."CommissionEntitlement" e
     JOIN vamotors."CommissionAllocation" a ON a."entitlementId"=e.id
     JOIN vamotors."NoticeLine" l ON l.id=a."noticeLineId"
     WHERE e."brokerageDealId"=$1`,
    [importedDeal.id]
  )
  assert.deepEqual(brokerLedger.rows, [
    {
      state: "SETTLED",
      expected: "10000",
      allocated: "10000",
      line: "brokerage",
    },
  ])
  const returned = await totalsDB.query(
    `SELECT r.state, reversal."occurredDate"::text AS date, reversal.amount::text,
       (SELECT count(*)::int FROM vamotors."CommissionAllocation" a
        WHERE a."remittanceId"=r.id AND a."reversalOf" IS NOT NULL) AS "reversedAllocations"
     FROM vamotors."Remittance" r
     JOIN vamotors."RemittancePayment" original ON original."remittanceId"=r.id
     JOIN vamotors."RemittancePayment" reversal ON reversal."reversalOf"=original.id
     WHERE r.reference=$1`,
    [reversedRemittance.reference]
  )
  assert.deepEqual(returned.rows, [
    {
      state: "REVERSED",
      date: "2026-02-01",
      amount: "10000",
      reversedAllocations: 1,
    },
  ])
  const evidence = await totalsDB.query(
    `SELECT s."legacyApproval" AS approval, r.metadata->>'historicalStatus' AS status
     FROM vamotors."SaleCase" s
     JOIN vamotors."EntityReadVersion" v ON v."entityId"=s."purchaseRecordId"
     JOIN vamotors."ImportSourceRow" r ON v.id=r."targetVersionId"
     WHERE s.id=$1 AND r."sourceType"='VEHICLES'`,
    [lease.id]
  )
  assert.deepEqual(evidence.rows, [
    {
      approval: {
        approverName: "Historical Sales Manager",
        approvalReference: "DISCOUNT-42",
      },
      status: "DELIVERED",
    },
  ])
  const cash = await totalsDB.query(
    `SELECT direction, sum(amount)::text AS total FROM vamotors."CashMovement"
     WHERE ("sourceType"='SALE' AND "sourceId"=ANY($1::uuid[]))
        OR ("sourceType"='PURCHASE' AND "sourceId"=ANY($2::uuid[]))
        OR ("sourceType"='REMITTANCE' AND "sourceId"=(
          SELECT id FROM vamotors."Remittance" WHERE "companyId"=$3 AND reference=$4
        )) OR ("sourceType"='REMITTANCE' AND "sourceId"=(
          SELECT id FROM vamotors."Remittance" WHERE "companyId"=$3 AND reference=$5
        )) GROUP BY direction ORDER BY direction`,
    [
      historicalSaleIds,
      historicalCycleIds,
      financeId,
      commitmentRows.REMITTANCES[0].reference,
      reversedRemittance.reference,
    ]
  )
  assert.deepEqual(cash.rows, [
    { direction: "IN", total: "650020000" },
    { direction: "OUT", total: "2290010000" },
  ])
} finally {
  await totalsDB.end()
}
console.log(
  "PASS historical advances, lease handover, invoice and remittance allocation"
)

const partialRecords = await commitHistory(
  "partially-paid-acquisition",
  {
    SUPPLIERS: [
      {
        sourceKey: "archived-seller",
        name: `Archived seller ${suffix}`,
        nicOrRegNumber: `ARCH-${suffix}`,
        isActive: "false",
      },
    ],
    CUSTOMERS: [
      {
        sourceKey: "archived-customer",
        nicOrPassport: `ARCH-${suffix}`,
        isActive: "false",
      },
    ],
    VEHICLES: [
      {
        ...commitmentRows.VEHICLES[1],
        sourceKey: "partially-paid",
        cycleSourceKey: "partially-paid-cycle",
        engineNumber: `partial-engine-${suffix}`,
        chassisNumber: `partial-chassis-${suffix}`,
        supplierExistingId: "",
        supplierSourceKey: "archived-seller",
        payments: JSON.stringify([
          {
            sourceKey: "first",
            amount: "2000000.00",
            date: "2026-01-11",
            direction: "OUT",
            category: "SELLER",
            method: "BANK_TRANSFER",
            reference: `partial-first-${suffix}`,
          },
          {
            sourceKey: "second",
            amount: "1000000.00",
            date: "2026-01-12",
            direction: "OUT",
            category: "SELLER",
            method: "CASH",
          },
        ]),
      },
    ],
  },
  "0",
  "300000000"
)
const inactiveSupplier = await query("party", {
  type: "SUPPLIER",
  id: recordId(
    partialRecords
      .find((record: { type: string }) => record.type === "Supplier")
      .href.split("?")[0]
  ),
})
const inactiveCustomer = await query("customer", {
  id: recordId(
    partialRecords.find(
      (record: { type: string }) => record.type === "Customer"
    ).href
  ),
})
assert.equal(inactiveSupplier.active, false)
assert.equal(inactiveCustomer.active, false)
const partiallyPaid = await query("purchase", {
  cycleId: recordId(
    partialRecords.find(
      (record: { type: string }) => record.type === "PurchaseRecord"
    ).href
  ),
})
assert.equal(partiallyPaid.outstanding.seller, "200000000")
assert.equal(partiallyPaid.financial.cashOut, "300000000")
assert.deepEqual(
  partiallyPaid.payments.map((entry: { date: string }) => entry.date),
  ["2026-01-11", "2026-01-12"]
)

const disposalRecords = await commitHistory(
  "historical-write-off",
  {
    VEHICLES: [
      {
        ...commitmentRows.VEHICLES[1],
        sourceKey: "written-off",
        cycleSourceKey: "written-off-cycle",
        engineNumber: `discard-engine-${suffix}`,
        chassisNumber: `discard-chassis-${suffix}`,
        status: "WRITTEN_OFF",
        available: "false",
        closedAt: "2026-01-20T00:00:00.000Z",
        disposalDate: "2026-01-20",
        disposalReason: "Historical damage",
        disposalMethod: "AUCTIONED",
        disposalProceeds: "500000.00",
        disposalReceiptAmount: "500000.00",
        disposalReceiptDate: "2026-01-20",
        disposalReceiptMethod: "CASH",
        disposalApproverName: "Historical Manager",
        disposalApprovalReference: "DISPOSAL-42",
      },
    ],
  },
  "50000000",
  "500000000"
)
const disposed = await query("purchase", {
  cycleId: recordId(
    disposalRecords.find(
      (record: { type: string }) => record.type === "PurchaseRecord"
    ).href
  ),
})
assert.equal(disposed.status, "WRITTEN_OFF")
assert.equal(disposed.disposal.approval.kind, "IMPORTED")
assert.equal(
  disposed.disposal.approval.legacy.approverName,
  "Historical Manager"
)
assert.equal(disposed.financial.net, "-450000000")
const disposalReport = await fetch(
  `${origin}/api/reports/disposals?from=2026-01-20&through=2026-01-20`,
  { headers: { cookie } }
)
assert.equal(disposalReport.status, 200)
const loss = (await disposalReport.json()).data.data.find(
  (item: { cycleId: string }) => item.cycleId === disposed.id
)
assert.equal(loss?.netLoss, "450000000")
assert.equal(loss?.approval.legacy.approverName, "Historical Manager")
const disposalAuditDB = new pg.Client({ connectionString: migration })
await disposalAuditDB.connect()
try {
  const { rows } = await disposalAuditDB.query(
    `SELECT a.action, a."actorKind", a."initiatedBy", a."userId", a."approverId"
     FROM vamotors."AuditEntry" a
     WHERE (a."entityType"='Disposal' AND a."entityId"=$1)
        OR (a."entityType"='ImportBatch' AND a."entityId"=$2 AND a.action='confirmImport')
     ORDER BY a.action`,
    [disposed.disposal.id, disposed.disposal.approval.batchId]
  )
  assert.deepEqual(
    rows,
    ["confirmImport", "importWriteOff"].map((action) => ({
      action,
      actorKind: "IMPORT",
      initiatedBy: disposed.disposal.approval.initiatedByAdminId,
      userId: null,
      approverId: null,
    }))
  )
} finally {
  await disposalAuditDB.end()
}

if (process.argv.includes("--browser")) {
  const browser = await chromium.launch({
    executablePath: process.env.VAMOTORS_CHROMIUM ?? "/usr/bin/chromium",
  })
  try {
    const context = await browser.newContext()
    const status = await context.request.post(
      `${origin}/api/auth/sign-in/email`,
      {
        headers: { origin },
        data: {
          email: accounts.BOOTSTRAP_ADMIN_EMAIL,
          password: accounts.BOOTSTRAP_ADMIN_PASSWORD,
        },
      }
    )
    assert.equal(status.status(), 200)
    const page = await context.newPage()
    await page.goto(`${origin}/imports`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    await expect(
      page.getByRole("heading", { name: "Historical imports", exact: true })
    ).toBeVisible()
    for (const label of ["Download CSV", "Download Excel"]) {
      const download = page.waitForEvent("download")
      await page.getByRole("link", { name: label, exact: true }).click()
      assert.match(
        (await download).suggestedFilename(),
        /suppliers-template\.(csv|xlsx)$/
      )
    }
    const browserFiles: [ImportType, string, Buffer][] = [
      ["SUPPLIERS", "broken.csv", csv("SUPPLIERS", { name: "" })],
      [
        "CUSTOMERS",
        "customers.csv",
        csv("CUSTOMERS", { nicOrPassport: `BC${suffix}` }),
      ],
      [
        "REPAIR_VENDORS",
        "vendor.xlsx",
        buildXlsx([
          {
            name: "REPAIR_VENDORS",
            rows: [
              importTemplateColumns("REPAIR_VENDORS").map((col) => col.name),
              importTemplateColumns("REPAIR_VENDORS").map(
                (col) =>
                  (
                    ({
                      sourceKey: "vnd-001",
                      nicOrRegNumber: `BV${suffix}`,
                    }) as Record<string, string>
                  )[col.name] ?? col.example
              ),
            ],
          },
        ]),
      ],
      [
        "VEHICLES",
        "vehicles.csv",
        csv("VEHICLES", {
          engineNumber: `B-ENG-${suffix}`,
          chassisNumber: `B-CHS-${suffix}`,
          status: "SOLD",
          available: "false",
          closedAt: "2026-01-20T12:00:00.000Z",
        }),
      ],
      [
        "REPAIRS",
        "repairs.csv",
        csv("REPAIRS", { legacyOriginalId: `browser-${suffix}` }),
      ],
      [
        "SALES",
        "sales.csv",
        csv("SALES", {
          legacyOriginalId: `browser-${suffix}`,
          completionBasisRepairs:
            '[{"sourceKey":"rep-001","amount":"45000.00"}]',
        }),
      ],
      [
        "FINANCE_COMPANIES",
        "finance.csv",
        csv("FINANCE_COMPANIES", { name: `Browser Finance ${suffix}` }),
      ],
      ["BROKERAGE", "brokerage.csv", csv("BROKERAGE", { quoteId: quote.id })],
    ]
    const display = (type: ImportType) =>
      type.replaceAll("_", " ").toLowerCase()
    await page
      .getByLabel("Namespace", { exact: true })
      .fill(`browser-${suffix}`)
    for (const [type] of browserFiles)
      await page
        .getByRole("checkbox", { name: display(type), exact: true })
        .check()
    await page.getByRole("button", { name: "Create STAGED batch" }).click()
    await expect(
      page.getByRole("heading", { name: "Historical import batch" })
    ).toBeVisible({ timeout: 15000 })
    async function uploadInBrowser(
      type: ImportType,
      filename: string,
      bytes: Buffer
    ) {
      const mimeType = filename.endsWith(".xlsx")
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv"
      await page
        .locator("#import-file")
        .setInputFiles({ name: filename, mimeType, buffer: bytes })
      await page
        .getByRole("button", { name: "Upload source bytes with new intent" })
        .click()
      await page
        .getByRole("listitem")
        .filter({ hasText: filename })
        .getByRole("button", { name: "Finalize retained bytes" })
        .click()
      const select = page.getByLabel(`${display(type)} source`)
      const option = select.locator("option").filter({ hasText: filename })
      await expect(option).toHaveCount(1, { timeout: 15000 })
      await select.selectOption((await option.getAttribute("value"))!)
    }
    for (const [type, filename, bytes] of browserFiles)
      await uploadInBrowser(type, filename, bytes)
    await page.getByRole("button", { name: "Validate and preview" }).click()
    await expect(
      page.getByRole("heading", { name: "Validation errors" })
    ).toBeVisible()
    await expect(page.getByText(/broken.csv, row 2, name/)).toBeVisible()
    await uploadInBrowser(
      "SUPPLIERS",
      "corrected.csv",
      csv("SUPPLIERS", {
        name: `Browser supplier ${suffix}`,
        nicOrRegNumber: `B${suffix}`,
      })
    )
    await page.getByRole("button", { name: "Validate and preview" }).click()
    await expect(
      page.getByRole("heading", { name: "Validated preview" })
    ).toBeVisible()
    await page.getByRole("button", { name: "Commit entire batch" }).click()
    await expect(
      page.getByText("Historical import committed.", { exact: true })
    ).toBeVisible()
    const recordLinks = page
      .getByRole("list")
      .filter({ has: page.getByRole("link", { name: /Supplier · row 2/ }) })
      .getByRole("link")
    await expect(recordLinks).toHaveCount(browserFiles.length)
    const hrefs = await recordLinks.evaluateAll((links) =>
      links.map((link) => link.getAttribute("href"))
    )
    for (const href of hrefs) {
      assert.ok(href)
      await page.goto(`${origin}${href}`)
      await expect(
        page.getByRole("link", { name: "Imported · source row 2" })
      ).toBeVisible({ timeout: 15000 })
    }
    await page.goto(`${origin}/imports`)
    await page
      .getByLabel("Namespace", { exact: true })
      .fill(`browser-lease-${suffix}`)
    const browserHistory = historicalCommitmentRows({
      prefix: `browser-lease-${suffix}`,
      companyId: financeId,
      customerId: recordId(customerRecord.href),
      supplierId: recordId(
        committed.importedRecords
          .find((record: { type: string }) => record.type === "Supplier")
          .href.split("?")[0]
      ),
    })
    const browserNotice = await withBankNotice(browserHistory.REMITTANCES[0])
    browserNotice.allocations = JSON.stringify([
      {
        type: "SALES",
        sourceKey: "lease-001",
        amount: "500000.00",
        noticeLineKey: "lease",
      },
    ])
    const newTypes = ["VEHICLES", "ADVANCES", "SALES", "REMITTANCES"] as const
    await page
      .getByRole("checkbox", { name: "suppliers", exact: true })
      .uncheck()
    for (const type of newTypes)
      await page
        .getByRole("checkbox", { name: display(type), exact: true })
        .check()
    await page.getByRole("button", { name: "Create STAGED batch" }).click()
    await expect(
      page.getByRole("heading", { name: "Historical import batch" })
    ).toBeVisible({ timeout: 30000 })
    for (const type of newTypes)
      await uploadInBrowser(
        type,
        `lease-${type.toLowerCase()}.csv`,
        csv(
          type,
          type === "REMITTANCES" ? browserNotice : browserHistory[type][0]
        )
      )
    await page.getByRole("button", { name: "Validate and preview" }).click()
    await expect(
      page.getByRole("heading", { name: "Validated preview" })
    ).toBeVisible({ timeout: 15000 })
    await page.getByRole("button", { name: "Commit entire batch" }).click()
    await expect(
      page.getByText("Historical import committed.", { exact: true })
    ).toBeVisible({ timeout: 15000 })
    await expect(
      page.getByRole("link", { name: /Reservation · row 2/ })
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /Remittance · row 2/ })
    ).toBeVisible()
    await context.close()
    console.log(
      "PASS Chromium historical advances, lease and remittance imports, plus eight-type CSV/XLSX stage, correction, preview, confirmation, and record provenance"
    )
  } finally {
    await browser.close()
  }
}
