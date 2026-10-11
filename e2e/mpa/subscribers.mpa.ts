import { type APIRequestContext, expect, test } from "@playwright/test"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/** The path and query of the first link in the newest mail to `email` whose subject starts so. */
async function mailedLink(request: APIRequestContext, email: string, subject: string) {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post("/api/test/last-mail", { data: { email } })
    if (!response.ok()) return response.status()
    const mail = (await response.json()) as { subject: string; text: string }
    text = mail.text
    return mail.subject.startsWith(subject)
  }, { timeout: 20_000, message: `the worker mails "${subject}"` }).toBe(true)
  const link = new URL(text.match(/https?:\/\/\S+/)![0])
  return link.pathname + link.search
}

// The subscription pages are plain forms: the whole flow runs without a single script.
test.use({ javaScriptEnabled: false })

test("a visitor without JavaScript subscribes, confirms and unsubscribes through the mailed links", async ({ page, request }) => {
  // A fresh address each run: the per-address limit allows three confirm mails an hour.
  const email = `mpa-subscribe-${uuidV7().slice(-8)}@example.com`

  await page.goto("/subscribe")
  await page.locator("[data-e2e=subscribe-email]").fill(email)
  await page.locator("[data-e2e=subscribe-submit]").click()
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()

  const confirmLink = await mailedLink(request, email, "Confirm your subscription")
  const confirmPage = await page.goto(confirmLink)
  expect(confirmPage?.headers()["cache-control"]).toBe("no-store")
  expect(confirmPage?.headers()["referrer-policy"]).toBe("no-referrer")
  await expect(page.getByText(email)).toBeVisible()
  await page.locator("[data-e2e=subscription-confirm-submit]").click()
  await expect(page.locator("[data-e2e=subscription-confirm-done]")).toBeVisible()
  // The confirm answered 303 to the page without its token.
  await expect(page).toHaveURL("/subscribe/confirm?state=done")

  const unsubscribeLink = await mailedLink(request, email, "You are subscribed")
  await page.goto(unsubscribeLink)
  await expect(page).toHaveURL(/\/unsubscribe\?list=news&token=/)
  await page.locator("[data-e2e=unsubscribe-submit]").click()
  await expect(page.locator("[data-e2e=unsubscribe-done]")).toBeVisible()
  await expect(page).toHaveURL("/unsubscribe?state=done")

  // The same link now finds nobody to remove.
  await page.goto(unsubscribeLink)
  await expect(page.locator("[data-e2e=unsubscribe-not-recognised]")).toBeVisible()
})
