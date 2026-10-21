import { type APIRequestContext, type Browser, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"
import { openGroupTab } from "./fixtures/groups.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const VIEWER = 1
const EDITOR = 2
const ADMIN = 3

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** A signed-in page in its own browser context, so several people use the app side by side. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  return page
}

test.describe("group activity", () => {
  test("an admin reads what happened and follows a note; an editor and a viewer are refused", async ({ page, browser, request }) => {
    // Four people sign in, and two of them open two pages each: past the default 30 s on a dev server.
    test.setTimeout(60_000)
    const owner = "e2e_activity_owner@example.com"
    const admin = "e2e_activity_admin@example.com"
    const editor = "e2e_activity_editor@example.com"
    const viewer = "e2e_activity_viewer@example.com"
    const people = [owner, admin, editor, viewer]
    for (const email of people) await cleanup(request, email)
    const extra: Page[] = []
    try {
      for (const email of people) await signUp(request, email)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      for (const [login, role] of [[admin, ADMIN], [editor, EDITOR], [viewer, VIEWER]] as const) {
        const added = await request.post(`${apiBase}/api/test/add-member`, {
          data: { login, groupId, role },
        })
        expect(added.status(), await added.text()).toBe(200)
      }
      const renamed = await page.request.patch(`${apiBase}/api/groups/${groupId}`, {
        headers,
        data: { name: "Crew" },
      })
      expect(renamed.status(), await renamed.text()).toBe(200)
      const noteId = uuidV7()
      const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: noteId, title: "Plan", body: "" },
      })
      expect(note.status(), await note.text()).toBe(201)

      // The owner reaches the log from the group page's Activity tab.
      await gotoApp(page, `/groups/${groupId}`, page.locator("[data-e2e=group-general-name]"))
      await openGroupTab(page, "Activity")
      const list = page.locator("[data-e2e=activity-list]")
      await expect(list).toContainText("renamed the group from “Team” to “Crew”")
      await expect(list).toContainText("added the note “Plan”")
      await page.locator("[data-e2e=activity-note-link]").first().click()
      await expect(page).toHaveURL(new RegExp(`/notes/${noteId}$`))

      // An admin reads the same log.
      const adminPage = await personPage(browser, admin)
      extra.push(adminPage)
      await gotoApp(
        adminPage,
        `/groups/${groupId}/activity`,
        adminPage.locator("[data-e2e=activity-list]"),
      )
      await expect(adminPage.locator("[data-e2e=activity-list]")).toContainText(
        "added the note “Plan”",
      )

      // An editor and a viewer get a refusal on the page, and 403 from the API.
      for (const email of [editor, viewer]) {
        const other = await personPage(browser, email)
        extra.push(other)
        await gotoApp(
          other,
          `/groups/${groupId}/activity`,
          other.locator("[data-e2e=activity-forbidden]"),
        )
        await expect(other.locator("[data-e2e=activity-list]")).toHaveCount(0)
        const refused = await other.request.get(`${apiBase}/api/groups/${groupId}/activity`)
        expect(refused.status()).toBe(403)
        await gotoApp(other, `/groups/${groupId}`, other.locator("[data-e2e=group-general-name]"))
        await expect(other.getByRole("tab", { name: "Activity" })).toHaveCount(0)
      }
    } finally {
      for (const other of extra) await other.context().close()
      for (const email of people) await cleanup(request, email)
    }
  })
})
