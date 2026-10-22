import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, submitAuthForm } from "./fixtures/app.ts"
import { currentStep, totpCode } from "./fixtures/totp.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"

test.describe("two-factor sign-in", () => {
  test("signs in with a one-time code after the password step", async ({ page, request }) => {
    // A fresh address each run, so the code mail read below is this run's.
    const email = `e2e-two-factor-${uuidV7().slice(-8)}@example.com`
    const password = "Passw0rd!"
    const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

    // The route answers 200 also when the user does not exist yet; anything else fails the spec.
    // `soft` in `finally`: a failed cleanup is reported next to the spec's own error, not over it.
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await signUpWithCode(page.request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      // Two-factor auth needs a proven address; the sign-up code proved it.
      await gotoApp(page, "/profile/account", page.locator("[data-e2e=email-state]"))
      await expect(page.locator("[data-e2e=email-state]")).toHaveText("Verified")

      // Turn two-factor auth on through the profile screen and read the secret it shows.
      // Without an authenticator app the page offers Enable only, never Disable next to it.
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=totp-start]"))
      await expect(page.locator("[data-e2e=totp-disable]")).toHaveCount(0)
      await page.locator("[data-e2e=totp-start]").click()
      // Turning it on asks for the password first (#406).
      await page.locator("[data-e2e=totp-start-password]").fill(password)
      await page.locator("[data-e2e=totp-start-submit]").click()
      const secret = (await page.locator("[data-e2e=totp-secret]").innerText()).trim()
      const enrolStep = currentStep()
      await page.locator("[data-e2e=totp-connect-otp]").fill(await totpCode(secret, enrolStep))
      await page.locator("[data-e2e=totp-connect-finish]").click()
      await page.locator("[data-e2e=totp-connect-finish]").waitFor({ state: "detached" })
      // Once the app is connected the page offers Disable only.
      await expect(page.locator("[data-e2e=totp-disable]")).toBeVisible()
      await expect(page.locator("[data-e2e=totp-start]")).toHaveCount(0)

      await page.locator("[data-e2e=account-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=auth-form-login]").waitFor()

      // Password step: the app reloads onto the code screen, which must still ask for the code.
      await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
      await page.locator("[data-e2e=auth-form-login]").fill(email)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      await submitAuthForm(page, "/totp", page.locator("[data-e2e=auth-form-code]"))
      // A page for signed-in people sends a session that owes its code to the code page.
      await gotoApp(page, "/notes", page.locator("[data-e2e=auth-form-code]"))
      await expect(page).toHaveURL("/totp?next=%2Fnotes")
      await gotoApp(page, "/totp", page.locator("[data-e2e=auth-form-code]"))
      await expect(page.getByRole("heading", { level: 1, name: "No code needed" }))
        .toHaveCount(0)

      // A code for the step the enrolment used is refused as a replay, so use a later step. The
      // server accepts one step ahead.
      const step = Math.max(currentStep(), enrolStep + 1)
      await page.locator("[data-e2e=auth-form-code]").fill(await totpCode(secret, step))
      await submitAuthForm(
        page,
        "/notes",
        page.getByRole("heading", { level: 1, name: "Notes", exact: true }),
      )

      const me = await page.request.get("/api/auth/me")
      expect(me.status()).toBe(200)
    } finally {
      await cleanup({ soft: true })
    }
  })
})
