import { type APIResponse, expect, test } from "@playwright/test"
import { watchCspViolations } from "../fixtures/csp.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/** The app's origin, another host than the website's (`e2e/mpa/run.sh`). */
const SPA = new URL(Deno.env.get("SPA_BASE_URL")!).origin
/** The stand-in Umami's origin (`e2e/mpa/run.sh`): analytics is on in these tests. */
const UMAMI = Deno.env.get("MPA_UMAMI_ORIGIN")!

function expectSecurityHeaders(response: APIResponse) {
  const headers = response.headers()
  // The website has its own host here, so its forms may also redirect to the app's.
  expect(headers["content-security-policy"]).toBe(
    `default-src 'self'; script-src 'self' ${UMAMI}; style-src 'self'; img-src 'self' data: https:; ` +
      `connect-src 'self' ${UMAMI}; object-src 'none'; base-uri 'self'; ` +
      `form-action 'self' ${SPA}; ` +
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
  // The error page keeps the site's frame, so the visitor can go on from it.
  expect(await unknown.text()).toContain("Page not found")
  expect(await unknown.text()).toContain("Main navigation")
})

test("a visitor walks the website and its forms without a refusal under the content security policy", async ({ context, page }) => {
  const violations = await watchCspViolations(context)

  // The stylesheet is asked for and applied: a refused one is never requested.
  const stylesheet = page.waitForResponse((response) => response.url().includes("/assets/"))
  await page.goto("/")
  expect((await stylesheet).status()).toBe(200)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "The groundwork of your SaaS, already built.",
  )
  expect(await page.evaluate(() => document.styleSheets.length)).toBeGreaterThan(0)

  await page.goto("/pricing")
  // A form that the website answers with a redirect, to the app's /try.
  await page.getByRole("button", { name: "Try in the demo: Pro" }).click()
  await expect(page).toHaveURL(/\/try$/)

  const email = `mpa-csp-${uuidV7().slice(-8)}@example.com`
  await page.goto("/privacy")
  await page.locator("[data-e2e=footer-subscribe-email]").fill(email)
  await page.locator("[data-e2e=footer-subscribe-submit]").click()
  await expect(page.locator("[data-e2e=subscribe-sent]")).toBeVisible()

  expect(violations).toEqual([])
})
