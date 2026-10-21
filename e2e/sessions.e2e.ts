import { type APIRequestContext, type Browser, type BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const newPassword = "N3w-passw0rd!"

const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0"
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"

/** Removes `email`'s account; `soft` only records a failure, for the `finally` of a test. */
async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/**
 * Creates `email`'s account over the API and signs that request out again, so the only devices are
 * the ones a test signs in.
 */
async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const signedOut = await request.post(`${apiBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
}

/** A fresh address per run, so a rerun never meets the previous run's account. */
function address(name: string): string {
  return `e2e-sessions-${name}-${uuidV7().slice(-8)}@example.com`
}

/**
 * A second device: its own browser context, with its own cookie jar and user agent. It also sends a
 * forged `X-Real-IP`: the proxy must replace it with the address it sees, so a client cannot
 * choose the address shown for its session.
 */
function device(browser: Browser, userAgent: string): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: test.info().project.use.baseURL,
    userAgent,
    extraHTTPHeaders: { "x-real-ip": "203.0.113.42" },
  })
}

/** Signs `email` in on `context` over the API, as a device that is not open right now. */
async function signInOver(context: BrowserContext, email: string, secret = password) {
  const response = await context.request.post(`${apiBase}/api/auth/password/check`, {
    headers,
    data: { login: email, password: secret },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** Whether `context`'s session still signs it in. */
async function signedIn(context: BrowserContext | APIRequestContext): Promise<boolean> {
  const request = "request" in context ? context.request : context
  return (await request.get(`${apiBase}/api/auth/me`)).status() === 200
}

test.describe("signed-in devices", () => {
  test("signing another device out ends its session and closes its open page at once", async ({ browser, page, request }) => {
    const email = address("one")
    await cleanup(request, email)
    let phone: BrowserContext | null = null
    try {
      await signUp(request, email)
      phone = await device(browser, SAFARI_IPHONE)
      const phonePage = await phone.newPage()
      await signIn(phonePage, email, password)
      await expect(phonePage.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      let socketClosedAt = 0
      phonePage.on("websocket", (socket) => socket.on("close", () => socketClosedAt = Date.now()))
      // The phone's socket was opened before the listener: reopen the page so it is watched.
      await phonePage.reload()
      await expect(phonePage.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await signIn(page, email, password)
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=sessions]"))
      const sessions = page.locator("[data-e2e=sessions]")
      await expect(sessions.locator("[data-e2e=session-current]")).toContainText("This device")
      const phoneRow = sessions.locator("dl > div", { hasText: "Safari on iPhone" })
      await expect(phoneRow).toHaveCount(1)
      // Traefik sees the browser at the Docker network's gateway address, not at the forged one.
      // That address differs per machine, so the spec checks the shape and that the forged value
      // did not win.
      const phoneIp = phoneRow.locator("[data-e2e=session-ip]")
      await expect(phoneIp).toHaveText(/^(\d+\.\d+\.\d+\.\*|[0-9a-f]+:[0-9a-f]+:\*)$/i)
      await expect(phoneIp).not.toHaveText("203.0.113.*")

      await phoneRow.getByRole("button", { name: "Sign out Safari on iPhone" }).click()
      await page.locator("[data-e2e=session-end-confirm]").getByRole("button", { name: "Sign out" })
        .click()
      const endedAt = Date.now()
      await expect(page.locator("[data-e2e=sessions-ended]")).toBeVisible()
      await expect(phoneRow).toHaveCount(0)

      expect(await signedIn(phone)).toBe(false)
      // The server closes the phone's socket as soon as the session ends (about 20 ms here). The
      // hub's periodic check every 15 seconds would land within half a second of it only by chance.
      await expect(phonePage.locator("[data-e2e=auth-form-login]")).toBeVisible({ timeout: 8_000 })
      await expect(phonePage.locator("[data-e2e=shell-ws-status]")).toHaveCount(0)
      expect(socketClosedAt).toBeGreaterThan(0)
      expect(socketClosedAt - endedAt).toBeLessThan(500)
      expect(await signedIn(page.context())).toBe(true)
    } finally {
      await phone?.close()
      await cleanup(request, email, { soft: true })
    }
  })

  test("signing out of all other devices keeps only this one", async ({ browser, page, request }) => {
    const email = address("all")
    await cleanup(request, email)
    const others: BrowserContext[] = []
    try {
      await signUp(request, email)
      for (const agent of [SAFARI_IPHONE, FIREFOX_LINUX]) {
        const other = await device(browser, agent)
        others.push(other)
        await signInOver(other, email)
      }
      await signIn(page, email, password)
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=sessions]"))
      const rows = page.locator("[data-e2e=sessions] dl > div")
      await expect(rows).toHaveCount(3)

      await page.locator("[data-e2e=sessions-end-others]").click()
      await page.locator("[data-e2e=sessions-end-others-confirm]")
        .getByRole("button", { name: "Sign out" }).click()

      await expect(rows).toHaveCount(1)
      await expect(page.locator("[data-e2e=session-current]")).toBeVisible()
      await expect(page.locator("[data-e2e=sessions-end-others]")).toHaveCount(0)
      for (const other of others) expect(await signedIn(other)).toBe(false)
      expect(await signedIn(page.context())).toBe(true)
    } finally {
      for (const other of others) await other.close()
      await cleanup(request, email, { soft: true })
    }
  })

  test("a password change signs the other devices out unless the box is cleared", async ({ browser, page, request }) => {
    const email = address("password")
    await cleanup(request, email)
    let phone: BrowserContext | null = null
    try {
      await signUp(request, email)
      phone = await device(browser, SAFARI_IPHONE)
      await signInOver(phone, email)
      await signIn(page, email, password)
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=password-open]"))

      const change = async (from: string, to: string, signOutOthers: boolean) => {
        await page.locator("[data-e2e=password-open]").click()
        const box = page.locator("[data-e2e=password-sign-out-others]")
        await expect(box).toBeChecked()
        if (!signOutOthers) await box.uncheck()
        await page.locator("[data-e2e=password-current]").fill(from)
        await page.locator("[data-e2e=password-new]").fill(to)
        await page.locator("[data-e2e=password-save]").click()
        await expect(page.locator("[data-e2e=password-saved]").last()).toBeVisible()
        await expect(page.locator("[data-e2e=password-dialog]")).toBeHidden()
      }

      await change(password, newPassword, false)
      expect(await signedIn(phone)).toBe(true)
      await expect(page.locator("[data-e2e=sessions] dl > div")).toHaveCount(2)

      await change(newPassword, password, true)
      expect(await signedIn(phone)).toBe(false)
      await expect(page.locator("[data-e2e=sessions] dl > div")).toHaveCount(1)
      expect(await signedIn(page.context())).toBe(true)
    } finally {
      await phone?.close()
      await cleanup(request, email, { soft: true })
    }
  })
})
