import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, SIGNED_IN_LANDING } from "./fixtures/app.ts"
import { lastMail, type Mail, nextCode } from "./fixtures/sign-up.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const lastMailUrl = `${apiBase}/api/test/last-mail`
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** Sends the sign-up form for `email` and answers the code mailed for it, newer than `before`. */
async function askForCode(
  page: Page,
  request: APIRequestContext,
  email: string,
  before: Mail | null,
): Promise<string> {
  await gotoApp(page, "/sign-up", page.locator("[data-e2e=auth-form-login]"))
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await expect(page.getByRole("heading", { level: 1, name: "Check your inbox" })).toBeVisible()
  return await nextCode(request, lastMailUrl, email, before)
}

test("the first sign-up code makes a new one wait, also after a reload", async ({ page, request }) => {
  const email = `e2e-sign-up-wait-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    await askForCode(page, request, email, await lastMail(request, lastMailUrl, email))
    await expect(page.locator("[data-e2e=resend-button-waiting]")).toBeVisible()
    await expect(page.locator("[data-e2e=resend-button-send]")).toHaveCount(0)

    await page.reload()
    await expect(page.locator("[data-e2e=mailed-code-step-code]")).toBeVisible()
    await expect(page.locator("[data-e2e=resend-button-waiting]")).toBeVisible()
    await expect(page.locator("[data-e2e=resend-button-send]")).toHaveCount(0)
  } finally {
    await cleanup(request, email, true)
  }
})

test("two sign-ups of one address: the first code signs in, the second finds the account and hands the address to sign-in", async ({ browser, request }) => {
  // A fresh address each run: each sign-up spends one of the client's three code mails an hour.
  const email = `e2e-sign-up-race-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  const first = await browser.newContext({ baseURL: apiBase })
  const second = await browser.newContext({ baseURL: apiBase })
  try {
    const firstPage = await first.newPage()
    const secondPage = await second.newPage()
    const firstCode = await askForCode(
      firstPage,
      request,
      email,
      await lastMail(request, lastMailUrl, email),
    )
    const secondCode = await askForCode(
      secondPage,
      request,
      email,
      await lastMail(request, lastMailUrl, email),
    )

    await firstPage.locator("[data-e2e=mailed-code-step-code]").pressSequentially(firstCode)
    await gotoApp(
      firstPage,
      "/notes",
      firstPage.locator("[data-e2e=shell-ws-status]"),
      async () => {
        await firstPage.locator("[data-e2e=mailed-code-step-code]").press("Enter")
        await firstPage.waitForURL(SIGNED_IN_LANDING)
      },
    )

    await secondPage.locator("[data-e2e=mailed-code-step-code]").pressSequentially(secondCode)
    await secondPage.locator("[data-e2e=mailed-code-step-code]").press("Enter")
    await expect(secondPage.getByRole("heading", { level: 1, name: "You already have an account" }))
      .toBeVisible()
    const signIn = secondPage.locator("[data-e2e=sign-up-exists-sign-in]")
    await expect(signIn).toBeFocused()
    await signIn.click()
    await expect(secondPage).toHaveURL("/sign-in")
    await expect(secondPage.locator("[data-e2e=auth-form-login]")).toHaveValue(email)
    await expect(secondPage.locator("[data-e2e=auth-form-password]")).toBeFocused()
  } finally {
    await first.close()
    await second.close()
    await cleanup(request, email, true)
  }
})
