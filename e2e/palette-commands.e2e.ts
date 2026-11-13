/**
 * The palette's commands in a real browser: the Theme submenu applies a theme with the palette
 * still open, and the palette's look on a phone and a desktop in both palettes, photographed into
 * the test's output folder for the design review.
 */
import { type APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

test.describe("the palette's commands", () => {
  test("Enter on Theme, then on Dark, turns the page dark and leaves the palette open on the submenu", async ({ page, request }) => {
    test.setTimeout(180_000)
    const user = "e2e_palette_commands@example.com"
    await cleanup(request, user)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
    try {
      const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email: user, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      await signIn(page, user, password)
      const palette = page.locator("[data-e2e=search]")
      const field = palette.getByRole("combobox")
      const html = page.locator("html")

      for (const width of [390, 1440]) {
        for (const scheme of ["light", "dark"] as const) {
          const view = `${width} px, ${scheme}`
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ colorScheme: scheme })
          await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
          await page.keyboard.press("Control+k")
          await expect(field, view).toBeFocused()
          await page.screenshot({ path: test.info().outputPath(`palette-${scheme}-${width}.png`) })
          await field.fill("тема")
          await expect(palette.getByRole("option").first(), view).toContainText("Theme")
          await page.screenshot({ path: test.info().outputPath(`theme-${scheme}-${width}.png`) })
          await page.keyboard.press("Escape")
          await expect(palette, view).toBeHidden()
        }
      }

      await page.emulateMedia({ colorScheme: "light" })
      await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
      await page.keyboard.press("Control+k")
      await expect(field).toBeFocused()
      await field.fill("dark")
      await page.keyboard.press("Enter")
      await expect(palette.getByRole("option", { name: /Dark/ })).toBeVisible()
      await expect(html).not.toHaveClass(/\bdark\b/)
      await field.fill("dark")
      await page.keyboard.press("Enter")

      await expect(html).toHaveClass(/\bdark\b/)
      await expect(palette).toBeVisible()
      await expect(palette.getByRole("option", { name: /Dark/ })).toContainText("Current")
      await page.screenshot({ path: test.info().outputPath(`dark-picked-1440.png`) })
      expect(errors).toEqual([])
    } finally {
      if (errors.length) console.log(errors.join(`\n---\n`))
      await cleanup(request, user)
    }
  })
})
