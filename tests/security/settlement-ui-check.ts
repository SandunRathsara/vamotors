/** Production browser/HTTP/PG regression for both shared SettlementFields consumers.
 * <owned-root> [probe|all]; probe also runs unchanged on rejected038 before fixing.
 * No mocked party DTOs, injected component state, direct business SQL or UI POST substitutes.
 */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type Locator, type Page } from "@playwright/test"
import type {
  Applied,
  PurchaseCycleDTO,
  PartyDetailDTO,
  CurrentActorDTO,
  Grant,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref } from "./cycle-edits-fixture"

const [root, mode = "all"] = process.argv.slice(2)
assert.ok(root && ["probe", "all"].includes(mode))
const f = await fixture(root),
  run = randomUUID()
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
const browser = await chromium.launch({ headless: true })
const events: unknown[] = [],
  errors: string[] = []
const save = () =>
  writeFile(
    join(root, `settlement-ui-${run}.json`),
    JSON.stringify(
      { sha, source: process.cwd(), origin: f.origin, mode, events, errors },
      null,
      2
    ),
    { mode: 0o600 }
  )
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "LeasePurchaseDetail",
  "VehicleCost",
  "PurchasePayment",
  "CostPayment",
  "MileageReading",
  "CycleBasisVersion",
  "StatusEvent",
  "CommandReceipt",
  "AuditEntry",
  "EntityReadVersion",
  "BusinessSequence",
]
async function snapshot() {
  const value: Record<string, unknown> = {}
  for (const table of tables) {
    // Exact PG text avoids JS integer rounding; no credential-bearing audit data exported.
    value[table] = (
      await f.db.query(
        `SELECT id,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS sha256 FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
  }
  return value // AdminGuard remains mutable synchronization, not business evidence.
}
async function enter(target: Locator, text: string) {
  await target.focus()
  await target.press("ControlOrMeta+A")
  await target.press("Backspace")
  await target.pressSequentially(text)
  await target.press("Tab")
  await expect(target).toHaveValue(text)
}
async function choose(target: Locator, value: string, verify = true) {
  await expect(target.locator(`option[value="${value}"]`)).toHaveCount(1)
  const label = await target.locator(`option[value="${value}"]`).innerText()
  await target.focus()
  // Native select typeahead works on macOS Chromium; arrow keys open a native
  // popup whose uncommitted highlight is not the selected option in headless mode.
  await target.pressSequentially(label)
  await target.page().keyboard.press("Tab")
  if (verify) await expect(target).toHaveValue(value)
}
async function activate(target: Locator) {
  await target.focus()
  await target.press("Enter")
}
async function date(target: Locator) {
  await target.focus()
  for (let i = 0; i < 3; i++) await target.press("ArrowLeft")
  await target.pressSequentially("2026")
  await target.press("ArrowRight")
  await target.pressSequentially("10")
  await target.press("ArrowRight")
  await target.pressSequentially("01")
  await target.press("Tab")
  await expect(target).toHaveValue("2026-10-01")
}
const revision = (p: Page) => p.getByText(/^Selected revision:/)
const companySelect = (p: Page) =>
  p.getByLabel("Settlement finance company", { exact: false })
const institution = (p: Page) =>
  p.getByLabel("Settlement institution type", { exact: false })
async function state(p: Page) {
  // Read only the actual production props via the host fiber. Never call setters,
  // fabricate a company/revision, or use this diagnostic as the pass/fail oracle.
  return p
    .getByRole("region", { name: "Settlement terms", exact: true })
    .evaluate((el) => {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
      if (!key) throw Error("HOST_FIBER_UNAVAILABLE")
      let fiber = Reflect.get(el, key)
      let root = fiber
      while (root.return) root = root.return
      if (root !== root.stateNode.current) fiber = fiber.alternate
      while (fiber) {
        const props = fiber.memoizedProps
        if (
          props &&
          Object.hasOwn(props, "draft") &&
          Object.hasOwn(props, "company")
        )
          return {
            company: props.company,
            draftCompanyIdPresent: Object.hasOwn(props.draft, "companyId"),
            draftCompanyId: props.draft.companyId ?? null,
          }
        fiber = fiber.return
      }
      throw Error("SETTLEMENT_PROPS_UNAVAILABLE")
    })
}
async function open(p: Page) {
  await p.goto("/purchases")
  await activate(
    p.getByRole("button", { name: "New paid acquisition", exact: true })
  )
  await choose(
    p.getByLabel("Purchase type", { exact: false }),
    "LEASE_SETTLEMENT"
  )
}
try {
  assert.notEqual(new URL(f.origin).port, "8000")
  await f.start()
  const admin = await f.login("ADMIN")
  try {
    const storageState = await admin.storageState()
    const probes: boolean[] = []
    for (const width of [360, 1920]) {
      const context = await browser.newContext({
        baseURL: f.origin,
        storageState,
        viewport: { width, height: 1080 },
        serviceWorkers: "block",
        locale: "en-US",
      })
      try {
        const p = await context.newPage(),
          consoleErrors: string[] = [],
          posts: string[] = []
        p.on("console", (m) => {
          if (m.type() === "error") consoleErrors.push(m.text())
        })
        p.on("pageerror", (e) => consoleErrors.push(e.message))
        p.on("request", (r) => {
          if (r.method() === "POST" && r.url().includes("/api/v1/commands/"))
            posts.push(new URL(r.url()).pathname)
        })
        await open(p)
        const initial = await state(p)
        assert.equal(initial.company, null)
        assert.equal(initial.draftCompanyIdPresent, false)
        for (const type of ["BANK", "PRIVATE_PARTY"]) {
          await choose(institution(p), type)
          await expect(
            p.getByLabel("Settlement institution name", { exact: false })
          ).toBeVisible()
        }
        const before = await snapshot()
        await choose(institution(p), "FINANCE_COMPANY", false)
        await expect(
          p.getByText(/Selected revision:|Something went wrong/).first()
        ).toBeVisible()
        const crashed = await p
          .getByText("Something went wrong", { exact: false })
          .isVisible()
        const after = await snapshot()
        await p.screenshot({
          path: join(root, `settlement-ui-${run}-probe-${width}.png`),
          fullPage: true,
        })
        const record = {
          kind: "initial-probe",
          width,
          initial,
          crashed,
          consoleErrors,
          posts,
          before,
          after,
          zeroEffects: JSON.stringify(before) === JSON.stringify(after),
        }
        events.push(record)
        await save()
        assert.deepEqual(after, before)
        assert.deepEqual(posts, [])
        if (!crashed) {
          await expect(revision(p)).toHaveText("Selected revision: Unavailable")
          await expect(
            p.getByLabel("Search active finance companies")
          ).toBeEditable()
          await expect(companySelect(p)).toBeEnabled()
          assert.deepEqual(consoleErrors, [])
        }
        probes.push(!crashed)
        console.log(
          JSON.stringify({
            width,
            initial,
            crashed,
            zeroPOSTs: !posts.length,
            zeroEffects: record.zeroEffects,
            consoleErrors,
          })
        )
      } finally {
        await context.close()
      }
    }
    assert.deepEqual(
      probes,
      [true, true],
      "Finance-company before selection must leave both real forms usable"
    )
    if (mode === "all") {
      const supplierName = `UI supplier ${run}`
      const supplier = (
        await f.command(
          admin,
          "createDirectoryParty",
          envelope({
            type: "SUPPLIER",
            values: { name: supplierName, category: "COMPANY", contacts: [] },
          }),
          201
        )
      ).result
      const settings = await f.query<{ id: string; revision: number }>(
        admin,
        "settings"
      )
      const companies: PartyDetailDTO[] = []
      for (const n of [0, 1]) {
        const made = await f.command(
          admin,
          "createFinanceCompany",
          envelope(
            {
              name: `UI finance ${run}-${n}`,
              contacts: [
                {
                  name: "Synthetic UI contact",
                  phone: "0112345678",
                  role: "Settlement",
                  primary: true,
                },
              ],
              policy: {
                path: "APPLICATION",
                commission: { basis: "FIXED", fixed: "1", rateBps: 0 },
                processingFee: "0",
                reconciliationMethod: "PER_DEAL",
              },
            },
            [ref(settings, "Settings")]
          ),
          201
        )
        companies.push(
          await f.query(
            admin,
            "party",
            `?type=FINANCE_COMPANY&id=${made.result.id}`
          )
        )
      }
      const first = companies[0],
        second = companies[1]
      async function select(p: Page, company = first) {
        await enter(
          p.getByLabel("Search active finance companies"),
          `UI finance ${run}`
        )
        // Rechoosing an already selected native option emits no change event.
        // Explicitly clear a retained ID before the real directory reselection.
        if ((await companySelect(p).inputValue()) === company.id)
          await choose(companySelect(p), "")
        await choose(companySelect(p), company.id)
        await expect(revision(p)).toHaveText(
          `Selected revision: ${company.revision}`
        )
      }
      async function selectionControls(p: Page) {
        const before = await snapshot()
        await choose(institution(p), "FINANCE_COMPANY")
        await expect(revision(p)).toHaveText("Selected revision: Unavailable")
        await select(p)
        await choose(companySelect(p), "")
        await expect(revision(p)).toHaveText("Selected revision: Unavailable")
        await select(p)
        for (const type of ["BANK", "PRIVATE_PARTY"]) {
          await choose(institution(p), type)
          await expect(revision(p)).toHaveCount(0)
          await choose(institution(p), "FINANCE_COMPANY")
          await expect(revision(p)).toHaveText("Selected revision: Unavailable")
          const actual = await state(p)
          assert.equal(actual.company, null)
          assert.equal(actual.draftCompanyId, first.id)
          await select(p)
        }
        // Real delayed DTO for A arrives after selecting B. Preserve actual bytes;
        // this exercises the reachable mismatched company/ID branch, not a mock.
        const path = `**/api/v1/queries/party?type=FINANCE_COMPANY&id=${first.id}`
        let release = () => {}
        let fetched = () => {}
        let responseStatus = 0
        let actual: PartyDetailDTO | undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        const ready = new Promise<void>((resolve) => {
          fetched = resolve
        })
        await p.route(path, async (route) => {
          const response = await route.fetch()
          responseStatus = response.status()
          actual = (await response.json()).data
          fetched()
          await gate
          await route.fulfill({ response })
        })
        try {
          await activate(
            p.getByRole("button", {
              name: "Load current selected company",
              exact: true,
            })
          )
          await ready
          assert.equal(responseStatus, 200)
          assert.equal(actual?.id, first.id)
          assert.equal(actual?.revision, first.revision)
          await select(p, second)
          release()
          await expect(revision(p)).toHaveText("Selected revision: Unavailable")
          const mismatch = await state(p)
          assert.equal(mismatch.company.id, first.id)
          assert.equal(mismatch.draftCompanyId, second.id)
          events.push({ kind: "real-delayed-mismatch", mismatch, actual })
        } finally {
          release()
          await p.unroute(path)
        }
        await activate(
          p.getByRole("button", {
            name: "Load current selected company",
            exact: true,
          })
        )
        await expect(revision(p)).toHaveText(
          `Selected revision: ${second.revision}`
        )
        await choose(companySelect(p), "")
        await select(p)
        const after = await snapshot()
        assert.deepEqual(after, before)
        events.push({
          kind: "selection-controls",
          zeroEffects: true,
          before,
          after,
        })
      }
      const created: { width: number; type: string; id: string }[] = []
      for (const width of [360, 1920]) {
        const context = await browser.newContext({
          baseURL: f.origin,
          storageState,
          viewport: { width, height: 1080 },
          serviceWorkers: "block",
          locale: "en-US",
        })
        try {
          const p = await context.newPage(),
            posts: string[] = []
          p.on("pageerror", (e) => errors.push(e.message))
          p.on("request", (r) => {
            if (r.method() === "POST" && r.url().includes("/api/v1/commands/"))
              posts.push(new URL(r.url()).pathname)
          })
          for (const type of ["FINANCE_COMPANY", "BANK", "PRIVATE_PARTY"]) {
            await open(p)
            if (type === "FINANCE_COMPANY") await selectionControls(p)
            else await choose(institution(p), type)
            const noPosts = posts.length
            await enter(
              p.getByLabel("Search active suppliers by name"),
              supplierName
            )
            await choose(
              p.getByLabel("Supplier *", { exact: true }),
              supplier.id
            )
            for (const [key, value] of Object.entries({
              engineNumber: `UI-E-${run}-${width}-${type}`,
              chassisNumber: `UI-C-${run}-${width}-${type}`,
              make: "SyntheticUI",
              model: "FC-C01",
              year: "2026",
              colour: "Blue",
            }))
              await enter(p.locator(`#acquisition-${key}`), value)
            await date(p.locator("#acquisition-purchaseDate"))
            await date(p.locator("#acquisition-mileageDate"))
            await enter(p.locator("#acquisition-mileage"), "123")
            await choose(
              p.locator("#acquisition-paymentMethod"),
              "BANK_TRANSFER"
            )
            if (type !== "FINANCE_COMPANY")
              await enter(
                p.getByLabel("Settlement institution name", { exact: false }),
                `Synthetic ${type} ${width}`
              )
            const reference = `UI-${type}-${width}`
            await enter(
              p.getByLabel("Settlement reference", { exact: false }),
              reference
            )
            await enter(
              p.getByLabel("Institution amount (major units)"),
              "60.25"
            )
            await enter(p.getByLabel("Cash to seller (major units)"), "40.75")
            await expect(
              p.getByText("Computed purchase total: 101.00", { exact: true })
            ).toBeVisible()
            assert.equal(posts.length, noPosts)
            await p.screenshot({
              path: join(
                root,
                `settlement-ui-${run}-${width}-${type}-ready.png`
              ),
              fullPage: true,
            })
            const response = p.waitForResponse(
              (r) =>
                new URL(r.url()).pathname ===
                  "/api/v1/commands/recordPurchase" &&
                r.request().method() === "POST"
            )
            await activate(
              p.getByRole("button", {
                name: "Record fully paid acquisition",
                exact: true,
              })
            )
            const r = await response,
              body = r.request().postDataJSON(),
              applied: Applied = await r.json()
            assert.equal(r.status(), 201, JSON.stringify(applied))
            assert.equal(posts.length, noPosts + 1)
            await p.waitForURL(`**/purchases/${applied.result.id}`)
            assert.equal(body.input.settlement.institutionType, type)
            assert.equal(body.input.settlement.reference, reference)
            assert.equal(body.input.settlement.amount, "6025")
            assert.equal(body.input.settlement.cashToSeller, "4075")
            assert.deepEqual(body.expected, [
              ref(supplier, "Supplier"),
              ...(type === "FINANCE_COMPANY"
                ? [ref(first, "FinanceCompany")]
                : []),
            ])
            const row = await f.query<PurchaseCycleDTO>(
              admin,
              "purchase",
              `?cycleId=${applied.result.id}`
            )
            const detail = (
              await f.db.query(
                'SELECT "institutionType","companyId","institutionNameSnapshot",reference,amount::text,"cashToSeller"::text FROM vamotors."LeasePurchaseDetail" WHERE "purchaseRecordId"=$1',
                [row.id]
              )
            ).rows
            const payments = (
              await f.db.query(
                'SELECT category,direction,amount::text,method,"occurredDate"::text,"commandId" FROM vamotors."PurchasePayment" WHERE "cycleId"=$1 ORDER BY category',
                [row.id]
              )
            ).rows
            assert.deepEqual(detail, [
              {
                institutionType: type,
                companyId: type === "FINANCE_COMPANY" ? first.id : null,
                institutionNameSnapshot:
                  type === "FINANCE_COMPANY"
                    ? first.name
                    : `Synthetic ${type} ${width}`,
                reference,
                amount: "6025",
                cashToSeller: "4075",
              },
            ])
            assert.deepEqual(payments, [
              {
                category: "SELLER",
                direction: "OUT",
                amount: "4075",
                method: "BANK_TRANSFER",
                occurredDate: "2026-10-01",
                commandId: applied.commandId,
              },
              {
                category: "SETTLEMENT",
                direction: "OUT",
                amount: "6025",
                method: "BANK_TRANSFER",
                occurredDate: "2026-10-01",
                commandId: applied.commandId,
              },
            ])
            assert.equal(row.purchasePrice, "10100")
            assert.ok(row.financial)
            assert.equal(row.financial.basis, "10100")
            assert.equal(row.financial.cashOut, "10100")
            assert.equal(row.basisVersions.length, 1)
            const basis = (
              await f.db.query(
                'SELECT version,total::text AS basis FROM vamotors."CycleBasisVersion" WHERE "cycleId"=$1',
                [row.id]
              )
            ).rows
            assert.deepEqual(basis, [{ version: 1, basis: "10100" }])
            created.push({ width, type, id: row.id })
            events.push({
              kind: "keyboard-acquisition",
              width,
              type,
              body,
              applied,
              detail,
              payments,
              basis,
              row,
            })
            await save()
            console.log(
              `PASS ${width} ${type} keyboard UI → real HTTP201 → typed SQL, exact components/basis once`
            )
          }
          // Existing correction consumer: null company with retained real ID,
          // then clear/switch/reselect; only reverse the old institution credit.
          const bank = created.find(
            (c) => c.width === width && c.type === "BANK"
          )!
          await p.goto(`/purchases/${bank.id}`)
          await activate(
            p.getByRole("button", {
              name: "Correct purchase terms",
              exact: true,
            })
          )
          const check = p.getByLabel("Correct full settlement terms", {
            exact: false,
          })
          await check.focus()
          await check.press("Space")
          await selectionControls(p)
          await enter(
            p.getByLabel("Mandatory correction reason"),
            "Truthful bank-to-finance correction after reversing old institution credit"
          )
          const old = await f.query<PurchaseCycleDTO>(
            admin,
            "purchase",
            `?cycleId=${bank.id}`
          )
          const payment = old.payments.find((v) => v.category === "SETTLEMENT")!
          const reverse = p.getByLabel(
            `Reverse SETTLEMENT recorded 60.25 on 2026-10-01 (${payment.id})`,
            { exact: true }
          )
          await reverse.focus()
          await reverse.press("Space")
          await enter(
            p.getByLabel("Payment correction reason", { exact: false }),
            "Original bank entry corrected; no invented cross-recipient replacement"
          )
          const response = p.waitForResponse(
            (r) => new URL(r.url()).pathname === "/api/v1/commands/editPurchase"
          )
          await activate(
            p.getByRole("button", {
              name: "Confirm cycle money change",
              exact: true,
            })
          )
          const r = await response,
            body = r.request().postDataJSON(),
            applied = await r.json()
          assert.equal(r.status(), 200, JSON.stringify(applied))
          assert.deepEqual(body.expected, [
            ref(old),
            {
              type: "Vehicle",
              id: old.vehicleId,
              revision: old.identityRevision,
            },
            ref(first, "FinanceCompany"),
          ])
          assert.deepEqual(body.input.cashCorrections, [
            {
              paymentId: payment.id,
              reason:
                "Original bank entry corrected; no invented cross-recipient replacement",
            },
          ])
          const corrected = await f.query<PurchaseCycleDTO>(
            admin,
            "purchase",
            `?cycleId=${bank.id}`
          )
          assert.ok(corrected.settlement)
          assert.equal(corrected.settlement.institutionType, "FINANCE_COMPANY")
          assert.ok(corrected.settlement.institutionType === "FINANCE_COMPANY")
          assert.equal(corrected.settlement.companyId, first.id)
          assert.equal(corrected.outstanding.seller, "0")
          assert.equal(corrected.outstanding.settlement, "6025")
          assert.deepEqual(corrected.basisVersions, old.basisVersions)
          assert.equal(corrected.payments.length, 3)
          const persisted = (
            await f.db.query(
              'SELECT "institutionType","companyId",amount::text,"cashToSeller"::text FROM vamotors."LeasePurchaseDetail" WHERE "purchaseRecordId"=$1',
              [bank.id]
            )
          ).rows
          assert.deepEqual(persisted, [
            {
              institutionType: "FINANCE_COMPANY",
              companyId: first.id,
              amount: "6025",
              cashToSeller: "4075",
            },
          ])
          const opposite = (
            await f.db.query(
              'SELECT category,direction,amount::text,"reversalOf","commandId" FROM vamotors."PurchasePayment" WHERE "reversalOf"=$1',
              [payment.id]
            )
          ).rows
          assert.deepEqual(opposite, [
            {
              category: "SETTLEMENT",
              direction: "IN",
              amount: "6025",
              reversalOf: payment.id,
              commandId: applied.commandId,
            },
          ])
          await p.reload()
          await activate(
            p.getByRole("button", {
              name: "Correct purchase terms",
              exact: true,
            })
          )
          await check.focus()
          await check.press("Space")
          await expect(revision(p)).toHaveText("Selected revision: Unavailable")
          const initial = await state(p)
          assert.equal(initial.company, null)
          assert.equal(initial.draftCompanyId, first.id)
          await activate(
            p.getByRole("button", {
              name: "Load current selected company",
              exact: true,
            })
          )
          await expect(revision(p)).toHaveText(
            `Selected revision: ${first.revision}`
          )
          events.push({
            kind: "lawful-correction",
            width,
            initial,
            body,
            applied,
            corrected,
            persisted,
            opposite,
          })
          await save()
          console.log(
            `PASS ${width} shared correction null/load/clear/switch/reselect and lawful real commit`
          )
        } finally {
          await context.close()
        }
      }
      // Real projection-hidden revision: no fake party response or synthetic ID.
      const staff = await f.login("STAFF")
      const actor = await f.query<CurrentActorDTO>(staff, "currentActor")
      try {
        const grants: Grant[] = [
          { subject: "PurchaseRecord", action: "read", fields: ["*"] },
          { subject: "PurchaseRecord", action: "create", fields: ["*"] },
          { subject: "Vehicle", action: "read", fields: ["*"] },
          { subject: "Vehicle", action: "create", fields: ["*"] },
          { subject: "Supplier", action: "read", fields: ["*"] },
          {
            subject: "FinanceCompany",
            action: "read",
            fields: ["id", "name", "active"],
          },
        ]
        const role = await f.command(
          admin,
          "saveRole",
          envelope({
            name: `UI hidden ${run}`,
            reason: "Synthetic projection-only regression",
            grants,
          }),
          201
        )
        const user = await f.query<{
          id: string
          revision: number
          name: string
        }>(admin, "user", `?id=${actor.user.id}`)
        await f.command(
          admin,
          "updateUser",
          envelope(
            {
              id: user.id,
              name: user.name,
              active: true,
              roleIds: [role.result.id],
              reason: "Synthetic hidden revision",
            },
            [ref(user, "User"), ref(role.result, "Role")]
          )
        )
        const context = await browser.newContext({
          baseURL: f.origin,
          storageState: await staff.storageState(),
          serviceWorkers: "block",
        })
        try {
          const p = await context.newPage(),
            posts: string[] = []
          p.on("request", (r) => {
            if (r.method() === "POST" && r.url().includes("/api/v1/commands/"))
              posts.push(r.url())
          })
          await open(p)
          await choose(institution(p), "FINANCE_COMPANY")
          const before = await snapshot()
          const list = p.waitForResponse(
            (r) =>
              r
                .url()
                .includes("/api/v1/queries/parties?type=FINANCE_COMPANY") &&
              r.url().includes(encodeURIComponent(run))
          )
          await enter(
            p.getByLabel("Search active finance companies"),
            `UI finance ${run}`
          )
          const projected = (await (await list).json()).data.data
          assert.equal(projected.length, 2)
          assert.ok(
            projected.every(
              (v: PartyDetailDTO) => !Object.hasOwn(v, "revision")
            )
          )
          await expect(companySelect(p).locator("option")).toHaveCount(1)
          await expect(revision(p)).toHaveText("Selected revision: Unavailable")
          assert.deepEqual(posts, [])
          const after = await snapshot()
          assert.deepEqual(after, before)
          events.push({
            kind: "actual-hidden-revision",
            projected,
            posts,
            before,
            after,
            zeroEffects: true,
          })
        } finally {
          await context.close()
        }
      } finally {
        const user = await f.query<{
          id: string
          revision: number
          name: string
        }>(admin, "user", `?id=${actor.user.id}`)
        const roles = await Promise.all(
          actor.roles.map((v) =>
            f.query<{ id: string; revision: number }>(
              admin,
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
              reason: "Restore original synthetic staff roles",
            },
            [ref(user, "User"), ...roles.map((v) => ref(v, "Role"))]
          )
        )
        await staff.dispose()
      }
      assert.deepEqual(errors, [])
      events.push({ kind: "PASS", created })
      console.log(
        "PASS all six acquisition forms, both correction consumers, actual mismatch/hidden state and zero browser errors"
      )
    }
  } finally {
    await admin.dispose()
  }
} catch (error) {
  events.push({
    kind: "FAIL",
    error: error instanceof Error ? error.stack : String(error),
  })
  throw error
} finally {
  await save()
  await browser.close()
  await f.close()
}
