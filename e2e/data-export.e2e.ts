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

// The e2e stack has no file store, so the file never turns ready here: the ZIP itself is covered by
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
    expect((await again.json()).code).toBe("TOO_SOON")
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
