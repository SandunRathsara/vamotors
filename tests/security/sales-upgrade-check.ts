/** Genuine v14 (T08) -> v15 (T09) upgrade check on non-empty PostgreSQL data. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type {
  Dependency,
  Grant,
  PurchaseCycleDTO,
  SaleDTO,
} from "../../.planning/implementation/contracts/api"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"

process.umask(0o077)
const [root, mode, parentDir] = process.argv.slice(2)
assert.ok(root && ["prepare", "verify"].includes(mode))
const stateFile = join(root, "sales-upgrade-state.json")

async function snapshotState(f: Awaited<ReturnType<typeof fixture>>) {
  const migrations = (
    await f.db.query(
      "SELECT migration_name FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
    )
  ).rows.map((r) => r.migration_name as string)
  const grants = (
    await f.db.query(
      'SELECT rp."roleId",r.name,r."systemKey",p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" ORDER BY rp."roleId",p."ruleHash"'
    )
  ).rows as {
    roleId: string
    name: string
    systemKey: string | null
    rule: Grant
  }[]
  const cycles = (
    await f.db.query(
      'SELECT id, status, "purchaseType", "acquisitionKind" FROM vamotors."PurchaseRecord" ORDER BY id'
    )
  ).rows
  return { migrations, grants, cycles }
}

if (mode === "prepare") {
  assert.ok(parentDir, "parentDir required in prepare mode")
  const f = await fixture(root, parentDir)
  try {
    await f.start()
    const admin = await f.login("ADMIN")
    const cmd = (
      name: string,
      input: unknown,
      expected: Dependency[] = [],
      status = 200
    ) => f.command(admin, name, envelope(input, expected), status)
    const suffix = randomUUID().slice(0, 8)
    const supplier = await cmd(
      "createDirectoryParty",
      {
        type: "SUPPLIER",
        values: {
          name: `Upgrade Supplier ${suffix}`,
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
          name: `Upgrade Vendor ${suffix}`,
          category: "COMPANY",
          specialisation: "Body",
          contacts: [],
        },
      },
      [],
      201
    )
    const cust = await cmd(
      "createCustomer",
      {
        fullName: `Upgrade Buyer ${suffix}`,
        callingName: "UpBuyer",
        nicOrPassport: `UPG-${suffix}`,
        address: "1 Upgrade Rd",
        phone: "0779999999",
      },
      [],
      201
    )
    const purchase = await cmd(
      "recordPurchase",
      purchaseInput(supplier.result.id, suffix, "upg", 500),
      [ref(supplier.result, "Supplier")],
      201
    )
    let cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${purchase.result.id}`
    )
    await cmd(
      "addCost",
      {
        cycleId: cycle.id,
        category: "Shipping",
        description: "Clearance",
        amount: "1000",
        incurredDate: "2026-10-02",
      },
      [ref(cycle)],
      201
    )
    cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${cycle.id}`
    )
    await cmd(
      "receiveStock",
      {
        cycleId: cycle.id,
        date: "2026-10-02",
        disposition: { kind: "HOLD", reason: "Needs touchup before sale" },
      },
      [ref(cycle)]
    )
    cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${cycle.id}`
    )
    const sent = await cmd(
      "sendRepair",
      {
        cycleId: cycle.id,
        vendorId: vendor.result.id,
        request: "Touchup",
        sentDate: "2026-10-02",
      },
      [ref(cycle), ref(vendor.result, "RepairVendor")],
      201
    )
    cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${cycle.id}`
    )
    await cmd(
      "returnRepair",
      {
        repairId: sent.result.id,
        invoiceAmount: "500",
        invoiceDate: "2026-10-02",
        returnedDate: "2026-10-02",
        summary: "Touchup finished",
      },
      [ref(cycle), ref(sent.result, "RepairRecord")]
    )
    cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${cycle.id}`
    )
    await cmd("releaseStock", { cycleId: cycle.id }, [ref(cycle)])

    // Custom v14 non-admin role to prove non-admin grant freeze on upgrade
    const customRole = await cmd(
      "saveRole",
      {
        name: `Custom V14 Manager ${suffix}`,
        grants: [
          {
            subject: "PurchaseRecord",
            action: "read",
            fields: ["*", "financial"],
          },
          {
            subject: "ApprovalRequest",
            action: "read",
            fields: ["*"],
          },
          {
            subject: "ApprovalRequest",
            action: "create",
            fields: ["*", "proposal"],
          },
        ],
        reason: "V14 baseline non-admin role",
      },
      [],
      201
    )
    const customGrants = (
      await f.db.query(
        'SELECT p.rule FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" WHERE rp."roleId"=$1 ORDER BY p."ruleHash"',
        [customRole.result.id]
      )
    ).rows.map((r) => r.rule as Grant)
    const before = await snapshotState(f)
    assert.equal(before.migrations.length, 18)

    await writeFile(
      stateFile,
      JSON.stringify(
        {
          cycleId: cycle.id,
          customerId: cust.result.id,
          supplierId: supplier.result.id,
          customRoleId: customRole.result.id,
          customGrants,
          before,
          suffix,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
    await admin.dispose()
  } finally {
    await f.close()
  }
} else {
  const saved = JSON.parse(await readFile(stateFile, "utf8")) as {
    cycleId: string
    customerId: string
    supplierId: string
    customRoleId: string
    customGrants: Grant[]
    before: Awaited<ReturnType<typeof snapshotState>>
    suffix: string
  }
  const f = await fixture(root)
  try {
    const after = await snapshotState(f)
    assert.equal(after.migrations.length, 19)
    assert.ok(
      after.migrations.includes("202611230001_immediate_sales_tradein")
    )

    // Custom v14 non-admin role did NOT gain new v15 PurchaseRecord/ApprovalRequest/SaleCase permissions
    const customAfter = after.grants
      .filter((g) => g.roleId === saved.customRoleId)
      .map((g) => g.rule)
    assert.deepEqual(customAfter, saved.customGrants)
    const customPurchaseRead = customAfter.filter(
      (g) => g.subject === "PurchaseRecord" && g.action === "read"
    )
    assert.ok(
      !customPurchaseRead.some(
        (g) =>
          g.fields.includes("tradeInSourceSaleId") ||
          g.fields.includes("financial.originalBasis") ||
          g.fields.includes("financial.restatedProfit")
      )
    )
    assert.ok(!customAfter.some((g) => g.subject === "SaleCase"))

    // ADMINISTRATOR gained SaleCase read/create/update + new PurchaseRecord fields
    const adminGrants = after.grants
      .filter((g) => g.systemKey === "ADMINISTRATOR")
      .map((g) => g.rule)
    for (const action of ["read", "create", "update"] as const) {
      assert.ok(
        adminGrants.some(
          (g) => g.subject === "SaleCase" && g.action === action
        ),
        `ADMINISTRATOR missing SaleCase:${action}`
      )
    }

    // Boot upgraded T09 server and sell pre-upgrade cycle cleanly
    await f.start()
    const admin = await f.login("ADMIN")
    let cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${saved.cycleId}`
    )
    assert.equal(cycle.status, "IN_STOCK")
    assert.equal(cycle.financial?.basis, "11500") // 10000 + 1000 cost + 500 repair
    const custRes = await f.query<{ id: string; revision: number }>(
      admin,
      "customer",
      `?id=${saved.customerId}`
    )
    const sale = await f.command(
      admin,
      "completeImmediate",
      envelope(
        {
          cycleId: cycle.id,
          customerId: custRes.id,
          kind: "CASH",
          price: "15000",
          date: "2026-10-10",
          mileage: 550,
          method: "CASH",
        },
        [ref(cycle), ref(custRes, "Customer")]
      ),
      201
    )
    const saleDto = await f.query<SaleDTO>(
      admin,
      "sale",
      `?id=${sale.result.id}`
    )
    assert.equal(saleDto.price, "15000")
    cycle = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${saved.cycleId}`
    )
    assert.equal(cycle.financial?.originalProfit, "3500")
    await admin.dispose()
  } finally {
    await f.close()
  }
}
console.log(JSON.stringify({ mode, pass: true }))
