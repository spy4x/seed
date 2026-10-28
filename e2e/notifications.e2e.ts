import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const EDITOR = 2
const VIEWER = 1

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

/** The rail's Notifications cell; the phone sheet holds a second link to the same page. */
const bell = (page: Page) => page.locator(`[data-e2e=rail-shell-bottom] a[href="/notifications"]`)
const bellCount = (page: Page) =>
  page.locator("[data-e2e=rail-shell-bottom] [data-e2e=rail-shell-counter]")

test.describe("notifications inbox", () => {
  test("the bell counts a role change and a removal live, the page lists them, and only their owner can read them", async ({ page, browser, request }) => {
    const id = uuidV7().slice(-8)
    const owner = `e2e-inbox-owner-${id}@example.com`
    const member = `e2e-inbox-member-${id}@example.com`
    for (const email of [owner, member]) await cleanup(request, email)
    const ownerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    const ownerApi = ownerContext.request
    try {
      await signUp(ownerApi, owner)
      const groupId = uuidV7()
      const created = await ownerApi.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      await signUp(request, member)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: EDITOR },
      })
      expect(added.status(), await added.text()).toBe(200)
      const members = await (await ownerApi.get(`${apiBase}/api/groups/${groupId}/members`)).json()
      const memberId: number = members.members.find((m: { email?: string }) =>
        m.email === member
      ).userId

      await signIn(page, member, password)
      await expect(bell(page)).toHaveAccessibleName("Notifications")
      await expect(bellCount(page)).toHaveCount(0)

      // Another person's action reaches this open page without a reload.
      const changed = await ownerApi.patch(`${apiBase}/api/groups/${groupId}/members/${memberId}`, {
        headers,
        data: { role: VIEWER },
      })
      expect(changed.status(), await changed.text()).toBe(200)
      await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread")
      await expect(bellCount(page)).toHaveText("1")

      const removed = await ownerApi.delete(
        `${apiBase}/api/groups/${groupId}/members/${memberId}`,
        {
          headers,
        },
      )
      expect(removed.status(), await removed.text()).toBe(200)
      await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread")

      await bell(page).click()
      await expect(page).toHaveURL(/\/notifications$/)
      const list = page.locator("[data-e2e=notifications-list]")
      await expect(list.locator("li")).toHaveCount(2)
      await expect(list.locator("li").nth(0)).toContainText("You were removed from “Team”.")
      await expect(list.locator("li").nth(1)).toContainText("Your role in “Team” is now a viewer.")
      await expect(list.locator("li").nth(0)).toContainText("Unread:")

      // Another person cannot mark it, and cannot tell it exists.
      const mine = await (await page.request.get(`${apiBase}/api/notifications`)).json()
      const theirs = await ownerApi.post(
        `${apiBase}/api/notifications/${mine.notifications[0].id}/read`,
        { headers },
      )
      const nowhere = await ownerApi.post(`${apiBase}/api/notifications/999999999/read`, {
        headers,
      })
      expect(theirs.status()).toBe(404)
      const refusal = async (response: typeof theirs) => {
        // Everything but the request's own id.
        const { code, reason, message } = (await response.json()).error
        return { code, reason, message }
      }
      expect(await refusal(theirs)).toEqual(await refusal(nowhere))
      await expect(bell(page)).toHaveAccessibleName("Notifications, 2 unread")

      // Following a notification's link marks that one read.
      await list.locator("li").nth(0).locator("[data-e2e=notification-link]").click()
      await expect(page).toHaveURL(/\/groups$/)
      await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread")

      await page.reload()
      await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread")
      await bell(page).click()
      await expect(page.locator("[data-e2e=notifications-unread]")).toHaveText("1 unread")
      await page.locator("[data-e2e=notifications-read-all]").click()
      await expect(bell(page)).toHaveAccessibleName("Notifications")
      await expect(bellCount(page)).toHaveCount(0)
      await expect(page.locator("[data-e2e=notifications-read-all]")).toHaveCount(0)
      await expect(list.locator("li[data-unread=true]")).toHaveCount(0)

      // The owner made both changes and was told nothing.
      const ownerInbox = await (await ownerApi.get(`${apiBase}/api/notifications`)).json()
      expect(ownerInbox.notifications).toEqual([])
    } finally {
      await ownerContext.close()
      for (const email of [owner, member]) await cleanup(request, email, { soft: true })
    }
  })

  test("a person with no notifications sees an empty inbox and a bell without a badge", async ({ page, request }) => {
    const email = `e2e-inbox-empty-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      await signUp(request, email)
      await signIn(page, email, password)
      await bell(page).click()
      await expect(page).toHaveURL(/\/notifications$/)
      await expect(page.getByText("You are all caught up.")).toBeVisible()
      await expect(bellCount(page)).toHaveCount(0)
    } finally {
      await cleanup(request, email, { soft: true })
    }
  })
})
