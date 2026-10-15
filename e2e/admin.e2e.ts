import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/**
 * The admin app (#146) on its own host: an operator signs in there, finds a person and blocks
 * them. The person's open page signs out, their session is gone and their password no longer
 * signs in.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

function address(name: string): string {
  return `e2e-admin-${name}-${uuidV7().slice(-8)}@example.com`
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Creates `email`'s account over the API and signs that request out again. */
async function signUp(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const signedOut = await request.post(`${appBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
}

test.describe("the admin app", () => {
  test("an operator finds and blocks a person, whose session ends and whose sign-in is refused", async ({ browser, page, request }) => {
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

      // The person is signed in to the product, with the page open.
      await signIn(page, targetEmail, password)

      // The operator signs in on the admin host, which has a cookie of its own.
      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/`)
      await expect(ops).toHaveURL(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(operatorEmail)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-users-title]")).toBeVisible()

      // Finds the person by address and opens their page.
      await ops.locator("[data-e2e=admin-users-search]").fill(targetEmail)
      await ops.locator("[data-e2e=admin-users-submit]").click()
      await expect(ops).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(targetEmail)}`))
      const row = ops.locator("[data-e2e=admin-users-list] a")
      await expect(row).toHaveCount(1)
      await row.click()
      await expect(ops.locator("[data-e2e=admin-user-sessions] li")).toHaveCount(1)

      // Blocks them: the dialog only confirms, it asks for no password.
      await ops.locator("[data-e2e=admin-user-menu]").click()
      await ops.locator("[data-e2e=admin-block-open]").click()
      await ops.locator("[data-e2e=admin-action-submit]").click()
      await expect(ops.locator("[data-e2e=admin-user-blocked-notice]")).toBeVisible()
      await expect(ops.locator("[data-e2e=admin-user-sessions] li")).toHaveCount(0)
      await expect(ops.locator("[data-e2e=admin-user-audits]")).toContainText(
        "Blocked by an operator",
      )

      // The person's open page signs out, and their session is gone. The API closes their sockets
      // at once; its 15-second recheck of every socket would too, so this does not tell the two apart.
      await expect(page.locator("[data-e2e=signin-required]")).toBeVisible({ timeout: 8_000 })
      expect((await page.request.get(`${appBase}/api/auth/me`)).status()).toBe(401)
      await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))

      // Their password no longer signs in, through the form or the API.
      await page.locator("[data-e2e=auth-form-login]").fill(targetEmail)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      const refused = page.waitForResponse((response) =>
        response.url().endsWith("/api/auth/password/check")
      )
      await page.locator("[data-e2e=auth-form-submit]").click()
      expect((await refused).status()).toBe(401)
      await expect(page.locator("[data-e2e=auth-form-login]")).toBeVisible()
      const again = await request.post(`${appBase}/api/auth/password/check`, {
        headers,
        data: { login: targetEmail, password },
      })
      expect(again.status()).toBe(401)
    } finally {
      await admin?.close()
      await cleanup(request, targetEmail)
      await cleanup(request, operatorEmail)
    }
  })
})
