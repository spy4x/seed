import { type APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

// The e2e worker has no file store, so the file never turns ready here: the ZIP itself is covered by
// tests/integration/data-export.integration.test.ts and tests/files/garage.test.ts.
test("asking for my data shows it in preparation, keeps it after a reload, and refuses a second ask that day", async ({ page, request }) => {
  const email = `e2e-export-${uuidV7().slice(-8)}@example.com`
  await cleanup(request, email)
  try {
    const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password },
    })
    expect(response.ok(), await response.text()).toBe(true)
    await signIn(page, email, password)

    // The delete section's link lands on the row's control.
    await gotoApp(page, "/profile/danger-zone", page.locator("[data-e2e=danger-zone]"))
    await page.locator("[data-e2e=account-delete-export-link]").click()
    await expect(page).toHaveURL(/\/profile\/account#your-data$/)
    const ask = page.locator("[data-e2e=data-export-request]")
    await expect(ask).toBeFocused()
    await expect(ask).toHaveText("Download my data")

    await ask.click()
    const state = page.locator("[data-e2e=data-export-state]")
    await expect(state).toContainText("Preparing your file.")
    await expect(ask).toHaveCount(0)

    await page.reload()
    await expect(state).toContainText("Preparing your file.")

    const again = await page.request.post(`${apiBase}/api/account/data-export`, { headers })
    expect(again.status()).toBe(429)
    expect((await again.json()).error.reason).toBe("TOO_SOON")
    // Nothing is ready, so the download address answers 404 and signs nothing.
    const download = await page.request.get(`${apiBase}/api/account/data-export/download`, {
      headers,
      maxRedirects: 0,
    })
    expect(download.status()).toBe(404)
  } finally {
    await cleanup(request, email, { soft: true })
  }
})

const HOUR = 3_600_000

/** An export as the API answers it: `status` 1 is Preparing, 2 is Ready a day ago. */
function exportJson(status: 1 | 2) {
  const now = Date.now()
  const requested = status === 1 ? now : now - 25 * HOUR
  return {
    id: uuidV7(),
    status,
    requestedAt: new Date(requested).toISOString(),
    readyAt: status === 2 ? new Date(requested + 60_000).toISOString() : null,
    expiresAt: status === 2 ? new Date(now + 6 * 24 * HOUR).toISOString() : null,
    sizeBytes: status === 2 ? 4_200_000 : null,
    nextRequestAt: new Date(requested + 24 * HOUR).toISOString(),
  }
}

// The control pressed leaves the page when the answer arrives; focus must land on the row's
// status instead of the page. Whether it did once depended on when the answer came, so the answer
// is held for a fixed time here, and CI's single run is backed by a `--repeat-each` loop locally.
for (const answerMs of [0, 600]) {
  test(`focus stays on Your data when a request by keyboard takes its control away (answer in ${answerMs} ms)`, async ({ page, request }) => {
    const email = `e2e-export-focus-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(response.ok(), await response.text()).toBe(true)
      await signIn(page, email, password)

      let latest: ReturnType<typeof exportJson> | null = null
      await page.route(`${apiBase}/api/account/data-export`, async (route) => {
        if (route.request().method() !== "POST") {
          return route.fulfill({ json: { export: latest } })
        }
        await new Promise((resolve) => setTimeout(resolve, answerMs))
        latest = exportJson(1)
        await route.fulfill({ status: 201, json: { export: latest } })
      })
      const state = page.locator("[data-e2e=data-export-state]")
      const pressExpectingFocusOnState = async (selector: string) => {
        await gotoApp(page, "/profile/account", page.locator(selector))
        const control = page.locator(selector)
        await control.focus()
        await expect(control).toBeFocused()
        await page.keyboard.press("Enter")
        await expect(state).toContainText("Preparing your file.")
        await expect(control).toHaveCount(0)
        await expect(state).toBeFocused()
      }

      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        latest = null
        await pressExpectingFocusOnState("[data-e2e=data-export-request]")
        latest = exportJson(2)
        await pressExpectingFocusOnState("[data-e2e=data-export-again]")
      }
    } finally {
      await cleanup(request, email, { soft: true })
    }
  })
}
