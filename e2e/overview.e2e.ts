import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The group overview (#219): the rail's first link opens the selected group's overview, a widget
 * hidden from its card's menu stays hidden after a reload (the layout is kept in the person's
 * preferences on the server), and "Reset layout" brings it back. A group the person is not in
 * reads as one that does not exist.
 */

const appBase = "http://app.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

test.describe("group overview", () => {
  test("a widget hidden from its menu stays hidden after a reload, and Reset layout shows it again", async ({ page, request }) => {
    test.setTimeout(90_000)
    const email = `e2e-overview-${uuidV7().slice(-8)}@example.com`
    const cleanup = async () => {
      const response = await request.post(`${appBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      expect.soft(response.status(), await response.text()).toBe(200)
    }
    try {
      const signUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok(), await signUp.text()).toBe(true)
      await signIn(page, email, password)

      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Overview" }).click()
      await expect(page).toHaveURL(/\/overview\/[0-9a-f-]{36}$/)
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
      const added = page.locator(`[data-e2e="overview-widget-notes.added"]`)
      await expect(added).toBeVisible()
      await expect(page.locator(`[data-e2e="overview-widget-notes.total"]`)).toBeVisible()

      await page.getByRole("button", { name: "Actions for Notes added" }).click()
      await page.getByRole("menuitem", { name: "Hide widget" }).click()
      await expect(page.getByText("Notes added hidden.")).toBeVisible()
      await expect(added).toHaveCount(0)

      await page.reload()
      await expect(page.locator(`[data-e2e="overview-widget-notes.total"]`)).toBeVisible()
      await expect(added).toHaveCount(0)

      await page.locator("[data-e2e=overview-menu]").click()
      await page.getByRole("menuitem", { name: "Reset layout" }).click()
      await expect(added).toBeVisible()
      await page.reload()
      await expect(added).toBeVisible()

      await page.goto(`/overview/${uuidV7()}`)
      await expect(page.getByText("This group does not exist.")).toBeVisible()
    } finally {
      await cleanup()
    }
  })
})
