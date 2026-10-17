import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

interface ManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

/** The manifest the page links, fetched the way the browser does. */
async function linkedManifest(page: Page) {
  const href = await page.locator("link[rel=manifest]").getAttribute("href")
  expect(href, "the page links a manifest").toBeTruthy()
  const url = new URL(href!, page.url()).toString()
  const response = await page.request.get(url)
  expect(response.ok(), url).toBe(true)
  return {
    url,
    manifest: await response.json() as Record<string, unknown> & { icons: ManifestIcon[] },
  }
}

// The install check needs the full Chromium: the headless shell Playwright runs by default
// does not compute installability, and answers "no errors" for any manifest.
test.use({ channel: "chromium" })

test.describe("installable app", () => {
  test("the manifest names the app and carries a 192, a 512 and a maskable icon that load", async ({ page }) => {
    await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
    const { url, manifest } = await linkedManifest(page)

    expect(manifest.name).toBe("Seed")
    expect(manifest.short_name).toBe("Seed")
    expect(manifest.display).toBe("standalone")
    expect(manifest.start_url).toBe("/")
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(manifest.background_color).toBeTruthy()
    // One theme-color per palette (#444): the light one is the manifest's, the dark one ink's canvas.
    await expect(page.locator(`meta[name=theme-color][media="(prefers-color-scheme: light)"]`))
      .toHaveAttribute("content", manifest.theme_color as string)
    await expect(page.locator(`meta[name=theme-color][media="(prefers-color-scheme: dark)"]`))
      .toHaveAttribute("content", "#080b10")

    const wanted = [
      { size: "192x192", purpose: undefined },
      { size: "512x512", purpose: undefined },
      { size: "512x512", purpose: "maskable" },
    ]
    for (const { size, purpose } of wanted) {
      const icon = manifest.icons.find((candidate) =>
        candidate.sizes === size && candidate.purpose === purpose
      )
      expect(icon, `an icon of ${size} with purpose ${purpose ?? "any"}`).toBeTruthy()
      const response = await page.request.get(new URL(icon!.src, url).toString())
      expect(response.status(), icon!.src).toBe(200)
      expect(response.headers()["content-type"], icon!.src).toBe("image/png")
      // The file is as big as the manifest says, so a stale size is caught.
      const [width, height] = size.split("x").map(Number)
      const dimensions = await page.evaluate(async (src) => {
        const image = new Image()
        image.src = src
        await image.decode()
        return [image.naturalWidth, image.naturalHeight]
      }, new URL(icon!.src, url).toString())
      expect(dimensions, icon!.src).toEqual([width, height])
    }
  })

  test("Chromium finds nothing that stops the app from being installed", async ({ page }) => {
    await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
    // The browser checks for the worker and the manifest after the page settles.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready
    })
    const session = await page.context().newCDPSession(page)
    try {
      await session.send("Page.enable")
      // An empty answer before the browser has read the manifest would pass for the wrong reason,
      // so the manifest must have been parsed, without errors, before the errors are read.
      const parsed = await session.send("Page.getAppManifest")
      expect(parsed.errors.map((error) => error.message)).toEqual([])
      expect(JSON.parse(parsed.data || "{}").display).toBe("standalone")
      await expect.poll(async () => {
        const { installabilityErrors } = await session.send("Page.getInstallabilityErrors")
        // Playwright's contexts are private windows, which can never be installed from.
        return installabilityErrors.map((error) => error.errorId).filter((id) =>
          id !== "in-incognito"
        )
      }, { timeout: 15_000 }).toEqual([])
    } finally {
      await session.detach()
    }
  })

  test("the install offer appears when the browser allows install, and Not now hides it for good and moves focus to the heading", async ({ page, request }) => {
    const user = "e2e_pwa_install@example.com"
    await cleanup(request, user)
    try {
      await signUp(request, user)
      await signIn(page, user, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const offer = page.getByRole("region", { name: "Install this app" })
      await expect(offer).toHaveCount(0)

      // Chromium fires this event when the app can be installed; the page keeps it for its button.
      const fire = () =>
        page.evaluate(() => {
          const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
            prompt: () => Promise<void>
            userChoice: Promise<{ outcome: string }>
          }
          event.prompt = () => Promise.resolve()
          event.userChoice = Promise.resolve({ outcome: "dismissed" })
          globalThis.dispatchEvent(event)
        })
      await fire()
      await expect(offer).toBeVisible()
      await expect(offer.getByRole("button", { name: "Install" })).toBeVisible()

      await offer.getByRole("button", { name: "Not now" }).click()
      await expect(offer).toHaveCount(0)
      // The card took the focused button with it: the reader continues at the page's heading.
      await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toBeFocused()

      // A person who said "not now" is not asked again, even when the browser offers once more.
      await page.reload()
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await fire()
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await expect(offer).toHaveCount(0)
    } finally {
      await cleanup(request, user)
    }
  })

  test("a phone 360 px wide shows the notes with no sideways scroll and room to tap", async ({ browser, request }) => {
    const user = "e2e_pwa_phone@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 360, height: 740 },
      hasTouch: true,
      isMobile: true,
    })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await gotoApp(page, "/notes", page.locator("[data-e2e=note-new], [data-e2e=note-new-empty]"))
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
      }))
      expect(overflow).toEqual({ page: 0, body: 0 })
      const box = await page.locator("[data-e2e=note-new], [data-e2e=note-new-empty]").first()
        .boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(40)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}
