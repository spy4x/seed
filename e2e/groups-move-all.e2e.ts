import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { groupLink, openNotes } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

const VIEWER = 1

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

async function signInOnline(page: Page, email: string) {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

test.describe("moving all of a group's data", () => {
  test("moves every note to a group the person can edit, offers no group they only read, shows it live to the target's members, then deletes the emptied group", async ({ browser, request }) => {
    const id = uuidV7().slice(-8)
    const owner = `e2e-move-all-owner-${id}@example.com`
    const watcher = `e2e-move-all-watcher-${id}@example.com`
    const stranger = `e2e-move-all-stranger-${id}@example.com`
    const emails = [owner, watcher, stranger]
    for (const email of emails) await cleanup(request, email)
    const baseURL = test.info().project.use.baseURL
    const contexts = await Promise.all(emails.map(() => browser.newContext({ baseURL })))
    try {
      for (const email of emails) await signUp(request, email)
      const [ownerPage, watcherPage, strangerPage] = await Promise.all(
        contexts.map((context) => context.newPage()),
      )
      await signInOnline(ownerPage, owner)
      await signInOnline(strangerPage, stranger)

      const groups = { Source: uuidV7(), Target: uuidV7() }
      for (const [name, groupId] of Object.entries(groups)) {
        const created = await ownerPage.request.post(`${apiBase}/api/groups`, {
          headers,
          data: { id: groupId, name },
        })
        expect(created.status(), await created.text()).toBe(201)
      }
      // A group the owner can only read: it must not be offered.
      const readOnly = uuidV7()
      const made = await strangerPage.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: readOnly, name: "Read only" },
      })
      expect(made.status(), await made.text()).toBe(201)
      for (const [login, groupId] of [[owner, readOnly], [watcher, groups.Target]]) {
        const added = await request.post(`${apiBase}/api/test/add-member`, {
          data: { login, groupId, role: VIEWER },
        })
        expect(added.status(), await added.text()).toBe(200)
      }
      for (const title of ["One", "Two", "Three"]) {
        const note = await ownerPage.request.post(
          `${apiBase}/api/groups/${groups.Source}/notes`,
          { headers, data: { id: uuidV7(), title, body: "" } },
        )
        expect(note.status(), await note.text()).toBe(201)
      }

      await signInOnline(watcherPage, watcher)
      await openNotes(watcherPage, "Target")
      await expect(watcherPage.getByText("No notes yet")).toBeVisible()

      await gotoApp(
        ownerPage,
        `/groups/${groups.Source}`,
        ownerPage.locator("[data-e2e=group-general-name]"),
      )
      await ownerPage.getByRole("button", { name: "More actions" }).click()
      await ownerPage.getByRole("menuitem", { name: "Move all data…" }).click()
      const dialog = ownerPage.locator("[data-e2e=group-move-all-dialog]")
      // Only groups the person may edit, and never the group itself.
      const options = dialog.locator("[data-e2e=group-move-all-to] option")
      expect((await options.allTextContents()).sort()).toEqual(["Personal", "Target"])
      await dialog.locator("[data-e2e=group-move-all-to]").selectOption({ label: "Target" })
      await dialog.locator("[data-e2e=group-move-all-submit]").click()
      await expect(dialog.locator("[data-e2e=group-move-all-done]")).toContainText(
        `Moved 3 notes from "Source" to "Target".`,
      )
      await expect(watcherPage.locator("[data-e2e=note-item-title]")).toHaveCount(3, {
        timeout: 5_000,
      })

      // The emptied group can be deleted from the same dialog.
      await dialog.locator("[data-e2e=group-move-all-delete]").click()
      const confirm = ownerPage.locator("[data-e2e=group-delete-dialog]")
      await expect(confirm).toContainText(`Delete "Source"?`)
      await confirm.getByRole("button", { name: "Delete group", exact: true }).click()
      await expect(ownerPage).toHaveURL(/\/groups$/)
      await expect(groupLink(ownerPage, "Personal")).toBeVisible()
      await expect(groupLink(ownerPage, "Source")).toHaveCount(0)
      await expect(watcherPage.locator("[data-e2e=note-item-title]")).toHaveCount(3)

      // The audit trail of the target says who moved the data in.
      await gotoApp(
        ownerPage,
        `/groups/${groups.Target}/activity`,
        ownerPage.locator("[data-e2e=activity-list]"),
      )
      await expect(ownerPage.locator("[data-e2e=activity-list]")).toContainText(
        "moved all of another group's data (3 items) here",
      )
    } finally {
      for (const context of contexts) await context.close()
      for (const email of emails) await cleanup(request, email, { soft: true })
    }
  })
})
