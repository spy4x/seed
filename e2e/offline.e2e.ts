import { type APIRequestContext, type BrowserContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

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

/** The user's own group with one note in it. */
async function groupWithNote(page: Page, name: string, title: string) {
  const groupId = uuidV7()
  const noteId = uuidV7()
  const group = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name },
  })
  expect(group.status(), await group.text()).toBe(201)
  const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title, body: "" },
  })
  expect(note.status(), await note.text()).toBe(201)
  return { groupId, noteId }
}

/**
 * Opens a group's notes, then makes sure the device holds what an offline start needs: the app in
 * the service worker's cache, the choice of this group, and the group's notes. `title` is a note
 * of the group. The page shows it only once it knows the group and has stored the server's list,
 * so cutting the network before that would start the app on the group it had before.
 */
async function openNotesAndCacheShell(page: Page, groupId: string, title: string): Promise<void> {
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

/** Goes offline and loads the page again: the app must start from the cache alone. */
async function reloadOffline(context: BrowserContext, page: Page): Promise<void> {
  await context.setOffline(true)
  await page.reload()
  await expect(page.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")
}

async function serverNotes(page: Page, groupId: string): Promise<{ title: string }[]> {
  const response = await page.request.get(`${apiBase}/api/groups/${groupId}/notes`)
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json()).notes
}

test.describe("offline notes", () => {
  // Each spec signs in up to twice, loads the app three times so the service worker holds it, and
  // goes offline and back. That takes 15 s on an idle machine, up to 29 s on a loaded one, and one run
  // went past the 30 s default (it timed out in the cleanup after its last step).
  test.describe.configure({ timeout: 60_000 })

  test("a person with no network opens the app, reads notes, adds one, and it syncs when the network is back", async ({ browser, request }) => {
    const user = "e2e_offline_writer@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signInOnline(page, user)
      const { groupId } = await groupWithNote(page, "Offline team", "Written online")
      await openNotesAndCacheShell(page, groupId, "Written online")

      // The worker caches the app's files, never the API's answers or the socket route.
      const cachedPaths = async () =>
        await page.evaluate(async () => {
          const paths: string[] = []
          for (const name of await caches.keys()) {
            for (const request of await (await caches.open(name)).keys()) {
              paths.push(new URL(request.url).pathname)
            }
          }
          return paths
        })
      await expect.poll(cachedPaths).toContain("/")
      expect((await cachedPaths()).filter((path) => /^\/(api|ws)(\/|$)/.test(path))).toEqual([])

      await reloadOffline(context, page)
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveText(["Written online"])

      await page.locator("[data-e2e=note-new]").click()
      await page.locator("[data-e2e=note-title]").fill("Written offline")
      await page.locator("[data-e2e=note-body]").fill("no network here")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await page.locator("[data-e2e=page-back]").click()
      await expect(titles).toHaveText(["Written offline", "Written online"])
      await expect(page.locator(WAITING)).toHaveText(
        "Offline, 1 change waiting",
      )

      await context.setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 20_000,
      })
      await expect(page.locator(WAITING)).toHaveCount(0)
      await expect.poll(async () => (await serverNotes(page, groupId)).map((n) => n.title))
        .toEqual(["Written offline", "Written online"])

      // Still there after a fresh load.
      await gotoApp(page, page.url(), page.locator("[data-e2e=shell-ws-status]"))
      await expect(titles).toHaveText(["Written offline", "Written online"])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("notes edited and deleted with no network are sent when the network is back, and an Undo before that takes the delete back", async ({ browser, request }) => {
    const user = "e2e_offline_edit_delete@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signInOnline(page, user)
      const { groupId } = await groupWithNote(page, "Edit team", "Keep as it is")
      for (const title of ["Edit me", "Delete me", "Undo me"]) {
        const created = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
          headers,
          data: { id: uuidV7(), title, body: "" },
        })
        expect(created.status(), await created.text()).toBe(201)
      }
      await openNotesAndCacheShell(page, groupId, "Keep as it is")
      await reloadOffline(context, page)
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveCount(4)

      const deleteOpenNote = async () => {
        await page.locator("[data-e2e=note-menu]").click()
        await page.getByRole("menuitem", { name: "Delete" }).click()
        await page.locator("[data-e2e=note-delete-dialog]").getByRole("button", {
          name: "Delete note",
          exact: true,
        }).click()
        await expect(page).toHaveURL("/notes")
      }

      await page.getByRole("link", { name: "Edit me" }).click()
      await page.locator("[data-e2e=note-title]").fill("Edited offline")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL("/notes")

      await page.getByRole("link", { name: "Delete me" }).click()
      await deleteOpenNote()

      await page.getByRole("link", { name: "Undo me" }).click()
      await deleteOpenNote()
      await expect(titles).toHaveCount(2)
      await page.locator("[data-e2e=note-undo]").click()
      await expect(titles).toHaveCount(3)

      // The edit and the delete wait; the undone delete is not among them.
      await expect(page.locator(WAITING)).toHaveText(
        "Offline, 2 changes waiting",
      )

      await context.setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 20_000,
      })
      await expect(page.locator(WAITING)).toHaveCount(0)
      await expect.poll(async () => (await serverNotes(page, groupId)).map((n) => n.title).sort())
        .toEqual(["Edited offline", "Keep as it is", "Undo me"])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a person with no network switches between groups already on the device, and the server learns the choice when the network is back", async ({ browser, request }) => {
    const user = "e2e_offline_picker@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signInOnline(page, user)
      const first = await groupWithNote(page, "Offline first", "In the first")
      const second = await groupWithNote(page, "Offline second", "In the second")
      // Open both online so their notes are in the local store.
      await openNotesAndCacheShell(page, second.groupId, "In the second")
      await openNotesAndCacheShell(page, first.groupId, "In the first")
      const titles = page.locator("[data-e2e=note-item-title]")
      await expect(titles).toHaveText(["In the first"])

      await reloadOffline(context, page)
      await expect(titles).toHaveText(["In the first"])
      await page.locator("[data-e2e=group-picker]").click()
      await page.getByRole("menuitemradio", { name: /Offline second/ }).click()
      await expect(page.locator("[data-e2e=notes-group]")).toHaveText("Offline second")
      await expect(titles).toHaveText(["In the second"])

      await context.setOffline(false)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online", {
        timeout: 20_000,
      })
      await expect.poll(async () => {
        const response = await page.request.get(`${apiBase}/api/groups/selected`)
        return (await response.json()).groupId
      }).toBe(second.groupId)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("two devices editing the same note offline end with one visible conflict and no lost edit", async ({ browser, request }) => {
    const user = "e2e_offline_pair@example.com"
    await cleanup(request, user)
    const baseURL = test.info().project.use.baseURL
    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
      await signUp(request, user)
      const a = await contextA.newPage()
      const b = await contextB.newPage()
      await signInOnline(a, user)
      await signInOnline(b, user)
      const { groupId } = await groupWithNote(a, "Pair team", "Shared note")
      for (const page of [a, b]) await openNotesAndCacheShell(page, groupId, "Shared note")
      await reloadOffline(contextA, a)
      await reloadOffline(contextB, b)

      for (const [page, title] of [[a, "Edited on A"], [b, "Edited on B"]] as const) {
        await page.getByRole("link", { name: "Shared note" }).click()
        await page.locator("[data-e2e=note-title]").fill(title)
        await page.locator("[data-e2e=note-save]").click()
        await expect(page.locator("[data-e2e=note-item-title]")).toHaveText([title])
        await expect(page.locator(WAITING)).toBeVisible()
      }

      // Device A reconnects first: its edit reaches the server.
      await contextA.setOffline(false)
      await expect(a.locator(WAITING)).toHaveCount(0, { timeout: 20_000 })
      await expect.poll(async () => (await serverNotes(a, groupId)).map((n) => n.title))
        .toEqual(["Edited on A"])

      // Device B reconnects second: its edit is not applied over A's, and it is not dropped.
      await contextB.setOffline(false)
      const conflict = b.locator("[data-e2e=offline-status] li")
      await expect(conflict).toHaveCount(1, { timeout: 20_000 })
      await expect(conflict.locator("[data-e2e=conflict-mine]")).toContainText("Edited on B")
      await expect(conflict.locator("[data-e2e=conflict-theirs]")).toContainText("Edited on A")
      expect((await serverNotes(a, groupId)).map((n) => n.title)).toEqual(["Edited on A"])

      // Keeping mine sends B's text on top of A's.
      await conflict.getByRole("button", { name: "Keep mine" }).click()
      await expect(conflict).toHaveCount(0)
      await expect.poll(async () => (await serverNotes(a, groupId)).map((n) => n.title))
        .toEqual(["Edited on B"])
    } finally {
      await contextA.close()
      await contextB.close()
      await cleanup(request, user)
    }
  })

  test("choosing the server's version drops the offline edit and shows the server's note", async ({ browser, request }) => {
    const user = "e2e_offline_theirs@example.com"
    await cleanup(request, user)
    const baseURL = test.info().project.use.baseURL
    const contextA = await browser.newContext({ baseURL })
    const contextB = await browser.newContext({ baseURL })
    try {
      await signUp(request, user)
      const a = await contextA.newPage()
      const b = await contextB.newPage()
      await signInOnline(a, user)
      await signInOnline(b, user)
      const { groupId, noteId } = await groupWithNote(a, "Theirs team", "Shared note")
      for (const page of [a, b]) await openNotesAndCacheShell(page, groupId, "Shared note")
      await reloadOffline(contextB, b)

      await b.getByRole("link", { name: "Shared note" }).click()
      await b.locator("[data-e2e=note-title]").fill("Edited on B")
      await b.locator("[data-e2e=note-save]").click()

      // Device A, online, changes the note first.
      const changed = await a.request.patch(`${apiBase}/api/groups/${groupId}/notes/${noteId}`, {
        headers,
        data: { title: "Edited on A", body: "", version: 1 },
      })
      expect(changed.status(), await changed.text()).toBe(200)

      await contextB.setOffline(false)
      const conflict = b.locator("[data-e2e=offline-status] li")
      await expect(conflict).toHaveCount(1, { timeout: 20_000 })
      await conflict.getByRole("button", { name: "Use the server's" }).click()
      await expect(conflict).toHaveCount(0)
      await expect(b.locator("[data-e2e=note-item-title]")).toHaveText(["Edited on A"])
      expect((await serverNotes(a, groupId)).map((n) => n.title)).toEqual(["Edited on A"])
    } finally {
      await contextA.close()
      await contextB.close()
      await cleanup(request, user)
    }
  })
})
