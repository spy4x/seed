import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { openNotes } from "./fixtures/groups.ts"
import { payForGroup, signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * Undo of a delete made with no network. The app starts from the service worker's cache, so this
 * spec runs against the built SPA (`OFFLINE_SPECS` in `infra/scripts/e2e-local-plan.ts`).
 */

/** The sync line while changes wait or the device is offline; absent once everything is sent. */
const WAITING = "[data-e2e=offline-status] [data-sync-state]:not([data-sync-state=synced])"
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

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

test.describe("restoring deleted notes", () => {
  test("offline, a delete is queued and Undo takes it back from the queue, so it never reaches the server", async ({ browser, request }) => {
    test.setTimeout(90_000)
    const owner = "e2e_notes_restore_offline_owner@example.com"
    await cleanup(request, owner)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, owner)
      const page = await context.newPage()
      await signInOnline(page, owner)
      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Restore offline team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      await payForGroup(page.request, apiBase, groupId)
      const noteId = uuidV7()
      const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: noteId, title: "Trip", body: "passport" },
      })
      expect(note.status(), await note.text()).toBe(201)
      await openNotes(page, "Restore offline team")
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveText(["Trip"])

      // The service worker must hold the app before the page can start without a network.
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await page.reload()
      await expect(titles).toHaveText(["Trip"])
      await context.setOffline(true)
      await page.reload()
      await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")
      await expect(titles).toHaveText(["Trip"])
      await page.locator(`[data-e2e=note-${noteId}] [data-e2e=note-menu]`).click()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      await expect(titles).toHaveCount(0)
      await page.locator("[data-e2e=note-undo-toast]").getByRole("button", { name: "Undo" })
        .click()
      await expect(titles).toHaveText(["Trip"])
      // Offline, with nothing waiting: the taken-back delete left no queued write.
      await expect(page.locator(WAITING)).toHaveText("Offline")
      await context.setOffline(false)
      // The taken-back delete never reached the server.
      const server = await page.request.get(`${apiBase}/api/groups/${groupId}/notes`)
      expect((await server.json()).notes.map((n: { title: string }) => n.title)).toEqual(["Trip"])
    } finally {
      await context.close()
      await cleanup(request, owner)
    }
  })
})
