import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * An address no page answers (#368) shows "Page not found" with one link back, in the SPA signed
 * in and signed out and in the admin app, instead of an empty page or a silent jump to the
 * dashboard. A signed-out visit to the admin app still goes to its sign-in.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

function address(name: string): string {
  return `e2e-not-found-${name}-${uuidV7().slice(-8)}@example.com`
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

test.describe("an unknown address", () => {
  test("a signed-out visitor of the app gets the page with a link to sign in", async ({ page }) => {
    const card = page.locator("[data-e2e=not-found]")
    await gotoApp(page, `${appBase}/no-such-page`, card)
    await expect(card.getByRole("heading", { level: 1 })).toHaveText("Page not found")
    await expect(page.locator("[data-e2e=not-found-link]")).toHaveAttribute("href", "/sign-in")
  })

  test("a signed-in person gets the page inside the app, and its link opens the notes", async ({ page, request }) => {
    const email = address("member")
    try {
      await signUp(request, email)
      await signIn(page, email, password)
      await page.goto(`${appBase}/no-such-page`)
      const screen = page.locator("[data-e2e=not-found]")
      await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Page not found")
      await page.locator("[data-e2e=not-found-link]").click()
      await expect(page).toHaveURL(`${appBase}/notes`)
    } finally {
      await cleanup(request, email)
    }
  })

  test("the admin app shows an operator the page instead of the dashboard, and a signed-out visit still goes to sign-in", async ({ browser, request }) => {
    const email = address("ops")
    let admin: BrowserContext | null = null
    try {
      await signUp(request, email)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: email, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/no-such-page`)
      await expect(ops).toHaveURL(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(email)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops).toHaveURL(`${adminBase}/`)

      await ops.goto(`${adminBase}/no-such-page`)
      const screen = ops.locator("[data-e2e=not-found]")
      await expect(screen.getByRole("heading", { level: 1 })).toHaveText("Page not found")
      await expect(ops).toHaveURL(`${adminBase}/no-such-page`)
      await expect(ops).toHaveTitle("Page not found · Admin · Seed")
      await ops.locator("[data-e2e=not-found-link]").click()
      await expect(ops).toHaveURL(`${adminBase}/`)
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()
    } finally {
      await admin?.close()
      await cleanup(request, email)
    }
  })
})
