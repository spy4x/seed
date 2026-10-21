import { type APIRequestContext, type Browser, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** Removes `email`'s account; `soft` only records a failure, for the `finally` of a test. */
async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** A signed-in page in its own browser context, so two people use the app side by side. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  return page
}

const settingsReady = (page: Page) => page.locator("[data-e2e=group-general-name]")

test.describe("group details", () => {
  test("the owner edits the details on the group's page, the other member's open page shows them without a reload, and a viewer reads them only", async ({ page, browser, request }) => {
    const owner = "e2e_details_owner@example.com"
    const member = "e2e_details_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Flat" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: 1 },
      })
      expect(added.status(), await added.text()).toBe(200)

      memberPage = await personPage(browser, member)
      await gotoApp(memberPage, `/groups/${groupId}`, settingsReady(memberPage))
      await expect(memberPage.locator("[data-e2e=page-header] [data-e2e=group-mark]")).toHaveCount(
        0,
      )
      // A viewer reads the group's details as text, with no field and no Save.
      await expect(memberPage.locator("[data-e2e=group-read-only]")).toBeVisible()
      await expect(memberPage.locator("[data-e2e=group-name]")).toHaveCount(0)
      await expect(memberPage.locator("[data-e2e=group-save]")).toHaveCount(0)
      // Count the documents the member's page loads, so a reload fails the test.
      let loads = 0
      memberPage.on("load", () => loads++)

      await gotoApp(page, `/groups/${groupId}`, settingsReady(page))
      // The form saves nothing until something changed: no footer yet.
      await expect(page.locator("[data-e2e=group-save]")).toHaveCount(0)
      await page.locator("[data-e2e=group-description]").fill("Rent, bills and the shopping list")
      await page.locator("[data-e2e=group-color]").getByTitle("Purple", { exact: true }).click()
      await page.locator("[data-e2e=group-emoji]").fill("🏠🏕️")
      await page.locator("[data-e2e=group-save]").click()
      await expect(page.getByText("Use a single emoji")).toBeVisible()
      await expect(page.locator("[data-e2e=group-emoji]")).toBeFocused()
      await page.locator("[data-e2e=group-emoji]").fill("🏠")
      await page.locator("[data-e2e=group-save]").click()
      await expect(page.locator("[data-e2e=group-saved]")).toContainText("Flat")
      await expect(page.locator("[data-e2e=group-save]")).toHaveCount(0)

      await expect(page.locator("[data-e2e=group-description]"))
        .toHaveValue("Rent, bills and the shopping list")
      const mark = page.locator("[data-e2e=page-header] [data-e2e=group-mark]")
      await expect(mark).toHaveText("🏠")
      await expect(mark).toHaveAttribute("data-color", "#7e22ce")

      // Only the worker's announcement, turned into a hint on the socket, can bring it here.
      await expect(memberPage.locator("[data-e2e=group-general-description]"))
        .toHaveText("Rent, bills and the shopping list", { timeout: 3_000 })
      await expect(memberPage.locator("[data-e2e=page-header] [data-e2e=group-mark]")).toHaveText(
        "🏠",
      )
      expect(loads).toBe(0)

      // The list and the picker show the same mark.
      await gotoApp(page, "/groups", page.locator("[data-e2e=group-item-name]").first())
      await expect(page.locator(`[data-e2e=group-${groupId}] [data-e2e=group-mark]`))
        .toHaveText("🏠")
      await expect(page.locator(`[data-e2e=group-${groupId}] [data-e2e=group-item-description]`))
        .toContainText("Rent, bills")
      await page.locator("[data-e2e=group-picker]").click()
      await expect(
        page.getByRole("menuitemradio", { name: /Flat/ }).locator("[data-e2e=group-mark]"),
      ).toHaveText("🏠")

      // The same edit, made through the API by a viewer, is refused.
      const refused = await memberPage.request.put(`${apiBase}/api/groups/${groupId}/details`, {
        headers: { ...headers, "idempotency-key": uuidV7() },
        data: { description: "Mine", color: "#b91c1c", emoji: null },
      })
      expect(refused.status()).toBe(403)
    } finally {
      await memberPage?.context().close()
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })
})
