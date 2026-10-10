import { type APIResponse, expect, test } from "@playwright/test"
import { watchCspViolations } from "../fixtures/csp.ts"

function expectSecurityHeaders(response: APIResponse) {
  const headers = response.headers()
  // One origin serves the MPA and the API here, so no other origin is added to `form-action`.
  expect(headers["content-security-policy"]).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
      "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
      "frame-ancestors 'none'",
  )
  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["referrer-policy"]).toBe("no-referrer")
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["strict-transport-security"]).toBe("max-age=15552000; includeSubDomains")
}

test("the website sends the security headers with a page, its stylesheet and an unknown address", async ({ request }) => {
  const page = await request.get("/")
  expect(page.status()).toBe(200)
  expectSecurityHeaders(page)

  const stylesheet = (await page.text()).match(/<link rel="stylesheet" href="([^"]+)"/)![1]
  const css = await request.get(stylesheet.replaceAll("&amp;", "&"))
  expect(css.status()).toBe(200)
  expect(css.headers()["content-type"]).toContain("text/css")
  expectSecurityHeaders(css)

  const unknown = await request.get("/no-such-page")
  expect(unknown.status()).toBe(404)
  expectSecurityHeaders(unknown)
})

test("a visitor walks the website and its forms without a refusal under the content security policy", async ({ context, page }) => {
  const violations = await watchCspViolations(context)

  // The stylesheet is asked for and applied: a refused one is never requested.
  const stylesheet = page.waitForResponse((response) => response.url().includes("/assets/"))
  await page.goto("/")
  expect((await stylesheet).status()).toBe(200)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The groundwork of a SaaS, already built.",
  )
  expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0)

  await page.goto("/pricing")
  // A form that the website answers with a redirect.
  await page.getByRole("button", { name: "Try Pro in the demo" }).click()
  await expect(page).toHaveURL(/\/sign-up$/)

  const email = `mpa-csp-${crypto.randomUUID().slice(0, 8)}@example.com`
  await page.goto("/privacy")
  await page.locator("[data-e2e=footer-subscribe-email]").fill(email)
  await page.locator("[data-e2e=footer-subscribe-submit]").click()
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()

  expect(violations).toEqual([])
})
