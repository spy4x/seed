import { type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** Makes the page report `hidden` or `visible`, as the browser does when the app is backgrounded. */
async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next })
    document.dispatchEvent(new Event("visibilitychange"))
  }, state)
}

/** Records every text the connection indicator takes from now on. */
async function recordStatusTexts(page: Page) {
  await page.evaluate(() => {
    const target = document.querySelector("[data-e2e=shell-ws-status]")!
    const seen: string[] = []
    ;(window as unknown as { __statusTexts: string[] }).__statusTexts = seen
    new MutationObserver(() => seen.push(target.textContent ?? "")).observe(target, {
      childList: true,
      characterData: true,
      subtree: true,
    })
  })
}

const statusTexts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __statusTexts: string[] }).__statusTexts)

/** A signed-up, signed-in user on the groups page with an open socket, and a cleanup. */
async function signedIn(
  { page, request }: { page: Page; request: import("@playwright/test").APIRequestContext },
  email: string,
  backoff?: { baseMs: number; maxMs: number; jitterRatio: number },
) {
  // Slows the app's reconnect timer (see `testBackoff` in apps/spa/src/state/realtime.ts).
  if (backoff) {
    await page.addInitScript((value) => {
      ;(globalThis as { __REALTIME_BACKOFF__?: unknown }).__REALTIME_BACKOFF__ = value
    }, backoff)
  }
  const cleanup = async ({ soft = false } = {}) => {
    const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
      data: { login: email },
    })
    ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
  }
  await cleanup()
  const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(signUp.ok()).toBe(true)
  await signIn(page, email, password)
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
    name: "Groups",
  }).click()
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  const dropSockets = async () => {
    const closed = await request.post(`${apiBase}/api/test/close-sockets`, {
      data: { login: email },
    })
    expect(closed.status(), await closed.text()).toBe(200)
  }
  return { cleanup, dropSockets }
}

test.describe("realtime when the app returns", () => {
  test("reconnects and pulls missed changes as soon as the page is shown again", async ({ page, request }) => {
    const { cleanup, dropSockets } = await signedIn(
      { page, request },
      "e2e_resume_pull@example.com",
      // The first retry comes a minute after the drop, with no jitter: the spec is over long
      // before, so only `resume()` can reconnect it.
      { baseMs: 60_000, maxMs: 60_000, jitterRatio: 0 },
    )
    try {
      const names = page.locator("[data-e2e=group-item-name]")
      await expect(names).toHaveCount(1)

      // The app goes to the background and the phone drops the connection. The network stays
      // down long enough that the reconnect delay has grown well past what the test waits for.
      await setVisibility(page, "hidden")
      await page.context().setOffline(true)
      await dropSockets()
      const behindItsBack = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: uuidV7(), name: "Made while away" },
      })
      expect(behindItsBack.status()).toBe(201)
      await page.waitForTimeout(12_000)
      await expect(names.filter({ hasText: "Made while away" })).toHaveCount(0)

      await page.context().setOffline(false)
      await setVisibility(page, "visible")

      await expect(names.filter({ hasText: "Made while away" })).toHaveCount(1, { timeout: 3_000 })
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
    } finally {
      await page.context().setOffline(false)
      await cleanup({ soft: true })
    }
  })

  test("shows no warning after a short trip to the background, but shows a later real drop", async ({ page, request }) => {
    const { cleanup, dropSockets } = await signedIn(
      { page, request },
      "e2e_resume_quiet@example.com",
    )
    try {
      await setVisibility(page, "hidden")
      await page.context().setOffline(true)
      await dropSockets()
      await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")

      await page.context().setOffline(false)
      await recordStatusTexts(page)
      await setVisibility(page, "visible")
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await page.waitForTimeout(2_500) // longer than the quiet period

      const texts = await statusTexts(page)
      expect(texts.filter((text) => text !== "Online")).toEqual([])

      // The quiet period is over. A real drop while the page is visible must show, not stay hidden.
      await page.context().setOffline(true)
      await dropSockets()
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Offline")
    } finally {
      await page.context().setOffline(false)
      await cleanup({ soft: true })
    }
  })

  test("says Reconnecting only when the reconnect takes longer than two seconds", async ({ page, request }) => {
    const { cleanup, dropSockets } = await signedIn(
      { page, request },
      "e2e_resume_slow@example.com",
    )
    try {
      await setVisibility(page, "hidden")
      await page.context().setOffline(true)
      await dropSockets()
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Offline")

      // Shown again with the network still down: quiet at first, then honest.
      await setVisibility(page, "visible")
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Reconnecting…", {
        timeout: 4_000,
      })

      await page.context().setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 5_000,
      })
    } finally {
      await page.context().setOffline(false)
      await cleanup({ soft: true })
    }
  })
})
