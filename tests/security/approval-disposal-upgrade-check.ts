/** Exact236 NONEMPTY parent -> allocated17/v13. Never reset, reseed or adopt a root. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { request, type APIRequestContext } from "@playwright/test"
import type {
  Grant,
  PurchaseCycleDTO,
} from "../../.planning/implementation/contracts/api"
import { privateEnvironment } from "../../scripts/private-environment"
import { canonical } from "../../lib/server/idempotency"
import { expanded, grantSchema } from "../../lib/server/permissions"
import { fixture, envelope, purchaseInput, ref } from "./cycle-edits-fixture"
import { verifyFiles } from "./cycle-edits-files"

process.umask(0o077)
const [root, mode, resumeLog] = process.argv.slice(2)
assert.ok(root && ["prepare", "resume", "verify"].includes(mode))
const parent = "2360cbb92658d8b0c4cd0a38e3de14ef38efdeaa"
const cluster = await privateEnvironment(join(root, "cluster.env"))
const source = cluster.PROJECT!
assert.equal(
  source,
  "/Users/alpha/Developer/Personal/vamotors-writeoff-parent236"
)
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim()
assert.equal(git("status", "--porcelain"), "")
const head = git("rev-parse", "HEAD")
execFileSync("git", ["merge-base", "--is-ancestor", parent, head], {
  cwd: source,
})
const f = await fixture(root, source)
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex")
const record = join(root, "approval-disposal-parent236-before.json")
const parentStart = JSON.parse(
  await readFile(join(root, `settlement-upgrade-${parent}.json`), "utf8")
)
assert.equal(parentStart.source.sha, parent)
assert.equal(parentStart.source.registryVersion, 12)
assert.equal(parentStart.migrations.length, 16)
async function nativeBytes(
  directory = f.runtime.PRIVATE_FILES_ROOT!,
  prefix = ""
): Promise<unknown[]> {
  const entries: unknown[] = []
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name),
      relative = join(prefix, name),
      stat = await lstat(path)
    assert.ok(!stat.isSymbolicLink())
    assert.equal(stat.mode & 0o077, 0)
    entries.push({
      path: relative,
      mode: stat.mode & 0o777,
      kind: stat.isDirectory() ? "directory" : "file",
      ...(stat.isFile()
        ? { size: stat.size, sha256: hash(await readFile(path)) }
        : {}),
    })
    if (stat.isDirectory()) entries.push(...(await nativeBytes(path, relative)))
  }
  return entries
}
async function snapshot() {
  const rows: Record<string, Record<string, unknown>[]> = {}
  const tables = (
    await f.db.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind='r' AND relname NOT IN ('_prisma_migrations','AdminGuard','session','verification') ORDER BY relname"
    )
  ).rows
  for (const { relname } of tables) {
    assert.match(relname, /^[a-zA-Z][a-zA-Z0-9]*$/)
    const values = (
      await f.db.query(
        `SELECT to_jsonb(t) row FROM vamotors."${relname}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows.map((r) => r.row)
    rows[relname] =
      relname === "account"
        ? values.map((r) => ({ id: r.id, sha256: hash(canonical(r)) }))
        : values
  }
  const inventory = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {registry,registryVersion} from ${JSON.stringify(pathToFileURL(join(source, "lib/server/permissions.ts")).href)};console.log(JSON.stringify({registry,registryVersion}))`,
      ],
      { cwd: source, encoding: "utf8" }
    )
  )
  const migrations = (
    await f.db.query(
      "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
    )
  ).rows
  for (const m of migrations)
    assert.equal(
      hash(
        await readFile(
          join(source, "prisma/migrations", m.migration_name, "migration.sql")
        )
      ),
      m.checksum
    )
  return {
    source: { head, tree: git("rev-parse", "HEAD^{tree}"), ...inventory },
    rows,
    migrations,
    bytes: await nativeBytes(),
    owners: (
      await f.db.query(
        "SELECT relname,pg_get_userbyid(relowner) owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='vamotors' AND c.relkind IN ('r','v') ORDER BY relname"
      )
    ).rows,
    columns: (
      await f.db.query(
        "SELECT table_name,column_name,privilege_type FROM information_schema.column_privileges WHERE grantee='vamotors_runtime' ORDER BY table_name,column_name,privilege_type"
      )
    ).rows,
    functions: (
      await f.db.query(
        "SELECT p.oid::regprocedure::text name,p.prosrc body,to_jsonb(p)-'prosrc' metadata FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vamotors' ORDER BY p.oid"
      )
    ).rows as { name: string; body: string; metadata: unknown }[],
    grants: (
      await f.db.query(
        'SELECT rp."roleId",p.rule,r."systemKey" FROM vamotors."RolePermission" rp JOIN vamotors."Permission" p ON p.id=rp."permissionId" JOIN vamotors."Role" r ON r.id=rp."roleId" ORDER BY rp."roleId",p."ruleHash"'
      )
    ).rows as { roleId: string; rule: Grant; systemKey: string | null }[],
  }
}
async function enrich() {
  await f.start()
  const admin = await f.login("ADMIN"),
    suffix = randomUUID().slice(0, 8)
  try {
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
          name: `Parent236 lease supplier ${suffix}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    const companies = []
    for (const tag of ["A", "B"])
      companies.push(
        await f.command(
          admin,
          "createFinanceCompany",
          envelope(
            {
              name: `Parent236 finance ${tag} ${suffix}`,
              contacts: [],
              policy: {
                path: "APPLICATION",
                commission: { basis: "FINANCED_PRINCIPAL", rateBps: 100 },
                processingFee: "250000",
                reconciliationMethod: "PERIOD_NOTICE",
              },
            },
            [ref(settings, "Settings")]
          ),
          201
        )
      )
    const current = (id: string) =>
      f.query<PurchaseCycleDTO>(admin, "purchase", `?cycleId=${id}`)
    const cycles: string[] = []
    for (const channel of [
      "BRAND_NEW",
      "FINANCE_COMPANY",
      "BANK",
      "PRIVATE_PARTY",
    ]) {
      const lease = channel !== "BRAND_NEW"
      const created = await f.command(
        admin,
        "recordPurchase",
        envelope(
          {
            ...purchaseInput(supplier.result.id, suffix, channel),
            purchaseType: lease ? "LEASE_SETTLEMENT" : channel,
            ...(lease
              ? {
                  purchasePrice: undefined,
                  settlement: {
                    institutionType: channel,
                    ...(channel === "FINANCE_COMPANY"
                      ? { companyId: companies[0].result.id }
                      : { institutionName: `Parent236 ${channel}` }),
                    reference: `Original ${channel}`,
                    amount: "6000",
                    cashToSeller: "4000",
                  },
                }
              : {}),
          },
          [
            ref(supplier.result, "Supplier"),
            ...(channel === "FINANCE_COMPANY"
              ? [ref(companies[0].result, "FinanceCompany")]
              : []),
          ]
        ),
        201
      )
      let row = await current(created.result.id)
      if (channel === "FINANCE_COMPANY") {
        await f.command(
          admin,
          "editPurchase",
          envelope(
            {
              cycleId: row.id,
              patch: {
                settlement: {
                  institutionType: "FINANCE_COMPANY",
                  companyId: companies[1].result.id,
                  reference: "Corrected current B terms",
                  amount: "7000",
                  cashToSeller: "3000",
                },
              },
              cashCorrections: row.payments.map((p) => ({
                paymentId: p.id,
                reason:
                  "Actual original payment reversal before lawful payee change",
              })),
              reason:
                "Actual A to B corrected invoice with retained original terms",
            },
            [
              ref(row),
              {
                type: "Vehicle",
                id: row.vehicleId,
                revision: row.identityRevision,
              },
              ref(companies[1].result, "FinanceCompany"),
            ]
          )
        )
        for (const [recipient, amount] of [
          ["SELLER", "1000"],
          ["SETTLEMENT", "5000"],
        ]) {
          row = await current(row.id)
          await f.command(
            admin,
            "payPurchase",
            envelope(
              {
                cycleId: row.id,
                recipient,
                payment: {
                  amount,
                  date: "2026-10-03",
                  method: "BANK_TRANSFER",
                },
              },
              [ref(row)]
            )
          )
        }
        row = await current(row.id)
        assert.deepEqual(row.outstanding, {
          seller: "2000",
          settlement: "2000",
        })
        await f.command(
          admin,
          "updateFinanceCompany",
          envelope(
            {
              id: companies[1].result.id,
              name: `Renamed parent236 B ${suffix}`,
              contacts: [],
              policy: {
                path: "APPLICATION",
                commission: { basis: "FIXED", fixed: "1", rateBps: 0 },
                processingFee: "0",
                reconciliationMethod: "PER_DEAL",
              },
              reason: "Actual directory/policy history, not a cycle correction",
            },
            [
              ref(companies[1].result, "FinanceCompany"),
              ref(settings, "Settings"),
            ]
          )
        )
      }
      cycles.push(row.id)
    }
    // Reaching C-99 needs 100 actual A-sized cash facts, not an owner-seeded total.
    const gross = await f.command(
      admin,
      "recordPurchase",
      envelope(
        {
          ...purchaseInput(supplier.result.id, suffix, "gross"),
          purchasePrice: "99999999999999",
        },
        [ref(supplier.result, "Supplier")]
      ),
      201
    )
    let row = await current(gross.result.id)
    for (let n = 0; n < 100; n++) {
      const live = row.payments.find(
        (p) => !p.reversalOf && !row.payments.some((r) => r.reversalOf === p.id)
      )!
      await f.command(
        admin,
        "reversePayment",
        envelope(
          {
            sourceType: "PURCHASE",
            sourceId: row.id,
            paymentId: live.id,
            reason: `Actual gross witness original-entry correction ${n + 1}`,
            ...(n < 99
              ? {
                  replacement: {
                    amount: "99999999999999",
                    date: "2026-10-01",
                    method: "CASH",
                  },
                }
              : {}),
          },
          [ref(row)]
        )
      )
      row = await current(row.id)
    }
    assert.equal(row.financial!.cashIn, "9999999999999900")
    assert.equal(row.financial!.cashOut, "9999999999999900")
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
      { subject: "Role", action: "create", fields: ["*"] },
      { subject: "ImportBatch", action: "read", fields: ["uploads"] },
    ]
    const role = await f.command(
      admin,
      "saveRole",
      envelope({
        name: `Useful parent236 delegate ${suffix}`,
        grants,
        reason: "Retained useful own-record/create/compound/delegation role",
      }),
      201
    )
    const email = `parent236-delegate-${suffix}@example.test`,
      password = hash(`${f.runtime.BETTER_AUTH_SECRET}:${email}`)
    const created = await admin.post("/api/v1/commands/createUser", {
      headers: { Origin: f.origin },
      data: envelope(
        {
          name: "Useful parent236 delegate",
          email,
          password,
          roleIds: [role.result.id],
        },
        [ref(role.result, "Role")]
      ),
    })
    assert.equal(created.status(), 201)
    const delegate = await request.newContext({ baseURL: f.origin })
    let delegateCycle: string
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
      const result = await f.command(
        delegate,
        "recordPurchase",
        envelope(purchaseInput(supplier.result.id, suffix, "delegate"), [
          ref(supplier.result, "Supplier"),
        ]),
        201
      )
      delegateCycle = result.result.id
      assert.equal(
        (
          await f.query<PurchaseCycleDTO>(
            delegate,
            "purchase",
            `?cycleId=${delegateCycle}`
          )
        ).id,
        delegateCycle
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
          name: `Lawful parent236 delegated child ${suffix}`,
          grants: [
            {
              subject: "Supplier",
              action: "read",
              fields: ["id"],
            },
          ],
          reason:
            "Actual broad supplier authority permits bounded delegation; own-record authority does not",
        }),
        201
      )
    } finally {
      await delegate.dispose()
    }
    return {
      cycles,
      grossCycle: row.id,
      delegate: { email, cycleId: delegateCycle },
      stagedBatch: await stageBytes(admin),
    }
  } finally {
    await admin.dispose()
    await f.stop()
  }
}
async function stageBytes(admin: APIRequestContext) {
  const batch = await f.command(
    admin,
    "stageImport",
    envelope({
      types: ["SUPPLIERS"],
      namespace: `parent236-staged-${randomUUID()}`,
    }),
    201
  )
  const bytes = Buffer.from("name,value\nActual retained staged bytes,236\n")
  const init = await admin.post("/api/v1/commands/initUpload", {
    headers: { Origin: f.origin },
    data: envelope(
      {
        target: { type: "IMPORT_BATCH", id: batch.result.id },
        purpose: "IMPORT_SOURCE",
        filename: "retained-staged.csv",
        contentType: "text/csv",
        size: bytes.length,
        sha256: hash(bytes),
      },
      [ref(batch.result, "ImportBatch")]
    ),
  })
  assert.equal(init.status(), 201)
  const ready = await init.json()
  assert.equal(
    (
      await admin.put(ready.putUrl, {
        headers: { Origin: f.origin, ...ready.requiredHeaders },
        data: bytes,
      })
    ).status(),
    204
  )
  return batch.result.id
}
async function resumeEnrichment(): Promise<Awaited<ReturnType<typeof enrich>>> {
  assert.match(resumeLog, /^cycle-edits-http-[a-f0-9]{8}\.json$/)
  const text = await readFile(join(root, resumeLog), "utf8")
  const log = JSON.parse(text)
  assert.equal(log.source, source)
  const commands = log.transcript.filter(
    (e: { kind: string }) => e.kind === "command"
  )
  const failed = commands.at(-1)
  assert.equal(failed.name, "saveRole")
  assert.equal(failed.status, 403)
  assert.equal(failed.value.error.code, "FORBIDDEN")
  assert.deepEqual(failed.body.input.grants, [
    {
      subject: "PurchaseRecord",
      action: "read",
      fields: ["id"],
      conditions: { createdBy: "$actor.id" },
    },
  ])
  const purchases = commands.filter(
    (c: { name: string; status: number }) =>
      c.name === "recordPurchase" && c.status === 201
  )
  const cycles = purchases
    .filter(
      (c: { body: { input: { vehicle: { engineNumber: string } } } }) =>
        !/-(delegate|gross)$/.test(c.body.input.vehicle.engineNumber)
    )
    .map(
      (c: { result?: unknown; value: { result: { id: string } } }) =>
        c.value.result.id
    ) as string[]
  assert.equal(cycles.length, 4)
  const gross = purchases.find(
    (c: { body: { input: { purchasePrice: string } } }) =>
      c.body.input.purchasePrice === "99999999999999"
  )
  const delegateCycle = purchases.at(-1).value.result.id as string
  const user = (
    await f.db.query(
      'SELECT u.id,u.email FROM vamotors."user" u JOIN vamotors."PurchaseRecord" p ON p."createdBy"=u.id WHERE p.id=$1',
      [delegateCycle]
    )
  ).rows[0]
  assert.match(user.email, /^parent236-delegate-[a-f0-9]{8}@example\.test$/)
  assert.equal(
    (
      await f.db.query(
        'SELECT count(*)::integer n FROM vamotors."CommandReceipt" WHERE "idempotencyKey"=$1',
        [failed.body.idempotencyKey]
      )
    ).rows[0].n,
    0
  )
  await f.start()
  const admin = await f.login("ADMIN"),
    reader = await request.newContext({ baseURL: f.origin })
  try {
    const row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${gross.value.result.id}`
    )
    assert.equal(row.financial!.cashIn, "9999999999999900")
    assert.equal(row.financial!.cashOut, "9999999999999900")
    assert.equal(row.payments.length, 200)
    assert.equal(
      (
        await reader.post("/api/auth/sign-in/email", {
          headers: { Origin: f.origin },
          data: {
            email: user.email,
            password: hash(`${f.runtime.BETTER_AUTH_SECRET}:${user.email}`),
          },
        })
      ).status(),
      200
    )
    assert.equal(
      (
        await f.query<PurchaseCycleDTO>(
          reader,
          "purchase",
          `?cycleId=${delegateCycle}`
        )
      ).id,
      delegateCycle
    )
    assert.equal(
      (
        await reader.get(`/api/v1/queries/purchase?cycleId=${cycles[0]}`)
      ).status(),
      404
    )
    const before = await snapshot()
    const denied = await reader.post("/api/v1/commands/saveRole", {
      headers: { Origin: f.origin },
      data: failed.body,
    })
    assert.equal(denied.status(), 403)
    assert.equal((await denied.json()).error.code, "FORBIDDEN")
    assert.deepEqual(await snapshot(), before)
    await f.command(
      reader,
      "saveRole",
      envelope({
        name: `Lawful supplier-only delegation ${randomUUID()}`,
        grants: [{ subject: "Supplier", action: "read", fields: ["id"] }],
        reason:
          "Existing broad Supplier grant covers arbitrary eventual holders; own-record grant does not",
      }),
      201
    )
    const retained = {
      cycles,
      grossCycle: row.id,
      delegate: { email: user.email as string, cycleId: delegateCycle },
      stagedBatch: await stageBytes(admin),
    }
    await writeFile(
      join(root, `approval-disposal-enrichment-resume-${randomUUID()}.json`),
      JSON.stringify(
        {
          parent,
          preservedFailure: {
            transcript: resumeLog,
            sha256: hash(text),
            error: "Wrong expected201; actual403 preserved",
          },
          noGrossOrChannelReseed: true,
          retained,
        },
        null,
        2
      ),
      { flag: "wx", mode: 0o600 }
    )
    return retained
  } finally {
    await admin.dispose()
    await reader.dispose()
    await f.stop()
  }
}
try {
  if (mode === "prepare" || mode === "resume") {
    assert.equal(head, parent)
    await assert.rejects(readFile(record))
    const retained = await (mode === "resume" ? resumeEnrichment() : enrich()),
      before = await snapshot()
    assert.equal(before.source.registryVersion, 12)
    assert.equal(before.migrations.length, 16)
    assert.ok(before.rows.LeasePurchaseDetail.length >= 3)
    assert.ok(before.rows.Attachment.length >= 3)
    assert.ok(before.bytes.length)
    const text = JSON.stringify({ ...before, retained }, null, 2)
    await writeFile(record, text, { flag: "wx", mode: 0o600 })
    await writeFile(`${record}.sha256`, hash(text), { flag: "wx", mode: 0o600 })
    console.log(
      "PASS exact236 HTTP/PG NONEMPTY parent: all channels, A/B settlement history, C-99 gross witness, useful delegate, FINAL CSV/XLSX and staged native bytes"
    )
  } else {
    assert.notEqual(head, parent)
    const text = await readFile(record, "utf8")
    assert.equal(hash(text), await readFile(`${record}.sha256`, "utf8"))
    const before = JSON.parse(text) as Awaited<ReturnType<typeof snapshot>> & {
      retained: Awaited<ReturnType<typeof enrich>>
    }
    const after = await snapshot()
    assert.equal(after.source.registryVersion, 13)
    assert.equal(after.migrations.length, 17)
    assert.equal(
      after.migrations[16].migration_name,
      "202610310001_approval_disposal"
    )
    assert.deepEqual(after.migrations.slice(0, 16), before.migrations)
    assert.deepEqual(
      Object.fromEntries(
        Object.entries(after.source.registry).filter(
          ([s]) => !["ApprovalRequest", "Disposal"].includes(s)
        )
      ),
      before.source.registry
    )
    for (const [table, rows] of Object.entries(before.rows)) {
      if (["Role", "RolePermission", "Permission"].includes(table)) continue
      assert.deepEqual(after.rows[table], rows, `EXACT_OLD_${table}`)
    }
    assert.deepEqual(after.bytes, before.bytes)
    for (const old of before.rows.Permission)
      assert.ok(
        after.rows.Permission.some((p) => canonical(p) === canonical(old))
      )
    for (const old of before.rows.Role)
      assert.deepEqual(
        after.rows.Role.find((r) => r.id === old.id),
        {
          ...old,
          revision:
            Number(old.revision) + (old.systemKey === "ADMINISTRATOR" ? 1 : 0),
        }
      )
    for (const old of before.owners)
      assert.ok(after.owners.some((r) => canonical(r) === canonical(old)))
    for (const old of before.columns)
      assert.ok(after.columns.some((r) => canonical(r) === canonical(old)))
    for (const role of before.rows.Role) {
      const atoms = (grants: typeof after.grants) =>
        [
          ...new Set(
            grants
              .filter((g) => g.roleId === role.id)
              .flatMap((g) =>
                expanded(g.rule).map((field) =>
                  canonical({
                    subject: g.rule.subject,
                    action: g.rule.action,
                    field,
                    conditions: g.rule.conditions ?? {},
                  })
                )
              )
          ),
        ].sort()
      const old = atoms(before.grants),
        next = atoms(after.grants)
      if (role.systemKey !== "ADMINISTRATOR") assert.deepEqual(next, old)
      else
        assert.deepEqual(
          next.filter(
            (a) =>
              !["ApprovalRequest", "Disposal"].includes(JSON.parse(a).subject)
          ),
          old
        )
    }
    for (const p of after.rows.Permission) {
      grantSchema.parse(p.rule)
      assert.equal(hash(canonical(p.rule)), p.ruleHash)
    }
    const sql = await readFile(
      join(
        source,
        "prisma/migrations/202610310001_approval_disposal/migration.sql"
      ),
      "utf8"
    )
    const unquote = (s: string) =>
      s
        .replace(/^E?'/, "")
        .slice(0, -1)
        .replaceAll("''", "'")
        .replaceAll("\\n", "\n")
    const transforms = new Map(
      [
        ...sql.matchAll(
          /SELECT pg_get_functiondef\('((?:[^']|'')*)'::regprocedure\) INTO source;\s*updated:=replace\(source,(E?'(?:[^']|'')*'),(E?'(?:[^']|'')*')\);/g
        ),
      ].map((m) => [m[1], [unquote(m[2]), unquote(m[3])]])
    )
    assert.equal(transforms.size, 8)
    for (const old of before.functions) {
      const next = after.functions.find((r) => r.name === old.name)!
      assert.ok(next)
      assert.deepEqual(
        next.metadata,
        old.metadata,
        `${old.name} identity/ACL/owner`
      )
      const pair =
        transforms.get(old.name.replace(/^vamotors\./, "")) ??
        transforms.get(old.name)
      assert.equal(
        next.body,
        pair ? old.body.replaceAll(pair[0], pair[1]) : old.body,
        `${old.name} exact guarded extension`
      )
    }
    const repeat = join(root, "approval-disposal-upgrade-repeat-state.json")
    const state = canonical(after)
    try {
      assert.equal(await readFile(repeat, "utf8"), state)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
      await writeFile(repeat, state, { flag: "wx", mode: 0o600 })
    }
    await f.start()
    await verifyFiles(f, parentStart.fixture.files)
    const reader = await request.newContext({ baseURL: f.origin })
    try {
      const { email, cycleId } = before.retained.delegate
      assert.equal(
        (
          await reader.post("/api/auth/sign-in/email", {
            headers: { Origin: f.origin },
            data: {
              email,
              password: hash(`${f.runtime.BETTER_AUTH_SECRET}:${email}`),
            },
          })
        ).status(),
        200
      )
      assert.equal(
        (
          await f.query<PurchaseCycleDTO>(
            reader,
            "purchase",
            `?cycleId=${cycleId}`
          )
        ).id,
        cycleId
      )
      assert.equal(
        (
          await reader.get(
            `/api/v1/queries/purchase?cycleId=${before.retained.cycles[0]}`
          )
        ).status(),
        404
      )
    } finally {
      await reader.dispose()
    }
    await f.restart()
    await verifyFiles(f, parentStart.fixture.files)
    assert.deepEqual(await snapshot(), after)
    await writeFile(
      join(root, `approval-disposal-upgrade-verify-${randomUUID()}.json`),
      JSON.stringify(
        {
          parent,
          head,
          tree: after.source.tree,
          registry: 13,
          migrations: 17,
          status: "PASS",
          oldRows: Object.fromEntries(
            Object.entries(before.rows).map(([t, rows]) => [t, rows.length])
          ),
          nativeBytes: after.bytes,
        },
        null,
        2
      ),
      { flag: "wx", mode: 0o600 }
    )
    console.log(
      "PASS exact23616/v12 ->17/v13 upgrade/repeat, exact old rows/permissions/ceilings/guard extensions/ACLs/native modes+bytes, useful delegate, fresh-auth downloads and actual app+PG restart"
    )
  }
} finally {
  await f.close()
}
