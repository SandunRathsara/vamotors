/** Read-only comparison after explicit setup: genuine c46217/v13 ->18/v14,
 * then inert setup repeat. Never fabricates markers, rewrites rows or migrates. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFile, writeFile, readdir, lstat } from "node:fs/promises"
import { join } from "node:path"
import { fixture } from "./cycle-edits-fixture"

process.umask(0o077)
const [root, source, mode, exactFinal] = process.argv.slice(2)
assert.ok(root && source && exactFinal && ["upgrade", "repeat"].includes(mode))
assert.ok(
  root.endsWith("/genuine-c462-native") &&
    source.endsWith("/genuine-c462-source")
)
const base = "c462b7ac3f5111ebacd74cf326fc3da386d88993"
const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: source, encoding: "utf8" }).trim()
assert.equal(git("rev-parse", "HEAD"), exactFinal)
assert.notEqual(exactFinal, base)
assert.equal(git("status", "--porcelain=v1"), "")
execFileSync("git", ["merge-base", "--is-ancestor", base, exactFinal], {
  cwd: source,
})
const parent = JSON.parse(
  await readFile(join(root, "parent-c462-before.json"), "utf8")
)
assert.equal(parent.base, base)
assert.equal(parent.migrations.length, 17)
assert.equal(parent.identity.registryVersion, 13)
assert.ok(!parent.identity.models.includes("RepairRecord"))
assert.ok(parent.cycles.length >= 10 && parent.files.attachments.length >= 2)
const f = await fixture(root, source)
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex")
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
try {
  const tables: Record<string, { identity: unknown; sha256: string }[]> = {}
  for (const name of Object.keys(parent.before.tables)) {
    assert.match(name, /^[a-zA-Z_]+$/)
    const keys = (
      await f.db.query(
        "SELECT a.attname FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,n) JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY k.n",
        [`vamotors."${name}"`]
      )
    ).rows.map((r) => r.attname as string)
    const rows = (
      await f.db.query(
        `SELECT to_jsonb(t) row FROM vamotors."${name}" t ORDER BY to_jsonb(t)::text`
      )
    ).rows
    tables[name] = rows.map(({ row }) => ({
      identity: Object.fromEntries(keys.map((k) => [k, row[k]])),
      sha256: hash(JSON.stringify(row)),
    }))
    if (!["Permission", "RolePermission", "Role"].includes(name))
      assert.deepEqual(
        tables[name],
        parent.before.tables[name],
        `old ${name} rows byte-equivalent`
      )
  }
  const roles = (
    await f.db.query(
      'SELECT to_jsonb(r) row FROM vamotors."Role" r ORDER BY id'
    )
  ).rows
  assert.equal(roles.length, parent.before.roles.length)
  let administrator = ""
  for (const { row } of roles) {
    const old = parent.before.roles.find(
      (r: { row: { id: string } }) => r.row.id === row.id
    ).row
    if (old.systemKey === "ADMINISTRATOR") {
      administrator = row.id
      assert.equal(row.revision, old.revision + 1)
      assert.deepEqual({ ...row, revision: old.revision }, old)
    } else assert.deepEqual(row, old)
  }
  assert.ok(administrator)
  const grants = (
    await f.db.query(
      'SELECT id,"ruleHash",rule FROM vamotors."Permission" ORDER BY id'
    )
  ).rows
  const additions = grants.filter(
    (g) => !parent.before.grants.some((old: { id: string }) => old.id === g.id)
  )
  assert.equal(additions.length, 4)
  assert.deepEqual(additions.map((g) => g.rule.action).sort(), [
    "create",
    "pay",
    "read",
    "update",
  ])
  assert.ok(additions.every((g) => g.rule.subject === "RepairRecord"))
  for (const old of parent.before.grants)
    assert.deepEqual(
      grants.find((g) => g.id === old.id),
      old
    )
  const links = tables.RolePermission,
    oldLinks = parent.before.tables.RolePermission as typeof links
  for (const old of oldLinks)
    assert.ok(links.some((l) => l.sha256 === old.sha256))
  const newLinks = links.filter(
    (l) => !oldLinks.some((old) => old.sha256 === l.sha256)
  )
  assert.equal(newLinks.length, 4)
  assert.ok(
    newLinks.every((l) => {
      const link = l.identity as { roleId: string; permissionId: string }
      return (
        link.roleId === administrator &&
        additions.some((g) => g.id === link.permissionId)
      )
    })
  )
  const functions = (
    await f.db.query(
      "SELECT p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,p.proacl::text acl,p.prosecdef,p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='vamotors' ORDER BY signature"
    )
  ).rows
  const changedOwners = [
    "cycle_cost_payments_json",
    "acquisition_root_guard",
    "initial_cycle_transition",
    "purchase_status_guard",
    "check_stock_graph",
    "cycle_cost_root_graph",
    "check_acquisition_graph",
    "approval_origin",
    "check_approval_graph",
    "check_disposal_graph",
    "check_disposal_root",
    "cycle_cost_child_graph",
    "settlement_detail_guard",
  ]
  for (const old of parent.before.functions) {
    const current = functions.find((fn) => fn.signature === old.signature)
    assert.ok(current)
    const name = old.signature.split("(")[0].replace(/^vamotors\./, "")
    if (!changedOwners.includes(name))
      assert.deepEqual(current, old, `unchanged owner ${name}`)
    else assert.equal(current.acl, old.acl, `old ${name} EXECUTE ACL unchanged`)
  }
  const acl = (
    await f.db.query(
      "SELECT c.relname,c.relacl::text acl,a.attname,a.attacl::text column_acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='vamotors' AND c.relkind IN ('r','v','S') ORDER BY c.relname,a.attnum"
    )
  ).rows
  for (const old of parent.before.acl)
    assert.deepEqual(
      acl.find(
        (row) => row.relname === old.relname && row.attname === old.attname
      ),
      old,
      `old ${old.relname}.${old.attname} ACL`
    )
  const migrations = (
    await f.db.query(
      "SELECT migration_name,checksum FROM vamotors._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name"
    )
  ).rows
  assert.equal(migrations.length, 18)
  for (const migration of migrations) {
    assert.equal(
      migration.checksum,
      hash(
        await readFile(
          join(
            source,
            "prisma/migrations",
            migration.migration_name,
            "migration.sql"
          )
        )
      )
    )
    if (migration.migration_name !== "202610310002_repairs")
      assert.deepEqual(
        migration,
        parent.migrations.find(
          (old: { migration_name: string }) =>
            old.migration_name === migration.migration_name
        )
      )
  }
  for (const name of ["RepairRecord", "RepairPayment"])
    assert.equal(
      (await f.db.query(`SELECT count(*) n FROM vamotors."${name}"`)).rows[0].n,
      "0"
    )
  const files = await disk()
  assert.deepEqual(files, parent.before.files)
  const guard = Number(
    (
      await f.db.query(
        'SELECT generation FROM vamotors."AdminGuard" WHERE id=1'
      )
    ).rows[0].generation
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
        'import {createRequire} from "node:module";import {registryVersion} from "./lib/server/permissions.ts";const r=createRequire(process.cwd()+"/package.json"),c=r("@prisma/client");console.log(JSON.stringify({registryVersion,client:r.resolve("@prisma/client"),models:c.Prisma.dmmf.datamodel.models.map(m=>m.name)}))',
      ],
      { cwd: source, encoding: "utf8" }
    )
  )
  assert.equal(identity.registryVersion, 14)
  assert.ok(
    identity.models.includes("RepairRecord") &&
      identity.models.includes("Disposal")
  )
  assert.ok(identity.client.startsWith(`${source}/node_modules/`))
  const after = {
    tables,
    roles,
    grants,
    functions,
    acl,
    migrations,
    files,
    identity,
    guard,
  }
  if (mode === "upgrade") {
    // 002: one explicit lock + four new RolePermission statement guards + one
    // Role statement guard + its deferred last_admin guard; setup revalidation1.
    assert.equal(guard, Number(parent.before.guard) + 8)
  } else {
    const prior = JSON.parse(
      await readFile(join(root, "repair-upgrade-after.json"), "utf8")
    )
    assert.equal(prior.exactFinal, exactFinal)
    assert.equal(
      guard,
      prior.after.guard + 1,
      "repeat only revalidation's known mutable auth-guard generation"
    )
    assert.deepEqual(
      { ...after, guard: prior.after.guard },
      prior.after,
      "repeat does not alter rows/grants/versions/functions/ACL/files"
    )
  }
  await writeFile(
    join(root, `repair-${mode}-after.json`),
    JSON.stringify(
      {
        base,
        exactFinal,
        tree: git("rev-parse", "HEAD^{tree}"),
        source,
        mode,
        after,
        changedOwners,
        scope:
          "Actual genuine parent migration/repeat preservation, prior to new repair data or runtime regression campaigns",
      },
      null,
      2
    ),
    { mode: 0o600, flag: "wx" }
  )
  console.log(
    `PASS genuine exactc46217/v13 ->18/v14 ${mode}; old rows/immutable permissions/conditions/memberships/compound ceilings/functions/ACL/files retained; only4 Admin leaves/one Admin revision and explicit auth-guard delta`
  )
} finally {
  await f.close()
}
