import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The admin app's Jobs module (#394): an operator reaches it from the System page, runs the
 * nightly cleanup now from the Repeating tab, finds its run by name and opens it. The page never
 * scrolls sideways on a phone.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

test.describe("the admin Jobs module", () => {
  test("an operator runs the nightly cleanup now and opens its run", async ({ browser, request }) => {
    const operatorEmail = `e2e-jobs-ops-${uuidV7().slice(-8)}@example.com`
    let admin: BrowserContext | null = null
    try {
      const signedUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email: operatorEmail, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: operatorEmail, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(operatorEmail)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()

      await ops.goto(`${adminBase}/system`)
      await ops.locator("[data-e2e=admin-system-open-jobs]").click()
      await expect(ops.locator("[data-e2e=admin-jobs-title]")).toBeVisible()

      await ops.getByRole("tab", { name: "Repeating" }).click()
      await expect(ops).toHaveURL(`${adminBase}/jobs?tab=repeating`)
      await ops.locator("[data-e2e='admin-repeating-run-outbox.cleanup']").click()
      await expect(ops.locator("[data-e2e=admin-job-toast]").first())
        .toContainText("Nightly cleanup started.")

      await ops.getByRole("tab", { name: "Runs" }).click()
      await ops.locator("[data-e2e=admin-jobs-search]").fill("nightly")
      await ops.locator("[data-e2e=admin-jobs-submit]").click()
      await expect(ops).toHaveURL(`${adminBase}/jobs?q=nightly`)
      const row = ops.locator("[data-e2e=admin-jobs-list]").getByRole("link", {
        name: "Nightly cleanup",
      }).first()
      await row.click()
      await expect(ops.locator("[data-e2e=admin-job-title]")).toHaveText("Nightly cleanup")
      await expect(ops.locator("[data-e2e=admin-job-facts]")).toContainText("Every day")

      await ops.setViewportSize({ width: 390, height: 800 })
      expect(await ops.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      )
    } finally {
      await admin?.close()
      await cleanup(request, operatorEmail)
    }
  })
})
