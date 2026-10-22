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

/** The sync line while changes wait or the device is offline; absent once everything is sent. */
const WAITING = "[data-e2e=offline-status] [data-sync-state]:not([data-sync-state=synced])"

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

test.describe("tags", () => {
  test.describe.configure({ timeout: 90_000 })

  test("a person makes, renames and recolours tags, puts them on notes, filters the list by them and deletes one", async ({ browser, request }) => {
    const user = "e2e_tags_manage@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signInOnline(page, user)
      const groupId = await selectedGroup(page, "Tag team")
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))

      const tags = new TagsPage(page)
      const notes = new NotesTags(page)
      await tags.openFromNotes()
      await tags.create("Urgent", "Red")
      await tags.create("Hme", "Blue")
      await tags.rename("Hme", "Home")
      await expect(tags.names).toHaveText(["Home", "Urgent"])
      await expect.poll(async () => (await serverTags(page, groupId)).map((t) => t.name).sort())
        .toEqual(["Home", "Urgent"])
      expect((await serverTags(page, groupId)).find((t) => t.name === "Home")?.color)
        .toBe("#1d4ed8")
      await tags.toNotes()

      await notes.create("Groceries", ["Home", "Urgent"])
      await notes.create("Trip", ["Home"])
      await notes.create("Plan", [])
      await expect(notes.labels("Groceries")).toHaveText(["Home", "Urgent"])
      await expect(notes.labels("Trip")).toHaveText(["Home"])
      await expect(notes.labels("Plan")).toHaveCount(0)

      // The filter narrows the local list and is kept in the address, one `tag=` per tag.
      await notes.toggleTagFilter("Home")
      await expect(page).toHaveURL(/[?&]tag=/)
      await expect(notes.titles).toHaveText(["Trip", "Groceries"])
      // Any of the tags by default; All of these tags narrows to the notes with every one.
      await notes.toggleTagFilter("Urgent")
      await expect(notes.titles).toHaveText(["Trip", "Groceries"])
      await page.locator("[data-e2e=filter-tags]").click()
      await page.getByRole("menuitemradio", { name: "All of these tags" }).click()
      await page.keyboard.press("Escape")
      await expect(notes.titles).toHaveText(["Groceries"])
      // The address is written a frame after the click; wait for both tags before reloading.
      await expect(page).toHaveURL(/tag=[^&]+&(.*&)?tag=/)
      await expect(page).toHaveURL(/match=all/)
      await page.reload()
      await expect(notes.titles).toHaveText(["Groceries"])
      await page.locator("[data-e2e=filter-clear]").click()
      await expect(notes.titles).toHaveCount(3)
      await expect(page).not.toHaveURL(/tag=|match=/)

      // Each tag's row counts its notes, and the count opens the notes list filtered by the tag.
      const before = await serverNotes(page, groupId)
      await notes.page.locator("[data-e2e=notes-menu]").click()
      await notes.page.locator("[data-e2e=notes-tags]").click()
      const homeCount = tags.row("Home").locator("[data-e2e=tag-note-count]")
      await expect(homeCount).toHaveText("2 notes")
      await expect(homeCount).toHaveAccessibleName("Show the 2 notes tagged Home")
      await expect(tags.row("Urgent").locator("[data-e2e=tag-note-count]")).toHaveText("1 note")
      const home = (await serverTags(page, groupId)).find((t) => t.name === "Home")!
      await homeCount.click()
      await expect(page).toHaveURL(`/notes?tag=${home.id}`)
      await notes.page.locator("[data-e2e=notes-menu]").click()
      await notes.page.locator("[data-e2e=notes-tags]").click()

      // Deleting a tag takes it off the notes and leaves the notes (the integration test proves
      // their versions stay); a toast names it and counts its notes, and focus moves to the next
      // tag's menu, not to the page's body.
      await tags.remove("Urgent")
      await expect(page.locator("[data-e2e=tag-deleted]"))
        .toContainText(`"Urgent" was deleted and taken off 1 note.`)
      await expect(tags.names).toHaveText(["Home"])
      await expect(tags.row("Home").locator("[data-e2e=tag-menu]")).toBeFocused()
      await expect.poll(async () => (await serverTags(page, groupId)).map((t) => t.name))
        .toEqual(["Home"])
      await tags.toNotes()
      await expect(notes.titles).toHaveCount(3)
      await expect(notes.labels("Groceries")).toHaveText(["Home"])
      const after = await serverNotes(page, groupId)
      expect(after.length).toBe(before.length)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a tag typed on the create page is kept and created in the group the person switches to", async ({ browser, request }) => {
    const user = "e2e_tags_switch@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signInOnline(page, user)
      const second = await selectedGroup(page, "Second team")
      const first = await selectedGroup(page, "First team")
      await gotoApp(page, "/tags/new", page.locator("[data-e2e=tag-name]"))
      await expect(page.locator("[data-e2e=tags-group]")).toHaveText("First team")
      await page.locator("[data-e2e=tag-name]").fill("Errands")

      await page.locator("[data-e2e=group-picker]").click()
      await page.getByRole("menuitemradio", { name: /Second team/ }).click()
      await expect(page.locator("[data-e2e=tags-group]")).toHaveText("Second team")
      await expect(page.locator("[data-e2e=tag-name]")).toHaveValue("Errands")

      await page.locator("[data-e2e=tag-name]").fill("Errands 2")
      await page.locator("[data-e2e=tag-save]").click()
      await expect(page).toHaveURL(/\/tags\/[0-9a-f-]{36}$/)
      await expect.poll(async () => (await serverTags(page, second)).map((t) => t.name))
        .toEqual(["Errands 2"])
      expect(await serverTags(page, first)).toEqual([])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

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
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))

      await context.setOffline(true)
      await page.reload()
      await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")

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
