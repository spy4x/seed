import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { mailedCode, signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const lastMailUrl = `${apiBase}/api/test/last-mail`
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const newPassword = "N3w-Passw0rd"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** The code in the newest reset mail to `email`, once the worker sent it. */
async function resetCodeFor(request: APIRequestContext, email: string): Promise<string> {
  return await mailedCode(request, lastMailUrl, email, "Your code to reset your password")
}

/** Types `code` into the code step key by key, as a person does, and presses Enter. */
async function enterCode(page: Page, code: string): Promise<void> {
  const field = page.locator("[data-e2e=mailed-code-step-code]")
  await expect(field).toBeFocused()
  await field.pressSequentially(code)
  await field.press("Enter")
}

/** Sends the sign-in form and leaves the outcome to the caller. */
async function trySignIn(page: Page, email: string, secret: string): Promise<void> {
  await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(secret)
  await page.locator("[data-e2e=auth-form-submit]").click()
}

test("a forgotten password is reset with the mailed code, which works once", async ({ page, request }) => {
  // A fresh address each run: the per-address limit allows three requests an hour.
  const email = `e2e-reset-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    const forgotLink = page.getByRole("link", { name: "Forgot your password?" })
    await gotoApp(page, "/sign-in", forgotLink)
    await forgotLink.click()
    await expect(page).toHaveURL("/forgot-password")
    await page.locator("[data-e2e=forgot-password-email]").fill(` ${email.toUpperCase()} `)
    await page.locator("[data-e2e=forgot-password-submit]").click()
    // The step names the address as the server keeps it, trimmed and in lower case.
    await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(email)
    await expect(page.locator("[data-e2e=mailed-code-step]")).not.toContainText(email.toUpperCase())

    const code = await resetCodeFor(request, email)
    await enterCode(page, code)
    // The token the code gave stays in the page: the address never carries it.
    await expect(page).toHaveURL("/forgot-password")
    await page.locator("[data-e2e=reset-password-new]").fill(newPassword)
    await page.locator("[data-e2e=reset-password-submit]").click()
    await expect(page.locator("[data-e2e=reset-password-done]")).toBeVisible()

    // The code was spent: the same code from the same browser is refused.
    const again = await page.request.post(`${apiBase}/api/auth/password/reset/verify`, {
      headers,
      data: { code },
    })
    expect(again.ok()).toBe(false)

    await trySignIn(page, email, password)
    await expect(page.getByText("Invalid e-mail, username or password")).toBeVisible()
    await signIn(page, email, newPassword)
  } finally {
    await cleanup(request, email, true)
  }
})

test("asking for a code answers the same for an address no account uses", async ({ page }) => {
  const email = `e2e-nobody-${uuidV7().slice(-8)}@example.com`
  await gotoApp(page, "/forgot-password", page.locator("[data-e2e=forgot-password-email]"))
  await page.locator("[data-e2e=forgot-password-email]").fill(email)
  await page.locator("[data-e2e=forgot-password-submit]").click()
  await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(
    `If an account uses ${email}, we sent it a code.`,
  )
})

test("the answer to a code request is in the page's language, not the server's English", async ({ page }) => {
  const email = `e2e-nobody-${uuidV7().slice(-8)}@example.com`
  await page.addInitScript(() => localStorage.setItem("language", "de"))
  await gotoApp(page, "/forgot-password", page.locator("[data-e2e=forgot-password-email]"))
  await page.locator("[data-e2e=forgot-password-email]").fill(email)
  await page.locator("[data-e2e=forgot-password-submit]").click()
  // The same neutral line as for any address, so it says nothing about whether an account exists.
  await expect(page.locator("[data-e2e=mailed-code-step]")).toContainText(
    `Falls es ein Konto mit ${email} gibt, haben wir einen Code dorthin geschickt.`,
  )
  await expect(page.locator("[data-e2e=mailed-code-step-code]")).toBeFocused()
})
