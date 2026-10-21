import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { openNotes } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/** The sync line while changes wait or the device is offline; absent once everything is sent. */
const WAITING = "[data-e2e=offline-status] [data-sync-state]:not([data-sync-state=synced])"
const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const VIEWER = 1

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

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

test.describe("restoring deleted notes", () => {
  test("a deleted note comes back with Undo or from Show deleted notes, and a viewer's tab follows", async ({ browser, request }) => {
    test.setTimeout(90_000)
    const owner = "e2e_notes_restore_owner@example.com"
    const member = "e2e_notes_restore_viewer@example.com"
    const baseURL = test.info().project.use.baseURL
    for (const email of [owner, member]) await cleanup(request, email)
    const ownerContext = await browser.newContext({ baseURL })
    const memberContext = await browser.newContext({ baseURL })
    try {
      for (const email of [owner, member]) await signUp(request, email)
      const ownerPage = await ownerContext.newPage()
      await signInOnline(ownerPage, owner)
      const groupId = uuidV7()
      const created = await ownerPage.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Restore team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: VIEWER },
      })
      expect(added.status(), await added.text()).toBe(200)
      const noteId = uuidV7()
      const note = await ownerPage.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: noteId, title: "Trip", body: "passport" },
      })
      expect(note.status(), await note.text()).toBe(201)

      const memberPage = await memberContext.newPage()
      await signInOnline(memberPage, member)
      await openNotes(memberPage, "Restore team")
      await openNotes(ownerPage, "Restore team")
      const ownerTitles = ownerPage.locator("[data-e2e=note-item-title]")
      const memberTitles = memberPage.locator("[data-e2e=note-item-title]")
      await expect(memberTitles).toHaveText(["Trip"])

      const deleteTrip = async () => {
        await ownerPage.locator(`[data-e2e=note-${noteId}] [data-e2e=note-menu]`).click()
        // A row's Delete needs no confirmation: Undo in the toast takes it back.
        await ownerPage.getByRole("menuitem", { name: "Delete" }).click()
        await expect(ownerTitles).toHaveCount(0)
        await expect(memberTitles).toHaveCount(0, { timeout: 5_000 })
      }

      // Delete, then Undo from the toast.
      await deleteTrip()
      const toast = ownerPage.locator("[data-e2e=note-undo-toast]")
      await expect(toast).toContainText(`"Trip" was deleted.`)
      await toast.getByRole("button", { name: "Undo" }).click()
      await expect(ownerTitles).toHaveText(["Trip"])
      await expect(memberTitles).toHaveText(["Trip"], { timeout: 5_000 })
      await expect(toast).toHaveCount(0)

      // Delete, then Show deleted notes and Restore.
      await deleteTrip()
      await ownerPage.locator("[data-e2e=notes-menu]").click()
      await ownerPage.getByRole("menuitem", { name: "Show deleted notes" }).click()
      await expect(ownerTitles).toHaveText(["Trip"])
      await expect(ownerPage.locator("[data-e2e=notes-deleted-banner]")).toContainText("30 days")

      // A viewer may look at the deleted notes but not restore them.
      await memberPage.locator("[data-e2e=notes-menu]").click()
      await memberPage.getByRole("menuitem", { name: "Show deleted notes" }).click()
      await expect(memberTitles).toHaveText(["Trip"])
      await expect(memberPage.locator("[data-e2e=note-restore]")).toHaveCount(0)

      await ownerPage.getByRole("button", { name: "Restore Trip" }).click()
      await expect(ownerPage.getByText("No deleted notes")).toBeVisible()
      await ownerPage.locator("[data-e2e=notes-show-live]").click()
      await expect(ownerTitles).toHaveText(["Trip"])
      // The viewer's deleted list follows: the note left it.
      await expect(memberPage.getByText("No deleted notes")).toBeVisible({ timeout: 5_000 })
      await memberPage.locator("[data-e2e=notes-show-live]").click()
      await expect(memberTitles).toHaveText(["Trip"])

      // Offline, the delete is queued, and Undo takes it back from the queue: no connection is needed.
      // The service worker must hold the app before the page can start without a network.
      await ownerPage.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await ownerPage.reload()
      await expect(ownerTitles).toHaveText(["Trip"])
      await ownerContext.setOffline(true)
      await ownerPage.reload()
      await expect(ownerPage.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")
      await expect(ownerTitles).toHaveText(["Trip"])
      await ownerPage.locator(`[data-e2e=note-${noteId}] [data-e2e=note-menu]`).click()
      await ownerPage.getByRole("menuitem", { name: "Delete" }).click()
      await expect(ownerTitles).toHaveCount(0)
      await ownerPage.locator("[data-e2e=note-undo-toast]").getByRole("button", {
        name: "Undo",
      }).click()
      await expect(ownerTitles).toHaveText(["Trip"])
      // Offline, with nothing waiting: the taken-back delete left no queued write.
      await expect(ownerPage.locator(WAITING)).toHaveText("Offline")
      await ownerContext.setOffline(false)
      // The taken-back delete never reached the server.
      const server = await ownerPage.request.get(`${apiBase}/api/groups/${groupId}/notes`)
      expect((await server.json()).notes.map((n: { title: string }) => n.title)).toEqual(["Trip"])
    } finally {
      await ownerContext.close()
      await memberContext.close()
      for (const email of [owner, member]) await cleanup(request, email)
    }
  })
})
