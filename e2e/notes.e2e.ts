import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { openNotes } from "./fixtures/groups.ts"

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
  const response = await request.post(`${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

/** Creates a shared group as the page's user and makes `member` a viewer of it. */
async function sharedGroup(
  owner: Page,
  request: APIRequestContext,
  name: string,
  member: string,
): Promise<string> {
  const groupId = uuidV7()
  const created = await owner.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name },
  })
  expect(created.status(), await created.text()).toBe(201)
  const added = await request.post(`${apiBase}/api/test/add-member`, {
    data: { login: member, groupId, role: VIEWER },
  })
  expect(added.status(), await added.text()).toBe(200)
  return groupId
}

test.describe("notes in a shared group", () => {
  test("a note created, edited and deleted by the owner shows in a viewer's open tab without a reload", async ({ browser, request }) => {
    const owner = "e2e_notes_live_owner@example.com"
    const member = "e2e_notes_live_viewer@example.com"
    const baseURL = test.info().project.use.baseURL
    for (const email of [owner, member]) await cleanup(request, email)
    const ownerContext = await browser.newContext({ baseURL })
    const memberContext = await browser.newContext({ baseURL })
    try {
      for (const email of [owner, member]) await signUp(request, email)
      const ownerPage = await ownerContext.newPage()
      const framesSent: string[] = []
      ownerPage.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      await signInOnline(ownerPage, owner)
      await sharedGroup(ownerPage, request, "Notes team", member)

      // The viewer's tab counts the app's sockets and its page loads, so a reconnect or a reload,
      // which would read the notes on their own, fails the test instead of passing it.
      const memberPage = await memberContext.newPage()
      let memberSockets = 0
      memberPage.on("websocket", (socket) => {
        if (new URL(socket.url()).pathname === "/api/ws") memberSockets++
      })
      let memberLoads = 0
      memberPage.on("load", () => memberLoads++)
      await signInOnline(memberPage, member)
      await openNotes(memberPage, "Notes team")
      await expect(memberPage.locator("[data-e2e=notes-read-only]")).toBeVisible()
      const memberTitles = memberPage.locator("[data-e2e=note-item-title]")
      await expect(memberPage.getByText("No notes yet")).toBeVisible()
      // Signing in loads the page again; from here on, nothing may load or connect again.
      const settled = { memberSockets, memberLoads }
      expect(settled.memberSockets).toBeGreaterThan(0)

      await openNotes(ownerPage, "Notes team")
      const ownerTitles = ownerPage.locator("[data-e2e=note-item-title]")

      // Create, on a page of its own: the person lands on the new note's page.
      await ownerPage.locator("[data-e2e=note-new]").click()
      await expect(ownerPage).toHaveURL("/notes/new")
      await ownerPage.locator("[data-e2e=note-title]").fill("Groceries")
      await ownerPage.locator("[data-e2e=note-body]").fill("milk")
      await ownerPage.locator("[data-e2e=note-save]").click()
      await expect(ownerPage).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await expect(ownerPage.locator("[data-e2e=note-title]")).toHaveValue("Groceries")
      const notePath = new URL(ownerPage.url()).pathname
      await ownerPage.locator("[data-e2e=page-back]").click()
      await expect(ownerTitles).toHaveText(["Groceries"])
      await expect(memberTitles).toHaveText(["Groceries"], { timeout: 5_000 })
      await expect(memberPage.locator("[data-e2e=note-item-body]")).toHaveText(["milk"])

      // The create went over the socket, as a command with an idempotency key.
      const command = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "note.create",
      )
      expect(command?.idempotencyKey).toBeTruthy()

      // Edit.
      await ownerPage.getByRole("link", { name: "Groceries" }).click()
      await expect(ownerPage).toHaveURL(notePath)
      await ownerPage.locator("[data-e2e=note-title]").fill("Groceries for Friday")
      await ownerPage.locator("[data-e2e=note-save]").click()
      await expect(ownerPage).toHaveURL("/notes")
      await expect(ownerTitles).toHaveText(["Groceries for Friday"])
      await expect(memberTitles).toHaveText(["Groceries for Friday"], { timeout: 5_000 })

      // Delete asks first: keeping the note leaves it, confirming deletes it.
      await ownerPage.getByRole("link", { name: "Groceries for Friday" }).click()
      await ownerPage.locator("[data-e2e=note-menu]").click()
      await ownerPage.getByRole("menuitem", { name: "Delete" }).click()
      const dialog = ownerPage.locator("[data-e2e=note-delete-dialog]")
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Cancel" }).first().click()
      await expect(dialog).toHaveCount(0)
      await expect(ownerPage).toHaveURL(notePath)
      await ownerPage.locator("[data-e2e=note-menu]").click()
      await ownerPage.getByRole("menuitem", { name: "Delete" }).click()
      await dialog.getByRole("button", { name: "Delete note", exact: true }).click()
      await expect(ownerPage).toHaveURL("/notes")
      await expect(ownerTitles).toHaveCount(0)
      await expect(memberTitles).toHaveCount(0, { timeout: 5_000 })
      await expect(memberPage.getByText("No notes yet")).toBeVisible()

      expect({ memberSockets, memberLoads }).toEqual(settled)
    } finally {
      await ownerContext.close()
      await memberContext.close()
      for (const email of [owner, member]) await cleanup(request, email)
    }
  })

  test("a viewer cannot create, edit or delete a note over REST", async ({ browser, request }) => {
    const owner = "e2e_notes_rest_owner@example.com"
    const member = "e2e_notes_rest_viewer@example.com"
    const baseURL = test.info().project.use.baseURL
    for (const email of [owner, member]) await cleanup(request, email)
    const ownerContext = await browser.newContext({ baseURL })
    const memberContext = await browser.newContext({ baseURL })
    try {
      for (const email of [owner, member]) await signUp(request, email)
      const ownerPage = await ownerContext.newPage()
      await signInOnline(ownerPage, owner)
      const groupId = await sharedGroup(ownerPage, request, "Read only", member)
      const notes = `${apiBase}/api/groups/${groupId}/notes`
      const noteId = uuidV7()
      const created = await ownerPage.request.post(notes, {
        headers,
        data: { id: noteId, title: "Owner's note", body: "" },
      })
      expect(created.status(), await created.text()).toBe(201)

      const memberPage = await memberContext.newPage()
      await signInOnline(memberPage, member)
      const refused = [
        await memberPage.request.post(notes, {
          headers,
          data: { id: uuidV7(), title: "Mine", body: "" },
        }),
        await memberPage.request.patch(`${notes}/${noteId}`, {
          headers,
          data: { title: "Changed", body: "", version: 1 },
        }),
        await memberPage.request.delete(`${notes}/${noteId}`, { headers, data: { version: 1 } }),
      ]
      for (const response of refused) {
        expect(response.status()).toBe(403)
        expect((await response.json()).error.code).toBe("ROLE_INSUFFICIENT")
      }

      // The viewer still reads it, unchanged.
      const read = await memberPage.request.get(`${notes}/${noteId}`)
      expect(read.status()).toBe(200)
      expect((await read.json()).note).toMatchObject({ title: "Owner's note", version: 1 })
    } finally {
      await ownerContext.close()
      await memberContext.close()
      for (const email of [owner, member]) await cleanup(request, email)
    }
  })

  test("a viewer opens a note as text, with no way to save, delete or add", async ({ browser, request }) => {
    const owner = "e2e_notes_view_owner@example.com"
    const member = "e2e_notes_view_viewer@example.com"
    const baseURL = test.info().project.use.baseURL
    for (const username of [owner, member]) await cleanup(request, username)
    const ownerContext = await browser.newContext({ baseURL })
    const memberContext = await browser.newContext({ baseURL })
    try {
      for (const username of [owner, member]) await signUp(request, username)
      const ownerPage = await ownerContext.newPage()
      await signInOnline(ownerPage, owner)
      const groupId = await sharedGroup(ownerPage, request, "Viewer team", member)
      const created = await ownerPage.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: uuidV7(), title: "Owner's note", body: "Read me" },
      })
      expect(created.status(), await created.text()).toBe(201)

      const memberPage = await memberContext.newPage()
      await signInOnline(memberPage, member)
      await openNotes(memberPage, "Viewer team")
      await expect(memberPage.locator("[data-e2e=note-new]")).toHaveCount(0)
      await memberPage.getByRole("link", { name: "Owner's note" }).click()
      await expect(memberPage.locator("[data-e2e=note-read-title]")).toHaveText("Owner's note")
      await expect(memberPage.locator("[data-e2e=note-read-body]")).toHaveText("Read me")
      await expect(memberPage.locator("[data-e2e=note-read-only]")).toBeVisible()
      for (const hook of ["note-title", "note-save", "note-delete"]) {
        await expect(memberPage.locator(`[data-e2e=${hook}]`), hook).toHaveCount(0)
      }

      await gotoApp(memberPage, "/notes/new", memberPage.locator("[data-e2e=shell-ws-status]"))
      await expect(memberPage.getByText("Only an editor can add notes to this group."))
        .toBeVisible()
      await expect(memberPage.locator("[data-e2e=note-save]")).toHaveCount(0)
    } finally {
      await ownerContext.close()
      await memberContext.close()
      for (const username of [owner, member]) await cleanup(request, username)
    }
  })

  test("a note of another of my groups offers a switch, which selects the group and opens the note", async ({ browser, request }) => {
    const owner = "e2e_notes_other_group@example.com"
    await cleanup(request, owner)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, owner)
      const page = await context.newPage()
      await signInOnline(page, owner)
      const selectedBefore = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      const otherGroup = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: otherGroup, name: "Other team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const noteId = uuidV7()
      const note = await page.request.post(`${apiBase}/api/groups/${otherGroup}/notes`, {
        headers,
        data: { id: noteId, title: "Elsewhere", body: "" },
      })
      expect(note.status(), await note.text()).toBe(201)
      expect(selectedBefore.groupId).not.toBe(otherGroup)

      await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=shell-ws-status]"))
      await expect(page.locator("[data-e2e=note-elsewhere]")).toContainText("Other team")
      await expect(page.getByRole("button", { name: "Switch to Other team" })).toBeVisible()
      await expect(page.locator("[data-e2e=note-title]")).toHaveCount(0)
      // The page load alone changed nothing: the selection is still the one from before.
      const selectedAfterLoad = await (await page.request.get(`${apiBase}/api/groups/selected`))
        .json()
      expect(selectedAfterLoad.groupId).toBe(selectedBefore.groupId)

      await page.getByRole("button", { name: "Switch to Other team" }).click()
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Elsewhere")
      await expect(page).toHaveURL(`/notes/${noteId}`)
      await expect.poll(async () =>
        (await (await page.request.get(`${apiBase}/api/groups/selected`)).json()).groupId
      ).toBe(otherGroup)
    } finally {
      await context.close()
      await cleanup(request, owner)
    }
  })

  test("a note in a group I am not in looks exactly like a note that does not exist", async ({ browser, request }) => {
    const owner = "e2e_notes_stranger_owner@example.com"
    const stranger = "e2e_notes_stranger@example.com"
    await cleanup(request, owner)
    await cleanup(request, stranger)
    const ownerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    const strangerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, owner)
      await signUp(request, stranger)
      const strangerPage = await strangerContext.newPage()
      await signInOnline(strangerPage, stranger)
      const theirGroup = uuidV7()
      const created = await strangerPage.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: theirGroup, name: "Their secret group" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const theirNote = uuidV7()
      const note = await strangerPage.request.post(`${apiBase}/api/groups/${theirGroup}/notes`, {
        headers,
        data: { id: theirNote, title: "Theirs", body: "" },
      })
      expect(note.status(), await note.text()).toBe(201)

      const page = await ownerContext.newPage()
      await signInOnline(page, owner)
      const selectedBefore = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      const pageOf = async (id: string) => {
        await gotoApp(page, `/notes/${id}`, page.locator("[data-e2e=shell-ws-status]"))
        await expect(page.getByRole("heading", { level: 1, name: "This note does not exist." }))
          .toBeVisible()
        await expect(page.locator("[data-e2e=note-not-found]")).toBeVisible()
        await expect(page.locator("[data-e2e=note-switch-group]")).toHaveCount(0)
        await expect(page.locator("[data-e2e=note-title]")).toHaveCount(0)
        return await page.locator("main").innerText()
      }
      const foreign = await pageOf(theirNote)
      const missing = await pageOf(uuidV7())

      expect(foreign).toBe(missing)
      expect(foreign).not.toContain("Their secret group")
      const selectedAfter = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      expect(selectedAfter.groupId).toBe(selectedBefore.groupId)
      await page.locator("[data-e2e=page-back]").click()
      await expect(page).toHaveURL("/notes")
    } finally {
      await ownerContext.close()
      await strangerContext.close()
      await cleanup(request, owner)
      await cleanup(request, stranger)
    }
  })

  test("leaving the note page with unsaved text asks first, and staying keeps the text", async ({ browser, request }) => {
    const owner = "e2e_notes_unsaved@example.com"
    await cleanup(request, owner)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, owner)
      const page = await context.newPage()
      await signInOnline(page, owner)
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
        name: "Notes",
      }).click()
      await page.locator("[data-e2e=note-new]").click()
      await expect(page).toHaveURL("/notes/new")

      // Nothing typed: leaving is free.
      await page.locator("[data-e2e=page-back]").click()
      await expect(page).toHaveURL("/notes")
      await page.locator("[data-e2e=note-new]").click()

      await page.locator("[data-e2e=note-title]").fill("Half a thought")
      const dialog = page.getByRole("alertdialog", { name: "Leave without saving?" })
      await page.locator("[data-e2e=page-back]").click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Stay" }).first().click()
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL("/notes/new")
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Half a thought")

      // The browser's Back button is held back the same way.
      await page.goBack()
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Stay" }).first().click()
      await expect(dialog).toHaveCount(0)
      await expect(page).toHaveURL("/notes/new")
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Half a thought")

      // A link in the side menu is held back the same way.
      await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
        name: "Groups",
      }).click()
      await expect(dialog).toBeVisible()
      await dialog.getByRole("button", { name: "Leave" }).click()
      await expect(page).toHaveURL("/groups")

      // Discarded: the next create page starts empty.
      await gotoApp(page, "/notes/new", page.locator("[data-e2e=shell-ws-status]"))
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("")
    } finally {
      await context.close()
      await cleanup(request, owner)
    }
  })

  test('after a refused save, "Load the latest version" loads the server\'s text instead of asking to leave', async ({ browser, request }) => {
    const owner = "e2e_notes_conflict@example.com"
    await cleanup(request, owner)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, owner)
      const page = await context.newPage()
      await signInOnline(page, owner)
      const { groupId } = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      const noteId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: noteId, title: "Original", body: "" },
      })
      expect(created.status(), await created.text()).toBe(201)

      await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=shell-ws-status]"))
      const title = page.locator("[data-e2e=note-title]")
      await expect(title).toHaveValue("Original")
      await title.fill("Mine")

      // Someone else saves first, so this save is refused for a stale version.
      const theirs = await page.request.patch(`${apiBase}/api/groups/${groupId}/notes/${noteId}`, {
        headers,
        data: { title: "Theirs", body: "", version: 1 },
      })
      expect(theirs.status(), await theirs.text()).toBe(200)
      await page.locator("[data-e2e=note-save]").click()
      await expect(page.locator("[data-e2e=note-conflict]")).toBeVisible()
      await expect(title).toHaveValue("Mine")

      await page.getByRole("link", { name: "Load the latest version" }).click()
      await expect(title).toHaveValue("Theirs")
      await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toHaveCount(0)
      await expect(page.locator("[data-e2e=note-conflict]")).toHaveCount(0)
    } finally {
      await context.close()
      await cleanup(request, owner)
    }
  })
})
