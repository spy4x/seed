import { expect, type Page, test } from "@playwright/test"
import { watchCspViolations } from "../fixtures/csp.ts"

/**
 * The website's analytics against the stand-in tracker `spa-shell.ts` serves at
 * `MPA_UMAMI_ORIGIN` (`e2e/mpa/run.sh`), which keeps every `umami.track` call in `__umamiEvents`.
 * Clicks and submits are stopped before they navigate, so the calls stay readable.
 */

const UMAMI = Deno.env.get("MPA_UMAMI_ORIGIN")!

interface Tracked {
  name: string
  data?: Record<string, unknown>
}

function events(page: Page): Promise<Tracked[]> {
  return page.evaluate(() =>
    (globalThis as unknown as { __umamiEvents?: Tracked[] }).__umamiEvents ?? []
  )
}

/**
 * Keeps the page where it is after a click on a link, or after a submit, once the website's own
 * listeners (which run first, in the capture phase) have seen it.
 */
function stayOnPage(page: Page, type: "click" | "submit"): Promise<void> {
  return page.evaluate((type) => {
    document.addEventListener(type, (event) => event.preventDefault())
  }, type)
}

test("a page loads the tracker from the Umami origin and the website's own events, with no refusal", async ({ context, page }) => {
  const violations = await watchCspViolations(context)
  await page.goto("/")

  const tracker = page.locator(`script[src="${UMAMI}/script.js"]`)
  await expect(tracker).toHaveAttribute("data-do-not-track", "true")
  await expect(tracker).toHaveAttribute("data-domains", new URL(page.url()).hostname)
  await expect(page.locator(`script[src="/analytics.js"]`)).toHaveCount(1)
  // The stand-in ran, so the policy let the tracker in.
  await expect.poll(() =>
    page.evaluate(() => typeof (globalThis as unknown as { umami?: unknown }).umami)
  ).toBe("object")
  expect(violations).toEqual([])
})

// The shared header takes no `data-umami-event`, so `/analytics.js` names its links by where they go.
test("counts the shared header's GitHub and Pricing links as clicked in the header", async ({ page }) => {
  await page.goto("/")
  await stayOnPage(page, "click")
  await page.getByRole("navigation", { name: "Main navigation" }).first()
    .getByRole("link", { name: "GitHub" }).click()
  await page.getByRole("navigation", { name: "Main navigation" }).first()
    .getByRole("link", { name: "Pricing" }).click()

  expect(await events(page)).toEqual([
    { name: "github", data: { from: "header" } },
    { name: "internal-link", data: { to: "/pricing", from: "header" } },
  ])
})

test("counts a demo plan chosen on the pricing page, with the plan", async ({ page }) => {
  await page.goto("/pricing")
  await stayOnPage(page, "submit")

  await page.getByRole("button", { name: "Try in the demo: Pro" }).click()

  expect(await events(page)).toEqual([{ name: "pricing-plan", data: { planId: "pro" } }])
})

test("counts the 404 page once it has loaded", async ({ page }) => {
  await page.goto("/no-such-page")

  await expect.poll(() => events(page)).toEqual([
    { name: "not-found", data: { path: "/no-such-page" } },
  ])
})

test("counts the admin video's first play, each quarter once, and its end", async ({ page }) => {
  await page.goto("/admin")

  // The file is not loaded (`preload="none"`): the test sets the clock the listeners read.
  await page.locator("[data-e2e=admin-video]").evaluate((video: HTMLVideoElement) => {
    let now = 0
    Object.defineProperty(video, "duration", { value: 100 })
    Object.defineProperty(video, "currentTime", { get: () => now })
    const at = (seconds: number) => {
      now = seconds
      video.dispatchEvent(new Event("timeupdate"))
    }
    video.dispatchEvent(new Event("play"))
    at(30)
    video.dispatchEvent(new Event("play"))
    at(80)
    at(81)
    video.dispatchEvent(new Event("ended"))
  })

  expect(await events(page)).toEqual([
    { name: "admin-video-play" },
    { name: "admin-video-progress", data: { percent: 25 } },
    { name: "admin-video-progress", data: { percent: 50 } },
    { name: "admin-video-progress", data: { percent: 75 } },
    { name: "admin-video-progress", data: { percent: 100 } },
    { name: "admin-video-ended" },
  ])
})

test("loads no tracker on a page whose address carries a newsletter token", async ({ page }) => {
  await page.goto("/unsubscribe?list=news&token=not-a-real-token")

  await expect(page.locator(`script[src="${UMAMI}/script.js"]`)).toHaveCount(0)
  await expect(page.locator(`script[src="/analytics.js"]`)).toHaveCount(0)
})
