import { type APIRequestContext, type Page } from "@playwright/test"
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

const settingsReady = (page: Page) => page.locator("[data-e2e=group-general-name]")

test.describe("group ownership transfer", () => {
  test("the owner hands the group to a member after a wrong password is refused, and stays as an admin", async ({ page, browser, request }) => {
    const id = uuidV7().slice(-8)
    const owner = `e2e-transfer-owner-${id}@example.com`
    const member = `e2e-transfer-member-${id}@example.com`
    for (const email of [owner, member]) await cleanup(request, email)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      const groupId = uuidV7()
      const created = await request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      await signUp(request, member)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: 2 },
      })
      expect(added.status(), await added.text()).toBe(200)

      await signIn(page, owner, password)
      await gotoApp(page, `/groups/${groupId}`, settingsReady(page))
      await page.getByRole("button", { name: "More actions" }).click()
      await page.getByRole("menuitem", { name: "Transfer ownership" }).click()
      const section = page.getByRole("dialog", { name: 'Transfer "Team"' })
      await expect(section.locator("[data-e2e=group-transfer-member]")).toHaveValue(/\d+/)
      await section.locator("[data-e2e=group-transfer-name]").fill("Team")
      await section.locator("[data-e2e=group-transfer-password]").fill("wrong-password")
      await section.locator("[data-e2e=group-transfer]").click()
      await expect(section).toContainText("The password is incorrect")
      await expect(section.locator("[data-e2e=group-transfer-password]")).toBeFocused()
      await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Owner")

      await section.locator("[data-e2e=group-transfer-password]").fill(password)
      await section.locator("[data-e2e=group-transfer]").click()
      await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Admin")
      await expect(section).toHaveCount(0)

      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      memberPage = await context.newPage()
      await signIn(memberPage, member, password)
      await gotoApp(memberPage, `/groups/${groupId}`, settingsReady(memberPage))
      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Owner")
      await memberPage.getByRole("button", { name: "More actions" }).click()
      await expect(memberPage.getByRole("menuitem", { name: "Transfer ownership" })).toBeVisible()
    } finally {
      await memberPage?.context().close()
      for (const email of [owner, member]) await cleanup(request, email, { soft: true })
    }
  })
})
