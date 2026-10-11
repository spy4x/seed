import type { APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"

/** The path and query of the first link in the newest mail to `email` whose subject starts so. */
async function mailedLink(request: APIRequestContext, email: string, subject: string) {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post(`${apiBase}/api/test/last-mail`, { data: { email } })
    if (!response.ok()) return response.status()
    const mail = (await response.json()) as { subject: string; text: string }
    text = mail.text
    return mail.subject.startsWith(subject)
  }, { timeout: 20_000, message: `the worker mails "${subject}"` }).toBe(true)
  const link = new URL(text.match(/https?:\/\/\S+/)![0])
  return link.pathname + link.search
}

test("a visitor subscribes, confirms through the mailed link and unsubscribes from the welcome", async ({ page, request }) => {
  // A fresh address each run: the per-address limit allows three confirm mails an hour.
  const email = `e2e-subscribe-${uuidV7().slice(-8)}@example.com`

  await gotoApp(page, "/subscribe", page.locator("[data-e2e=subscribe-email]"))
  await page.locator("[data-e2e=subscribe-email]").fill(email)
  await page.locator("[data-e2e=subscribe-submit]").click()
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()

  const confirmLink = await mailedLink(request, email, "Confirm your subscription")
  expect(confirmLink).toMatch(/^\/subscribe\/confirm\?/)
  await gotoApp(page, confirmLink, page.locator("[data-e2e=subscription-confirm-submit]"))
  await expect(page.locator("meta[name=referrer]")).toHaveAttribute("content", "no-referrer")
  await expect(page.getByText(email)).toBeVisible()
  await page.locator("[data-e2e=subscription-confirm-submit]").click()
  await expect(page.locator("[data-e2e=subscription-confirm-done]")).toBeVisible()
  // The token leaves the address bar once it is spent.
  await expect(page).toHaveURL("/subscribe/confirm")

  const unsubscribeLink = await mailedLink(request, email, "You are subscribed")
  expect(unsubscribeLink).toMatch(/^\/api\/subscribers\/unsubscribe\?/)
  await gotoApp(page, unsubscribeLink, page.locator("[data-e2e=unsubscribe-submit]"))
  await expect(page).toHaveURL(/\/unsubscribe\?list=news&token=/)
  await page.locator("[data-e2e=unsubscribe-submit]").click()
  await expect(page.locator("[data-e2e=unsubscribe-done]")).toBeVisible()
  await expect(page).toHaveURL("/unsubscribe")

  // The same link now finds nobody to remove.
  await gotoApp(page, unsubscribeLink, page.locator("[data-e2e=unsubscribe-not-recognised]"))
})
