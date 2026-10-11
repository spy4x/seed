import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }

test.describe("group list and settings pages", () => {
  test("creates a group, opens its settings and reads its name and the person's role there", async ({ page, request }) => {
    const email = "e2e_groups_pages_user@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Groups" }).click()
      await expect(page.getByRole("heading", { level: 1, name: "Groups" })).toBeVisible()
      await expect(page.locator("[data-e2e=group-item-name]")).toHaveCount(1)

      await page.getByRole("button", { name: "New group" }).click()
      const dialog = page.getByRole("dialog", { name: "New group" })
      await dialog.getByLabel("Name").fill("Trip")
      await dialog.getByRole("button", { name: "Create group" }).click()
      await expect(dialog).toBeHidden()
      await expect(page.locator("[data-e2e=group-item-name]").filter({ hasText: "Trip" }))
        .toHaveCount(1)

      await page.getByRole("link", { name: "Settings of Trip" }).click()
      await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Trip")
      await expect(page.locator("[data-e2e=group-general-name]")).toHaveText("Trip")
      await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Owner")

      await page.getByRole("link", { name: "Back to groups" }).click()
      await expect(page).toHaveURL("/groups")
      await page.getByRole("button", { name: "Open notes in Trip" }).click()
      await expect(page).toHaveURL("/notes")
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("neither page scrolls sideways at 375 px", async ({ page, request }) => {
    const email = "e2e_groups_pages_narrow@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      // Signed in at the default width: below 640 px the connection status that `signIn` waits for
      // is hidden.
      await signIn(page, email, password)
      await page.setViewportSize({ width: 375, height: 812 })
      const longName = "A group with a very long name that must wrap and never push the page wider"
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: uuidV7(), name: longName },
      })
      expect(created.status(), await created.text()).toBe(201)

      const overflow = () =>
        page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth
        )
      const heading = page.getByRole("heading", { level: 1, name: "Groups" })
      await gotoApp(page, "/groups", heading)
      await expect(heading).toBeVisible()
      await expect(page.locator("[data-e2e=group-item-name]").filter({ hasText: "A group" }))
        .toBeVisible()
      expect(await overflow()).toBeLessThanOrEqual(0)

      await page.getByRole("link", { name: `Settings of ${longName}` }).click()
      await expect(page.getByRole("heading", { level: 2, name: /^Members/ })).toBeVisible()
      expect(await overflow()).toBeLessThanOrEqual(0)
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("renames a group, deletes it with its confirmation and restores it from the Groups page", async ({ page, request }) => {
    const email = "e2e_groups_lifecycle@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await gotoApp(page, "/groups", page.getByRole("heading", { level: 1, name: "Groups" }))
      await page.getByRole("button", { name: "New group" }).click()
      await page.getByRole("dialog", { name: "New group" }).getByLabel("Name").fill("Trip")
      await page.getByRole("button", { name: "Create group" }).click()
      await page.getByRole("link", { name: "Settings of Trip" }).click()

      await page.getByRole("button", { name: "Rename Trip" }).click()
      await page.getByLabel("New name").fill("Trip 2027")
      await page.getByLabel("New name").press("Enter")
      await expect(page.locator("[data-e2e=group-general-name]")).toHaveText("Trip 2027")

      await page.getByRole("button", { name: "More actions" }).click()
      await page.getByRole("menuitem", { name: "Delete group" }).click()
      const dialog = page.locator("[data-e2e=group-delete-dialog]")
      await expect(dialog.locator("[data-e2e=group-delete-confirmation]"))
        .toContainText("You can restore it from the Groups page for 30 days")
      await dialog.getByRole("button", { name: "Delete group" }).click()
      await expect(page).toHaveURL("/groups")
      await expect(page.locator("[data-e2e=group-item-name]")).toHaveText(["Personal"])
      await expect(page.locator("[data-e2e=deleted-group-name]")).toHaveText(["Trip 2027"])

      await page.getByRole("button", { name: "Restore Trip 2027" }).click()
      await expect(page.locator("[data-e2e=group-item-name]").filter({ hasText: "Trip 2027" }))
        .toHaveCount(1)
      await expect(page.locator("[data-e2e=deleted-group-list]")).toHaveCount(0)
    } finally {
      await cleanup({ soft: true })
    }
  })

  test("the last group cannot be deleted: the menu item is disabled and says why", async ({ page, request }) => {
    const email = "e2e_groups_last@example.com"
    const password = "Passw0rd!"
    const cleanup = async ({ soft = false } = {}) => {
      const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
        data: { login: email },
      })
      ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
    }

    await cleanup()
    try {
      const signUp = await request.post(`${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok()).toBe(true)
      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await gotoApp(page, "/groups", page.getByRole("heading", { level: 1, name: "Groups" }))
      await page.getByRole("link", { name: "Settings of Personal" }).click()
      await page.getByRole("button", { name: "More actions" }).click()
      await expect(page.locator("[data-e2e=group-delete-open]")).toBeDisabled()
      await expect(page.locator("[data-e2e=group-delete-why]")).toHaveText("It is your only group")

      const groups = await page.request.get(`${apiBase}/api/groups`)
      const [only] = (await groups.json()).groups
      const refused = await page.request.delete(`${apiBase}/api/groups/${only.id}`, { headers })
      expect(refused.status()).toBe(409)
    } finally {
      await cleanup({ soft: true })
    }
  })
})
