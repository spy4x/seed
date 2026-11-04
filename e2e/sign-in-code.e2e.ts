import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { mailedCode, signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const lastMailUrl = `${apiBase}/api/test/last-mail`
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** The sign-in code in the newest sign-in mail to `email`. */
async function codeFor(request: APIRequestContext, email: string): Promise<string> {
  return await mailedCode(request, lastMailUrl, email, "Your sign-in code for ")
}

/** Types `code` into the code step key by key, as a person does, and presses Enter. */
async function enterCode(page: Page, code: string): Promise<void> {
  const field = page.locator("[data-e2e=mailed-code-step-code]")
  await expect(field).toBeFocused()
  await field.pressSequentially(code)
  await field.press("Enter")
}

test("a new address signs up by the mailed code, which works once", async ({ page, request }) => {
  const email = `e2e-code-new-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const button = page.locator("[data-e2e=link-sign-up]")
    await gotoApp(page, "/sign-up", button)
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await button.click()
    await expect(page).toHaveURL("/sign-in/code")
    await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(email)
    await expect(page.locator("[data-e2e=resend-button-waiting]")).toBeVisible()

    const code = await codeFor(request, email)
    expect(code).toMatch(/^[A-Za-z0-9_-]{8}$/)
    await enterCode(page, code)
    await page.waitForURL("/notes")

    // The code was spent: the same code from the same browser is refused.
    const again = await page.request.post(`${apiBase}/api/auth/code/verify`, {
      headers,
      data: { code },
    })
    expect(again.ok()).toBe(false)
  } finally {
    await cleanup(request, email, true)
  }
})

test("signed in, the code page says so, and from the profile it confirms the account's own address", async ({ page, request }) => {
  const email = `e2e-code-proof-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const button = page.locator("[data-e2e=link-sign-up]")
    await gotoApp(page, "/sign-up", button)
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await button.click()
    const first = await codeFor(request, email)
    await enterCode(page, first)
    await page.waitForURL("/notes")

    await gotoApp(page, "/sign-in/code", page.locator("[data-e2e=sign-in-code-signed-in]"))
    await expect(page.locator("[data-e2e=sign-in-code-email]")).toHaveCount(0)

    const next = "/profile/danger-zone"
    const confirm = page.locator("[data-e2e=sign-in-code-confirm]")
    await gotoApp(page, `/sign-in/code?next=${encodeURIComponent(next)}`, confirm)
    await expect(confirm).toContainText(email)
    await expect(page.locator("[data-e2e=sign-in-code-email]")).toHaveCount(0)
    await expect(page.locator("[data-e2e=sign-in-code-submit]")).toBeFocused()
    await page.locator("[data-e2e=sign-in-code-submit]").click()
    await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(email)
    let second = first
    await expect.poll(async () => (second = await codeFor(request, email)), {
      message: "the worker mails a second code",
    }).not.toBe(first)
    await enterCode(page, second)
    await page.waitForURL(next)
  } finally {
    await cleanup(request, email, true)
  }
})

test("a reload keeps the code step, and Use a different one goes back with the address", async ({ page, request }) => {
  const email = `e2e-code-back-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    await gotoApp(page, "/sign-in/code", page.locator("[data-e2e=sign-in-code-email]"))
    await page.locator("[data-e2e=sign-in-code-email]").fill(email)
    await page.locator("[data-e2e=sign-in-code-submit]").click()
    await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(email)

    // The server's cookie says a code waits for this browser.
    await gotoApp(page, "/sign-in/code", page.locator("[data-e2e=mailed-code-step]"))
    await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(email)

    await page.locator("[data-e2e=mailed-code-step-change-email]").click()
    await expect(page.locator("[data-e2e=sign-in-code-email]")).toHaveValue(email)
    await expect(page.locator("[data-e2e=sign-in-code-email]")).toBeFocused()
  } finally {
    await cleanup(request, email, true)
  }
})

test("Back to sign in opens the sign-in form with the address typed on the code page", async ({ page }) => {
  const email = `e2e-code-back-${uuidV7().slice(-8)}@example.com`
  const button = page.locator("[data-e2e=link-sign-in]")
  await gotoApp(page, "/sign-in", button)
  await button.click()
  await expect(page).toHaveURL("/sign-in/code")
  await page.locator("[data-e2e=sign-in-code-email]").fill(email)

  await page.locator("[data-e2e=sign-in-code-back]").click()

  await expect(page).toHaveURL("/sign-in")
  await expect(page.locator("[data-e2e=auth-form-login]")).toHaveValue(email)
  await expect(page.locator("[data-e2e=auth-form-password]")).toBeFocused()
})

test("an old sign-in link address opens the code page", async ({ page }) => {
  await gotoApp(page, "/sign-in/link/open", page.locator("[data-e2e=sign-in-code-email]"))
  await expect(page).toHaveURL("/sign-in/code")
})

test("an account signs in by a code asked for on the code page, and sign-in names it next time", async ({ page, request }) => {
  const email = `e2e-code-known-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password: "Passw0rd!" },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    // No address typed: the button opens the code page, focused on its field.
    const button = page.locator("[data-e2e=link-sign-in]")
    await gotoApp(page, "/sign-in", button)
    await button.click()
    await expect(page).toHaveURL("/sign-in/code")
    const field = page.locator("[data-e2e=sign-in-code-email]")
    await expect(field).toBeFocused()
    await field.fill(email)
    await page.locator("[data-e2e=sign-in-code-submit]").click()
    await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(email)

    // Once the mail is out, a wrong code is refused under the field, ready for the next try.
    const code = await codeFor(request, email)
    await enterCode(page, code === "AAAAAAAA" ? "BBBBBBBB" : "AAAAAAAA")
    await expect(page.locator("[data-e2e=mailed-code-step-code]")).toHaveAttribute(
      "aria-invalid",
      "true",
    )
    await page.locator("[data-e2e=mailed-code-step-code]").fill("")

    await enterCode(page, code)
    await page.waitForURL("/notes")

    await page.context().clearCookies()
    await gotoApp(page, "/sign-in", page.locator("[data-e2e=last-sign-in]"))
    await expect(page.locator("[data-e2e=last-sign-in]")).toContainText(
      "Last time you signed in with an email code",
    )
  } finally {
    await cleanup(request, email, true)
  }
})
