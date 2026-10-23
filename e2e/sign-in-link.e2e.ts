import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** The path, query and fragment of the sign-in link in the newest mail to `email`. */
async function linkFor(request: APIRequestContext, email: string): Promise<string> {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post(`${apiBase}/api/test/last-mail`, { data: { email } })
    if (!response.ok()) return response.status()
    const mail = (await response.json()) as { subject: string; text: string }
    text = mail.text
    // A sign-up first mails a code to prove the address; wait for the link mail after it.
    return mail.subject.startsWith("Your sign-in link for ")
  }, { timeout: 20_000, message: "the worker mails the sign-in link" }).toBe(true)
  const link = new URL(text.match(/https?:\/\/\S+/)![0])
  return link.pathname + link.search + link.hash
}

/** Opens a sign-in link and presses Continue, which spends it. */
async function openLink(page: Page, link: string): Promise<void> {
  const go = page.locator("[data-e2e=sign-in-link-continue]")
  await gotoApp(page, link, go)
  // The token leaves the address bar before anything is pressed: opening the page spends nothing.
  await expect.poll(() => new URL(page.url()).hash).toBe("")
  await expect(go).toBeFocused()
  await go.click()
}

test("a new address signs up by the mailed link, which works once", async ({ page, request }) => {
  const email = `e2e-link-new-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const button = page.locator("[data-e2e=link-sign-up]")
    await gotoApp(page, "/sign-up", button)
    await page.locator("[data-e2e=auth-form-login]").fill(email)
    await button.click()
    await expect(page).toHaveURL("/sign-in/link")
    await expect(page.locator("[data-e2e=sign-in-link-sent]")).toContainText(email)
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeFocused()
    await expect(page.locator("[data-e2e=resend-button-waiting]")).toContainText(
      "send a new link in",
    )

    const link = await linkFor(request, email)
    expect(link).toMatch(/^\/sign-in\/link\/open#token=/)
    await openLink(page, link)
    await page.waitForURL("/notes")

    // The link was spent: a second press is refused, with a new link as the way on.
    await page.context().clearCookies()
    await openLink(page, link)
    await expect(page.getByRole("heading", { name: "This link no longer works" })).toBeVisible()
    await expect(page.locator("[data-e2e=sign-in-link-new]")).toBeFocused()
  } finally {
    await cleanup(request, email, true)
  }
})

test("Back to sign in opens the sign-in form with the address typed on the link page", async ({ page }) => {
  const email = `e2e-link-back-${uuidV7().slice(-8)}@example.com`
  const button = page.locator("[data-e2e=link-sign-in]")
  await gotoApp(page, "/sign-in", button)
  await button.click()
  await expect(page).toHaveURL("/sign-in/link")
  await page.locator("[data-e2e=sign-in-link-email]").fill(email)

  await page.locator("[data-e2e=sign-in-link-back]").click()

  await expect(page).toHaveURL("/sign-in")
  await expect(page.locator("[data-e2e=auth-form-login]")).toHaveValue(email)
  await expect(page.locator("[data-e2e=auth-form-password]")).toBeFocused()
})

test("an account signs in by a link asked for on the link page, and sign-in names it next time", async ({ page, request }) => {
  const email = `e2e-link-known-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password: "Passw0rd!" },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    // No address typed: the button opens the link page, focused on its field.
    const button = page.locator("[data-e2e=link-sign-in]")
    await gotoApp(page, "/sign-in", button)
    await button.click()
    await expect(page).toHaveURL("/sign-in/link")
    const field = page.locator("[data-e2e=sign-in-link-email]")
    await expect(field).toBeFocused()
    await field.fill(email)
    await page.locator("[data-e2e=sign-in-link-submit]").click()
    await expect(page.locator("[data-e2e=sign-in-link-sent]")).toContainText(email)

    await openLink(page, await linkFor(request, email))
    await page.waitForURL("/notes")

    await page.context().clearCookies()
    await gotoApp(page, "/sign-in", page.locator("[data-e2e=last-sign-in]"))
    await expect(page.locator("[data-e2e=last-sign-in]")).toContainText(
      "Last time you signed in with an e-mail link",
    )
  } finally {
    await cleanup(request, email, true)
  }
})
