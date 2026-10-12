import { type APIRequestContext, expect, test } from "@playwright/test"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/** The app's origin, another host than the website's (`e2e/mpa/run.sh`). `/api` is served there. */
const SPA = new URL(Deno.env.get("SPA_BASE_URL")!).origin

/** The first link in the newest mail to `email` whose subject starts so, exactly as mailed. */
async function mailedLink(request: APIRequestContext, email: string, subject: string) {
  let text = ""
  await expect.poll(async () => {
    const response = await request.post(`${SPA}/api/test/last-mail`, { data: { email } })
    if (!response.ok()) return response.status()
    const mail = (await response.json()) as { subject: string; text: string }
    text = mail.text
    return mail.subject.startsWith(subject)
  }, { timeout: 20_000, message: `the worker mails "${subject}"` }).toBe(true)
  return new URL(text.match(/https?:\/\/\S+/)![0])
}

// The subscription pages are plain forms: the whole flow runs without a single script.
test.use({ javaScriptEnabled: false })

test("a visitor without JavaScript subscribes, confirms and unsubscribes through the mailed links, which open the website and not the app", async ({ page, request, baseURL }) => {
  const site = new URL(baseURL!).origin
  expect(site).not.toBe(SPA)
  // A fresh address each run: the per-address limit allows three confirm mails an hour.
  const email = `mpa-subscribe-${uuidV7().slice(-8)}@example.com`

  await page.goto("/subscribe")
  await page.locator("[data-e2e=subscribe-email]").fill(email)
  await page.locator("[data-e2e=subscribe-submit]").click()
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()

  // The link is followed as mailed, host included: on the app's host a visitor without JavaScript
  // gets an empty page.
  const confirmLink = await mailedLink(request, email, "Confirm your subscription")
  expect(confirmLink.origin).toBe(site)
  const confirmPage = await page.goto(confirmLink.href)
  expect(confirmPage?.headers()["cache-control"]).toBe("no-store")
  expect(confirmPage?.headers()["referrer-policy"]).toBe("no-referrer")
  await expect(page.getByText(email)).toBeVisible()
  await page.locator("[data-e2e=subscription-confirm-submit]").click()
  await expect(page.locator("[data-e2e=subscription-confirm-done]")).toBeVisible()
  // The confirm answered 303 to the page without its token.
  await expect(page).toHaveURL(`${site}/subscribe/confirm?state=done`)

  // The unsubscribe link names the API, which a mail client's one-click unsubscribe posts to; a
  // person who opens it is sent on to the website's page.
  const unsubscribeLink = await mailedLink(request, email, "You are subscribed")
  expect(unsubscribeLink.origin).toBe(SPA)
  expect(unsubscribeLink.pathname).toBe("/api/subscribers/unsubscribe")
  await page.goto(unsubscribeLink.href)
  expect(page.url().startsWith(`${site}/unsubscribe?list=news&token=`)).toBe(true)
  await page.locator("[data-e2e=unsubscribe-submit]").click()
  await expect(page.locator("[data-e2e=unsubscribe-done]")).toBeVisible()
  await expect(page).toHaveURL(`${site}/unsubscribe?state=done`)

  // The same link now finds nobody to remove.
  await page.goto(unsubscribeLink.href)
  await expect(page.locator("[data-e2e=unsubscribe-not-recognised]")).toBeVisible()

  // The two hosts are really apart: the same address on the app's host is not the website's page.
  await page.goto(`${SPA}/unsubscribe${unsubscribeLink.search}`)
  await expect(page.locator("[data-e2e=spa-shell]")).toBeVisible()
  await expect(page.locator("[data-e2e=unsubscribe-not-recognised]")).toHaveCount(0)
})
