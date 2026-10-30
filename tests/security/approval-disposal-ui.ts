/** Production Chromium with real active SW; explicit keyboard actions, no mocked owner. */
import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { chromium, expect, type Locator, type Page } from "@playwright/test"
import type {
  Pending,
  PurchaseCycleDTO,
  CurrentActorDTO,
  Grant,
} from "../../.planning/implementation/contracts/api"
import { envelope, fixture, purchaseInput, ref } from "./cycle-edits-fixture"
import { privateEnvironment } from "../../scripts/private-environment"

process.umask(0o077)
const root = process.argv[2]
assert.ok(root)
const f = await fixture(root),
  browser = await chromium.launch({ headless: true }),
  suffix = randomUUID().slice(0, 8),
  groups: unknown[] = []
const tables = [
  "Vehicle",
  "PurchaseRecord",
  "PurchasePayment",
  "CostPayment",
  "CycleBasisVersion",
  "StatusEvent",
  "ApprovalRequest",
  "Disposal",
  "DisposalReceipt",
  "Notification",
  "AuditEntry",
  "EntityReadVersion",
  "CommandReceipt",
  "BusinessSequence",
]
let stage = "initialize"
const pages: Page[] = [],
  responses: { path: string; status: number }[] = [],
  navigation: {
    page: number
    event: string
    path: string
    failure?: string
  }[] = []
async function key(page: Page, control: Locator) {
  // Let the previous action's intentional alert-focus animation frame finish.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
  await control.focus()
  await expect(control).toBeFocused()
  await control.press("Enter")
}
async function group(name: string, run: () => Promise<void>) {
  if (process.argv[3] && !name.includes(process.argv[3])) {
    groups.push({
      group: name,
      skipped: true,
      reason: "Explicit diagnostic group filter",
    })
    return
  }
  stage = name
  await run()
  groups.push({ group: name, pass: true })
  console.log(`PASS ${name}`)
}
async function view(page: Page, label: string) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  )
  const controls = await page
    .locator("header")
    .getByRole("button")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const rect = button.getBoundingClientRect()
        let left = 0,
          right = innerWidth,
          top = 0,
          bottom = innerHeight
        for (
          let ancestor = button.parentElement;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor),
            box = ancestor.getBoundingClientRect()
          if (/hidden|clip|auto|scroll/.test(style.overflowX)) {
            left = Math.max(left, box.left)
            right = Math.min(right, box.right)
          }
          if (/hidden|clip|auto|scroll/.test(style.overflowY)) {
            top = Math.max(top, box.top)
            bottom = Math.min(bottom, box.bottom)
          }
        }
        return {
          name: button.getAttribute("aria-label") ?? button.textContent?.trim(),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          fullyVisible:
            rect.left >= left &&
            rect.right <= right &&
            rect.top >= top &&
            rect.bottom <= bottom,
        }
      })
    )
  for (const control of controls)
    assert.ok(
      control.fullyVisible,
      `Header action clipped: ${JSON.stringify(control)}`
    )
  groups.push({ group: `${label} actual header action bounds`, controls })
  await page.screenshot({
    path: join(root, `writeoff-ui-${suffix}-${label}.png`),
    fullPage: true,
  })
}
try {
  await f.start()
  const admin = await f.login("ADMIN"),
    second = await f.login("SECOND")
  try {
    const requester = await browser.newContext({
      baseURL: f.origin,
      storageState: await admin.storageState(),
      viewport: { width: 1920, height: 1080 },
      serviceWorkers: "allow",
    })
    const sameActor = await browser.newContext({
      baseURL: f.origin,
      storageState: await admin.storageState(),
      viewport: { width: 360, height: 800 },
      serviceWorkers: "allow",
    })
    const reviewer = await browser.newContext({
      baseURL: f.origin,
      storageState: await second.storageState(),
      viewport: { width: 360, height: 800 },
      serviceWorkers: "allow",
    })
    const page = await requester.newPage(),
      mobile = await reviewer.newPage(),
      other = await sameActor.newPage()
    pages.push(page, mobile, other)
    for (const [index, p] of pages.entries()) {
      p.on("request", (request) => {
        if (request.isNavigationRequest())
          navigation.push({
            page: index,
            event: "request",
            path:
              new URL(request.url()).pathname + new URL(request.url()).search,
          })
      })
      p.on("requestfailed", (request) => {
        if (request.isNavigationRequest())
          navigation.push({
            page: index,
            event: "failed",
            path:
              new URL(request.url()).pathname + new URL(request.url()).search,
            failure: request.failure()?.errorText,
          })
      })
      p.on("framenavigated", (frame) => {
        if (frame === p.mainFrame() && frame.url() !== "about:blank")
          navigation.push({
            page: index,
            event: "commit",
            path: new URL(frame.url()).pathname + new URL(frame.url()).search,
          })
      })
      p.on("response", (response) => {
        const path = new URL(response.url()).pathname
        if (
          path.startsWith("/api/v1/commands/") ||
          path === "/api/auth/sign-out" ||
          path === "/api/v1/queries/currentActor"
        )
          responses.push({ path, status: response.status() })
      })
    }
    const supplier = await f.command(
      admin,
      "createDirectoryParty",
      envelope({
        type: "SUPPLIER",
        values: {
          name: `Writeoff UI ${suffix}`,
          category: "COMPANY",
          contacts: [],
        },
      }),
      201
    )
    const created = await f.command(
      admin,
      "recordPurchase",
      envelope(purchaseInput(supplier.result.id, suffix, "ui"), [
        ref(supplier.result, "Supplier"),
      ]),
      201
    )
    let row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${created.result.id}`
    )
    await f.command(
      admin,
      "addCost",
      envelope(
        {
          cycleId: row.id,
          category: "Transport",
          description: "Actual UI basis cost",
          amount: "500",
          incurredDate: "2026-10-03",
        },
        [ref(row)]
      ),
      201
    )
    row = await f.query<PurchaseCycleDTO>(
      admin,
      "purchase",
      `?cycleId=${row.id}`
    )
    const createCycle = async (tag: string) => {
      const created = await f.command(
        admin,
        "recordPurchase",
        envelope(purchaseInput(supplier.result.id, suffix, tag), [
          ref(supplier.result, "Supplier"),
        ]),
        201
      )
      return f.query<PurchaseCycleDTO>(
        admin,
        "purchase",
        `?cycleId=${created.result.id}`
      )
    }
    const zeroDraft = async (
      p: Page,
      source: PurchaseCycleDTO,
      tag: string
    ) => {
      await p.goto(`/purchases/${source.id}`)
      await key(
        p,
        p.getByRole("button", { name: "Request write-off", exact: true })
      )
      await p.getByLabel("Disposal date", { exact: true }).fill("2026-10-04")
      await p
        .getByLabel("Disposal reason", { exact: true })
        .fill(`PRIVATE_UI_DISPOSAL_${tag}_${suffix}`)
      await p
        .getByLabel("Approval request reason", { exact: true })
        .fill(`PRIVATE_UI_REQUEST_${tag}_${suffix}`)
      await p.getByLabel("Actual proceeds", { exact: false }).fill("0")
    }
    const requestBodies: string[] = [],
      reviewBodies: string[] = [],
      routeErrors: number[] = []
    let pending!: Pending
    await group(
      "P8 360 header controls are fully visible and keyboard reachable",
      async () => {
        await mobile.goto(`/purchases/${row.id}`)
        await expect(
          mobile.getByRole("button", { name: "Request write-off", exact: true })
        ).toBeVisible()
        await view(mobile, "header-360")
        const controls = mobile.locator("header").getByRole("button")
        await controls.first().focus()
        for (let index = 0; index < (await controls.count()); index++) {
          await expect(controls.nth(index)).toBeFocused()
          if (index + 1 < (await controls.count()))
            await mobile.keyboard.press("Tab")
        }
      }
    )
    await group(
      "P8 1920 keyboard request, committed response loss, route unmount and failed ordinary read preserve exact envelope",
      async () => {
        await page.goto(`/purchases/${row.id}`)
        await page.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await key(
          page,
          page.getByRole("button", { name: "Request write-off", exact: true })
        )
        await page
          .getByLabel("Disposal date", { exact: true })
          .fill("2026-10-04")
        await page.getByLabel("Disposal method", { exact: true }).focus()
        await page.keyboard.press("ArrowDown")
        await page
          .getByLabel("Disposal reason", { exact: true })
          .fill(`PRIVATE_UI_DISPOSAL_${suffix}`)
        await page
          .getByLabel("Approval request reason", { exact: true })
          .fill(`PRIVATE_UI_REQUEST_${suffix}`)
        await page.getByLabel("Actual proceeds", { exact: false }).fill("20.00")
        await page
          .getByLabel("Actual receipt date", { exact: true })
          .fill("2026-10-05")
        await page
          .getByLabel("Receipt reference (optional)", { exact: true })
          .fill(`PRIVATE_UI_RECEIPT_${suffix}`)
        await requester.route(
          "**/api/v1/commands/requestApproval",
          async (route) => {
            // A controlling active SW deliberately leaves POST on native network.
            requestBodies.push(route.request().postData()!)
            if (requestBodies.length === 1) {
              const response = await route.fetch()
              if (response.status() !== 202) routeErrors.push(response.status())
              pending = await response.json()
              await route.abort("failed")
            } else await route.continue()
          }
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        await expect(
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        ).toBeVisible()
        assert.deepEqual(routeErrors, [])
        const committed = await f.snapshot(tables)
        await key(
          page,
          page.getByRole("link", { name: "Approvals", exact: true })
        )
        await expect(
          page.getByRole("heading", { name: "Approvals", exact: true })
        ).toBeVisible()
        await requester.route("**/api/v1/queries/purchase?**", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              error: { code: "RETRYABLE_TRANSACTION", retryable: true },
            }),
          })
        )
        await page.goBack()
        await expect(
          page.getByRole("button", { name: "Retry detail", exact: true })
        ).toBeVisible()
        await requester.unroute("**/api/v1/queries/purchase?**")
        await key(
          page,
          page.getByRole("button", { name: "Retry detail", exact: true })
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Recover unresolved write-off request",
            exact: true,
          })
        )
        await expect(
          page.getByLabel("Approval request reason", { exact: true })
        ).toHaveValue(`PRIVATE_UI_REQUEST_${suffix}`)
        await key(
          page,
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        )
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "Not written off; no funds recorded" })
        ).toBeVisible()
        assert.equal(requestBodies.length, 2)
        assert.equal(requestBodies[0], requestBodies[1])
        assert.equal(await f.snapshot(tables), committed)
        await requester.unroute("**/api/v1/commands/requestApproval")
        await other.goto(`/approvals/${pending.approvalId}`)
        await expect(
          other.getByText("A separate authorized reviewer is required.", {
            exact: false,
          })
        ).toBeVisible()
        await expect(
          other.getByRole("button", { name: "Commit review", exact: true })
        ).toHaveCount(0)
        await view(page, "requester-1920")
        await view(other, "same-actor-360")
      }
    )
    await group(
      "P8 separate 360 keyboard review, committed response loss and unmount recovery",
      async () => {
        await mobile.goto(`/approvals/${pending.approvalId}`)
        await mobile.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await expect(
          mobile.getByText(`PRIVATE_UI_REQUEST_${suffix}`, { exact: true })
        ).toBeVisible()
        await mobile
          .getByLabel("Review note (required for rejection)")
          .fill("Actual independent approval")
        await reviewer.route(
          "**/api/v1/commands/reviewApproval",
          async (route) => {
            reviewBodies.push(route.request().postData()!)
            if (reviewBodies.length === 1) {
              const response = await route.fetch()
              if (response.status() !== 200) routeErrors.push(response.status())
              await route.abort("failed")
            } else await route.continue()
          }
        )
        await key(
          mobile,
          mobile.getByRole("button", { name: "Commit review", exact: true })
        )
        await expect(
          mobile.getByRole("button", {
            name: "Retry identical review",
            exact: true,
          })
        ).toBeVisible()
        const committed = await f.snapshot(tables)
        await key(
          mobile,
          mobile.getByRole("link", {
            name: "Owning purchase cycle",
            exact: true,
          })
        )
        await expect(
          mobile.getByRole("heading", {
            name: "Committed current disposal",
            exact: true,
          })
        ).toBeVisible()
        await mobile.goBack()
        await key(
          mobile,
          mobile.getByRole("button", {
            name: "Retry identical review",
            exact: true,
          })
        )
        await expect(
          mobile.getByRole("alert").filter({ hasText: "Review committed once" })
        ).toBeVisible()
        assert.equal(reviewBodies.length, 2)
        assert.equal(reviewBodies[0], reviewBodies[1])
        assert.equal(await f.snapshot(tables), committed)
        await reviewer.unroute("**/api/v1/commands/reviewApproval")
        await view(mobile, "reviewer-terminal-360")
        await page.goto(`/vehicles/${row.vehicleId}`)
        await expect(
          page.getByRole("heading", {
            name: "Committed current disposal",
            exact: true,
          })
        ).toBeVisible()
        await expect(page.getByText("85.00", { exact: true })).toBeVisible()
        await view(page, "vehicle-terminal-1920")
      }
    )
    await group(
      "P8 360 keyboard rejection retains exact proposal and has no domain effect",
      async () => {
        const source = await createCycle("keyboard-reject")
        await zeroDraft(other, source, "reject")
        const domain = [
          "Vehicle",
          "PurchaseRecord",
          "MileageReading",
          "PurchasePayment",
          "VehicleCost",
          "CostPayment",
          "CycleBasisVersion",
          "StatusEvent",
        ]
        const before = await f.snapshot(domain)
        const requested = other.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/v1/commands/requestApproval"
        )
        await key(
          other,
          other.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        const response = await requested
        assert.equal(response.status(), 202)
        const p = (await response.json()) as Pending
        assert.equal(p.businessEffect, false)
        await mobile.goto(`/approvals/${p.approvalId}`)
        const decision = mobile.getByLabel("Decision", { exact: true })
        await decision.focus()
        await decision.press("End")
        await expect(decision).toHaveValue("REJECT")
        await mobile
          .getByLabel("Review note (required for rejection)")
          .fill(`PRIVATE_UI_REJECT_NOTE_${suffix}`)
        const reviewed = mobile.waitForResponse(
          (r) => new URL(r.url()).pathname === "/api/v1/commands/reviewApproval"
        )
        await key(
          mobile,
          mobile.getByRole("button", { name: "Commit review", exact: true })
        )
        const result = await reviewed
        assert.equal(result.status(), 200)
        await expect(
          mobile.getByText("REJECTED", { exact: true })
        ).toBeVisible()
        await expect(
          mobile.getByText(`PRIVATE_UI_REJECT_NOTE_${suffix}`, { exact: true })
        ).toBeVisible()
        assert.equal(await f.snapshot(domain), before)
        await mobile.reload()
        await expect(
          mobile.getByText(`PRIVATE_UI_REQUEST_reject_${suffix}`, {
            exact: true,
          })
        ).toBeVisible()
        await expect(
          mobile.getByRole("button", { name: "Commit review", exact: true })
        ).toHaveCount(0)
        await view(mobile, "keyboard-reject-360")
        groups.push({
          group: "actual rejection evidence",
          approvalId: p.approvalId,
          requestCommandId: p.commandId,
          reviewCommandId: (await result.json()).commandId,
          domainBeforeAfterSha256: createHash("sha256")
            .update(before)
            .digest("hex"),
        })
      }
    )
    await group(
      "P8 stale draft requires failed-read recovery and explicit new-key reconfirmation",
      async () => {
        const source = await createCycle("keyboard-stale"),
          bodies: string[] = []
        await zeroDraft(other, source, "stale")
        await f.command(
          admin,
          "setListedPrice",
          envelope(
            {
              cycleId: source.id,
              amount: "21000",
              reason: "Actual concurrent asking-price edit",
            },
            [ref(source)]
          )
        )
        const before = await f.snapshot(tables)
        await sameActor.route("**/api/v1/commands/requestApproval", (route) => {
          bodies.push(route.request().postData()!)
          return route.continue()
        })
        const failed = other.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/v1/commands/requestApproval"
        )
        await key(
          other,
          other.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        assert.equal((await failed).status(), 409)
        await expect(
          other.getByRole("alert").filter({ hasText: "STALE_REVISION" })
        ).toBeVisible()
        await expect(
          other.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        ).toBeDisabled()
        await sameActor.route("**/api/v1/queries/purchase?**", (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              error: { code: "RETRYABLE_TRANSACTION", retryable: true },
            }),
          })
        )
        await key(
          other,
          other.getByRole("button", {
            name: "Reload current cycle",
            exact: true,
          })
        )
        await expect(
          other.getByRole("alert").filter({ hasText: "RETRYABLE_TRANSACTION" })
        ).toBeVisible()
        await expect(
          other.getByLabel("Approval request reason", { exact: true })
        ).toHaveValue(`PRIVATE_UI_REQUEST_stale_${suffix}`)
        await expect(
          other.getByRole("button", {
            name: "Confirm current source and new request",
            exact: true,
          })
        ).toHaveCount(0)
        assert.equal(await f.snapshot(tables), before)
        await sameActor.unroute("**/api/v1/queries/purchase?**")
        await key(
          other,
          other.getByRole("button", {
            name: "Reload current cycle",
            exact: true,
          })
        )
        await expect(
          other.getByRole("button", {
            name: "Confirm current source and new request",
            exact: true,
          })
        ).toBeVisible()
        assert.equal(bodies.length, 1)
        await key(
          other,
          other.getByRole("button", {
            name: "Confirm current source and new request",
            exact: true,
          })
        )
        assert.equal(bodies.length, 1)
        const applied = other.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/v1/commands/requestApproval"
        )
        await key(
          other,
          other.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        const response = await applied
        assert.equal(response.status(), 202)
        assert.equal(bodies.length, 2)
        const old = JSON.parse(bodies[0]),
          fresh = JSON.parse(bodies[1])
        assert.notEqual(old.idempotencyKey, fresh.idempotencyKey)
        assert.deepEqual(old.input, fresh.input)
        assert.equal(
          fresh.expected.find(
            (r: { type: string }) => r.type === "PurchaseRecord"
          ).revision,
          source.revision + 1
        )
        assert.deepEqual(
          fresh.expected.find((r: { type: string }) => r.type === "Vehicle"),
          {
            type: "Vehicle",
            id: source.vehicleId,
            revision: source.identityRevision,
          }
        )
        await sameActor.unroute("**/api/v1/commands/requestApproval")
        await view(other, "stale-reconfirmed-360")
        groups.push({
          group: "actual explicit reconfirmation",
          oldKey: old.idempotencyKey,
          newKey: fresh.idempotencyKey,
          oldExpected: old.expected,
          newExpected: fresh.expected,
          approvalId: (await response.json()).approvalId,
        })
      }
    )
    await group(
      "P8 actual grant loss and deactivation purge an unresolved keyboard request",
      async () => {
        const staff = await f.login("STAFF"),
          original = await f.query<CurrentActorDTO>(staff, "currentActor")
        const context = await browser.newContext({
          baseURL: f.origin,
          storageState: await staff.storageState(),
          viewport: { width: 360, height: 800 },
          serviceWorkers: "allow",
        })
        const limited = await context.newPage()
        pages.push(limited)
        const readGrants: Grant[] = (
          [
            "PurchaseRecord",
            "Vehicle",
            "VehicleCost",
            "Supplier",
            "ApprovalRequest",
            "Disposal",
          ] as const
        ).map((subject) => ({ subject, action: "read", fields: ["*"] }))
        const writeGrants: Grant[] = [
          ...readGrants,
          { subject: "PurchaseRecord", action: "update", fields: ["cycleId"] },
          { subject: "ApprovalRequest", action: "create", fields: ["*"] },
          { subject: "Disposal", action: "create", fields: ["*"] },
          { subject: "Disposal", action: "pay", fields: ["*"] },
        ]
        const writer = await f.command(
          admin,
          "saveRole",
          envelope({
            name: `UI-writer-${suffix}`,
            grants: writeGrants,
            reason: "Actual keyboard permission proof",
          }),
          201
        )
        const reader = await f.command(
          admin,
          "saveRole",
          envelope({
            name: `UI-reader-${suffix}`,
            grants: readGrants,
            reason: "Actual keyboard permission revocation",
          }),
          201
        )
        const membership = async (roleIds: string[], active = true) => {
          const user = await f.query<{
            id: string
            revision: number
            name: string
          }>(admin, "user", `?id=${original.user.id}`)
          const roles = await Promise.all(
            roleIds.map((id) =>
              f.query<{ id: string; revision: number }>(
                admin,
                "role",
                `?id=${id}`
              )
            )
          )
          await f.command(
            admin,
            "updateUser",
            envelope(
              {
                id: user.id,
                name: user.name,
                active,
                roleIds,
                reason: "Actual UI authority change",
              },
              [ref(user, "User"), ...roles.map((role) => ref(role, "Role"))]
            )
          )
        }
        let retained: string | undefined
        try {
          await membership([writer.result.id])
          const source = await createCycle("access-loss")
          await zeroDraft(limited, source, "access-loss")
          await context.route("**/api/v1/commands/requestApproval", (route) => {
            retained = route.request().postData()!
            return route.abort("failed")
          })
          await key(
            limited,
            limited.getByRole("button", {
              name: "Submit approval request",
              exact: true,
            })
          )
          await expect(
            limited.getByRole("button", {
              name: "Retry identical request",
              exact: true,
            })
          ).toBeVisible()
          await membership([reader.result.id])
          await page.bringToFront()
          await limited.bringToFront()
          await expect(
            limited.getByLabel("Approval request reason", { exact: true })
          ).toHaveCount(0)
          const before = await f.snapshot(tables)
          assert.ok(retained)
          const denied = await staff.post("/api/v1/commands/requestApproval", {
            headers: { Origin: f.origin },
            data: JSON.parse(retained),
          })
          assert.equal(denied.status(), 403)
          assert.equal(await f.snapshot(tables), before)
          await membership([writer.result.id])
          await limited.goto(`/purchases/${source.id}`)
          await expect(
            limited.getByRole("button", {
              name: "Recover unresolved write-off request",
              exact: true,
            })
          ).toHaveCount(0)
          await key(
            limited,
            limited.getByRole("button", {
              name: "Request write-off",
              exact: true,
            })
          )
          await expect(
            limited.getByLabel("Approval request reason", { exact: true })
          ).toHaveValue("")
          await limited
            .getByLabel("Disposal date", { exact: true })
            .fill("2026-10-04")
          await limited
            .getByLabel("Disposal reason", { exact: true })
            .fill("PRIVATE_UI_DEACTIVATE_DISPOSAL")
          await limited
            .getByLabel("Approval request reason", { exact: true })
            .fill("PRIVATE_UI_DEACTIVATE_REQUEST")
          await limited
            .getByLabel("Actual proceeds", { exact: false })
            .fill("0")
          await key(
            limited,
            limited.getByRole("button", {
              name: "Submit approval request",
              exact: true,
            })
          )
          await expect(
            limited.getByRole("button", {
              name: "Retry identical request",
              exact: true,
            })
          ).toBeVisible()
          await membership([writer.result.id], false)
          await page.bringToFront()
          await limited.bringToFront()
          await limited.waitForURL(/\/login(?:\?|$)/)
          await expect(
            limited.getByRole("button", { name: "Sign In", exact: true })
          ).toBeVisible()
          await expect(
            limited.getByLabel("Approval request reason", { exact: true })
          ).toHaveCount(0)
          const inactive = await staff.get("/api/v1/queries/currentActor")
          assert.equal(inactive.status(), 403)
          assert.equal((await inactive.json()).error.code, "ACCOUNT_INACTIVE")
          assert.ok(
            !(
              await limited.evaluate(() =>
                JSON.stringify({ ...localStorage, ...sessionStorage })
              )
            ).includes("PRIVATE_UI_")
          )
          await view(limited, "actual-access-loss-360")
          groups.push({
            group: "actual UI access loss",
            userId: original.user.id,
            roleRevocationStatus: denied.status(),
            deactivationStatus: inactive.status(),
            finalUrl: limited.url(),
            oldEnvelopeSha256: createHash("sha256")
              .update(retained)
              .digest("hex"),
          })
        } finally {
          await membership(original.roles.map((role) => role.id))
          await context.close()
          await staff.dispose()
        }
      }
    )
    await group(
      "P8 real bell read controls and authenticated private-cache exclusion",
      async () => {
        // A retained draft may already have every old event read. Seed at most
        // two real required-review events so read-one and read-all both act.
        const unread = await f.query<{ unreadCount: number }>(
          admin,
          "notifications"
        )
        for (let count = unread.unreadCount; count < 2; count++) {
          const source = await createCycle(`bell-${count}`)
          await f.command(
            second,
            "requestApproval",
            envelope(
              {
                proposal: {
                  kind: "WRITE_OFF",
                  input: {
                    cycleId: source.id,
                    date: "2026-10-04",
                    reason: "Actual bell proposal",
                    method: "OTHER",
                    proceeds: "0",
                  },
                },
                reason: "Actual recipient bell obligation",
              },
              [
                ref(source),
                {
                  type: "Vehicle",
                  id: source.vehicleId,
                  revision: source.identityRevision,
                },
              ]
            ),
            202
          )
        }
        if (page.url() === "about:blank")
          await page.goto(`/purchases/${row.id}`)
        await page.waitForFunction(
          () => navigator.serviceWorker.controller?.state === "activated"
        )
        await key(page, page.getByRole("button", { name: /^Notifications/ }))
        await expect(
          page.getByRole("heading", { name: "Notifications", exact: true })
        ).toBeVisible()
        await key(
          page,
          page
            .getByRole("button", {
              name: "Mark notification read",
              exact: true,
            })
            .first()
        )
        await expect(
          page.getByText("Read state committed.", { exact: true })
        ).toBeVisible()
        await key(
          page,
          page.getByRole("button", { name: "Mark all as read", exact: true })
        )
        await expect(page.getByText("0 unread", { exact: true })).toBeVisible()
        const cachesState = await page.evaluate(async () => {
          const entries: string[] = []
          for (const name of await caches.keys())
            for (const request of await (await caches.open(name)).keys())
              entries.push(request.url)
          return {
            controlled: navigator.serviceWorker.controller?.state,
            entries,
            local: JSON.stringify({ ...localStorage, ...sessionStorage }),
          }
        })
        assert.equal(cachesState.controlled, "activated")
        assert.ok(
          !cachesState.entries.some((url) =>
            /\/api\/|\/approvals|\/purchases|\/vehicles/.test(url)
          )
        )
        assert.ok(!cachesState.local.includes("PRIVATE_UI_"))
        groups.push({
          group: "active SW cache inventory",
          ...cachesState,
          local: undefined,
        })
        await view(page, "recipient-bell-1920")
      }
    )
    await group(
      "P8 unresolved private request is purged on logout across same-actor contexts",
      async () => {
        const created = await f.command(
          admin,
          "recordPurchase",
          envelope(purchaseInput(supplier.result.id, suffix, "logout"), [
            ref(supplier.result, "Supplier"),
          ]),
          201
        )
        // The diagnostic filter must still create a genuinely active second context.
        await other.goto(`/purchases/${created.result.id}`)
        await expect(
          other.getByRole("button", { name: "Request write-off", exact: true })
        ).toBeVisible()
        await page.goto(`/purchases/${created.result.id}`)
        await key(
          page,
          page.getByRole("button", { name: "Request write-off", exact: true })
        )
        await page
          .getByLabel("Disposal date", { exact: true })
          .fill("2026-10-04")
        await page
          .getByLabel("Disposal reason", { exact: true })
          .fill(`PRIVATE_UI_LOGOUT_DISPOSAL_${suffix}`)
        await page
          .getByLabel("Approval request reason", { exact: true })
          .fill(`PRIVATE_UI_LOGOUT_REQUEST_${suffix}`)
        await page.getByLabel("Actual proceeds", { exact: false }).fill("0")
        await requester.route("**/api/v1/commands/requestApproval", (route) =>
          route.abort("failed")
        )
        await key(
          page,
          page.getByRole("button", {
            name: "Submit approval request",
            exact: true,
          })
        )
        await expect(
          page.getByRole("button", {
            name: "Retry identical request",
            exact: true,
          })
        ).toBeVisible()
        assert.ok(
          !(
            await page.evaluate(() =>
              JSON.stringify({ ...localStorage, ...sessionStorage })
            )
          ).includes("PRIVATE_UI_")
        )
        await key(
          page,
          page.getByRole("button", { name: "Logout", exact: true })
        )
        await page.waitForURL(/\/login(?:\?|$)/)
        await expect(
          page.getByRole("button", { name: "Sign In", exact: true })
        ).toBeVisible()
        const remainingCookies = (await requester.cookies()).filter((c) =>
          c.name.includes("session_token")
        ).length
        assert.equal(remainingCookies, 0)
        // Browser contexts are storage-isolated: the second context observes
        // server-side session revocation on real focus, not a cross-context BC.
        await other.bringToFront()
        await other.waitForURL(/\/login(?:\?|$)/)
        await expect(
          other.getByRole("button", { name: "Sign In", exact: true })
        ).toBeVisible()
        await expect(
          page.getByLabel("Approval request reason", { exact: true })
        ).toHaveCount(0)
        const denied = await requester.request.get(
          `/api/v1/queries/purchase?cycleId=${created.result.id}`
        )
        assert.equal(denied.status(), 401)
        assert.match(denied.headers()["cache-control"], /no-store/)
        const deniedOther = await sameActor.request.get(
          `/api/v1/queries/purchase?cycleId=${created.result.id}`
        )
        assert.equal(deniedOther.status(), 401)
        assert.match(deniedOther.headers()["cache-control"], /no-store/)
        groups.push({
          group: "actual logout state",
          initiatingUrl: page.url(),
          otherUrl: other.url(),
          remainingInitiatingSessionCookies: remainingCookies,
          privateReadStatuses: [denied.status(), deniedOther.status()],
          logoutNavigation: navigation.filter((n) =>
            n.path.startsWith("/login")
          ),
        })
        for (const p of [page, other]) {
          const storage = await p.evaluate(async () => {
            const urls: string[] = []
            for (const name of await caches.keys())
              for (const req of await (await caches.open(name)).keys())
                urls.push(req.url)
            return {
              local: JSON.stringify({ ...localStorage, ...sessionStorage }),
              urls,
            }
          })
          assert.ok(!storage.local.includes("PRIVATE_UI_"))
          assert.ok(
            !storage.urls.some((url) =>
              /\/api\/|\/approvals|\/purchases|\/vehicles/.test(url)
            )
          )
        }
        await view(page, "logout-purge")
        const accounts = await privateEnvironment(join(root, "accounts.env"))
        await page.bringToFront()
        await page
          .getByLabel("Email Address")
          .fill(accounts.BOOTSTRAP_SECOND_EMAIL!)
        await page
          .getByLabel("Password", { exact: true })
          .fill(accounts.BOOTSTRAP_SECOND_PASSWORD!)
        await key(
          page,
          page.getByRole("button", { name: "Sign In", exact: true })
        )
        await page.waitForURL("**/dashboard")
        await page.goto(`/purchases/${created.result.id}`)
        await expect(
          page.getByRole("button", {
            name: "Recover unresolved write-off request",
            exact: true,
          })
        ).toHaveCount(0)
        await key(
          page,
          page.getByRole("button", { name: "Request write-off", exact: true })
        )
        await expect(
          page.getByLabel("Approval request reason", { exact: true })
        ).toHaveValue("")
        await expect(
          page.getByLabel("Disposal reason", { exact: true })
        ).toHaveValue("")
      }
    )
    await requester.close()
    await reviewer.close()
    await sameActor.close()
  } finally {
    await admin.dispose()
    await second.dispose()
  }
} catch (error) {
  for (const [index, page] of pages.entries())
    if (!page.isClosed()) {
      await page
        .screenshot({
          path: join(root, `writeoff-ui-${suffix}-failure-${index}.png`),
          fullPage: true,
        })
        .catch(() => undefined)
      await writeFile(
        join(root, `writeoff-ui-${suffix}-failure-${index}.json`),
        JSON.stringify(
          {
            stage,
            url: page.url(),
            responses,
            navigation,
            cookies: (await page.context().cookies()).map((c) => ({
              name: c.name,
              sessionToken: c.name.includes("session_token"),
            })),
            bodyText: await page
              .locator("body")
              .innerText()
              .catch(() => "UNAVAILABLE"),
          },
          null,
          2
        ),
        { mode: 0o600 }
      )
    }
  groups.push({
    group: stage,
    pass: false,
    error: error instanceof Error ? error.message : "UNKNOWN",
  })
  throw error
} finally {
  await browser.close()
  await f.close()
  await writeFile(
    join(root, `approval-disposal-ui-${Date.now()}.json`),
    JSON.stringify(
      { source: process.cwd(), groups, responses, navigation },
      null,
      2
    ) + "\n",
    { mode: 0o600 }
  )
}
