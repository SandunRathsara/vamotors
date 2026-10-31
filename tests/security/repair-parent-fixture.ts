/** New, actually nonempty EXACTc46217/v13 parent. No REPAIR table/marker/data,
 * no other author's roots and no role repairs. Stop this parent before upgrade. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import { request } from "@playwright/test"
import type {
  Applied,
  Dependency,
  Grant,
  Pending,
  PurchaseCycleDTO,
  UploadReady,
} from "../../.planning/implementation/contracts/api"
import {
  fixture,
  envelope,
  purchaseInput,
  ref,
  seed,
} from "./cycle-edits-fixture"
import { seedFiles, verifyFiles } from "./cycle-edits-files"

process.umask(0o077)
const [root, source] = process.argv.slice(2)
assert.ok(root && source)
assert.ok(
  root.endsWith("/genuine-c462-native") &&
    source.endsWith("/genuine-c462-source")
)
const base = "c462b7ac3f5111ebacd74cf326fc3da386d88993"
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim()
assert.equal(git("rev-parse", "HEAD"), base)
assert.equal(
  git("rev-parse", "HEAD^{tree}"),
  "500a9d41325ad28b44481f210aa97fc6faa730b8"
)
assert.equal(git("status", "--porcelain=v1"), "")
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex")
const suffix = randomUUID().slice(0, 8),
  f = await fixture(root, source)
let stage = "initialize"
const groups: string[] = [],
  replay: {
    name: string
    body: ReturnType<typeof envelope>
    commandId: string
  }[] = []
const cycleRefs = (row: PurchaseCycleDTO): Dependency[] => [
  ref(row),
  { type: "Vehicle", id: row.vehicleId, revision: row.identityRevision },
]
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  groups.push(name)
  console.log(`PASS ${name}`)
}
async function disk(
  path = f.runtime.PRIVATE_FILES_ROOT!,
  relative = ""
): Promise<unknown[]> {
  const facts: unknown[] = []
  for (const name of (await readdir(path)).sort()) {
    const full = join(path, name),
      stat = await lstat(full),
      key = join(relative, name)
    assert.equal(stat.isSymbolicLink(), false)
    facts.push({
      key,
      mode: stat.mode & 0o777,
      bytes: stat.size,
      directory: stat.isDirectory(),
      ...(stat.isFile() ? { sha256: hash(await readFile(full)) } : {}),
    })
    if (stat.isDirectory()) facts.push(...(await disk(full, key)))
  }
  return facts
}
async function snapshot() {
  const names = (
    await f.db.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind='r' AND relname NOT IN ('_prisma_migrations','AdminGuard','session','verification') ORDER BY relname"
    )
  ).rows
  const tables: Record<string, { identity: unknown; sha256: string }[]> = {}
  for (const { relname } of names) {
    const keys = (
      await f.db.query(
        "SELECT a.attname FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.n",
        [`vamotors."${relname}"`]
      )
    ).rows.map((r) => r.attname as string)
    const rows = (
      await f.db.query(
        `SELECT to_jsonb(t) row FROM vamotors."${relname}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows
    tables[relname] = rows.map(({ row }) => ({
      identity: Object.fromEntries(keys.map((k) => [k, row[k]])),
      sha256: hash(JSON.stringify(row)),
    }))
  }
  const functions = (
    await f.db.query(
      "SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vamotors' ORDER BY signature"
    )
  ).rows
  const acl = (
    await f.db.query(
      "SELECT c.relname,c.relacl::text acl,a.attname,a.attacl::text column_acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='vamotors' AND c.relkind IN ('r','v','S') ORDER BY c.relname,a.attnum"
    )
  ).rows
  const grants = (
    await f.db.query(
      'SELECT id,"ruleHash",rule FROM vamotors."Permission" ORDER BY id'
    )
  ).rows
  const roles = (
    await f.db.query(
      'SELECT to_jsonb(r) row FROM vamotors."Role" r ORDER BY id'
    )
  ).rows
  return {
    tables,
    functions,
    acl,
    grants,
    roles,
    files: await disk(),
    guard: (
      await f.db.query(
        'SELECT generation FROM vamotors."AdminGuard" WHERE id=1'
      )
    ).rows[0].generation,
  }
}
try {
  const migrations = (
    await f.db.query(
      "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
    )
  ).rows
  assert.equal(migrations.length, 17)
  assert.equal(
    (await f.db.query("SELECT to_regclass('vamotors.\"RepairRecord\"') repair"))
      .rows[0].repair,
    null
  )
  const identity = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        'import {createRequire} from "node:module";import {registry,registryVersion} from "./lib/server/permissions.ts";const r=createRequire(process.cwd()+"/package.json"),c=r("@prisma/client");console.log(JSON.stringify({registry,registryVersion,client:r.resolve("@prisma/client"),models:c.Prisma.dmmf.datamodel.models.map(m=>m.name)}))',
      ],
      { cwd: source, encoding: "utf8" }
    )
  )
  assert.equal(identity.registryVersion, 13)
  assert.equal(Object.keys(identity.registry).length, 18)
  assert.ok(identity.client.startsWith(`${source}/node_modules/`))
  assert.ok(!identity.models.includes("RepairRecord"))
  await f.start()
  const admin = await f.login("ADMIN"),
    reviewer = await f.login("SECOND")
  const current = (cycleId: string) =>
    f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${cycleId}`)
  let seeded: Awaited<ReturnType<typeof seed>>
  const cycles: string[] = []
  await group(
    "exact parent actual rates/quote, cost/reversal, receipt, physical/mileage/listed/financial histories",
    async () => {
      seeded = await seed(f, admin, `repair-parent-${suffix}`)
      let row = seeded.cycle
      await f.command(
        admin,
        "editPurchase",
        envelope(
          {
            cycleId: row.id,
            patch: {
              purchasePrice: "10100",
              notes: "Retained corrected acquisition",
            },
            cashCorrections: [],
            reason: "Actual pre-repair invoice correction",
          },
          cycleRefs(row)
        )
      )
      row = await current(row.id)
      await f.command(
        admin,
        "setListedPrice",
        envelope(
          {
            cycleId: row.id,
            amount: "17000",
            reason: "Actual parent asking history",
          },
          [ref(row)]
        )
      )
      row = await current(row.id)
      await f.command(
        admin,
        "addMileage",
        envelope(
          {
            cycleId: row.id,
            mileage: {
              reading: 25,
              date: "2026-10-04",
              remark: "Actual parent mileage",
            },
          },
          cycleRefs(row)
        )
      )
      row = await current(row.id)
      const values = { ...row.identity, colour: "Silver" }
      await f.command(
        admin,
        "editVehicle",
        envelope(
          {
            vehicleId: row.vehicleId,
            values,
            reason: "Actual physical history before repair migration",
          },
          [
            {
              type: "Vehicle",
              id: row.vehicleId,
              revision: row.identityRevision,
            },
          ]
        )
      )
      cycles.push(row.id)
    }
  )
  await group(
    "all acquisition channels with actual settlement/payee corrections and retained old cash",
    async () => {
      const companies = (
        await f.db.query(
          'SELECT id,revision FROM vamotors."FinanceCompany" ORDER BY id'
        )
      ).rows
      for (const channel of [
        "CASH",
        "BRAND_NEW",
        "FINANCE_COMPANY",
        "BANK",
        "PRIVATE_PARTY",
      ]) {
        const lease = !["CASH", "BRAND_NEW"].includes(channel)
        const body = envelope(
          {
            ...purchaseInput(seeded!.supplier.id, suffix, channel),
            purchaseType: lease ? "LEASE_SETTLEMENT" : channel,
            ...(lease
              ? {
                  purchasePrice: undefined,
                  settlement: {
                    institutionType: channel,
                    ...(channel === "FINANCE_COMPANY"
                      ? { companyId: companies[0].id }
                      : { institutionName: `Actual ${channel} ${suffix}` }),
                    reference: "Retained parent settlement",
                    amount: "6000",
                    cashToSeller: "4000",
                  },
                }
              : {}),
          },
          [
            ref(seeded!.supplier, "Supplier"),
            ...(channel === "FINANCE_COMPANY"
              ? [ref(companies[0], "FinanceCompany")]
              : []),
          ]
        )
        const created = await f.command(admin, "recordPurchase", body, 201)
        replay.push({
          name: "recordPurchase",
          body,
          commandId: created.commandId,
        })
        cycles.push(created.result.id)
        if (channel === "FINANCE_COMPANY") {
          const row = await current(created.result.id),
            original = row.payments.find((p) => p.category === "SETTLEMENT")!
          await f.command(
            admin,
            "reversePayment",
            envelope(
              {
                sourceType: "PURCHASE",
                sourceId: row.id,
                paymentId: original.id,
                reason: "Retained actual institution cash correction",
                replacement: {
                  amount: "5000",
                  date: "2026-10-02",
                  method: "BANK_TRANSFER",
                },
              },
              [ref(row)]
            )
          )
          assert.equal((await current(row.id)).outstanding.settlement, "1000")
        }
      }
    }
  )
  await group(
    "real pending/rejected requests and CURRENT zero/positive write-offs, receipts, replay and notifications",
    async () => {
      for (const [index, state] of [
        "PENDING",
        "REJECTED",
        "ZERO",
        "POSITIVE",
      ].entries()) {
        const created = await f.command(
          admin,
          "recordPurchase",
          envelope(
            purchaseInput(seeded!.supplier.id, suffix, `approval-${index}`),
            [ref(seeded!.supplier, "Supplier")]
          ),
          201
        )
        const row = await current(created.result.id),
          proceeds = state === "POSITIVE" ? "200" : "0"
        cycles.push(row.id)
        const body = envelope(
          {
            proposal: {
              kind: "WRITE_OFF",
              input: {
                cycleId: row.id,
                date: "2026-10-05",
                reason: `Actual ${state} parent disposal`,
                method: "SCRAPPED",
                proceeds,
                ...(proceeds !== "0"
                  ? {
                      receipt: {
                        amount: proceeds,
                        date: "2026-09-25",
                        method: "CASH",
                      },
                    }
                  : {}),
              },
            },
            reason: `Independent ${state} parent request`,
          },
          cycleRefs(row)
        )
        const pending = (await f.command(
          admin,
          "requestApproval",
          body,
          202
        )) as unknown as Pending
        replay.push({
          name: "requestApproval",
          body,
          commandId: pending.commandId,
        })
        if (state !== "PENDING") {
          await f.command(
            reviewer,
            "reviewApproval",
            envelope(
              {
                approvalId: pending.approvalId,
                decision: state === "REJECTED" ? "REJECT" : "APPROVE",
                ...(state === "REJECTED"
                  ? { note: "Actual independently rejected proposal" }
                  : {}),
              },
              [
                ref(
                  { id: pending.approvalId, revision: pending.revision },
                  "ApprovalRequest"
                ),
                ...cycleRefs(row),
              ]
            )
          )
        }
        const status = await f.query<Pending>(
          admin,
          "commandStatus",
          `?name=requestApproval&idempotencyKey=${body.idempotencyKey}`
        )
        assert.equal(status.commandId, pending.commandId)
        assert.equal(status.replayed, true)
      }
      assert.equal(
        (await f.db.query('SELECT count(*) n FROM vamotors."Disposal"')).rows[0]
          .n,
        "2"
      )
      assert.ok(
        Number(
          (await f.db.query('SELECT count(*) n FROM vamotors."Notification"'))
            .rows[0].n
        ) >= 7
      )
    }
  )
  await group(
    "useful nonadmin own acquisition and compound/delegation ceilings, no modification of old staff memberships",
    async () => {
      const grants: Grant[] = [
        {
          subject: "Vehicle",
          action: "read",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "Vehicle", action: "create", fields: ["*"] },
        {
          subject: "PurchaseRecord",
          action: "read",
          fields: ["*"],
          conditions: { createdBy: "$actor.id" },
        },
        { subject: "PurchaseRecord", action: "create", fields: ["*"] },
        { subject: "Supplier", action: "read", fields: ["*"] },
        { subject: "Role", action: "read", fields: ["id", "revision", "name"] },
        { subject: "Role", action: "create", fields: ["*"] },
        { subject: "ImportBatch", action: "read", fields: ["uploads"] },
      ]
      const role = await f.command(
        admin,
        "saveRole",
        envelope({
          name: `Genuine parent own delegate ${suffix}`,
          grants,
          reason: "Retained useful own-record and compound ceilings",
        }),
        201
      )
      const email = `repair-parent-${suffix}@example.test`,
        password = hash(`${f.runtime.BETTER_AUTH_SECRET}:${email}`)
      const created = await admin.post("/api/v1/commands/createUser", {
        headers: { Origin: f.origin },
        data: envelope(
          {
            name: "Genuine parent own delegate",
            email,
            password,
            roleIds: [role.result.id],
          },
          [ref(role.result, "Role")]
        ),
      })
      assert.equal(created.status(), 201)
      const delegate = await request.newContext({ baseURL: f.origin })
      try {
        assert.equal(
          (
            await delegate.post("/api/auth/sign-in/email", {
              headers: { Origin: f.origin },
              data: { email, password },
            })
          ).status(),
          200
        )
        const own = await f.command(
          delegate,
          "recordPurchase",
          envelope(purchaseInput(seeded!.supplier.id, suffix, "own"), [
            ref(seeded!.supplier, "Supplier"),
          ]),
          201
        )
        assert.equal(
          (
            await f.query<PurchaseCycleDTO>(
              delegate,
              "purchase",
              `?cycleId=${own.result.id}`
            )
          ).id,
          own.result.id
        )
        assert.equal(
          (
            await delegate.get(`/api/v1/queries/purchase?cycleId=${cycles[0]}`)
          ).status(),
          404
        )
        await f.command(
          delegate,
          "saveRole",
          envelope({
            name: `Lawful parent delegated supplier reader ${suffix}`,
            grants: [{ subject: "Supplier", action: "read", fields: ["id"] }],
            reason: "Actual bounded delegated child",
          }),
          201
        )
        cycles.push(own.result.id)
      } finally {
        await delegate.dispose()
      }
    }
  )
  let files: Awaited<ReturnType<typeof seedFiles>>
  await group(
    "FINAL CSV/XLSX plus distinct staged-byte and INIT intents; all linked file GET200/403/404/401",
    async () => {
      files = await seedFiles(f, admin)
      const staged = await f.command(
        admin,
        "stageImport",
        envelope({
          types: ["SUPPLIERS"],
          namespace: `repair-parent-staged-${suffix}`,
        }),
        201
      )
      let batch = staged.result
      for (const kind of ["staged", "init"]) {
        const bytes = Buffer.from(
          `name,value\nActual ${kind} parent bytes,c462\n`
        )
        const response = await admin.post("/api/v1/commands/initUpload", {
          headers: { Origin: f.origin },
          data: envelope(
            {
              target: { type: "IMPORT_BATCH", id: batch.id },
              purpose: "IMPORT_SOURCE",
              filename: `retained-${kind}.csv`,
              contentType: "text/csv",
              size: bytes.length,
              sha256: hash(bytes),
            },
            [ref(batch, "ImportBatch")]
          ),
        })
        assert.equal(response.status(), 201)
        const ready = (await response.json()) as UploadReady
        if (kind === "staged")
          assert.equal(
            (
              await admin.put(ready.putUrl, {
                headers: { Origin: f.origin, ...ready.requiredHeaders },
                data: bytes,
              })
            ).status(),
            204
          )
        batch = (await f.query<{ id: string; revision: number }>(
          admin,
          "importBatchFiles",
          `?id=${batch.id}`
        )) as Applied["result"]
      }
      await verifyFiles(f, files)
    }
  )
  await f.stop()
  assert.equal(git("rev-parse", "HEAD"), base)
  const before = await snapshot()
  const sourceFiles = Object.fromEntries(
    await Promise.all(
      git("ls-files")
        .split("\n")
        .map(async (path) => [path, hash(await readFile(join(source, path)))])
    )
  )
  await writeFile(
    join(root, "parent-c462-before.json"),
    JSON.stringify(
      {
        base,
        tree: git("rev-parse", "HEAD^{tree}"),
        source,
        sourceFiles,
        migrations,
        identity,
        groups,
        cycles,
        files: files!,
        replay,
        before,
        scope:
          "Genuine NONEMPTY exactc46217/v13 parent only. No repair migration/data yet; no final upgrade claim.",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  console.log(
    "PASS genuine NONEMPTY exactc46217/v13 parent facts/snapshots saved; app stopped, database retained"
  )
} catch (error) {
  console.error(
    `FAIL ${stage}: ${error instanceof Error ? error.message : "unknown"}`
  )
  process.exitCode = 1
} finally {
  await writeFile(
    join(root, `parent-c462-${suffix}-summary.json`),
    JSON.stringify(
      {
        stage,
        groups,
        source,
        base,
        scope:
          "Parent fixture preparation only; no repair data or upgrade proof",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  await f.close()
}
