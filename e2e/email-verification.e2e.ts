import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const CODE_SUBJECT = "Your code to confirm your e-mail address"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** The code in the newest code mail to `email`, once the worker sent it. */
async function codeFor(request: APIRequestContext, email: string): Promise<string> {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post(`${apiBase}/api/test/last-mail`, { data: { email } })
    if (!response.ok()) return response.status()
    const mail = (await response.json()) as { subject: string; text: string }
    text = mail.text
    return mail.subject
  }, { timeout: 20_000, message: "the worker mails the code" }).toBe(CODE_SUBJECT)
  // The mail is the request, the code, how long it is valid and what to do if unasked.
  return text.split("\n\n")[1].trim()
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.locator("[data-e2e=email-code]").fill(code)
  await page.locator("[data-e2e=email-verify]").click()
}

test("a new account proves its address with the mailed code, then moves to a new one", async ({ page, request }) => {
  // Fresh addresses each run: the per-address limit allows three code mails an hour.
  const id = uuidV7().slice(-8)
  const email = `e2e-verify-${id}@example.com`
  const next = `e2e-verify-next-${id}@example.com`
  await cleanup(request, email)
  await cleanup(request, next)
  try {
    const signUp = await page.request.post(`${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    // Every signed-in page asks for the code until the address is proven.
    const banner = page.locator("[data-e2e=email-banner]")
    await gotoApp(page, "/", banner)
    await expect(banner).toContainText(email)
    await banner.getByRole("link", { name: "Enter the code" }).click()
    await expect(page).toHaveURL("/email")

    const code = await codeFor(request, email)
    await enterCode(page, "wrong-00")
    await expect(page.getByText("This code is wrong or has expired. Ask for a new one."))
      .toBeVisible()
    await enterCode(page, code)
    await expect(page.locator("[data-e2e=email-verified]")).toBeVisible()
    await expect(page.locator("[data-e2e=email-state]")).toHaveText("Verified")
    await gotoApp(page, "/", page.locator("[data-e2e=profile-email-link]"))
    await expect(banner).toHaveCount(0)

    // A change waits for the new address's code; until then the account keeps the old one.
    await gotoApp(page, "/email", page.locator("[data-e2e=email-change-open]"))
    await page.locator("[data-e2e=email-change-open]").click()
    await page.locator("[data-e2e=email-new]").fill(next)
    await page.locator("[data-e2e=email-password]").fill(password)
    await page.locator("[data-e2e=email-change]").click()
    await expect(page.locator("[data-e2e=email-change-notice]")).toBeVisible()
    await expect(page.locator("[data-e2e=email-change-dialog]")).toHaveCount(0)
    await expect(page.locator("[data-e2e=email-current]")).toContainText(email)
    await expect(page.locator("[data-e2e=email-verify-card]")).toContainText(next)

    await enterCode(page, await codeFor(request, next))
    await expect(page.locator("[data-e2e=email-verified]")).toBeVisible()
    await expect(page.locator("[data-e2e=email-current]")).toContainText(next)
    await expect(page.locator("[data-e2e=email-verify-card]")).toHaveCount(0)

    // The new address signs in; the old one no longer does.
    await page.locator("[data-e2e=shell-user-menu-button]").click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    // Signing out leaves the e-mail page for plain sign-in: whoever signs in next must not be
    // sent back to this person's page.
    await expect(page).toHaveURL("/sign-in")
    await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await page.locator("[data-e2e=auth-form-password]").fill(password)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page.getByText("Invalid e-mail, username or password")).toBeVisible()
    await signIn(page, next, password)
  } finally {
    await cleanup(request, email, true)
    await cleanup(request, next, true)
  }
})
