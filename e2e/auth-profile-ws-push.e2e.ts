import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, openProfile, signIn, submitAuthForm } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"

test.describe("auth profile ws push flow", () => {
  test("sign-up sign-in profile ws sign-out", async ({ page, request }) => {
    const email = "e2e_auth_profile_user@example.com"
    const password = "Passw0rd!"
    const firstName = "John"
    const lastName = "Doe"

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
      // The API refuses a mutation without the headers a browser sends from the app's own page.
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers: { origin: apiBase, "sec-fetch-site": "same-origin" },
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)

      await gotoApp(
        page,
        "/sign-in",
        page.getByRole("heading", { level: 1, name: "Welcome back" }),
      )
      await page.locator("[data-e2e=auth-form-login]").fill(email)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      await submitAuthForm(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      // The signed-in layout: the skip link is the first thing Tab reaches. A sign-in lands on the
      // notes list, whose entry is the current one.
      await page.keyboard.press("Tab")
      await expect(page.locator("[data-e2e=rail-shell-skip-link]")).toBeFocused()
      const nav = page.getByRole("navigation", { name: "Main navigation" })
      await expect(nav.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page")

      // Nav links go through the router: a click keeps the page instead of reloading it, and a
      // Ctrl-click (Cmd on macOS) is left to the browser, which opens the link in a new tab. The
      // entry of the page shown is marked as the current one.
      await page.evaluate(() => Object.assign(globalThis, { e2ePageMarker: true }))
      await nav.getByRole("link", { name: "Groups" }).click()
      await expect(nav.getByRole("link", { name: "Groups" })).toHaveAttribute(
        "aria-current",
        "page",
      )
      expect(await page.evaluate(() => "e2ePageMarker" in globalThis)).toBe(true)
      const newTab = page.context().waitForEvent("page", { timeout: 5_000 })
      await nav.getByRole("link", { name: "Notes" }).click({ modifiers: ["ControlOrMeta"] })
      await (await newTab).close()

      // Profile in the account menu goes through the router too.
      await openProfile(page)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      expect(await page.evaluate(() => "e2ePageMarker" in globalThis)).toBe(true)

      // A wide window opens the first section, Account, beside the list of sections.
      await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible()
      await expect(page.locator("[data-e2e=settings-section] [data-e2e=profile-name]"))
        .toBeVisible()
      // Cancelling the name dialog drops what was typed and the error it caused.
      const firstNameField = page.locator("[data-e2e=profile-first-name]")
      const lastNameField = page.locator("[data-e2e=profile-last-name]")
      await page.locator("[data-e2e=profile-edit]").click()
      const savedFirstName = await firstNameField.inputValue()
      const savedLastName = await lastNameField.inputValue()
      await firstNameField.fill("x".repeat(51))
      await lastNameField.fill(lastName)
      await page.locator("[data-e2e=profile-save]").click()
      await expect(firstNameField).toHaveAttribute("aria-invalid", "true")
      await page.locator("[data-e2e=profile-dialog]").getByRole("button", { name: "Cancel" })
        .click()
      await page.locator("[data-e2e=profile-edit]").click()
      await expect(firstNameField).toHaveValue(savedFirstName)
      await expect(lastNameField).toHaveValue(savedLastName)
      await expect(firstNameField).not.toHaveAttribute("aria-invalid", "true")

      await firstNameField.fill(firstName)
      await lastNameField.fill(lastName)
      await page.locator("[data-e2e=profile-save]").click()
      await page.locator("[data-e2e=profile-saved]").getByText("Profile saved", { exact: true })
        .waitFor()
      await expect(page.locator("[data-e2e=profile-dialog]")).toHaveCount(0)
      await expect(page.locator("[data-e2e=profile-name]")).toHaveText(`${firstName} ${lastName}`)

      // The push devices have a section of their own, which keeps the page.
      await page.locator("[data-e2e=settings-nav-notifications]").click()
      await expect(page).toHaveURL("/profile/notifications")
      await expect(page.getByRole("heading", { level: 2, name: "Push notifications" }))
        .toBeVisible()
      expect(await page.evaluate(() => "e2ePageMarker" in globalThis)).toBe(true)

      await page.locator("[data-e2e=account-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=auth-form-login]").waitFor()

      const me = await page.request.get("/api/auth/me")
      expect(me.status()).toBe(401)
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("after a sign-in, the sign-in page names the method and the masked address", async ({ page, request }) => {
    const email = "e2e_last_sign_in_user@example.com"
    const password = "Passw0rd!"
    const signInPage = () => gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers: { origin: apiBase, "sec-fetch-site": "same-origin" },
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      // A browser nobody signed in on says nothing.
      await signInPage()
      await expect(page.locator("[data-e2e=last-sign-in]")).toHaveCount(0)

      await signIn(page, email, password)
      // The app asks the API which method the session used and keeps the answer. Signing out
      // before it arrived would keep nothing, so the spec waits for it.
      await expect.poll(() => page.evaluate(() => localStorage.getItem("last-sign-in")))
        .not.toBeNull()
      await page.locator("[data-e2e=account-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=auth-form-login]").waitFor()

      await signInPage()
      const last = page.locator("[data-e2e=last-sign-in]")
      await expect(last).toContainText(
        "Last time you signed in with your password (e***@example.com).",
      )
      await expect(last).not.toContainText(email)
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("push endpoints require auth", async ({ request }) => {
    const devices = await request.get(`${apiBase}/api/push/devices`)
    expect(devices.status()).toBe(401)

    const publicKey = await request.get(`${apiBase}/api/push/public-key`)
    expect(publicKey.status()).toBe(401)
  })
})
