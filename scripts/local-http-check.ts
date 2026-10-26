/** Production Next HTTP transport smoke; no browser or mock transport. */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { once } from "node:events"
import { privateEnvironment } from "./private-environment"
import { runtimeConfig } from "../lib/server/config"

async function main() {
  const runtime = runtimeConfig(await privateEnvironment(process.argv[2] ?? ""))
  assert.equal(runtime.APP_ENV, "local")
  const accounts = await privateEnvironment(process.argv[3] ?? "")
  const socket = createServer()
  socket.listen(0, "127.0.0.1")
  await once(socket, "listening")
  const address = socket.address()
  assert.ok(address && typeof address !== "string")
  const port = address.port
  await new Promise<void>((ok) => socket.close(() => ok()))
  const origin = `http://127.0.0.1:${port}`
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      env: {
        ...process.env,
        ...runtime,
        NODE_ENV: "production",
        APP_ORIGIN: origin,
        BETTER_AUTH_URL: origin,
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  // Never echo server output, which might contain library diagnostics.
  child.stderr.resume()
  const exited = once(child, "exit")
  try {
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(
        () => fail(new Error("LOCAL_HTTP_START_TIMEOUT")),
        20000
      )
      child.once("error", () => {
        clearTimeout(timer)
        fail(new Error("LOCAL_HTTP_START_FAILED"))
      })
      child.once("exit", () => {
        clearTimeout(timer)
        fail(new Error("LOCAL_HTTP_EARLY_EXIT"))
      })
      child.stdout.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("Ready in")) {
          clearTimeout(timer)
          ok()
        }
      })
    })
    const post = (
      path: string,
      body: unknown,
      cookie?: string,
      requestOrigin = origin
    ) =>
      fetch(`${origin}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: requestOrigin,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      })
    const query = (cookie?: string) =>
      fetch(`${origin}/api/v1/queries/currentActor`, {
        headers: cookie ? { cookie } : {},
      })
    assert.equal((await query()).status, 401)
    assert.equal((await post("/api/auth/sign-up/email", {})).status, 404)
    assert.equal(
      (
        await post(
          "/api/auth/sign-in/email",
          {
            email: accounts.BOOTSTRAP_ADMIN_EMAIL,
            password: accounts.BOOTSTRAP_ADMIN_PASSWORD,
          },
          undefined,
          "http://foreign.example.test"
        )
      ).status,
      403
    )
    for (const prefix of ["ADMIN", "STAFF"]) {
      const login = await post("/api/auth/sign-in/email", {
        email: accounts[`BOOTSTRAP_${prefix}_EMAIL`],
        password: accounts[`BOOTSTRAP_${prefix}_PASSWORD`],
      })
      assert.equal(login.status, 200)
      assert.deepEqual(await login.json(), { ok: true })
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ")
      assert.ok(cookie)
      const actor = await query(cookie)
      assert.equal(actor.status, 200)
      assert.equal(actor.headers.get("cache-control"), "private,no-store")
      const body = JSON.stringify(await actor.json())
      assert.ok(!body.includes("password") && !body.includes("token"))
      const logout = await post("/api/auth/sign-out", {}, cookie)
      assert.equal(logout.status, 200)
      assert.equal((await query(cookie)).status, 401)
    }
    console.log(
      "PASS production Next HTTP: unauthenticated denial, signup disabled, foreign Origin denial, administrator/staff login, currentActor no-store, logout/cookie revocation."
    )
  } finally {
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
    await exited
    clearTimeout(timer)
  }
}
main().catch(() => {
  console.error("Local HTTP checks failed; no secret diagnostics emitted.")
  process.exitCode = 1
})
