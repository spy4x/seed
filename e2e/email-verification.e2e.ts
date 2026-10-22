import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { lastMail, nextCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
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

test("a new account proves its address with the mailed code before it exists, then moves to a new one", async ({ page, request }) => {
  // Fresh addresses each run: the per-address limit allows three code mails an hour.
  const id = uuidV7().slice(-8)
  const email = `e2e-verify-${id}@example.com`
  const next = `e2e-verify-next-${id}@example.com`
  await cleanup(request, email)
  await cleanup(request, next)
  try {
    // Sign-up asks for the code before it creates anything (#142); a wrong one is refused there.
    await gotoApp(page, "/sign-up", page.locator("[data-e2e=auth-form-login]"))
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await page.locator("[data-e2e=auth-form-password]").fill(password)
    const lastMailUrl = `${apiBase}/api/test/last-mail`
    const before = await lastMail(request, lastMailUrl, email)
    await page.locator("[data-e2e=auth-form-submit]").click()
    await expect(page).toHaveURL("/sign-up/code")
    await expect(page.locator("[data-e2e=sign-up-code]")).toContainText(email)
    const code = await nextCode(request, lastMailUrl, email, before)
    await page.locator("[data-e2e=sign-up-code-input]").fill("wrong-00")
    await page.locator("[data-e2e=sign-up-code-submit]").click()
    await expect(page.getByText("This code is wrong or has expired. Ask for a new one."))
      .toBeVisible()
    await expect(page.locator("[data-e2e=sign-up-code-input]")).toBeFocused()
    await page.locator("[data-e2e=sign-up-code-input]").fill(code)
    await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"), async () => {
      await page.locator("[data-e2e=sign-up-code-submit]").click()
      await page.waitForURL("/notes")
    })

    // The code proved the address: no page asks for it again.
    await expect(page.locator("[data-e2e=email-banner]")).toHaveCount(0)
    await gotoApp(page, "/profile/account", page.locator("[data-e2e=email-state]"))
    await expect(page.locator("[data-e2e=email-state]")).toHaveText("Verified")

    // A change moves the dialog on to the code mailed to the new address; until the code is
    // entered the account keeps the old one.
    await page.locator("[data-e2e=email-change-open]").click()
    await page.locator("[data-e2e=email-new]").fill(next)
    await page.locator("[data-e2e=email-password]").fill(password)
    await page.locator("[data-e2e=email-change]").click()
    await expect(page.locator("[data-e2e=email-verify-card]")).toContainText(next)
    await expect(page.locator("[data-e2e=email-code]")).toBeFocused()
    await expect(page.locator("[data-e2e=email-current]")).toContainText(email)

    await enterCode(page, await codeFor(request, next))
    await expect(page.locator("[data-e2e=email-verified]")).toContainText("E-mail verified")
    await expect(page.locator("[data-e2e=email-change-dialog]")).toBeHidden()
    await expect(page.locator("[data-e2e=email-current]")).toContainText(next)

    // The new address signs in; the old one no longer does.
    await page.locator("[data-e2e=account-menu-button]").click()
    await page.getByRole("menuitem", { name: "Sign out" }).click()
    // Signing out leaves the profile for plain sign-in: whoever signs in next must not be
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
