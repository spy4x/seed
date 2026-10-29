import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * Right-to-left layouts (#215): in Arabic, the SPA and the admin app mirror. The page reads right
 * to left, the shell's rail sits at the window's right edge at 1440 px, and at 390 px nothing
 * scrolls sideways. Measured in a real browser, because happy-dom lays nothing out.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

/** A new operator, signed out, for one test. */
async function operator(request: APIRequestContext): Promise<string> {
  const email = `e2e-rtl-${uuidV7().slice(-8)}@example.com`
  const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const signedOut = await request.post(`${appBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
  const promoted = await request.post(`${appBase}/api/test/set-role`, {
    data: { login: email, role: OPERATOR },
  })
  expect(promoted.ok(), await promoted.text()).toBe(true)
  return email
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** A device that chose Arabic before signing in. */
async function arabicDevice(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ locale: "ar-EG" })
  await context.addInitScript(() => localStorage.setItem("language", "ar"))
  return context
}

/**
 * The page as it is: its rail flush with the window's right edge at 1440 px, no sideways scroll at
 * 390 px, where a tab bar takes the rail's place, and `<html lang="ar" dir="rtl">`.
 */
async function expectMirrored(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  const rail = page.locator("[data-e2e=rail-shell-column]")
  const content = page.locator("[data-e2e=app-shell-content]")
  await expect(rail).toBeVisible()
  const [railBox, contentBox] = await Promise.all([rail.boundingBox(), content.boundingBox()])
  if (!railBox || !contentBox) throw new Error("The shell drew no rail or no page.")
  const width = await page.evaluate(() => document.documentElement.clientWidth)
  expect(Math.abs(railBox.x + railBox.width - width)).toBeLessThanOrEqual(1)
  expect(contentBox.x + contentBox.width).toBeLessThanOrEqual(railBox.x + 1)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator("[data-e2e=rail-shell-tabbar]")).toBeVisible()
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ),
  ).toBeLessThanOrEqual(0)
  await expect(page.locator("html")).toHaveAttribute("lang", "ar")
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
}

test.describe("right-to-left layouts", () => {
  test("the SPA's notes in Arabic: rail on the right at 1440 px, no sideways scroll at 390 px", async ({ browser, request }) => {
    const email = await operator(request)
    const device = await arabicDevice(browser)
    try {
      const page = await device.newPage()
      await page.setViewportSize({ width: 1440, height: 900 })
      await signIn(page, email, password)
      await page.goto(`${appBase}/notes`)
      await expectMirrored(page)
    } finally {
      await device.close()
      await cleanup(request, email)
    }
  })

  test("the admin app's people in Arabic: rail on the right at 1440 px, no sideways scroll at 390 px", async ({ browser, request }) => {
    const email = await operator(request)
    const device = await arabicDevice(browser)
    try {
      const ops = await device.newPage()
      await ops.setViewportSize({ width: 1440, height: 900 })
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(email)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()
      await ops.goto(`${adminBase}/users`)
      await expect(ops.locator("[data-e2e=admin-users-list]")).toBeVisible()
      await expectMirrored(ops)
    } finally {
      await device.close()
      await cleanup(request, email)
    }
  })
})
