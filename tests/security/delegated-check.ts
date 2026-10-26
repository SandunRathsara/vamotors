/** Production HTTP/Chromium and real isolated PostgreSQL. PRIVATE_DIRECTORY only. */
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import {
  chromium,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import { runtimeConfig } from "../../lib/server/config"
import type {
  Applied,
  Grant,
  RoleDTO,
  UserAdminDTO,
  CurrentActorDTO,
  PermissionRegistryDTO,
} from "../../.planning/implementation/contracts/api"

process.umask(0o077)
const passed: string[] = []
let stage = "initialize"
async function group(name: string, run: () => Promise<void>) {
  stage = name
  await run()
  passed.push(name)
  console.log(`PASS ${name}`)
}
async function main() {
  const directory = process.argv[2]
  assert.ok(directory)
  const runtime = runtimeConfig(
    await privateEnvironment(join(directory, "runtime.env"))
  )
  assert.equal(runtime.APP_ENV, "local")
  const accounts = await privateEnvironment(join(directory, "accounts.env"))
  const migration = await privateEnvironment(join(directory, "migration.env"))
  const cluster = await privateEnvironment(join(directory, "cluster.env"))
  assert.equal(cluster.PROJECT, process.cwd())
  const runtimeURL = new URL(runtime.DATABASE_URL)
  const migrationURL = new URL(migration.DIRECT_URL!)
  assert.equal(runtimeURL.hostname, "127.0.0.1")
  assert.equal(runtimeURL.port, cluster.PORT)
  assert.equal(migrationURL.hostname, runtimeURL.hostname)
  assert.equal(migrationURL.port, runtimeURL.port)
  assert.equal(migrationURL.pathname, runtimeURL.pathname)
  const db = new pg.Pool({ connectionString: migration.DIRECT_URL, max: 3 })
  const socket = createServer().listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const origin = `http://127.0.0.1:${address.port}`
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(address.port),
    ],
    {
      env: {
        ...process.env,
        ...runtime,
        APP_ORIGIN: origin,
        BETTER_AUTH_URL: origin,
        NODE_ENV: "production",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  const exited = once(server, "exit")
  server.stderr.resume()
  const browser = await chromium.launch({ headless: true })
  const admin = await browser.newContext({ baseURL: origin })
  const delegate = await browser.newContext({ baseURL: origin })
  const limited = await browser.newContext({ baseURL: origin })
  const page = await delegate.newPage()
  const suffix = randomUUID().slice(0, 8)
  const reason = "Synthetic T03c bounded verification"
  const grant = (
    subject: Grant["subject"],
    action: Grant["action"],
    fields: string[],
    conditions?: Grant["conditions"]
  ): Grant => ({
    subject,
    action,
    fields,
    ...(conditions ? { conditions } : {}),
  })
  const customer = (fields: string[], conditions?: Grant["conditions"]) =>
    grant("Customer", "read", fields, conditions)
  const ref = (
    type: "User" | "Role",
    row: { id: string; revision: number }
  ) => ({ type, id: row.id, revision: row.revision })
  async function query<T>(
    client: APIRequestContext,
    name: string,
    params = ""
  ): Promise<T> {
    const response = await client.get(`/api/v1/queries/${name}${params}`)
    assert.equal(response.status(), 200, `QUERY_${name}`)
    assert.match(response.headers()["cache-control"], /no-store/)
    return (await response.json()).data
  }
  const role = (id: string) =>
    query<RoleDTO>(admin.request, "role", `?id=${id}`)
  const user = (id: string) =>
    query<UserAdminDTO>(admin.request, "user", `?id=${id}`)
  async function post(
    client: APIRequestContext,
    name: string,
    input: unknown,
    expected: unknown[] = [],
    key = randomUUID()
  ) {
    const response = await client.post(`/api/v1/commands/${name}`, {
      headers: { origin },
      data: { schemaVersion: 1, idempotencyKey: key, input, expected },
    })
    assert.match(response.headers()["cache-control"], /no-store/)
    return response
  }
  async function applied(
    client: APIRequestContext,
    name: string,
    input: unknown,
    expected: unknown[] = [],
    key = randomUUID()
  ): Promise<Applied> {
    const response = await post(client, name, input, expected, key)
    assert.ok(
      [200, 201].includes(response.status()),
      `${name}_${response.status()}_${(await response.json()).error?.code ?? ""}`
    )
    return response.json()
  }
  async function deny(
    client: APIRequestContext,
    name: string,
    input: unknown,
    expected: unknown[],
    status: number,
    code: string,
    key = randomUUID()
  ) {
    const response = await post(client, name, input, expected, key)
    assert.equal(response.status(), status)
    const body = await response.json()
    assert.equal(body.error.code, code)
    assert.equal(body.result, undefined)
  }
  async function makeRole(name: string, grants: Grant[]) {
    const result = await applied(admin.request, "saveRole", {
      name: `T03c ${suffix} ${name}`,
      grants,
      reason,
    })
    assert.equal(result.result.type, "Role")
    return role(result.result.id)
  }
  async function makeUser(name: string, roles: RoleDTO[]) {
    const email = `${randomUUID()}@example.test`
    const password = `${randomUUID()}Aa!`
    const result = await applied(
      admin.request,
      "createUser",
      {
        name: `T03c ${suffix} ${name}`,
        email,
        password,
        roleIds: roles.map((r) => r.id),
      },
      roles.map((r) => ref("Role", r))
    )
    return { row: await user(result.result.id), email, password }
  }
  async function login(page: Page, email: string, password: string) {
    await page.goto("/login")
    await page.getByLabel("Email Address").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/sign-in/email") &&
        r.request().method() === "POST"
    )
    await page.getByRole("button", { name: "Sign In", exact: true }).click()
    assert.equal((await response).status(), 200)
    await page.waitForURL("**/dashboard")
  }
  async function replaceRole(row: RoleDTO, grants: Grant[]) {
    await applied(
      admin.request,
      "saveRole",
      { id: row.id, name: row.name, grants, reason },
      [ref("Role", await role(row.id))]
    )
    return role(row.id)
  }
  const counts = async () =>
    (
      await db.query(
        'SELECT (SELECT count(*) FROM vamotors."CommandReceipt")::int AS receipts, (SELECT count(*) FROM vamotors."AuditEntry")::int AS audit, (SELECT count(*) FROM vamotors."account")::int AS credentials'
      )
    ).rows[0]
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SERVER_START_TIMEOUT")),
        20000
      )
      server.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Ready")) {
          clearTimeout(timer)
          resolve()
        }
      })
      server.once("exit", () => {
        clearTimeout(timer)
        reject(new Error("SERVER_EARLY_EXIT"))
      })
    })
    const a = await admin.newPage()
    await login(
      a,
      accounts.BOOTSTRAP_ADMIN_EMAIL!,
      accounts.BOOTSTRAP_ADMIN_PASSWORD!
    )
    const ceiling = [
      grant("User", "read", ["*"]),
      grant("Role", "read", ["*"]),
      grant("User", "update", ["name"]),
      grant("User", "create", ["*"]),
      grant("Role", "create", ["name", "grants"]),
      grant("Role", "update", ["name"]),
      grant("Role", "archive", ["active"]),
      customer(["fullName"]),
      customer(["phone"], { createdBy: "$actor.id" }),
    ]
    let delegation = await makeRole("delegation", ceiling)
    const account = await makeUser("delegate", [delegation])
    const secondRole = await makeRole("hidden-reference-reader", [
      grant("User", "read", ["id", "revision", "name", "roles"]),
      grant("User", "update", ["name"]),
    ])
    const secondAccount = await makeUser("limited", [secondRole])
    const limitedPage = await limited.newPage()
    await login(page, account.email, account.password)
    await login(limitedPage, secondAccount.email, secondAccount.password)
    const safe = await makeRole("safe", [customer(["fullName"])])
    const empty = await makeRole("empty", [])
    let stronger = await makeRole("stronger", [customer(["phone"])])
    const target = await makeUser("target", [stronger])

    await group(
      "field-limited profile UI and protected profile (unchanged active/assignments)",
      async () => {
        await page.goto("/users")
        await expect(
          page.getByRole("heading", { name: "Users & Roles" })
        ).toBeVisible()
        await page
          .getByLabel("Search accounts or roles")
          .fill(target.row.email!)
        await page
          .getByRole("button", { name: `Edit ${target.row.name}`, exact: true })
          .click()
        await expect(
          page.getByLabel("Active account", { exact: true })
        ).toBeDisabled()
        const renamed = `${target.row.name} renamed`
        await page.getByLabel("Name", { exact: true }).fill(renamed)
        await page.getByLabel("Reason", { exact: true }).fill(reason)
        await page
          .getByRole("button", { name: "Save User", exact: true })
          .click()
        await expect(page.getByRole("dialog")).toBeHidden()
        assert.equal((await user(target.row.id)).name, renamed)
        const adminActor = await query<CurrentActorDTO>(
          admin.request,
          "currentActor"
        )
        const protectedUser = await user(adminActor.user.id)
        const refs = [
          ref("User", protectedUser),
          ...(await Promise.all(
            protectedUser.roles.map(async (r) => ref("Role", await role(r.id)))
          )),
        ]
        await applied(
          delegate.request,
          "updateUser",
          {
            id: protectedUser.id,
            name: protectedUser.name,
            active: protectedUser.active,
            roleIds: protectedUser.roles.map((r) => r.id).reverse(),
            reason,
          },
          refs
        )
        await deny(
          delegate.request,
          "updateUser",
          {
            id: target.row.id,
            name: renamed,
            active: false,
            roleIds: [stronger.id],
            reason,
          },
          [ref("User", await user(target.row.id)), ref("Role", stronger)],
          403,
          "FIELD_FORBIDDEN"
        )
      }
    )

    let created: UserAdminDTO
    await group(
      "delegated multirole creation UI and real credential atomicity",
      async () => {
        await page
          .getByRole("button", { name: "Add User", exact: true })
          .click()
        const name = `T03c ${suffix} created in UI`
        await page.getByLabel("Name", { exact: true }).fill(name)
        await page
          .getByLabel("Email", { exact: true })
          .fill(`${randomUUID()}@example.test`)
        await page
          .getByLabel("Initial password", { exact: true })
          .fill(`${randomUUID()}Aa!`)
        await page.getByLabel(safe.name, { exact: true }).check()
        await page.getByLabel(empty.name, { exact: true }).check()
        await page
          .getByRole("button", { name: "Save User", exact: true })
          .click()
        await expect(page.getByRole("dialog")).toBeHidden()
        const rows = await query<{ data: UserAdminDTO[] }>(
          admin.request,
          "users",
          `?q=${encodeURIComponent(name)}`
        )
        created = rows.data[0]
        assert.deepEqual(
          created.roles.map((r) => r.id).sort(),
          [safe.id, empty.id].sort()
        )
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM vamotors."account" WHERE "userId"=$1',
              [created.id]
            )
          ).rows[0].n,
          1
        )
      }
    )

    await group(
      "role rename UI does not require unchanged stronger grant edit/ceiling",
      async () => {
        await page.getByRole("button", { name: "Roles", exact: true }).click()
        await page.getByLabel("Search accounts or roles").fill(stronger.name)
        await page
          .getByRole("button", { name: `Edit ${stronger.name}`, exact: true })
          .click()
        await expect(page.getByLabel("Grants (JSON array)")).toHaveAttribute(
          "readonly",
          ""
        )
        await page
          .getByLabel("Role name", { exact: true })
          .fill(`${stronger.name} renamed`)
        await page.getByLabel("Reason", { exact: true }).fill(reason)
        await page
          .getByRole("button", { name: "Save Role", exact: true })
          .click()
        await expect(page.getByRole("dialog")).toBeHidden()
        stronger = await role(stronger.id)
        assert.deepEqual(stronger.grants, [customer(["phone"])])
      }
    )

    await group(
      "recipient laundering/self elevation/excess payloads have no credential/audit/receipt effects",
      async () => {
        const before = await counts()
        const own = await makeRole("own-only", [
          customer(["phone"], { createdBy: "$actor.id" }),
        ])
        const baseline = await counts()
        await deny(
          delegate.request,
          "createUser",
          {
            name: "laundering",
            email: `${randomUUID()}@example.test`,
            password: `${randomUUID()}Aa!`,
            roleIds: [own.id],
          },
          [ref("Role", own)],
          403,
          "FORBIDDEN"
        )
        await deny(
          delegate.request,
          "saveRole",
          { name: "self elevation", grants: [customer(["phone"])], reason },
          [],
          403,
          "FORBIDDEN"
        )
        await deny(
          delegate.request,
          "saveRole",
          { name: "own laundering", grants: own.grants, reason },
          [],
          403,
          "FORBIDDEN"
        )
        await deny(
          delegate.request,
          "saveRole",
          {
            name: "unknown",
            grants: [
              {
                subject: "Customer",
                action: "read",
                fields: ["phone"],
                conditions: { $or: [] },
              },
            ],
            reason,
          },
          [],
          422,
          "INVALID_INPUT"
        )
        assert.deepEqual(await counts(), baseline)
        assert.ok(baseline.audit > before.audit)
      }
    )

    await group(
      "unconditional covering actor delegates recipient-relative reusable conditional authority",
      async () => {
        const saved = await applied(delegate.request, "saveRole", {
          name: `T03c ${suffix} covered own`,
          grants: [customer(["fullName"], { createdBy: "$actor.id" })],
          reason,
        })
        const assigned = await role(saved.result.id)
        const made = await applied(
          delegate.request,
          "createUser",
          {
            name: `T03c ${suffix} covered recipient`,
            email: `${randomUUID()}@example.test`,
            password: `${randomUUID()}Aa!`,
            roleIds: [assigned.id],
          },
          [ref("Role", assigned)]
        )
        assert.equal((await user(made.result.id)).roles[0].id, assigned.id)
      }
    )

    await group(
      "nested target redaction/count/sort/filter and conservative registry",
      async () => {
        const hidden = await query<UserAdminDTO & { redactedFields: string[] }>(
          limited.request,
          "user",
          `?id=${target.row.id}`
        )
        assert.deepEqual(hidden.roles, [])
        assert.ok(hidden.redactedFields.includes("roles"))
        for (const path of [
          "roles",
          "audit?type=User&id=" + target.row.id,
          "users?q=target",
          "users?sort=" +
            encodeURIComponent('[{"field":"email","direction":"asc"}]'),
          "users?roleId=" + safe.id,
        ]) {
          const response = await limited.request.get(`/api/v1/queries/${path}`)
          assert.ok([403, 404].includes(response.status()))
          assert.equal((await response.json()).data, undefined)
        }
        const hiddenRefs = [
          ref("User", await user(target.row.id)),
          ref("Role", stronger),
        ]
        await deny(
          limited.request,
          "updateUser",
          {
            id: target.row.id,
            name: "hidden ref",
            active: true,
            roleIds: [stronger.id],
            reason,
          },
          hiddenRefs.map((r) => ({ ...r, revision: 1 })),
          404,
          "NOT_FOUND"
        )
        const registry = await query<PermissionRegistryDTO>(
          delegate.request,
          "permissionRegistry"
        )
        const customerRegistry = registry.subjects.find(
          (s) => s.subject === "Customer"
        )!
        assert.deepEqual(
          customerRegistry.actions[0].fields.map((f) => f.path),
          ["fullName"]
        )
        assert.ok(!JSON.stringify(registry).includes('"path":"phone"'))
        const list = await query<{ data: unknown[]; total: number }>(
          limited.request,
          "users",
          "?pageSize=10"
        )
        assert.equal(list.data.length, Math.min(10, list.total))
      }
    )

    await group(
      "audit population/order and historical nested role/diff projection",
      async () => {
        await replaceRole(secondRole, [
          ...secondRole.grants,
          grant("AuditLog", "read", ["id", "at", "fields"]),
        ])
        const audit = await query<{
          data: {
            fields?: { path: string; before: unknown; after: unknown }[]
            redactedFields: string[]
          }[]
          total: number
        }>(limited.request, "audit", `?type=User&id=${target.row.id}`)
        assert.ok(audit.total >= 2)
        assert.ok(
          audit.data.every((row) =>
            row.fields?.every((diff) =>
              ["id", "name", "revision", "roles"].includes(diff.path)
            )
          )
        )
        const roles = audit.data.flatMap(
          (row) => row.fields?.filter((diff) => diff.path === "roles") ?? []
        )
        assert.ok(roles.length)
        assert.ok(
          roles.every(
            (diff) => diff.after === null || JSON.stringify(diff.after) === "[]"
          )
        )
        assert.ok(
          audit.data.some((row) => row.redactedFields.includes("fields.roles"))
        )
        await replaceRole(secondRole, [
          ...secondRole.grants,
          grant("AuditLog", "read", ["fields"]),
        ])
        const forbiddenSort = await limited.request.get(
          `/api/v1/queries/audit?type=User&id=${target.row.id}`
        )
        assert.equal(forbiddenSort.status(), 403)
        assert.equal((await forbiddenSort.json()).error.code, "FIELD_FORBIDDEN")
      }
    )

    await group(
      "semantic reduction/removal/archive no old-grant floor; activation coverage/protected membership",
      async () => {
        delegation = await replaceRole(delegation, [
          ...ceiling,
          grant("Role", "update", ["grants"]),
          grant("User", "update", ["roleIds", "active"]),
        ])
        await applied(
          delegate.request,
          "saveRole",
          {
            id: stronger.id,
            name: stronger.name,
            grants: [customer(["phone"], { createdBy: "$actor.id" })],
            reason,
          },
          [ref("Role", stronger)]
        )
        stronger = await role(stronger.id)
        const current = await user(created.id)
        await applied(
          admin.request,
          "updateUser",
          {
            id: current.id,
            name: current.name,
            active: true,
            roleIds: [safe.id, stronger.id],
            reason,
          },
          [ref("User", current), ref("Role", safe), ref("Role", stronger)]
        )
        const withStronger = await user(created.id)
        await applied(
          delegate.request,
          "updateUser",
          {
            id: withStronger.id,
            name: withStronger.name,
            active: true,
            roleIds: [safe.id],
            reason,
          },
          [ref("User", withStronger), ref("Role", safe)]
        )
        const targetNow = await user(target.row.id)
        await applied(
          delegate.request,
          "updateUser",
          {
            id: targetNow.id,
            name: targetNow.name,
            active: false,
            roleIds: [stronger.id],
            reason,
          },
          [ref("User", targetNow), ref("Role", stronger)]
        )
        const inactive = await user(target.row.id)
        await deny(
          delegate.request,
          "updateUser",
          {
            id: inactive.id,
            name: inactive.name,
            active: true,
            roleIds: [stronger.id],
            reason,
          },
          [ref("User", inactive), ref("Role", stronger)],
          403,
          "FORBIDDEN"
        )
        const adminActor = await query<CurrentActorDTO>(
          admin.request,
          "currentActor"
        )
        const protectedUser = await user(adminActor.user.id)
        await deny(
          delegate.request,
          "updateUser",
          {
            id: protectedUser.id,
            name: protectedUser.name,
            active: false,
            roleIds: protectedUser.roles.map((r) => r.id),
            reason,
          },
          [
            ref("User", protectedUser),
            ...(await Promise.all(
              protectedUser.roles.map(async (r) =>
                ref("Role", await role(r.id))
              )
            )),
          ],
          403,
          "FORBIDDEN"
        )
        await deny(
          delegate.request,
          "saveRole",
          {
            id: delegation.id,
            name: delegation.name,
            grants: [...delegation.grants, customer(["phone"])],
            reason,
          },
          [ref("Role", delegation)],
          403,
          "FORBIDDEN"
        )
        await applied(
          delegate.request,
          "archiveRole",
          { id: stronger.id, reason },
          [ref("Role", stronger)]
        )
      }
    )

    await group(
      "each command REPLAY-REFERENCE original result/current affected and no business/audit/receipt effects",
      async () => {
        const newInput = {
          name: `T03c ${suffix} replay role`,
          grants: [customer(["fullName"])],
          reason,
        }
        const roleKey = randomUUID()
        const saved = await applied(
          delegate.request,
          "saveRole",
          newInput,
          [],
          roleKey
        )
        const replayRole = await role(saved.result.id)
        const rename = {
          id: replayRole.id,
          name: `${replayRole.name} updated`,
          grants: replayRole.grants,
          reason,
        }
        const renameRefs = [ref("Role", replayRole)]
        const renameKey = randomUUID()
        const renamed = await applied(
          delegate.request,
          "saveRole",
          rename,
          renameRefs,
          renameKey
        )
        const create = {
          name: `T03c ${suffix} replay user`,
          email: `${randomUUID()}@example.test`,
          password: `${randomUUID()}Aa!`,
          roleIds: [replayRole.id],
        }
        const createRefs = [ref("Role", await role(replayRole.id))]
        const createKey = randomUUID()
        const made = await applied(
          delegate.request,
          "createUser",
          create,
          createRefs,
          createKey
        )
        const madeUser = await user(made.result.id)
        const update = {
          id: madeUser.id,
          name: `${madeUser.name} updated`,
          active: true,
          roleIds: [replayRole.id],
          reason,
        }
        const updateRefs = [
          ref("User", madeUser),
          ref("Role", await role(replayRole.id)),
        ]
        const updateKey = randomUUID()
        const updated = await applied(
          delegate.request,
          "updateUser",
          update,
          updateRefs,
          updateKey
        )
        const archive = { id: replayRole.id, reason }
        const archiveRefs = [ref("Role", await role(replayRole.id))]
        const archiveKey = randomUUID()
        const archived = await applied(
          delegate.request,
          "archiveRole",
          archive,
          archiveRefs,
          archiveKey
        )
        const changedUser = await user(madeUser.id)
        await applied(
          admin.request,
          "updateUser",
          {
            id: changedUser.id,
            name: changedUser.name,
            active: false,
            roleIds: [empty.id],
            reason,
          },
          [ref("User", changedUser), ref("Role", empty)]
        )
        // Loss of historical business authority must not reauthorize old deltas.
        delegation = await replaceRole(
          delegation,
          delegation.grants.filter((g) => g.subject !== "Customer")
        )
        const before = await counts()
        for (const [name, input, refs, key, original] of [
          ["saveRole", newInput, [], roleKey, saved],
          ["saveRole", rename, renameRefs, renameKey, renamed],
          ["createUser", create, createRefs, createKey, made],
          ["updateUser", update, updateRefs, updateKey, updated],
          ["archiveRole", archive, archiveRefs, archiveKey, archived],
        ] as const) {
          const replay = await applied(
            delegate.request,
            name,
            input,
            [...refs],
            key
          )
          assert.equal(replay.replayed, true)
          assert.equal(replay.commandId, original.commandId)
          assert.deepEqual(replay.result, original.result)
          const current =
            original.result.type === "User"
              ? await user(original.result.id)
              : await role(original.result.id)
          assert.equal(replay.affected[0].revision, current.revision)
        }
        assert.deepEqual(await counts(), before)
        await deny(
          delegate.request,
          "saveRole",
          { ...newInput, name: "mismatch" },
          [],
          409,
          "IDEMPOTENCY_MISMATCH",
          roleKey
        )
        delegation = await replaceRole(
          delegation,
          delegation.grants.filter(
            (g) => !(g.subject === "Role" && g.action === "read")
          )
        )
        await deny(
          delegate.request,
          "saveRole",
          { ...newInput, name: "mismatch hidden" },
          [],
          404,
          "NOT_FOUND",
          roleKey
        )
        delegation = await replaceRole(
          delegation,
          delegation.grants.filter(
            (g) => !(g.subject === "User" && g.action === "create")
          )
        )
        await deny(
          delegate.request,
          "createUser",
          create,
          createRefs,
          403,
          "FORBIDDEN",
          createKey
        )
      }
    )

    await group(
      "role edit versus assignment/reactivation rebuilds recipient and holder coverage",
      async () => {
        delegation = await replaceRole(delegation, [
          grant("User", "read", ["*"]),
          grant("Role", "read", ["*"]),
          grant("User", "update", ["roleIds", "active"]),
          customer(["fullName"]),
        ])
        let racing = await makeRole("racing", [])
        for (const reactivation of [false, true]) {
          racing = await replaceRole(racing, [])
          const fixture = await makeUser(
            `race ${reactivation}`,
            reactivation ? [racing] : [safe]
          )
          if (reactivation) {
            await applied(
              admin.request,
              "updateUser",
              {
                id: fixture.row.id,
                name: fixture.row.name,
                active: false,
                roleIds: [racing.id],
                reason,
              },
              [ref("User", fixture.row), ref("Role", racing)]
            )
            fixture.row = await user(fixture.row.id)
          }
          const lock = await db.connect()
          const before = await counts()
          try {
            await lock.query("BEGIN")
            await lock.query("SELECT vamotors.lock_admin_guard()")
            const queued = post(
              delegate.request,
              "updateUser",
              {
                id: fixture.row.id,
                name: fixture.row.name,
                active: true,
                roleIds: reactivation ? [racing.id] : [safe.id, racing.id],
                reason,
              },
              [
                ref("User", fixture.row),
                { ...ref("Role", racing), revision: racing.revision + 1 },
                ...(!reactivation ? [ref("Role", safe)] : []),
              ]
            )
            let waiting = false
            const deadline = Date.now() + 3000
            while (Date.now() < deadline) {
              const rows = await db.query(
                "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.usename='vamotors_runtime' AND NOT l.granted"
              )
              if (rows.rowCount) {
                waiting = true
                break
              }
            }
            assert.ok(waiting, "GUARDED_WAITER_REQUIRED")
            await lock.query(
              "INSERT INTO vamotors.\"RolePermission\" (\"roleId\",\"permissionId\") SELECT $1,id FROM vamotors.\"Permission\" WHERE rule->>'subject'='Customer' AND rule->>'action'='read' AND rule->'fields'='[\"phone\"]'::jsonb AND NOT rule ? 'conditions' LIMIT 1",
              [racing.id]
            )
            await lock.query(
              'UPDATE vamotors."Role" SET revision=revision+1 WHERE id=$1',
              [racing.id]
            )
            await lock.query("COMMIT")
            const response = await queued
            assert.equal(response.status(), 403)
            assert.equal((await response.json()).error.code, "FORBIDDEN")
            assert.equal(
              (await user(fixture.row.id)).revision,
              fixture.row.revision
            )
            assert.deepEqual(await counts(), before)
          } finally {
            await lock.query("ROLLBACK")
            lock.release()
          }
        }
      }
    )

    await group(
      "receipt fault rolls back role/business/audit and releases runtime pool",
      async () => {
        delegation = await replaceRole(delegation, [
          grant("Role", "read", ["*"]),
          grant("Role", "create", ["name", "grants"]),
        ])
        const before = await counts()
        const name = `T03c ${suffix} fault`
        await db.query(
          'ALTER TABLE vamotors."CommandReceipt" ADD CONSTRAINT t03c_receipt_fault CHECK ("commandName" <> \'saveRole\') NOT VALID'
        )
        try {
          const response = await post(delegate.request, "saveRole", {
            name,
            grants: [],
            reason,
          })
          assert.equal(response.status(), 500)
          assert.equal((await response.json()).error.code, "INTERNAL_ERROR")
          assert.deepEqual(await counts(), before)
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM vamotors."Role" WHERE name=$1',
                [name]
              )
            ).rows[0].n,
            0
          )
        } finally {
          await db.query(
            'ALTER TABLE vamotors."CommandReceipt" DROP CONSTRAINT t03c_receipt_fault'
          )
        }
        await applied(delegate.request, "saveRole", {
          name,
          grants: [],
          reason,
        })
      }
    )

    await group(
      "revocation-before-lock stale waiter retries with fresh authority (execution and replay)",
      async () => {
        const cap = [
          grant("Role", "read", ["*"]),
          grant("Role", "create", ["name", "grants"]),
        ]
        delegation = await replaceRole(delegation, cap)
        const input = { name: `T03c ${suffix} queued`, grants: [], reason }
        const key = randomUUID()
        await applied(delegate.request, "saveRole", input, [], key)
        for (const replay of [false, true]) {
          delegation = await replaceRole(delegation, cap)
          const lock = await db.connect()
          try {
            await lock.query("BEGIN")
            await lock.query("SELECT vamotors.lock_admin_guard()")
            const queued = post(
              delegate.request,
              "saveRole",
              replay ? input : { ...input, name: `${input.name} fresh` },
              [],
              replay ? key : randomUUID()
            )
            // Observe the actual lock waiter, not a timing sleep.
            let waiting = false
            const deadline = Date.now() + 3000
            while (Date.now() < deadline) {
              const rows = await db.query(
                "SELECT 1 FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.usename='vamotors_runtime' AND NOT l.granted"
              )
              if (rows.rowCount) {
                waiting = true
                break
              }
            }
            assert.ok(waiting, "GUARDED_WAITER_REQUIRED")
            await lock.query(
              "DELETE FROM vamotors.\"RolePermission\" WHERE \"roleId\"=$1 AND \"permissionId\" IN (SELECT id FROM vamotors.\"Permission\" WHERE rule->>'subject'='Role' AND rule->>'action'='create')",
              [delegation.id]
            )
            await lock.query(
              'UPDATE vamotors."Role" SET revision=revision+1 WHERE id=$1',
              [delegation.id]
            )
            await lock.query("COMMIT")
            const response = await queued
            assert.equal(response.status(), 403)
            assert.equal((await response.json()).error.code, "FORBIDDEN")
          } finally {
            await lock.query("ROLLBACK")
            lock.release()
          }
        }
      }
    )

    await group(
      "removal and hidden-grants archive UI require no old grant read; hidden grants cannot be replaced",
      async () => {
        await replaceRole(secondRole, [
          ...secondRole.grants,
          grant("User", "update", ["roleIds", "active"]),
          grant("Role", "read", [
            "id",
            "revision",
            "name",
            "active",
            "systemKey",
          ]),
          grant("Role", "archive", ["active"]),
        ])
        const high = await makeRole("unread stronger grants", [
          customer(["phone"]),
        ])
        const fixture = await makeUser("remove unread", [safe, high])
        await applied(
          limited.request,
          "updateUser",
          {
            id: fixture.row.id,
            name: fixture.row.name,
            active: true,
            roleIds: [safe.id],
            reason,
          },
          [ref("User", fixture.row), ref("Role", safe)]
        )
        const inactive = await makeUser("unread reactivation", [high])
        await applied(
          admin.request,
          "updateUser",
          {
            id: inactive.row.id,
            name: inactive.row.name,
            active: false,
            roleIds: [high.id],
            reason,
          },
          [ref("User", inactive.row), ref("Role", high)]
        )
        const dormant = await user(inactive.row.id)
        await deny(
          limited.request,
          "updateUser",
          {
            id: dormant.id,
            name: dormant.name,
            active: true,
            roleIds: [high.id],
            reason,
          },
          [{ ...ref("User", dormant), revision: 1 }, ref("Role", high)],
          403,
          "FIELD_FORBIDDEN"
        )
        await limitedPage.goto("/users")
        await limitedPage
          .getByRole("button", { name: "Roles", exact: true })
          .click()
        await limitedPage.getByLabel("Search accounts or roles").fill(high.name)
        await limitedPage
          .getByRole("button", { name: `Edit ${high.name}`, exact: true })
          .click()
        await expect(limitedPage.getByLabel("Grants (JSON array)")).toHaveValue(
          ""
        )
        await expect(
          limitedPage.getByRole("button", { name: "Save Role", exact: true })
        ).toBeDisabled()
        await limitedPage.getByLabel("Reason", { exact: true }).fill(reason)
        await limitedPage
          .getByRole("button", { name: "Archive Role", exact: true })
          .click()
        await expect(limitedPage.getByRole("dialog")).toBeHidden()
        assert.equal((await role(high.id)).active, false)
      }
    )

    await group(
      "private UI identity/cache boundary after delegate revocation",
      async () => {
        delegation = await replaceRole(delegation, [
          grant("Role", "read", ["id", "revision", "grants"]),
          grant("Role", "update", ["grants"]),
        ])
        const selfInput = {
          id: delegation.id,
          name: delegation.name,
          grants: [],
          reason,
        }
        const selfKey = randomUUID()
        const selfRefs = [ref("Role", delegation)]
        const self = await applied(
          delegate.request,
          "saveRole",
          selfInput,
          selfRefs,
          selfKey
        )
        assert.equal(self.replayed, false)
        assert.deepEqual(
          (await query<CurrentActorDTO>(delegate.request, "currentActor"))
            .presentationGrants,
          []
        )
        await deny(
          delegate.request,
          "saveRole",
          selfInput,
          selfRefs,
          403,
          "FORBIDDEN",
          selfKey
        )
        await page.goto("/users")
        await page.waitForURL(/\/login(?:\?|$)/)
        await expect(page.getByRole("dialog")).toHaveCount(0)
        await expect(
          page.getByText(target.row.email!, { exact: true })
        ).toHaveCount(0)
        await limitedPage.goto("/users")
        await expect(
          limitedPage.getByRole("heading", { name: "Users & Roles" })
        ).toBeVisible()
        await expect(
          limitedPage.getByRole("button", { name: "Add User", exact: true })
        ).toHaveCount(0)
      }
    )
    await writeFile(
      join(directory, "t03c-results.json"),
      JSON.stringify(
        {
          sha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim(),
          origin,
          passed,
        },
        null,
        2
      ),
      { mode: 0o600 }
    )
  } finally {
    await browser.close()
    server.kill("SIGTERM")
    await exited
    await db.end()
  }
}
main().catch(async (error: unknown) => {
  if (process.argv[2])
    await writeFile(
      join(process.argv[2], "t03c-failure.txt"),
      error instanceof Error ? (error.stack ?? error.message) : "unknown",
      { mode: 0o600 }
    )
  console.error(`FAIL ${stage} (details suppressed; private t03c-failure.txt)`)
  process.exitCode = 1
})
