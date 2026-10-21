import { type Browser, type BrowserContext, type Page } from "@playwright/test"
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
 * Tags on a page whose `/config.json` says `realtime: false` (ADR 003, "the proof of the swap"):
 * tags are made, put on a note and filtered over `POST /api/call/<name>`, and the page opens no
 * WebSocket.
 */

interface SocketFree {
  context: BrowserContext
  page: Page
  sockets: string[]
  calls: string[]
}

/** A browser whose app is told to run without the socket; the service worker is blocked. */
async function socketFree(browser: Browser): Promise<SocketFree> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    serviceWorkers: "block",
  })
  await context.route(
    "**/config.json",
    (route) => route.fulfill({ json: { env: "dev", realtime: false } }),
  )
  const page = await context.newPage()
  const sockets: string[] = []
  const calls: string[] = []
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname.startsWith("/api/")) sockets.push(socket.url())
  })
  page.on("request", (request) => {
    const { pathname } = new URL(request.url())
    if (request.method() === "POST" && pathname.startsWith("/api/call/")) {
      calls.push(pathname.slice("/api/call/".length))
    }
  })
  return { context, page, sockets, calls }
}

test.describe("tags with the WebSocket module switched off", () => {
  test("a person makes a tag, puts it on a note, filters by it and deletes it without a socket", async ({ browser, request }) => {
    const user = "e2e_tags_realtime_off@example.com"
    await cleanup(request, user)
    const { context, page, sockets, calls } = await socketFree(browser)
    try {
      await signUp(request, user)
      await signIn(page, user, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = await selectedGroup(page, "Socket-free tag team")
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))

      const tags = new TagsPage(page)
      const notes = new NotesTags(page)
      await tags.openFromNotes()
      await tags.create("Urgent", "Red")
      await tags.toNotes()
      await notes.create("Groceries", ["Urgent"])
      await notes.create("Plan", [])
      await expect(notes.labels("Groceries")).toHaveText(["Urgent"])

      await notes.toggleTagFilter("Urgent")
      await expect(notes.titles).toHaveText(["Groceries"])
      // The address is written a frame after the click; wait for it before reloading.
      await expect(page).toHaveURL(/[?&]tag=/)
      await page.reload()
      await expect(notes.titles).toHaveText(["Groceries"])

      const [tag] = await serverTags(page, groupId)
      expect((await serverNotes(page, groupId)).find((n) => n.title === "Groceries")?.tagIds)
        .toEqual([tag.id])

      await notes.toggleTagFilter("Urgent")
      await tags.openFromNotes()
      await tags.remove("Urgent")
      await expect(tags.names).toHaveCount(0)
      expect(await serverTags(page, groupId)).toEqual([])

      expect(calls).toEqual(
        expect.arrayContaining(["tag.create", "note.create", "tag.delete"]),
      )
      expect(sockets).toEqual([])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})
