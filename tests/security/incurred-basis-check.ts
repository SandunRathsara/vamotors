/** Real shared incurred-basis boundary, including unconditional failure snapshots. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import type { PurchaseCycleDTO } from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

const [root, source = process.cwd(), channel = "BOTH"] = process.argv.slice(2)
assert.ok(root && ["CASH", "LEASE_SETTLEMENT", "BOTH"].includes(channel))
const f = await fixture(root, source),
  runId = randomUUID()
const hash = (text: string) => createHash("sha256").update(text).digest("hex")
try {
  await f.start()
  const admin = await f.login("ADMIN")
  try {
    const supplier = await f.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Incurred C ${runId}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    for (const purchaseType of channel === "BOTH"
      ? ["CASH", "LEASE_SETTLEMENT"]
      : [channel]) {
      const common = purchaseInput(supplier.result.id, runId, purchaseType)
      const { purchasePrice, ...leaseCommon } = common
      assert.equal(purchasePrice, "10000")
      const created = await f.command(
        admin,
        "recordPurchase",
        envelope(
          purchaseType === "CASH"
            ? { ...common, purchaseType, purchasePrice: "99999999999999" }
            : {
                ...leaseCommon,
                purchaseType,
                settlement: {
                  institutionType: "BANK",
                  institutionName: "Synthetic C bank",
                  reference: "INCURRED-C",
                  amount: "99999999999999",
                  cashToSeller: "0",
                },
              },
          [ref(supplier.result, "Supplier")]
        ),
        201
      )
      const current = () =>
        f.query<PurchaseCycleDTO>(
          admin,
          "purchase",
          `?cycleId=${created.result.id}`
        )
      let row = await current()
      for (let index = 0; index < 100; index++) {
        await f.command(
          admin,
          "addCost",
          envelope(
            {
              cycleId: row.id,
              category: "Incurred C proof",
              description: `Exact component ${index}`,
              amount: index === 99 ? "99" : "99999999999999",
              incurredDate: "2026-10-02",
            },
            [ref(row)]
          ),
          201
        )
        row = await current()
      }
      assert.equal(row.financial?.basis, "9999999999999999")
      const key = randomUUID(),
        body = envelope(
          {
            cycleId: row.id,
            category: "Incurred C proof",
            description: "Would overflow C",
            amount: "1",
            incurredDate: "2026-10-02",
          },
          [ref(row)],
          key
        )
      const before = await f.snapshot(),
        response = await admin.post("/api/v1/commands/addCost", {
          headers: { Origin: f.origin },
          data: body,
        }),
        result = await response.json(),
        after = await f.snapshot()
      // Never let a wrong HTTP discriminator skip the rollback proof again.
      const receipt = {
        source,
        head: execFileSync("git", ["rev-parse", "HEAD"], {
          cwd: source,
          encoding: "utf8",
        }).trim(),
        purchaseType,
        cycleId: row.id,
        status: response.status(),
        result,
        before: hash(before),
        after: hash(after),
        zeroEffects: before === after,
      }
      for (const [name, value] of [
        ["before", before],
        ["after", after],
        ["result", JSON.stringify(receipt, null, 2)],
      ])
        await writeFile(
          join(root, `incurred-C-${runId}-${purchaseType}-${name}.json`),
          value,
          { flag: "wx", mode: 0o600 }
        )
      console.log(JSON.stringify(receipt))
      assert.equal(
        after,
        before,
        "C+1 must roll back business/audit/read/receipt/sequence effects regardless HTTP classification"
      )
      assert.equal(
        response.status(),
        422,
        "C+1 must be a domain rejection, not INTERNAL_ERROR"
      )
      assert.equal(result.error.code, "MONEY_OVERFLOW")
      const cost = row.costs.find((c) => c.amount === "99")!
      await f.command(
        admin,
        "editCost",
        envelope(
          {
            costId: cost.id,
            amount: "98",
            reason: "Make one cent of real incurred headroom",
          },
          [ref(row), ref(cost, "VehicleCost")]
        )
      )
      row = await current()
      const recoverable = { ...body, expected: [ref(row)] }
      const success = await f.command(admin, "addCost", recoverable, 201)
      row = await current()
      assert.equal(row.financial?.basis, "9999999999999999")
      const committed = await f.snapshot(),
        replay = await f.command(admin, "addCost", recoverable)
      assert.equal(replay.commandId, success.commandId)
      assert.equal(replay.replayed, true)
      assert.equal(await f.snapshot(), committed)
      console.log(
        `PASS ${purchaseType} exact C / C+1 422 zero effects / failed key recovered with current valid intent / immutable replay`
      )
    }
  } finally {
    await admin.dispose()
  }
} finally {
  await f.close()
}
