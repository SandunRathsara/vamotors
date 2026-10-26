// Regression adapted from the read-only independent correction review fixture.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { chromium, expect } from "@playwright/test"
import pg from "pg"
import { privateEnvironment } from "../../scripts/private-environment"
import type {
  RoleDTO,
  UserAdminDTO,
} from "../../.planning/implementation/contracts/api"

const dir = process.argv[2]!
const runtime = await privateEnvironment(join(dir, "runtime.env"))
const accounts = await privateEnvironment(join(dir, "accounts.env"))
const cluster = await privateEnvironment(join(dir, "cluster.env"))
const owner = await privateEnvironment(join(dir, "admin.env"))
assert.equal(cluster.PROJECT, process.cwd())
assert.equal(runtime.APP_ENV, "local")
const url = new URL(owner.ADMIN_URL!)
assert.equal(url.hostname, "127.0.0.1")
assert.equal(url.port, cluster.PORT)
url.pathname = new URL(runtime.DATABASE_URL!).pathname
const db = new pg.Client({ connectionString: url.href })
const observer = new pg.Client({ connectionString: url.href })
await db.connect()
await observer.connect()
const socket = createServer().listen(0, "127.0.0.1")
await once(socket, "listening")
const addr = socket.address() as { port: number }
await new Promise<void>((r) => socket.close(() => r()))
const origin = `http://127.0.0.1:${addr.port}`
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(addr.port),
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
const exit = once(server, "exit")
server.stderr.resume()
await new Promise<void>((resolve, reject) => {
  server.once("exit", () => reject(new Error("START_EXIT")))
  server.stdout.on("data", (b) => {
    if (b.toString().includes("Ready in")) resolve()
  })
})
const browser = await chromium.launch({ headless: true })
const admin = await browser.newContext({ baseURL: origin })
const subject = await browser.newContext({ baseURL: origin })
const a = await admin.newPage()
const b = await subject.newPage()
const errors: string[] = []
let phase = "login"
for (const p of [a, b]) {
  p.on("pageerror", () => errors.push("pageerror"))
  p.on("console", (m) => {
    if (
      /flushSync|aria-hidden|focus trap|Maximum update|unmounted component/i.test(
        m.text()
      )
    )
      errors.push(`${phase}: ${m.type()}: ${m.text().split("\n")[0]}`)
  })
}
const passed: string[] = []
async function group(name: string, test: () => Promise<void>) {
  phase = name
  await test()
  passed.push(name)
  console.log(`PASS ${name}`)
}
async function login(page: typeof a, who: string) {
  await page.goto("/login")
  await page
    .getByLabel("Email Address")
    .fill(accounts[`BOOTSTRAP_${who}_EMAIL`]!)
  await page
    .getByLabel("Password", { exact: true })
    .fill(accounts[`BOOTSTRAP_${who}_PASSWORD`]!)
  await page.getByRole("button", { name: "Sign In", exact: true }).click()
  await page.waitForURL("**/dashboard")
  await expect(
    page.getByRole("heading", { name: "Unavailable", exact: true })
  ).toBeVisible()
}
async function query(client: typeof admin, name: string, params = "") {
  const response = await client.request.get(`/api/v1/queries/${name}${params}`)
  assert.equal(response.status(), 200)
  return (await response.json()).data
}
async function command(name: string, input: unknown, expected: unknown[] = []) {
  const r = await admin.request.post(`/api/v1/commands/${name}`, {
    headers: { origin },
    data: { schemaVersion: 1, idempotencyKey: randomUUID(), input, expected },
  })
  assert.ok(r.ok(), `COMMAND_${r.status()}`)
}
async function event(type: string) {
  await b.evaluate((t) => window.dispatchEvent(new Event(t)), type)
}
async function frames() {
  await b.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      )
  )
}
async function hidden(keys = true) {
  await expect(
    b.getByRole("status").filter({ hasText: "Checking access" })
  ).toBeVisible()
  await expect(b.getByRole("dialog")).toHaveCount(0)
  assert.equal(
    await b.evaluate(() =>
      [
        ...document.querySelectorAll(
          '[role="dialog"], [data-slot="sheet-overlay"]'
        ),
      ].some((e) => e.checkVisibility())
    ),
    false
  )
  if (keys)
    for (const key of ["Tab", "Shift+Tab", "Escape", "Enter", "Control+b"])
      await b.keyboard.press(key)
  assert.equal(
    await b.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]')
    ),
    false
  )
  const cdp = await subject.newCDPSession(b)
  const ax = await cdp.send("Accessibility.getFullAXTree")
  await cdp.detach()
  assert.equal(
    ax.nodes.some(
      (n) =>
        !n.ignored &&
        (n.role?.value === "dialog" ||
          String(n.value?.value ?? "").includes("Independent private draft"))
    ),
    false
  )
}
async function lock() {
  await db.query("BEGIN")
  await db.query("SET LOCAL idle_in_transaction_session_timeout = '30s'")
  await db.query('LOCK TABLE vamotors."user" IN ACCESS EXCLUSIVE MODE')
}
async function blocked() {
  await expect
    .poll(async () =>
      Number(
        (
          await observer.query(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"
          )
        ).rows[0].count
      )
    )
    .toBeGreaterThan(0)
}
async function draft() {
  await b.goto("/users")
  await b.getByRole("button", { name: "Add User", exact: true }).click()
  await b.getByLabel("Name", { exact: true }).fill("Independent private draft")
  await b
    .getByLabel("Email", { exact: true })
    .fill("independent-private@example.test")
  await b.getByLabel("Initial password").fill("UnsavedIndependentDraft123!")
}
try {
  await login(a, "ADMIN")
  await login(b, "SECOND")
  const actor = await query(subject, "currentActor")
  const target = await query(admin, "user", `?id=${actor.user.id}`)
  const suffix = randomUUID().slice(0, 8)
  const customName = `Independent ${suffix}`
  await command("saveRole", {
    name: customName,
    grants: [],
    reason: "Independent review fixture",
  })
  let custom = (await query(admin, "roles", `?q=${suffix}`)).data[0]
  async function assign(ids: string[]) {
    const current = await query(admin, "user", `?id=${target.id}`)
    // Retained synthetic rows may exceed the first list page. Resolve every
    // required reference explicitly instead of silently omitting its revision.
    const roles = await Promise.all(
      ids.map((id) => query(admin, "role", `?id=${id}`))
    )
    await command(
      "updateUser",
      {
        id: target.id,
        name: target.name,
        active: true,
        roleIds: ids,
        reason: "Independent fingerprint variation",
      },
      [
        { type: "User", id: target.id, revision: current.revision },
        ...(roles as RoleDTO[])
          .filter((r) => ids.includes(r.id))
          .map((r) => ({ type: "Role", id: r.id, revision: r.revision })),
      ]
    )
  }
  await group(
    "12 rapid lifecycle cycles; synchronous hide, full AX tree, hidden keyboard listeners, pending timer and same-actor drafts",
    async () => {
      await draft()
      for (let i = 0; i < 12; i++) {
        await lock()
        try {
          const immediate = await b.evaluate(() => {
            window.dispatchEvent(new Event("blur"))
            return [
              ...document.querySelectorAll(
                '[data-slot="sheet-content"], [data-slot="sheet-overlay"]'
              ),
            ].some((e) => e.checkVisibility())
          })
          assert.equal(immediate, false, "SYNCHRONOUS_PORTAL_HIDE")
          await event("focus")
          await blocked()
          await event("blur")
          await hidden()
          await event("auth-check")
          if (i === 0) {
            // Wait on the actual 3-second boundary timer, not a mocked clock.
            const tick = b.waitForRequest((r) =>
              r.url().endsWith("/api/v1/queries/currentActor")
            )
            await db.query("ROLLBACK")
            await tick
            await frames()
            await hidden()
          }
        } finally {
          await db.query("ROLLBACK")
        }
        await frames()
        await hidden()
        await event("focus")
        await expect(b.getByLabel("Name", { exact: true })).toHaveValue(
          "Independent private draft"
        )
        await expect(b.getByLabel("Email", { exact: true })).toHaveValue(
          "independent-private@example.test"
        )
        await expect(b.getByLabel("Initial password")).toHaveValue(
          "UnsavedIndependentDraft123!"
        )
      }
      await b.keyboard.press("Escape")
      await expect(b.getByRole("dialog")).toHaveCount(0)
    }
  )
  for (const kind of ["user", "role"] as const) {
    for (const mode of ["no-hide", "hidden-no-keys", "hidden-keys"] as const) {
      await group(
        `${kind}: mobile stacked-navigation attempt, ${mode}, three cycles`,
        async () => {
          await b.setViewportSize({ width: 375, height: 812 })
          if (kind === "role") {
            await b.goto("/users")
            await b.getByRole("button", { name: "Roles", exact: true }).click()
            await b
              .getByRole("button", { name: "Add Role", exact: true })
              .click()
            await b
              .getByLabel("Role name", { exact: true })
              .fill("Independent private draft")
            await b
              .getByLabel("Reason", { exact: true })
              .fill("Independent nested role draft")
          } else await draft()
          const field = b.getByLabel(kind === "user" ? "Name" : "Role name", {
            exact: true,
          })
          async function ownsFocus() {
            await expect(
              b.locator('[role="dialog"][data-state="open"]')
            ).toHaveCount(1)
            await expect(b.getByRole("dialog")).toHaveCount(1)
            await expect
              .poll(() =>
                b.evaluate(() => {
                  const active = document.activeElement
                  return (
                    !!active?.closest('[data-slot="sheet-content"]') &&
                    !active.closest('[aria-hidden="true"]')
                  )
                })
              )
              .toBe(true)
            const cdp = await subject.newCDPSession(b)
            try {
              const ax = await cdp.send("Accessibility.getFullAXTree")
              assert.equal(
                ax.nodes.filter((n) => !n.ignored && n.role?.value === "dialog")
                  .length,
                1
              )
            } finally {
              await cdp.detach()
            }
          }
          for (let cycle = 0; cycle < 3; cycle++) {
            await field.focus()
            await b.keyboard.press("Control+b")
            await ownsFocus()
            if (mode !== "no-hide") {
              await lock()
              try {
                assert.equal(
                  await b.evaluate(() => {
                    window.dispatchEvent(new Event("blur"))
                    return [
                      ...document.querySelectorAll(
                        '[role="dialog"], [data-slot="sheet-overlay"]'
                      ),
                    ].some((e) => e.checkVisibility())
                  }),
                  false,
                  "SYNCHRONOUS_PORTAL_HIDE"
                )
                const revalidation = b.waitForRequest((r) =>
                  r.url().endsWith("/api/v1/queries/currentActor")
                )
                await event("focus")
                await revalidation
                await blocked()
                await hidden(mode === "hidden-keys")
                await frames()
                await hidden(mode === "hidden-keys")
              } finally {
                await db.query("ROLLBACK")
              }
              await event("focus")
            }
            await expect(field).toHaveValue("Independent private draft")
            if (kind === "user") {
              await expect(b.getByLabel("Email", { exact: true })).toHaveValue(
                "independent-private@example.test"
              )
              await expect(b.getByLabel("Initial password")).toHaveValue(
                "UnsavedIndependentDraft123!"
              )
            } else
              await expect(b.getByLabel("Reason", { exact: true })).toHaveValue(
                "Independent nested role draft"
              )
            await ownsFocus()
            await field.scrollIntoViewIfNeeded()
            await expect
              .poll(() =>
                field.evaluate((el) => {
                  const rect = el.getBoundingClientRect()
                  return (
                    document.elementFromPoint(
                      rect.x + rect.width / 2,
                      rect.y + rect.height / 2
                    ) === el
                  )
                })
              )
              .toBe(true)
            await field.click()
            await expect(field).toBeFocused()
            for (const key of ["Tab", "Shift+Tab"])
              for (let step = 0; step < 12; step++) {
                await b.keyboard.press(key)
                await ownsFocus()
              }
          }
          await b.keyboard.press("Escape")
          await expect(b.locator('[role="dialog"]')).toHaveCount(0)
          // Keyboard navigation remains available after the business dialog closes.
          await b.keyboard.press("Control+b")
          await expect(
            b.getByRole("dialog", { name: "Sidebar", exact: true })
          ).toBeVisible()
          await b.keyboard.press("Tab")
          assert.equal(
            await b.evaluate(
              () =>
                !!document.activeElement?.closest('[data-sidebar="sidebar"]') &&
                !document.activeElement.closest('[aria-hidden="true"]')
            ),
            true
          )
          await b.keyboard.press("Escape")
          await expect(b.locator('[role="dialog"]')).toHaveCount(0)
          await b.setViewportSize({ width: 1280, height: 900 })
        }
      )
    }
  }
  await group(
    "real blocked command completes while hidden; auth-check remains live, no resurrection or stuck pending, fresh cache",
    async () => {
      await b.goto("/users")
      await b.getByRole("button", { name: "Roles", exact: true }).click()
      await b.getByRole("button", { name: "Add Role", exact: true }).click()
      const name = `Command ${suffix}`
      await b.getByLabel("Role name", { exact: true }).fill(name)
      await b
        .getByLabel("Reason", { exact: true })
        .fill("Independent command while hidden")
      await lock()
      const response = b.waitForResponse((r) =>
        r.url().endsWith("/api/v1/commands/saveRole")
      )
      try {
        await b.getByRole("button", { name: "Save Role", exact: true }).click()
        await blocked()
        await event("blur")
        await hidden()
      } finally {
        await db.query("ROLLBACK")
      }
      assert.equal((await response).status(), 201)
      await expect
        .poll(
          async () =>
            (await query(admin, "roles", `?q=${encodeURIComponent(name)}`))
              .total
        )
        .toBe(1)
      await frames()
      await hidden()
      await event("focus")
      await expect(b.getByRole("dialog")).toHaveCount(0)
      await expect(
        b.getByRole("button", { name: `Edit ${name}`, exact: true })
      ).toBeVisible()
    }
  )
  await group(
    "hidden query cache refetches roles changed by another actor while preserving local unsaved state",
    async () => {
      await draft()
      await event("blur")
      await hidden()
      await command(
        "saveRole",
        {
          id: custom.id,
          name: `${customName} Fresh`,
          grants: [],
          reason: "Changed while effects disconnected",
        },
        [{ type: "Role", id: custom.id, revision: custom.revision }]
      )
      await event("focus")
      await expect(
        b.getByLabel(`${customName} Fresh`, { exact: true })
      ).toBeVisible()
      await expect(b.getByLabel("Name", { exact: true })).toHaveValue(
        "Independent private draft"
      )
      custom = await query(admin, "role", `?id=${custom.id}`)
      await b.keyboard.press("Escape")
    }
  )
  await group(
    "same actor retains Administrator but authz fingerprint changes: reload discards all private draft state",
    async () => {
      await draft()
      await event("blur")
      await assign([
        ...(target.roles as UserAdminDTO["roles"]).map((r) => r.id),
        custom.id,
      ])
      const navigation = b.waitForEvent(
        "framenavigated",
        (f) => f === b.mainFrame()
      )
      await event("focus")
      await navigation
      await expect(
        b.getByRole("heading", { name: "Users & Roles", exact: true })
      ).toBeVisible()
      await expect(b.getByRole("dialog")).toHaveCount(0)
      await b.getByRole("button", { name: "Add User", exact: true }).click()
      await expect(b.getByLabel("Name", { exact: true })).toHaveValue("")
      await expect(b.getByLabel("Initial password")).toHaveValue("")
      await b.keyboard.press("Escape")
      await assign((target.roles as UserAdminDTO["roles"]).map((r) => r.id))
      await b.reload()
    }
  )
  await group(
    "account switch Administrator to Administrator reloads once; old drafts never migrate to new identity",
    async () => {
      await draft()
      await event("blur")
      assert.equal(
        (
          await subject.request.post("/api/auth/sign-out", {
            headers: { origin },
            data: {},
          })
        ).status(),
        200
      )
      assert.equal(
        (
          await subject.request.post("/api/auth/sign-in/email", {
            headers: { origin },
            data: {
              email: accounts.BOOTSTRAP_ADMIN_EMAIL,
              password: accounts.BOOTSTRAP_ADMIN_PASSWORD,
            },
          })
        ).status(),
        200
      )
      let navigations = 0
      b.on("request", (r) => {
        if (r.isNavigationRequest() && r.frame() === b.mainFrame())
          navigations++
      })
      await event("focus")
      await expect(
        b.getByRole("heading", { name: "Users & Roles", exact: true })
      ).toBeVisible()
      await expect(b.getByRole("dialog")).toHaveCount(0)
      await expect
        .poll(
          async () =>
            (await query(subject, "currentActor")).user.id !== actor.user.id
        )
        .toBe(true)
      await b.getByRole("button", { name: "Add User", exact: true }).click()
      await expect(b.getByLabel("Email", { exact: true })).toHaveValue("")
      await expect(b.getByLabel("Initial password")).toHaveValue("")
      await event("blur")
      await event("focus")
      await expect(b.getByLabel("Name", { exact: true })).toBeVisible()
      assert.equal(navigations, 1, "NO_REDIRECT_LOOP")
      await b.keyboard.press("Escape")
    }
  )
  await group(
    "access-lost during real pending validation cannot be undone by late success",
    async () => {
      await draft()
      await lock()
      try {
        await event("blur")
        await event("focus")
        await blocked()
        await event("access-lost")
        await b.waitForURL(/\/login(?:\?|$)/)
        await expect(b.getByRole("dialog")).toHaveCount(0)
      } finally {
        await db.query("ROLLBACK")
      }
      await frames()
      await expect(
        b.getByRole("button", { name: "Sign In", exact: true })
      ).toBeVisible()
      await expect(b.getByRole("dialog")).toHaveCount(0)
    }
  )
  await writeFile(
    join(dir, "mobile-focus-evidence.json"),
    JSON.stringify(
      {
        sha: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        dirty: !!execFileSync("git", ["status", "--porcelain"], {
          encoding: "utf8",
        }).trim(),
        passed,
        errors,
        fixture: "tests/security/mobile-focus-check.ts",
        transport:
          "own production Next, own PostgreSQL actual lock, Chromium CDP full AX tree; no mocks",
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  assert.deepEqual(errors, [])
} finally {
  await db.query("ROLLBACK").catch(() => {})
  await db.end()
  await observer.end()
  await browser.close()
  server.kill("SIGTERM")
  await exit
}
