import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { expect, test } from "./fixtures/stack.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The admin app's audit log (#429): an operator finds a person's sign-up by their address, opens
 * the person from the log, switches to the timeline and downloads the CSV, which the log then
 * records as the operator's own action.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

function address(name: string): string {
  return `e2e-audit-${name}-${uuidV7().slice(-8)}@example.com`
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Creates `email`'s account over the API and signs that request out again. */
async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const signedOut = await request.post(`${appBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
}

test.describe("the admin audit log", () => {
  test("an operator filters the log by a person, opens them and exports the CSV", async ({ browser, request }) => {
    const operatorEmail = address("ops")
    const targetEmail = address("ada")
    let admin: BrowserContext | null = null
    try {
      await signUp(request, operatorEmail)
      await signUp(request, targetEmail)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: operatorEmail, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      admin = await browser.newContext({ baseURL: adminBase, acceptDownloads: true })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/`)
      await expect(ops).toHaveURL(`${adminBase}/sign-in`)
      await expect(ops.locator("[data-e2e=auth-form-login]")).toBeVisible()
      await ops.locator("[data-e2e=auth-form-login]").fill(operatorEmail)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()

      await ops.getByRole("navigation", { name: "Admin sections" })
        .getByRole("link", { name: "Audit log" }).click()
      await expect(ops).toHaveURL(`${adminBase}/audit`)
      await expect(ops.locator("[data-e2e=admin-audit-title]")).toBeVisible()

      // The filters go into the address together.
      await ops.locator("[data-e2e=admin-audit-person]").fill(targetEmail)
      await ops.locator("[data-e2e=admin-audit-event]").selectOption({
        label: "Account: Signed up",
      })
      await ops.locator("[data-e2e=admin-audit-apply]").click()
      await expect(ops).toHaveURL(/[?&]event=account%3A1(&|$)/)
      await expect(ops).toHaveURL(new RegExp(`person=${encodeURIComponent(targetEmail)}`))
      const rows = ops.locator("[data-e2e=admin-audit-table] tbody tr")
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText("Signed up")

      // The timeline shows the same entry; the view is part of the address too.
      await ops.locator("[data-e2e=admin-audit-view]").getByRole("button", { name: "Timeline" })
        .click()
      await expect(ops).toHaveURL(/view=timeline/)
      await expect(ops.locator("[data-e2e=admin-audit-timeline] li")).toHaveCount(1)

      // The CSV holds what the filter shows.
      const [download] = await Promise.all([
        ops.waitForEvent("download"),
        ops.locator("[data-e2e=admin-audit-export]").click(),
      ])
      expect(download.suggestedFilename()).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/)
      const csv = await readFile(await download.path(), "utf8")
      const lines = csv.trim().split(/\r?\n/)
      expect(lines[0]).toContain("Time (UTC)")
      expect(lines).toHaveLength(2)
      expect(lines[1]).toContain(targetEmail)
      expect(lines[1]).toContain("signed_up")

      // The export is itself in the log, under the operator's name.
      await ops.locator("[data-e2e=admin-audit-clear]").click()
      await expect(ops).toHaveURL(`${adminBase}/audit?view=timeline`)
      await ops.locator("[data-e2e=admin-audit-event]").selectOption({
        label: "Operator: Audit log exported by an operator",
      })
      await ops.locator("[data-e2e=admin-audit-person]").fill(operatorEmail)
      await ops.locator("[data-e2e=admin-audit-apply]").click()
      await expect(ops.locator("[data-e2e=admin-audit-timeline] li")).toHaveCount(1)

      // The person's name opens their page.
      await ops.locator("[data-e2e=admin-audit-view]").getByRole("button", { name: "Table" })
        .click()
      await ops.locator("[data-e2e=admin-audit-person]").fill(targetEmail)
      await ops.locator("[data-e2e=admin-audit-event]").selectOption({ label: "Every event" })
      await ops.locator("[data-e2e=admin-audit-apply]").click()
      await rows.first().getByRole("link", { name: targetEmail }).first().click()
      await expect(ops.locator("[data-e2e=admin-user-title]")).toContainText(targetEmail)

      // On a phone the page itself never scrolls sideways; the table does.
      await ops.goBack()
      await expect(rows.first()).toBeVisible()
      await ops.setViewportSize({ width: 390, height: 800 })
      expect(await ops.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      )
    } finally {
      await admin?.close()
      await cleanup(request, targetEmail)
      await cleanup(request, operatorEmail)
    }
  })
})
