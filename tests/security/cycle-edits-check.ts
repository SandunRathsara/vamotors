/** UI -> production HTTP -> private PostgreSQL, with immutable source snapshots. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  chromium,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  CurrentActorDTO,
  Dependency,
  Grant,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import {
  fixture,
  seed,
  envelope,
  ref,
  refs,
  purchaseInput,
} from "./cycle-edits-fixture"

const root = process.argv[2]
assert.ok(root)
const f = await fixture(root, process.argv[3] ?? process.cwd()),
  suffix = randomUUID().slice(0, 8),
  groups: string[] = [],
  evidence: unknown[] = []
const browser = await chromium.launch({ headless: true })
let admin!: APIRequestContext,
  second!: APIRequestContext,
  staff!: APIRequestContext,
  original!: CurrentActorDTO,
  supplier!: { id: string; revision: number },
  cycle!: PurchaseCycleDTO,
  stage = "initialize"
const clients: APIRequestContext[] = [],
  pages: Page[] = []
const current = (id = cycle.id, client = admin) =>
  f.query<PurchaseCycleDTO>(client, "purchase", `?cycleId=${id}`)
const cmd = (
  name: string,
  input: unknown,
  expected: Dependency[] = [],
  status = 200,
  client = admin
) => f.command(client, name, envelope(input, expected), status)
const reads: Grant[] = (
  ["PurchaseRecord", "Vehicle", "VehicleCost", "AuditLog", "Supplier"] as const
).map((subject) => ({ subject, action: "read", fields: ["*"] }))
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
async function create(
  tag: string,
  reading = 0,
  date = "2026-10-01",
  client = admin
) {
  const result = await cmd(
    "recordPurchase",
    purchaseInput(supplier.id, suffix, tag, reading, date),
    [ref(supplier, "Supplier")],
    201,
    client
  )
  return current(result.result.id, client)
}
async function assign(grants: Grant[]) {
  const role = await cmd(
    "saveRole",
    {
      name: `Edits-${suffix}-${randomUUID()}`,
      reason: "Synthetic current authority",
      grants,
    },
    [],
    201
  )
  const user = await f.query<{ id: string; revision: number; name: string }>(
    admin,
    "user",
    `?id=${original.user.id}`
  )
  await cmd(
    "updateUser",
    {
      id: user.id,
      name: user.name,
      active: true,
      roleIds: [role.result.id],
      reason: "Synthetic current authority",
    },
    [ref(user, "User"), ref(role.result, "Role")]
  )
  const actor = await f.query<CurrentActorDTO>(staff, "currentActor")
  assert.equal(actor.roles.length, 1)
  evidence.push({ grants, actor })
  return role
}
async function restore() {
  if (!original || !admin) return
  const user = await f.query<{ id: string; revision: number; name: string }>(
      admin,
      "user",
      `?id=${original.user.id}`
    ),
    roles = await Promise.all(
      original.roles.map((r) =>
        f.query<{ id: string; revision: number }>(admin, "role", `?id=${r.id}`)
      )
    )
  await cmd(
    "updateUser",
    {
      id: user.id,
      name: user.name,
      active: true,
      roleIds: roles.map((r) => r.id),
      reason: "Restore original synthetic staff",
    },
    [ref(user, "User"), ...roles.map((r) => ref(r, "Role"))]
  )
}
async function zeroEffect(
  name: string,
  body: unknown,
  status: number,
  client = admin
) {
  const before = await f.snapshot()
  await f.command(client, name, body, status)
  assert.equal(await f.snapshot(), before)
}
async function pageFor(client: APIRequestContext, width: number) {
  const context = await browser.newContext({
      baseURL: f.origin,
      storageState: await client.storageState(),
      viewport: { width, height: 1080 },
      serviceWorkers: "allow",
    }),
    page = await context.newPage()
  pages.push(page)
  return page
}
function input(
  row: PurchaseCycleDTO,
  name: string,
  tag: string = randomUUID()
) {
  return name === "addMileage"
    ? {
        cycleId: row.id,
        mileage: {
          reading: 1000,
          date: "2026-10-20",
          decreaseReason: `Chronological source correction ${tag}`,
        },
      }
    : name === "setListedPrice"
      ? {
          cycleId: row.id,
          amount: String(20000 + row.revision),
          reason: `Asking price ${tag}`,
        }
      : {
          vehicleId: row.vehicleId,
          values: { ...row.identity, colour: `Corrected ${tag}` },
          reason: `Physical correction ${tag}`,
        }
}
try {
  await f.start()
  admin = await f.login("ADMIN")
  second = await f.login("SECOND")
  staff = await f.login("STAFF")
  clients.push(admin, second, staff)
  original = await f.query(staff, "currentActor")
  await group(
    "nonempty lawful costs/reversal/basis/held stock and immutable quote",
    async () => {
      const seeded = await seed(f, admin, suffix)
      supplier = seeded.supplier
      cycle = seeded.cycle
      assert.equal(cycle.status, "IN_STOCK")
      assert.equal(cycle.financial?.basis, "10500")
      assert.ok(Number(seeded.quoteCount) > 0)
    }
  )
  await group(
    "1920/360 keyboard UI: asking zero, mileage zero with reason, full physical correction",
    async () => {
      const page = await pageFor(admin, 1920),
        mobile = await pageFor(second, 360),
        money = await f.snapshot([
          "PurchasePayment",
          "CostPayment",
          "VehicleCost",
          "CycleBasisVersion",
          "Quote",
        ])
      await page.goto(`/purchases/${cycle.id}`)
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      await page
        .getByRole("button", { name: "Set asking price", exact: true })
        .click()
      await page.getByLabel("Asking price (major units)").fill("0.00")
      await page
        .getByRole("button", { name: "Confirm cycle edit", exact: true })
        .focus()
      await page.keyboard.press("Enter")
      await expect(
        page.getByRole("status").filter({ hasText: "Cycle details committed" })
      ).toBeVisible()
      cycle = await current(cycle.id, second)
      assert.equal(cycle.listedPrice, "0")
      assert.equal(cycle.identityRevision, 1)
      await mobile.goto(`/vehicles/${cycle.vehicleId}`)
      await mobile
        .getByRole("button", { name: "Append mileage", exact: true })
        .click()
      await mobile.getByLabel("Actual mileage reading").fill("0")
      await mobile.getByLabel("Actual mileage date").fill("2026-10-04")
      await mobile.getByLabel("Mileage remark").fill("Actual zero retained")
      await mobile
        .getByRole("button", { name: "Confirm cycle edit", exact: true })
        .focus()
      await mobile.keyboard.press("Enter")
      await expect(
        mobile
          .getByRole("status")
          .filter({ hasText: "Cycle details committed" })
      ).toBeVisible()
      cycle = await current()
      assert.equal(cycle.identityRevision, 2)
      assert.equal(cycle.mileage.at(-1)?.reading, 0)
      await page.reload()
      await page
        .getByRole("button", { name: "Correct physical details", exact: true })
        .click()
      await page.getByLabel("Physical Colour", { exact: false }).fill("Green")
      await page.getByLabel("Physical VIN", { exact: false }).fill("")
      await page.getByLabel("Physical CR number", { exact: false }).fill("")
      await page.getByLabel("Physical Vehicle notes", { exact: false }).fill("")
      await page
        .getByLabel("Mandatory physical correction reason")
        .fill("PRIVATE_PHYSICAL_REASON")
      await page
        .getByRole("button", { name: "Confirm cycle edit", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Cycle details committed" })
      ).toBeVisible()
      cycle = await current(cycle.id, second)
      assert.equal(cycle.identity.colour, "Green")
      assert.equal(cycle.identity.vin, undefined)
      assert.equal(cycle.identityRevision, 3)
      assert.equal(
        await f.snapshot([
          "PurchasePayment",
          "CostPayment",
          "VehicleCost",
          "CycleBasisVersion",
          "Quote",
        ]),
        money
      )
      const stored = (
        await f.db.query(
          'SELECT vin,"crNumber",notes FROM vamotors."Vehicle" WHERE id=$1',
          [cycle.vehicleId]
        )
      ).rows[0]
      assert.deepEqual(stored, { vin: null, crNumber: null, notes: null })
      for (const p of [page, mobile]) {
        await p.reload()
        assert.equal(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        )
        await p.screenshot({
          path: join(
            root,
            `cycle-edits-${suffix}-${p === page ? 1920 : 360}.png`
          ),
          fullPage: true,
        })
      }
    }
  )
  await group(
    "strict false inputs, wrong/missing/stale exact selectors and money boundaries are zero-effect",
    async () => {
      cycle = await current()
      for (const mileage of [
        { reading: -1, date: "2026-10-05" },
        { reading: 1.2, date: "2026-10-05" },
        { reading: 100000000, date: "2026-10-05" },
        { reading: "0", date: "2026-10-05" },
        { reading: 1, date: "2026-02-30" },
        { reading: 1, date: "9999-01-01" },
        { reading: 1, date: "2026-09-30" },
        { reading: 0, date: "2026-10-05", remark: " " },
        { reading: 0, date: "2026-10-05", decreaseReason: " " },
      ])
        await zeroEffect(
          "addMileage",
          envelope({ cycleId: cycle.id, mileage }, refs(cycle, "addMileage")),
          422
        )
      for (const amount of [
        "01",
        "-1",
        "1.0",
        "1e2",
        "100000000000000",
        0,
        null,
      ])
        await zeroEffect(
          "setListedPrice",
          envelope(
            { cycleId: cycle.id, amount },
            refs(cycle, "setListedPrice")
          ),
          422
        )
      for (const values of [
        { ...cycle.identity, year: 1885 },
        { ...cycle.identity, engineNumber: " \t " },
        { ...cycle.identity, fuelType: "STEAM" },
        { ...cycle.identity, transmission: "OTHER" },
        { ...cycle.identity, vin: null },
        { ...cycle.identity, activePurchaseId: randomUUID() },
      ]) {
        if (values.transmission === "OTHER") {
          delete (values as Partial<typeof values>).make
        }
        await zeroEffect(
          "editVehicle",
          envelope(
            { vehicleId: cycle.vehicleId, values, reason: "Correction" },
            refs(cycle, "editVehicle")
          ),
          422
        )
      }
      for (const name of ["addMileage", "setListedPrice", "editVehicle"]) {
        await zeroEffect(name, envelope(input(cycle, name)), 428)
        await zeroEffect(
          name,
          envelope(
            input(cycle, name),
            refs(cycle, name).map((r) => ({ ...r, id: randomUUID() }))
          ),
          428
        )
        await zeroEffect(
          name,
          envelope(
            input(cycle, name),
            refs(cycle, name).map((r) => ({ ...r, revision: 1 }))
          ),
          409
        )
        await zeroEffect(
          name,
          envelope(
            { ...input(cycle, name), actor: "ADMIN" },
            refs(cycle, name)
          ),
          422
        )
      }
      for (const expected of [[ref(cycle)], [refs(cycle, "addMileage")[1]]])
        await zeroEffect(
          "addMileage",
          envelope(input(cycle, "addMileage"), expected),
          428
        )
      for (const name of ["addMileage", "setListedPrice"] as const) {
        await assign([
          ...reads,
          {
            subject: "PurchaseRecord",
            action: "update",
            fields: [
              "cycleId",
              "reason",
              "amount",
              "mileage.reading",
              "mileage.date",
              "mileage.remark",
              "mileage.decreaseReason",
            ].filter(
              (f) => f !== (name === "addMileage" ? "mileage.date" : "amount")
            ),
          },
        ])
        assert.ok(!(await current(cycle.id, staff)).nextActions?.includes(name))
        await zeroEffect(
          name,
          envelope(input(cycle, name), refs(cycle, name)),
          403,
          staff
        )
      }
      await restore()
      await cmd(
        "setListedPrice",
        { cycleId: cycle.id, amount: "99999999999999" },
        refs(cycle, "setListedPrice")
      )
      cycle = await current()
      assert.equal(cycle.listedPrice, "99999999999999")
      await zeroEffect(
        "setListedPrice",
        envelope(
          { cycleId: cycle.id, amount: cycle.listedPrice },
          refs(cycle, "setListedPrice")
        ),
        409
      )
    }
  )
  await group(
    "predecessor/successor chronology, backdating, same-day ties, decreasing zero and immutable initial mileage",
    async () => {
      let row = await create("chronology", 100, "2026-10-03")
      const initial = row.mileage[0]
      await cmd(
        "addMileage",
        { cycleId: row.id, mileage: { reading: 200, date: "2026-10-05" } },
        refs(row, "addMileage")
      )
      row = await current(row.id)
      for (const mileage of [
        {
          reading: 250,
          date: "2026-10-04",
          decreaseReason: "Cannot authorize an unexplained old successor",
        },
        {
          reading: 150,
          date: "2026-10-02",
          decreaseReason: "Cannot change initial successor",
        },
        { reading: 0, date: "2026-10-06" },
      ])
        await zeroEffect(
          "addMileage",
          envelope({ cycleId: row.id, mileage }, refs(row, "addMileage")),
          422
        )
      await cmd(
        "addMileage",
        { cycleId: row.id, mileage: { reading: 50, date: "2026-10-02" } },
        refs(row, "addMileage")
      )
      row = await current(row.id)
      for (let i = 0; i < 2; i++) {
        await cmd(
          "addMileage",
          { cycleId: row.id, mileage: { reading: 200, date: "2026-10-06" } },
          refs(row, "addMileage")
        )
        row = await current(row.id)
      }
      await cmd(
        "addMileage",
        {
          cycleId: row.id,
          mileage: {
            reading: 0,
            date: "2026-10-07",
            decreaseReason: "PRIVATE_DECREASE_REASON",
            remark: "PRIVATE_MILEAGE_REMARK",
          },
        },
        refs(row, "addMileage")
      )
      row = await current(row.id)
      assert.equal(row.mileage.at(-1)?.reading, 0)
      assert.deepEqual(
        row.mileage.find((m) => m.id === initial.id),
        initial
      )
      const tied = row.mileage.filter((m) => m.date === "2026-10-06")
      assert.equal(tied.length, 2)
      assert.deepEqual(
        tied.map((m) => m.id),
        tied.map((m) => m.id).sort()
      )
      evidence.push({ chronology: row })
      for (const subject of ["Vehicle", "PurchaseRecord"] as const) {
        await assign([
          ...reads.filter((g) => g.subject !== subject),
          {
            subject,
            action: "read",
            fields: [
              "id",
              "revision",
              "identityRevision",
              "cycleId",
              "vehicleId",
              "status",
              "closedAt",
              "mileage.reading",
              "mileage.date",
              ...(subject === "PurchaseRecord" ? ["nextActions"] : []),
            ].filter(
              (p) =>
                !(
                  subject === "Vehicle" && ["vehicleId", "closedAt"].includes(p)
                ) && !(subject === "PurchaseRecord" && p === "cycleId")
            ),
          },
        ])
        const visible = await current(row.id, staff),
          vehicle = await f.query(staff, "vehicle", `?id=${row.vehicleId}`)
        for (const value of [
          visible,
          vehicle,
          await f.query(staff, "audit", `?type=PurchaseRecord&id=${row.id}`),
          await f.query(staff, "audit", `?type=Vehicle&id=${row.vehicleId}`),
        ])
          assert.ok(
            !JSON.stringify(value).includes("PRIVATE_DECREASE_REASON") &&
              !JSON.stringify(value).includes("PRIVATE_MILEAGE_REMARK")
          )
        assert.equal(visible.mileage.at(-1)?.reading, 0)
        assert.ok(!visible.nextActions?.includes("addMileage"))
      }
      await restore()
    }
  )
  await group(
    "normalized composite identity, punctuation, same-engine legal pair, hidden collision and leaf authority",
    async () => {
      let a = await create("identity-a")
      const b = await create("identity-b")
      const before = await f.snapshot()
      await zeroEffect(
        "editVehicle",
        envelope(
          {
            vehicleId: a.vehicleId,
            values: {
              ...a.identity,
              engineNumber: ` ${b.identity.engineNumber.toLowerCase().split("").join(" ")} `,
              chassisNumber: b.identity.chassisNumber.toLowerCase(),
            },
            reason: "Actual normalized collision",
          },
          refs(a, "editVehicle")
        ),
        409
      )
      assert.equal(await f.snapshot(), before)
      await cmd(
        "editVehicle",
        {
          vehicleId: a.vehicleId,
          values: {
            ...a.identity,
            engineNumber: b.identity.engineNumber,
            chassisNumber: `${b.identity.chassisNumber}-PUNCT`,
          },
          reason: "Same engine is not individual uniqueness",
        },
        refs(a, "editVehicle")
      )
      a = await current(a.id)
      const lookup = await f.query<{ id: string; revision: number }>(
        admin,
        "vehicleIdentity",
        `?engineNumber=${encodeURIComponent(a.identity.engineNumber.toLowerCase())}&chassisNumber=${encodeURIComponent(a.identity.chassisNumber.toLowerCase())}`
      )
      assert.equal(lookup.id, a.vehicleId)
      assert.equal(lookup.revision, a.identityRevision)
      for (const subject of ["Vehicle", "PurchaseRecord"] as const) {
        await assign([
          ...reads.filter((g) => g.subject !== subject),
          {
            subject,
            action: "read",
            fields: [
              "id",
              "revision",
              "status",
              "identityRevision",
              ...(subject === "PurchaseRecord"
                ? ["vehicleId", "closedAt", "nextActions"]
                : ["cycleId"]),
              ...[
                "engineNumber",
                "chassisNumber",
                "make",
                "model",
                "year",
                "fuelType",
                "transmission",
                "vin",
                "crNumber",
                "notes",
              ].map((f) => `identity.${f}`),
            ],
          },
          { subject: "Vehicle", action: "update", fields: ["*"] },
        ])
        const visible = await current(cycle.id, staff)
        assert.equal(visible.identity.colour, undefined)
        assert.ok(!visible.nextActions?.includes("editVehicle"))
        await zeroEffect(
          "editVehicle",
          envelope(
            {
              vehicleId: cycle.vehicleId,
              values: { ...cycle.identity, colour: "Hidden change" },
              reason: "Denied consumed leaf",
            },
            refs(cycle, "editVehicle")
          ),
          403,
          staff
        )
        for (const type of ["PurchaseRecord", "Vehicle"])
          assert.ok(
            !JSON.stringify(
              await f.query(
                staff,
                "audit",
                `?type=${type}&id=${type === "Vehicle" ? cycle.vehicleId : cycle.id}`
              )
            ).includes("PRIVATE_PHYSICAL_REASON")
          )
      }
      const own: Grant[] = [
        ...reads.filter(
          (g) => !["Vehicle", "PurchaseRecord"].includes(g.subject)
        ),
        ...(["Vehicle", "PurchaseRecord"] as const).map(
          (subject): Grant => ({
            subject,
            action: "read",
            fields: ["*"],
            conditions: { createdBy: "$actor.id" },
          })
        ),
        {
          subject: "Vehicle",
          action: "update",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "Vehicle", action: "create", fields: ["*"] },
        { subject: "PurchaseRecord", action: "create", fields: ["*"] },
      ]
      await assign(own)
      const mine = await create("staff-own", 0, "2026-10-01", staff)
      await zeroEffect(
        "editVehicle",
        envelope(
          {
            vehicleId: mine.vehicleId,
            values: b.identity,
            reason: "Hidden collision must not reveal target identity",
          },
          refs(mine, "editVehicle")
        ),
        409,
        staff
      )
      await zeroEffect(
        "editVehicle",
        envelope(input(b, "editVehicle"), refs(b, "editVehicle")),
        404,
        staff
      )
      await assign([
        ...reads,
        {
          subject: "Vehicle",
          action: "update",
          fields: ["vehicleId", "reason", "values.colour"],
        },
      ])
      await cmd(
        "editVehicle",
        {
          vehicleId: a.vehicleId,
          values: { ...a.identity, colour: "One authorized leaf" },
          reason: "Leaf-scoped lawful correction",
        },
        refs(a, "editVehicle"),
        200,
        staff
      )
      a = await current(a.id)
      await zeroEffect(
        "editVehicle",
        envelope(
          {
            vehicleId: a.vehicleId,
            values: { ...a.identity, make: "Forbidden leaf" },
            reason: "Not allowed",
          },
          refs(a, "editVehicle")
        ),
        403,
        staff
      )
      await restore()
    }
  )
  await group(
    "same-key canonical replay and different-key mileage/price/identity CAS races",
    async () => {
      for (const name of ["addMileage", "setListedPrice", "editVehicle"]) {
        let row = await create(`race-${name}`)
        const body = envelope(input(row, name), refs(row, name))
        const same = await Promise.all([
          f.command(admin, name, body),
          f.command(admin, name, {
            input: body.input,
            expected: body.expected,
            idempotencyKey: body.idempotencyKey,
            schemaVersion: 1,
          }),
        ])
        assert.equal(same[0].commandId, same[1].commandId)
        assert.equal(same.filter((r) => r.replayed).length, 1)
        row = await current(row.id)
        const before = await f.snapshot()
        await f.command(admin, name, body)
        assert.equal(await f.snapshot(), before)
        await zeroEffect(
          name,
          { ...body, input: input(row, name, "changed committed body") },
          409
        )
        const bodies = [
          envelope(input(row, name), refs(row, name)),
          envelope(input(row, name), refs(row, name)),
        ]
        const responses = await Promise.all(
          bodies.map((data, i) =>
            (i ? second : admin).post(`/api/v1/commands/${name}`, {
              data,
              headers: { Origin: f.origin },
            })
          )
        )
        assert.deepEqual(responses.map((r) => r.status()).sort(), [200, 409])
        assert.equal((await current(row.id)).revision, row.revision + 1)
      }
      let row = await create("acquisition-race")
      const vehicle = {
        ...row.identity,
        engineNumber: `CONTEST-E-${suffix.toUpperCase()}`,
        chassisNumber: `CONTEST-C-${suffix.toUpperCase()}`,
      }
      const acquired = {
        ...purchaseInput(supplier.id, suffix, "contender"),
        vehicle,
      }
      const responses = await Promise.all([
        admin.post("/api/v1/commands/editVehicle", {
          data: envelope(
            {
              vehicleId: row.vehicleId,
              values: vehicle,
              reason: "Competing normalized identity",
            },
            refs(row, "editVehicle")
          ),
          headers: { Origin: f.origin },
        }),
        second.post("/api/v1/commands/recordPurchase", {
          data: envelope(acquired, [ref(supplier, "Supplier")]),
          headers: { Origin: f.origin },
        }),
      ])
      const statuses = responses.map((r) => r.status())
      assert.ok(
        (statuses[0] === 200 && statuses[1] === 428) ||
          (statuses[0] === 409 && statuses[1] === 201)
      )
      row = await current(row.id)
      assert.equal(
        (
          await f.db.query(
            'SELECT count(*) FROM vamotors."Vehicle" WHERE "normalizedEngine"=$1 AND "normalizedChassis"=$2',
            [vehicle.engineNumber, vehicle.chassisNumber]
          )
        ).rows[0].count,
        "1"
      )
      evidence.push({ acquisitionIdentityRace: statuses, row })
    }
  )
  await group(
    "every essential write/final constraint rolls back; same-key recovery includes app/DB restart",
    async () => {
      let restarted = false
      for (const name of ["addMileage", "setListedPrice", "editVehicle"]) {
        let row = await create(`fault-${name}`)
        for (const [table, timing, predicate] of [
          ...(name === "setListedPrice"
            ? []
            : [["Vehicle", "BEFORE UPDATE", "true"]]),
          ...(name === "addMileage"
            ? [["MileageReading", "BEFORE INSERT", "true"]]
            : []),
          ["PurchaseRecord", "BEFORE UPDATE", "true"],
          ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='PurchaseRecord'`],
          ["AuditEntry", "BEFORE INSERT", `NEW."entityType"='Vehicle'`],
          [
            "EntityReadVersion",
            "BEFORE INSERT",
            `NEW."entityType"='PurchaseRecord'`,
          ],
          ["EntityReadVersion", "BEFORE INSERT", `NEW."entityType"='Vehicle'`],
          ["CommandReceipt", "BEFORE INSERT", "true"],
          ["BusinessSequence", "BEFORE UPDATE", "true"],
          ["PurchaseRecord", "AFTER UPDATE", "true"],
        ]) {
          const body = envelope(input(row, name), refs(row, name)),
            before = await f.snapshot()
          try {
            await f.db.query(
              `CREATE FUNCTION vamotors.cycle_edit_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'SYNTHETIC_EDIT_FAULT'; END IF; RETURN NEW; END $$`
            )
            await f.db.query(
              timing === "AFTER UPDATE"
                ? `CREATE CONSTRAINT TRIGGER cycle_edit_test_fault AFTER UPDATE ON vamotors."${table}" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_edit_test_fault()`
                : `CREATE TRIGGER cycle_edit_test_fault ${timing} ON vamotors."${table}" FOR EACH ROW EXECUTE FUNCTION vamotors.cycle_edit_test_fault()`
            )
            await f.command(admin, name, body, 500)
            assert.equal(await f.snapshot(), before)
          } finally {
            await f.db.query(
              `DROP TRIGGER IF EXISTS cycle_edit_test_fault ON vamotors."${table}"`
            )
            await f.db.query(
              "DROP FUNCTION IF EXISTS vamotors.cycle_edit_test_fault()"
            )
          }
          if (!restarted) {
            await f.restart()
            assert.equal(await f.snapshot(), before)
            restarted = true
          }
          await f.command(admin, name, body)
          row = await current(row.id)
        }
      }
    }
  )
  await group(
    "observed BusinessSequence wait rechecks execution and replay current authority",
    async () => {
      const adminEnv = await privateEnvironment(join(root, "admin.env")),
        url = new URL(adminEnv.ADMIN_URL!)
      url.pathname = "/vamotors_local"
      const monitor = new pg.Pool({ connectionString: url.href, max: 1 })
      try {
        for (const name of ["addMileage", "setListedPrice", "editVehicle"]) {
          const grants: Grant[] = [
            ...reads,
            { subject: "Vehicle", action: "update", fields: ["*"] },
            { subject: "PurchaseRecord", action: "update", fields: ["*"] },
          ]
          let row = await create(`wait-${name}`)
          await assign(grants)
          const committed = envelope(input(row, name), refs(row, name))
          await f.command(staff, name, committed)
          for (const mode of ["execution", "replay"]) {
            await assign(grants)
            row = await current(row.id)
            const body =
                mode === "replay"
                  ? committed
                  : envelope(input(row, name), refs(row, name)),
              blocker = await f.db.connect()
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
              const before = await f.snapshot()
              await blocker.query("COMMIT")
              assert.equal((await response).status(), 403)
              assert.equal(await f.snapshot(), before)
            } finally {
              await blocker.query("ROLLBACK")
              blocker.release()
            }
          }
        }
      } finally {
        await monitor.end()
        await restore()
      }
    }
  )
  await group(
    "active-SW committed response loss, stale explicit reconfirmation and draft purge",
    async () => {
      let row = await create("ui-intent")
      const page = await pageFor(admin, 360),
        bodies: string[] = []
      await page.goto(`/purchases/${row.id}`)
      await page.waitForFunction(
        () => navigator.serviceWorker.controller?.state === "activated"
      )
      await page
        .getByRole("button", { name: "Set asking price", exact: true })
        .click()
      await page.getByLabel("Asking price (major units)").fill("222.00")
      await page
        .context()
        .route("**/api/v1/commands/setListedPrice", async (route) => {
          bodies.push(route.request().postData()!)
          if (bodies.length === 1) {
            const r = await route.fetch()
            assert.equal(r.status(), 200)
            await route.abort("failed")
          } else await route.continue()
        })
      await page
        .getByRole("button", { name: "Confirm cycle edit", exact: true })
        .click()
      await expect(
        page.getByRole("button", { name: "Retry unchanged cycle edit" })
      ).toBeVisible()
      const before = await f.snapshot()
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await page
        .getByRole("button", { name: "Retry unchanged cycle edit" })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Cycle details committed" })
      ).toBeVisible()
      assert.equal(bodies[0], bodies[1])
      assert.equal(await f.snapshot(), before)
      await page.context().unroute("**/api/v1/commands/setListedPrice")
      await page
        .getByRole("button", { name: "Set asking price", exact: true })
        .click()
      await page.getByLabel("Asking price (major units)").fill("333.00")
      row = await current(row.id)
      await cmd(
        "setListedPrice",
        { cycleId: row.id, amount: "44400" },
        refs(row, "setListedPrice"),
        200,
        second
      )
      await page
        .getByRole("button", { name: "Confirm cycle edit", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "STALE_REVISION" })
      ).toBeVisible()
      await page.context().route("**/api/v1/queries/purchase?**", (route) => {
        assert.ok(route.request().serviceWorker())
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { code: "RETRYABLE_TRANSACTION", retryable: true },
          }),
        })
      })
      await page
        .getByRole("button", { name: "Reload current edit references" })
        .click()
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Current cycle reload failed" })
      ).toBeVisible()
      await expect(page.getByLabel("Asking price (major units)")).toHaveValue(
        "333.00"
      )
      await page.context().unroute("**/api/v1/queries/purchase?**")
      await page
        .getByRole("button", { name: "Reload current edit references" })
        .click()
      await page
        .getByRole("button", { name: "Reconfirm retained edit as new intent" })
        .click()
      await page
        .getByRole("button", { name: "Confirm cycle edit", exact: true })
        .click()
      await expect(
        page.getByRole("status").filter({ hasText: "Cycle details committed" })
      ).toBeVisible()
      assert.equal((await current(row.id)).listedPrice, "33300")
      await assign([
        ...reads,
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
      ])
      const limited = await pageFor(staff, 1920)
      await limited.goto(`/purchases/${row.id}`)
      await limited
        .getByRole("button", { name: "Append mileage", exact: true })
        .click()
      await limited.getByLabel("Mileage remark").fill("PRIVATE_EDIT_DRAFT")
      await assign(reads)
      await limited.evaluate(() =>
        window.dispatchEvent(new Event("auth-check"))
      )
      await expect(limited.getByLabel("Mileage remark")).toHaveCount(0)
      await assign([
        ...reads,
        { subject: "PurchaseRecord", action: "update", fields: ["*"] },
      ])
      await limited.goto(`/purchases/${row.id}`)
      await limited
        .getByRole("button", { name: "Append mileage", exact: true })
        .click()
      await limited.getByLabel("Mileage remark").fill("PRIVATE_LOGOUT_EDIT")
      await limited.getByRole("button", { name: "Logout", exact: true }).click()
      await limited.waitForURL(/\/login(?:\?|$)/)
      await expect(limited.getByLabel("Mileage remark")).toHaveCount(0)
      const accounts = await privateEnvironment(join(root, "accounts.env"))
      await limited
        .getByLabel("Email Address")
        .fill(accounts.BOOTSTRAP_SECOND_EMAIL!)
      await limited
        .getByLabel("Password", { exact: true })
        .fill(accounts.BOOTSTRAP_SECOND_PASSWORD!)
      await limited
        .getByRole("button", { name: "Sign In", exact: true })
        .click()
      await limited.waitForURL("**/dashboard")
      await limited.goto(`/purchases/${row.id}`)
      await expect(limited.getByLabel("Mileage remark")).toHaveCount(0)
      assert.ok(
        !(await limited.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
            "PRIVATE_"
          )
        ))
      )
      await restore()
    }
  )
  await group(
    "runtime ACLs, append-only history, direct-write backstops and restart authoritative reads",
    async () => {
      cycle = await current()
      const before = await f.snapshot()
      for (const sql of [
        `UPDATE vamotors."Vehicle" SET revision=revision+1 WHERE id='${cycle.vehicleId}'`,
        `UPDATE vamotors."PurchaseRecord" SET "listedPrice"=1,revision=revision+1 WHERE id='${cycle.id}'`,
        `UPDATE vamotors."MileageReading" SET reading=1 WHERE "cycleId"='${cycle.id}'`,
        `DELETE FROM vamotors."MileageReading"`,
        `UPDATE vamotors."Vehicle" SET "activePurchaseId"=NULL WHERE id='${cycle.vehicleId}'`,
        `TRUNCATE vamotors."MileageReading"`,
        `ALTER TABLE vamotors."Vehicle" ADD COLUMN forbidden text`,
      ])
        await assert.rejects(f.restricted.query(sql))
      assert.equal(await f.snapshot(), before)
      await f.restart()
      assert.equal(await f.snapshot(), before)
      const reload = await current(cycle.id, second)
      assert.equal(reload.listedPrice, "99999999999999")
      assert.equal(reload.identity.colour, "Green")
      assert.equal(reload.mileage.at(-1)?.reading, 0)
      evidence.push({
        restart: reload,
        source: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
      })
    }
  )
  await writeFile(
    join(root, `cycle-edits-${suffix}.json`),
    JSON.stringify(
      {
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        origin: f.origin,
        groups,
        evidence,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.log(
    `PASS ${groups.length} cycle-edit groups; cycle-edits-${suffix}.json`
  )
} catch (error) {
  await writeFile(
    join(root, `cycle-edits-failure-${suffix}.json`),
    JSON.stringify(
      {
        stage,
        groups,
        error: error instanceof Error ? error.stack : "TEST_FAILED",
        evidence,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "TEST_FAILED"}`
  )
  process.exitCode = 1
} finally {
  try {
    await restore()
  } catch {
    console.error("STAFF_RESTORE_FAILED")
    process.exitCode = 1
  }
  await browser.close()
  for (const client of clients) await client.dispose()
  await f.close()
}
