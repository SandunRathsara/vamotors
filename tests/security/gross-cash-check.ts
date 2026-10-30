/** Real HTTP source-cumulative C bounds. prepare once; probe is fast/read-only;
 * controls consumes the prepared boundary. all creates a fresh fixture then runs both.
 * Usage: <root> prepare|probe|controls|all. No SQL business fabrication or lowered cap.
 */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import type {
  Dependency,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { fixture, envelope, ref, purchaseInput } from "./cycle-edits-fixture"

const [root, mode = "all"] = process.argv.slice(2)
assert.ok(root && ["prepare", "probe", "controls", "all"].includes(mode))
const f = await fixture(root),
  run = randomUUID(),
  marker = join(root, "gross-cash-fixture.json")
const A = 99999999999999n,
  C = 9999999999999999n
const sha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
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
type Source = { cycleId: string; costId?: string }
type Prepared = {
  preparedSHA: string
  cash: Source
  lease: Source
  cost: Source
  leasePay: Source
  recoveryCostId: string
  keys: Record<"cash" | "lease" | "cost", ReturnType<typeof randomUUID>>
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const save = (name: string, value: unknown) =>
  writeFile(
    join(root, `gross-cash-${run}-${name}.json`),
    JSON.stringify(value, null, 2),
    { flag: "wx", mode: 0o600 }
  )
async function snapshot() {
  const result: Record<string, { count: number; sha256: string }> = {}
  for (const table of tables) {
    // Hash exact PostgreSQL text, not parsed JSON numbers (>2^53), and never
    // export bootstrap account emails or keyed input digests from audit/receipts.
    const rows = (
      await f.db.query(
        `SELECT id,encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS sha256 FROM vamotors."${table}" t ORDER BY id`
      )
    ).rows
    result[table] = { count: rows.length, sha256: hash(rows) }
  }
  return result // AdminGuard is a mutable mutex, not immutable business evidence.
}
const settlement = {
  institutionType: "BANK",
  institutionName: "Synthetic gross boundary bank",
  reference: "SOURCE-GROSS-C",
  amount: A.toString(),
  cashToSeller: "0",
}
try {
  assert.notEqual(new URL(f.origin).port, "8000")
  await f.start()
  const admin = await f.login("ADMIN")
  try {
    const current = (s: Source) =>
      f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${s.cycleId}`)
    const facts = (row: PurchaseCycleDTO, s: Source) =>
      s.costId
        ? row.costs.find((c) => c.id === s.costId)!.payments
        : row.payments
    const live = (row: PurchaseCycleDTO, s: Source) => {
      const payments = facts(row, s),
        found = payments.find(
          (p) => !p.reversalOf && !payments.some((r) => r.reversalOf === p.id)
        )
      assert.ok(found)
      return found
    }
    const expected = (row: PurchaseCycleDTO, s: Source): Dependency[] => [
      ref(row),
      ...(s.costId
        ? [ref(row.costs.find((c) => c.id === s.costId)!, "VehicleCost")]
        : []),
    ]
    const vehicleExpected = (row: PurchaseCycleDTO): Dependency[] => [
      ref(row),
      { type: "Vehicle", id: row.vehicleId, revision: row.identityRevision },
    ]
    const reverseBody = (
      row: PurchaseCycleDTO,
      s: Source,
      amount?: string,
      key = randomUUID()
    ) => {
      const p = live(row, s)
      return envelope(
        {
          sourceType: s.costId ? "COST" : "PURCHASE",
          sourceId: s.costId ?? row.id,
          paymentId: p.id,
          reason: "Actual original-entry gross boundary correction",
          ...(amount
            ? { replacement: { amount, date: p.date, method: p.method } }
            : {}),
        },
        expected(row, s),
        key
      )
    }
    async function gross(s: Source, incoming: bigint, outgoing: bigint) {
      const table = s.costId ? "CostPayment" : "PurchasePayment",
        owner = s.costId ? "costId" : "cycleId"
      const actual = (
        await f.db.query(
          `SELECT coalesce(sum(amount::numeric) FILTER(WHERE direction='IN'),0)::text AS incoming,coalesce(sum(amount::numeric) FILTER(WHERE direction='OUT'),0)::text AS outgoing FROM vamotors."${table}" WHERE "${owner}"=$1`,
          [s.costId ?? s.cycleId]
        )
      ).rows[0]
      assert.deepEqual(actual, {
        incoming: incoming.toString(),
        outgoing: outgoing.toString(),
      })
    }
    async function commitReplay(name: string, body: unknown) {
      const applied = await f.command(admin, name, body),
        before = await snapshot()
      const replay = await f.command(admin, name, body),
        after = await snapshot()
      await save(`replay-${name}-${applied.commandId}`, {
        sha,
        applied,
        replay,
        before,
        after,
        zeroEffects: hash(before) === hash(after),
      })
      assert.equal(replay.commandId, applied.commandId)
      assert.equal(replay.replayed, true)
      assert.deepEqual(after, before)
    }
    async function rejection(label: string, name: string, body: unknown) {
      const before = await snapshot()
      const response = await admin.post(`/api/v1/commands/${name}`, {
        headers: { Origin: f.origin },
        data: body,
      })
      const result = await response.json(),
        after = await snapshot()
      const record = {
        sha,
        mode,
        label,
        name,
        body,
        status: response.status(),
        result,
        before,
        after,
        zeroEffects: hash(before) === hash(after),
      }
      await save(label, record)
      console.log(
        JSON.stringify({
          label,
          status: response.status(),
          code: result.error?.code,
          zeroEffects: record.zeroEffects,
        })
      )
      // Always persist/compare all 13 populations before classifying HTTP failure.
      assert.deepEqual(
        after,
        before,
        `${label}: unconditional zero business/history effects`
      )
      return (
        response.status() === 422 && result.error?.code === "MONEY_OVERFLOW"
      )
    }
    let prepared: Prepared
    if (mode === "prepare" || mode === "all") {
      assert.equal(
        existsSync(marker),
        false,
        "Never overwrite/reseed a prepared fixture"
      )
      const supplier = await f.command(
        admin,
        "createDirectoryParty",
        envelope({
          type: "SUPPLIER",
          values: { name: `Gross C ${run}`, category: "COMPANY", contacts: [] },
        }),
        201
      )
      async function create(tag: string, lease = false): Promise<Source> {
        const common = purchaseInput(supplier.result.id, run, tag),
          { purchasePrice, ...base } = common
        assert.equal(purchasePrice, "10000")
        const result = await f.command(
          admin,
          "recordPurchase",
          envelope(
            lease
              ? { ...base, purchaseType: "LEASE_SETTLEMENT", settlement }
              : {
                  ...common,
                  purchaseType: "CASH",
                  purchasePrice: A.toString(),
                },
            [ref(supplier.result, "Supplier")]
          ),
          201
        )
        return { cycleId: result.result.id }
      }
      async function accumulate(s: Source) {
        let row = await current(s)
        const basis = row.basisVersions
        for (let i = 0; i < 99; i++) {
          await f.command(
            admin,
            "reversePayment",
            reverseBody(row, s, A.toString())
          )
          row = await current(s)
        }
        await gross(s, 99n * A, 100n * A)
        assert.equal(100n * A, C - 99n)
        assert.deepEqual(row.basisVersions, basis)
      }
      const cash = await create("cash")
      await accumulate(cash)
      const lease = await create("cash-to-lease")
      await accumulate(lease)
      let row = await current(lease)
      await f.command(admin, "reversePayment", reverseBody(row, lease, "99"))
      row = await current(lease)
      await f.command(admin, "reversePayment", reverseBody(row, lease))
      await gross(lease, C, C)
      row = await current(lease)
      await f.command(
        admin,
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            reason: "Truthful reverse then correct counterparty to bank",
            patch: { purchaseType: "LEASE_SETTLEMENT", settlement },
            cashCorrections: [],
          },
          vehicleExpected(row)
        )
      )
      row = await current(lease)
      assert.deepEqual(row.outstanding, {
        seller: "0",
        settlement: A.toString(),
      })
      assert.equal(row.basisVersions.length, 1)
      assert.equal(row.financial?.basis, A.toString())
      const cost = await create("cost")
      row = await current(cost)
      const invoice = await f.command(
        admin,
        "addCost",
        envelope(
          {
            cycleId: row.id,
            category: "Transport",
            description: "Actual gross-bound source invoice",
            amount: A.toString(),
            incurredDate: "2026-10-02",
            payment: {
              amount: A.toString(),
              date: "2026-10-02",
              method: "CASH",
            },
          },
          [ref(row)]
        ),
        201
      )
      cost.costId = invoice.result.id
      row = await current(cost)
      const recovery = await f.command(
        admin,
        "addCost",
        envelope(
          {
            cycleId: row.id,
            category: "Transport",
            description: "Separate legitimate one-cent payable",
            amount: "1",
            incurredDate: "2026-10-02",
          },
          [ref(row)]
        ),
        201
      )
      await accumulate(cost)
      const leasePay = await create("lease-exact-pay", true)
      await accumulate(leasePay)
      row = await current(leasePay)
      await f.command(admin, "reversePayment", reverseBody(row, leasePay))
      await gross(leasePay, C - 99n, C - 99n)
      prepared = {
        preparedSHA: sha,
        cash,
        lease,
        cost,
        leasePay,
        recoveryCostId: recovery.result.id,
        keys: { cash: randomUUID(), lease: randomUUID(), cost: randomUUID() },
      }
      await writeFile(marker, JSON.stringify(prepared, null, 2), {
        flag: "wx",
        mode: 0o600,
      })
      await save("prepared", { ...prepared, snapshot: await snapshot() })
      console.log(
        "PASS lawful CASH/COST/LEASE gross fixtures; real A-bounded immutable facts, no cap lowering or SQL fabrication"
      )
    } else prepared = JSON.parse(await readFile(marker, "utf8")) as Prepared
    if (mode === "probe" || mode === "all") {
      const cash = await current(prepared.cash),
        cost = await current(prepared.cost),
        lease = await current(prepared.lease)
      const results = []
      results.push(
        await rejection(
          "CASH-reversal-Cplus1",
          "reversePayment",
          reverseBody(cash, prepared.cash, "100", prepared.keys.cash)
        )
      )
      results.push(
        await rejection(
          "LEASE-institution-pay-Cplus1",
          "payPurchase",
          envelope(
            {
              cycleId: lease.id,
              recipient: "SETTLEMENT",
              payment: {
                amount: "1",
                date: "2026-10-03",
                method: "BANK_TRANSFER",
              },
            },
            [ref(lease)],
            prepared.keys.lease
          )
        )
      )
      results.push(
        await rejection(
          "COST-reversal-Cplus1",
          "reversePayment",
          reverseBody(cost, prepared.cost, "100", prepared.keys.cost)
        )
      )
      assert.deepEqual(
        results,
        [true, true, true],
        "Every actual gross C+1 path must return 422 MONEY_OVERFLOW"
      )
      console.log(
        "PASS three shared-guard HTTP rejections, all 13 populations unchanged"
      )
    }
    if (mode === "controls" || mode === "all") {
      let row = await current(prepared.cash),
        basis = row.basisVersions
      await commitReplay(
        "reversePayment",
        reverseBody(row, prepared.cash, "99", prepared.keys.cash)
      )
      await gross(prepared.cash, C - 99n, C)
      row = await current(prepared.cash)
      assert.deepEqual(row.basisVersions, basis)
      assert.equal(
        await rejection(
          "CASH-seller-pay-Cplus1",
          "payPurchase",
          envelope(
            {
              cycleId: row.id,
              recipient: "SELLER",
              payment: { amount: "1", date: "2026-10-03", method: "CASH" },
            },
            [ref(row)]
          )
        ),
        true
      )
      const correctionKey = randomUUID(),
        p = live(row, prepared.cash)
      assert.equal(
        await rejection(
          "editPurchase-cashCorrection-Cplus1",
          "editPurchase",
          envelope(
            {
              cycleId: row.id,
              reason: "Actual correction cannot overrun gross cap",
              patch: {},
              cashCorrections: [
                {
                  paymentId: p.id,
                  reason: "Original-entry correction",
                  replacement: { amount: "1", date: p.date, method: p.method },
                },
              ],
            },
            vehicleExpected(row),
            correctionKey
          )
        ),
        true
      )
      await commitReplay(
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            reason: "Same failed key, explicit valid notes-only intent",
            patch: { notes: "Gross bound remains exact C" },
            cashCorrections: [],
          },
          vehicleExpected(row),
          correctionKey
        )
      )
      row = await current(prepared.cash)
      await commitReplay("reversePayment", reverseBody(row, prepared.cash))
      await gross(prepared.cash, C, C)
      row = await current(prepared.cash)
      assert.deepEqual(row.basisVersions, basis)
      assert.equal(row.outstanding.seller, A.toString())
      row = await current(prepared.leasePay)
      // Recover the failed lease key with a new valid current intent, at exact C
      // on a lawful eligible lease source; zero payments are never fabricated.
      await commitReplay(
        "payPurchase",
        envelope(
          {
            cycleId: row.id,
            recipient: "SETTLEMENT",
            payment: {
              amount: "99",
              date: "2026-10-03",
              method: "BANK_TRANSFER",
            },
          },
          [ref(row)],
          prepared.keys.lease
        )
      )
      await gross(prepared.leasePay, C - 99n, C)
      row = await current(prepared.leasePay)
      assert.equal(row.outstanding.settlement, (A - 99n).toString())
      assert.equal(
        row.payments.find(
          (p) =>
            !p.reversalOf && !row.payments.some((r) => r.reversalOf === p.id)
        )!.category,
        "SETTLEMENT"
      )
      row = await current(prepared.cost)
      basis = row.basisVersions
      await commitReplay(
        "reversePayment",
        reverseBody(row, prepared.cost, "99", prepared.keys.cost)
      )
      await gross(prepared.cost, C - 99n, C)
      row = await current(prepared.cost)
      const child = row.costs.find((c) => c.id === prepared.cost.costId)!,
        costPayKey = randomUUID()
      assert.equal(
        await rejection(
          "payCost-Cplus1",
          "payCost",
          envelope(
            {
              costId: child.id,
              payment: { amount: "1", date: "2026-10-03", method: "CASH" },
            },
            [ref(row), ref(child, "VehicleCost")],
            costPayKey
          )
        ),
        true
      )
      const recovery = row.costs.find((c) => c.id === prepared.recoveryCostId)!
      await commitReplay(
        "payCost",
        envelope(
          {
            costId: recovery.id,
            payment: { amount: "1", date: "2026-10-03", method: "CASH" },
          },
          [ref(row), ref(recovery, "VehicleCost")],
          costPayKey
        )
      )
      row = await current(prepared.cost)
      await commitReplay("reversePayment", reverseBody(row, prepared.cost))
      await gross(prepared.cost, C, C)
      row = await current(prepared.cost)
      assert.deepEqual(row.basisVersions, basis)
      assert.equal(
        row.costs.find((c) => c.id === child.id)!.outstanding,
        A.toString()
      )
      await save("controls-PASS", {
        sha,
        sources: prepared,
        snapshot: await snapshot(),
        incomingBoundary:
          "IN=C succeeds via exact unique reversals. IN>C is unreachable from a committed OUT<=C prefix because every IN reverses a unique OUT fact once; no impossible SQL rows inserted.",
      })
      console.log(
        "PASS exact OUT=C and IN=C, both categories/cost sources, failed-key valid-intent recovery, immutable replay and basis; no fabricated IN>C"
      )
    }
  } finally {
    await admin.dispose()
  }
} finally {
  await f.close()
}
