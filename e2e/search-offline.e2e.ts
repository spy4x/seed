import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/**
 * The search with no network. The app starts from the service worker's cache, so this spec runs
 * against the built SPA (`OFFLINE_SPECS` in `infra/scripts/e2e-local-plan.ts`).
 */

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/**
 * Selects a new group with one note, opens its notes, and makes sure the device holds what an
 * offline start needs: the app in the service worker's cache, and the group's notes.
 */
async function groupOnDevice(page: Page, name: string, title: string, body: string) {
  const groupId = uuidV7()
  const group = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name },
  })
  expect(group.status(), await group.text()).toBe(201)
  const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: uuidV7(), title, body },
  })
  expect(note.status(), await note.text()).toBe(201)
  const selected = await page.request.put(`${apiBase}/api/groups/selected`, {
    headers,
    data: { groupId },
  })
  expect(selected.ok(), await selected.text()).toBe(true)
  await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  // One more load under the worker's control, so everything the page needs is cached.
  await gotoApp(page, page.url(), page.locator("[data-e2e=note-list]"))
  await expect(page.locator("[data-e2e=note-item-title]").filter({ hasText: title })).toHaveCount(1)
}

test.describe("search with no network", () => {
  // Signs up, loads the app twice so the service worker holds it, and starts it again offline.
  test.describe.configure({ timeout: 60_000 })

  test("searches the notes on this device and says so", async ({ browser, request }) => {
    const user = "e2e_search_offline@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user, password)
      await groupOnDevice(page, "Field trip", "Packing list", "Rain jacket")

      await context.setOffline(true)
      await page.reload()
      await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")

      const palette = page.locator("[data-e2e=search]")
      const field = palette.getByRole("combobox")
      await page.locator("[data-e2e=shell-search-rail] button").click()
      await field.fill("jacket")
      await expect(palette.getByRole("group").first()).toContainText("Notes on this device")
      await expect(palette.getByRole("option").filter({ hasText: "Packing list" })).toBeVisible()

      await field.fill("snorkel")
      await expect(palette.getByRole("status")).toHaveText(
        "Nothing on this device matches “snorkel”. Search again when you are back online.",
      )
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})
