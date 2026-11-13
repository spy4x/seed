import { type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import {
  cleanup,
  NotesTags,
  password,
  selectedGroup,
  serverNotes,
  serverTags,
  signUp,
  TagsPage,
} from "./fixtures/tags.ts"

/**
 * Tags made with no network. The app starts from the service worker's cache, so this spec runs
 * against the built SPA (`OFFLINE_SPECS` in `infra/scripts/e2e-local-plan.ts`).
 */

/** The sync line while changes wait or the device is offline; absent once everything is sent. */
const WAITING = "[data-e2e=offline-status] [data-sync-state]:not([data-sync-state=synced])"

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

test.describe("tags", () => {
  test.describe.configure({ timeout: 90_000 })

  test("a tag made and renamed with no network, and a note that names it, reach the server in order and show in a second browser", async ({ browser, request }) => {
    const user = "e2e_tags_offline@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signInOnline(page, user)
      const groupId = await selectedGroup(page, "Offline tag team")
      // The group was selected through the API, so wait until the page has read it from the
      // server: a navigation that cuts that read short leaves the device on the group it knew
      // before, and the offline writes below would go there.
      const group = page.locator("[data-e2e=notes-group]")
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await expect(group).toHaveText("Offline tag team")
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
      await expect(group).toHaveText("Offline tag team")

      await context.setOffline(true)
      await page.reload()
      await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")
      await expect(group).toHaveText("Offline tag team")

      const tags = new TagsPage(page)
      const notes = new NotesTags(page)
      await tags.openFromNotes()
      await tags.create("Errnds")
      await tags.rename("Errnds", "Errands", "Green")
      await tags.toNotes()
      await notes.create("Buy stamps", ["Errands"])
      await expect(notes.labels("Buy stamps")).toHaveText(["Errands"])
      await expect(page.locator(WAITING)).toHaveCount(1)

      await context.setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 20_000,
      })
      await expect(page.locator(WAITING)).toHaveCount(0)

      // The note could only name the tag because the tag reached the server first.
      await expect.poll(async () => (await serverTags(page, groupId)).map((t) => t.name))
        .toEqual(["Errands"])
      const [tag] = await serverTags(page, groupId)
      expect(tag.color).toBe("#15803d")
      await expect.poll(async () => (await serverNotes(page, groupId)).map((n) => n.tagIds))
        .toEqual([[tag.id]])

      // A second browser of the same person sees both.
      const second = await other.newPage()
      await signInOnline(second, user)
      await gotoApp(second, "/notes", second.locator("[data-e2e=note-list]"))
      await expect(new NotesTags(second).labels("Buy stamps")).toHaveText(["Errands"])
    } finally {
      await context.close()
      await other.close()
      await cleanup(request, user)
    }
  })
})
