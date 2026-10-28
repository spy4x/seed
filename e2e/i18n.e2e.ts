import type { BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The interface language (#216): a browser's languages pick the first frame's language, a choice
 * kept on the device before sign-up becomes the account's, the account's language follows the
 * person to a new device and into the admin app, and an operator sees it on the person's screen.
 * The preferences' Language row and the operator's menu switch the page at once.
 * The screens' own switching at once is covered by `libs/ui/i18n.test.tsx`.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

test.describe("the interface language", () => {
  test("a browser that prefers Russian or Arabic gets the sign-in page in it", async ({ browser }) => {
    const russian = await browser.newContext({ locale: "ru-RU" })
    const arabic = await browser.newContext({ locale: "ar-EG" })
    try {
      const page = await russian.newPage()
      await page.goto(`${appBase}/sign-in`)
      await expect(page.locator("[data-e2e=auth-form-submit]")).toHaveText("Войти")
      await expect(page.locator("html")).toHaveAttribute("lang", "ru")
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr")

      const rtl = await arabic.newPage()
      await rtl.goto(`${appBase}/sign-in`)
      await expect(rtl.locator("html")).toHaveAttribute("lang", "ar")
      await expect(rtl.locator("html")).toHaveAttribute("dir", "rtl")
    } finally {
      await russian.close()
      await arabic.close()
    }
  })

  test("a language chosen on the device before sign-in is the account's, on every device and in the admin app", async ({ browser, request }) => {
    test.setTimeout(90_000)
    const email = `e2e-language-${uuidV7().slice(-8)}@example.com`
    const devices: BrowserContext[] = []
    try {
      const signUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok(), await signUp.text()).toBe(true)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: email, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      // An English browser whose person picked German on this device before signing in.
      const laptop = await browser.newContext({ locale: "en-GB" })
      devices.push(laptop)
      await laptop.addInitScript(() => localStorage.setItem("language", "de"))
      const page = await laptop.newPage()
      await signIn(page, email, password)
      await expect(page.locator("html")).toHaveAttribute("lang", "de")
      await expect(page.getByRole("link", { name: "Notizen" }).first()).toBeVisible()

      // A new English device follows the account's language once it signs in.
      const phone = await browser.newContext({ locale: "en-GB" })
      devices.push(phone)
      const other = await phone.newPage()
      await signIn(other, email, password)
      await expect(other.locator("html")).toHaveAttribute("lang", "de")
      await expect(other.getByRole("link", { name: "Notizen" }).first()).toBeVisible()

      // The admin app speaks the operator's language, and shows the person's on their screen.
      const admin = await browser.newContext({ locale: "en-GB" })
      devices.push(admin)
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(email)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops).toHaveURL(`${adminBase}/`)
      await expect(ops.locator("html")).toHaveAttribute("lang", "de")
      await ops.goto(`${adminBase}/users?q=${encodeURIComponent(email)}`)
      const row = ops.locator("[data-e2e=admin-users-list] tbody tr")
      await expect(row).toHaveCount(1)
      await row.getByRole("link").first().click()
      await expect(ops.locator("[data-e2e=admin-user-preferences-language]")).toContainText(
        "Deutsch",
      )
      await expect(ops.locator("[data-e2e=admin-user-preferences-formats]")).toContainText(
        "registriert mit",
      )

      // Choosing Arabic in the preferences switches the page at once, right to left, unreloaded.
      await page.goto(`${appBase}/profile/region`)
      await page.locator("html").evaluate((html) => html.setAttribute("data-unreloaded", "yes"))
      await page.locator("[data-e2e=preferences-language-change]").click()
      const dialog = page.locator("[data-e2e=language-dialog]")
      await dialog.getByRole("radio", { name: "العربية", exact: true }).click()
      await expect(page.locator("html")).toHaveAttribute("lang", "ar")
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl")
      await expect(page.locator("html")).toHaveAttribute("data-unreloaded", "yes")
      await expect(page.locator("[data-e2e=preferences-language-name]")).toHaveText("العربية")
      await dialog.locator("[data-e2e=language-dialog-done]").click()
      await expect(dialog).toBeHidden()

      // The operator's own menu sets the admin app's language on this device, over the account's.
      await ops.locator("[data-e2e=rail-shell-bottom] [data-e2e=account-menu-button]").click()
      await ops.locator("[data-e2e=account-menu-language]").click()
      await ops.locator("[data-e2e=language-dialog]").getByRole("radio", {
        name: "Español",
        exact: true,
      }).click()
      await expect(ops.locator("html")).toHaveAttribute("lang", "es")
    } finally {
      for (const device of devices) await device.close()
      const response = await request.post(`${appBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      expect.soft(response.status(), await response.text()).toBe(200)
    }
  })
})
