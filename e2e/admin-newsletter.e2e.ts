import { readFile } from "node:fs/promises"
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The newsletter page of the operator area (#428): a visitor subscribes and confirms on the
 * website, then an operator finds the address, exports the list and removes it. The confirm link
 * the visitor was mailed no longer adds them back.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

function address(name: string): string {
  return `e2e-admin-news-${name}-${uuidV7().slice(-8)}@example.com`
}

/** The path and query of the first link in the newest mail to `email` whose subject starts so. */
async function mailedLink(request: APIRequestContext, email: string, subject: string) {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post(`${appBase}/api/test/last-mail`, { data: { email } })
    if (!response.ok()) return response.status()
    const mail = (await response.json()) as { subject: string; text: string }
    text = mail.text
    return mail.subject.startsWith(subject)
  }, { timeout: 20_000, message: `the worker mails "${subject}"` }).toBe(true)
  const link = new URL(text.match(/https?:\/\/\S+/)![0])
  return link.pathname + link.search
}

/** Subscribes `email` on the website and confirms it; answers the confirm link it was mailed. */
async function subscribeAndConfirm(page: Page, request: APIRequestContext, email: string) {
  await gotoApp(page, "/subscribe", page.locator("[data-e2e=subscribe-email]"))
  await page.locator("[data-e2e=subscribe-email]").fill(email)
  await page.locator("[data-e2e=subscribe-submit]").click()
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()
  const confirmLink = await mailedLink(request, email, "Confirm your subscription")
  await gotoApp(page, confirmLink, page.locator("[data-e2e=subscription-confirm-submit]"))
  await page.locator("[data-e2e=subscription-confirm-submit]").click()
  await expect(page.locator("[data-e2e=subscription-confirm-done]")).toBeVisible()
  return confirmLink
}

test("an operator finds a subscriber, exports the list and removes them", async ({ browser, page, request }) => {
  const operatorEmail = address("ops")
  const subscriber = address("sub")
  // A second address on the list, so the search has something to leave out.
  const decoy = address("decoy")
  let admin: BrowserContext | null = null
  let ops: Page | null = null
  try {
    // The operator's account, promoted.
    const signUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
      headers,
      data: { email: operatorEmail, password },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)
    expect((await request.post(`${appBase}/api/auth/sign-out`, { headers })).ok()).toBe(true)
    const promoted = await request.post(`${appBase}/api/test/set-role`, {
      data: { login: operatorEmail, role: OPERATOR },
    })
    expect(promoted.ok(), await promoted.text()).toBe(true)

    // Two visitors subscribe and confirm on the website.
    const confirmLink = await subscribeAndConfirm(page, request, subscriber)
    await subscribeAndConfirm(page, request, decoy)

    // The operator signs in on the admin host and opens the newsletter from the sidebar.
    admin = await browser.newContext({ baseURL: adminBase, acceptDownloads: true })
    ops = await admin.newPage()
    await ops.goto(`${adminBase}/sign-in`)
    await ops.locator("[data-e2e=auth-form-login]").fill(operatorEmail)
    await ops.locator("[data-e2e=auth-form-password]").fill(password)
    await ops.locator("[data-e2e=auth-form-submit]").click()
    await expect(ops).toHaveURL(`${adminBase}/`)
    await ops.getByRole("navigation", { name: "Admin sections" })
      .getByRole("link", { name: "Newsletter" }).click()
    await expect(ops).toHaveURL(`${adminBase}/newsletter`)
    await expect(ops.locator("[data-e2e=admin-newsletter-title]")).toBeVisible()
    await expect(ops.locator("[data-e2e=admin-newsletter-stats]")).toContainText("Subscribers")
    await expect(ops.locator("[data-e2e=admin-newsletter-chart] svg").first()).toBeVisible()

    // Finds the address. The search goes in a request body: neither the page's address nor any
    // request's URL holds it, so no history entry or access log keeps it.
    const urls: string[] = []
    ops.on("request", (request) => urls.push(request.url()))
    await ops.locator("[data-e2e=admin-newsletter-search]").fill(subscriber)
    const [search] = await Promise.all([
      ops.waitForRequest((request) =>
        request.url().endsWith("/subscribers/search") &&
        (request.postData() ?? "").includes(subscriber)
      ),
      ops.locator("[data-e2e=admin-newsletter-submit]").click(),
    ])
    expect(search.method()).toBe("POST")
    expect(search.postDataJSON()).toEqual({ q: subscriber })
    const rows = ops.locator("[data-e2e=admin-newsletter-list] tbody tr")
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(subscriber)
    await expect(rows.first()).toContainText("Confirmed")
    await expect(ops.locator("[data-e2e=admin-newsletter-count]")).toHaveText("1 address")
    await expect(ops).toHaveURL(`${adminBase}/newsletter`)
    expect(urls.filter((url) => decodeURIComponent(url).includes(subscriber))).toEqual([])

    // The export downloads a CSV that holds the address.
    const [download] = await Promise.all([
      ops.waitForEvent("download"),
      ops.locator("[data-e2e=admin-newsletter-export]").click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^newsletter-subscribers-\d{4}-\d{2}-\d{2}\.csv$/)
    const csv = await readFile(await download.path())
    expect(csv.toString("utf8")).toContain(`${subscriber},confirmed`)

    // Removes it: the dialog only confirms, it asks for no password.
    await ops.locator("[data-e2e=admin-subscriber-remove]").click()
    await expect(ops.locator("[data-e2e=admin-newsletter-dialog]")).toContainText(subscriber)
    await ops.locator("[data-e2e=admin-newsletter-confirm]").click()
    await expect(ops.locator("[data-e2e=toasts]")).toContainText("no longer gets the newsletter")
    await expect(ops.locator("[data-e2e=admin-newsletter-count]")).toHaveText("0 addresses")
    await expect(ops.locator("[data-e2e=admin-newsletter-count]")).toBeFocused()

    // The confirm link mailed before the removal no longer adds the address back.
    await gotoApp(page, confirmLink, page.locator("[data-e2e=subscription-confirm-submit]"))
    await page.locator("[data-e2e=subscription-confirm-submit]").click()
    await expect(page.locator("[data-e2e=subscription-confirm-done]")).toHaveCount(0)
    // A reload forgets the search, which lives in no address, so the operator searches again.
    await ops.reload()
    await ops.locator("[data-e2e=admin-newsletter-search]").fill(subscriber)
    await ops.locator("[data-e2e=admin-newsletter-submit]").click()
    await expect(ops.locator("[data-e2e=admin-newsletter-count]")).toHaveText("0 addresses")

    // The sent issues have their own tab, kept in the address.
    await ops.getByRole("tab", { name: "Sent issues" }).click()
    await expect(ops).toHaveURL(/tab=sends/)
    await expect(ops.locator("[data-e2e=admin-newsletter-sends]")).toBeVisible()
  } finally {
    // The decoy leaves the list the way an operator removes it. The request goes from the admin
    // page: the browser resolves `admin.localhost`, but the CI container's Node resolver does not.
    const removed = await ops?.evaluate(async (email) => {
      const response = await fetch("/api/admin/newsletter/subscribers/remove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      return { status: response.status, text: await response.text() }
    }, decoy)
    if (removed) expect.soft(removed.status, removed.text).toBe(200)
    await admin?.close()
    const cleaned = await request.post(`${appBase}/api/test/cleanup-user`, {
      data: { login: operatorEmail },
    })
    expect.soft(cleaned.status(), await cleaned.text()).toBe(200)
  }
})
