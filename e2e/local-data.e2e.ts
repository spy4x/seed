import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { TagsPage } from "./fixtures/tags.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import {
  createGroup as createGroupInBrowser,
  openGroup,
  openGroups,
  openNotes,
} from "./fixtures/groups.ts"
import { signUpInPage, signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The local-data module as a swappable part (ADR 003, sections 1, 4 and 5), in a real browser with
 * a real IndexedDB: the app with the module switched off, every list screen with no network, and
 * what a device keeps across an update, a sign-out and a start without a session.
 */

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const VIEWER = 1
const EDITOR = 2

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

async function createGroup(api: APIRequestContext, name: string): Promise<string> {
  const groupId = uuidV7()
  const group = await api.post(`${apiBase}/api/groups`, { headers, data: { id: groupId, name } })
  expect(group.status(), await group.text()).toBe(201)
  return groupId
}

async function createNote(api: APIRequestContext, groupId: string, title: string) {
  const noteId = uuidV7()
  const note = await api.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title, body: "" },
  })
  expect(note.status(), await note.text()).toBe(201)
  return noteId
}

async function selectGroup(api: APIRequestContext, groupId: string): Promise<void> {
  const selected = await api.put(`${apiBase}/api/groups/selected`, { headers, data: { groupId } })
  expect(selected.ok(), await selected.text()).toBe(true)
}

const online = (page: Page) => page.locator("[data-e2e=shell-ws-status]")

/**
 * A browser whose app is given the test's `/config.json`. The service worker is blocked so the
 * answer is the test's, not the worker's stored copy.
 */
async function configured(browser: Browser, config: Record<string, unknown>) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    serviceWorkers: "block",
  })
  await context.route(
    "**/config.json",
    (route) => route.fulfill({ json: { env: "dev", ...config } }),
  )
  return { context, page: await context.newPage() }
}

/** The names of the IndexedDB databases the page's origin holds. */
async function databases(page: Page): Promise<string[]> {
  return await page.evaluate(async () =>
    (await indexedDB.databases()).map((database) => database.name ?? "").sort()
  )
}

/**
 * How many records the database `name` holds, over all its stores; 0 when there is no such
 * database. It never opens a database that is not there, because opening creates it.
 */
async function recordsIn(page: Page, name: string): Promise<number> {
  return await page.evaluate(async (name) => {
    const all = await indexedDB.databases()
    if (!all.some((database) => database.name === name)) return 0
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name)
      opening.onsuccess = () => resolve(opening.result)
      opening.onerror = () => reject(opening.error)
    })
    try {
      let records = 0
      for (const store of Array.from(db.objectStoreNames)) {
        records += await new Promise<number>((resolve, reject) => {
          const counting = db.transaction(store).objectStore(store).count()
          counting.onsuccess = () => resolve(counting.result)
          counting.onerror = () => reject(counting.error)
        })
      }
      return records
    } finally {
      db.close()
    }
  }, name)
}

/** The signed-in user's id, read from the name of the read-copy database the app opened. */
async function userIdOnDevice(page: Page): Promise<number> {
  let id = 0
  await expect.poll(async () => {
    const name = (await databases(page)).find((name) => /^reads:\d+$/.test(name))
    id = name ? Number(name.slice("reads:".length)) : 0
    return id
  }).toBeGreaterThan(0)
  return id
}

async function signOut(page: Page): Promise<void> {
  await askToSignOut(page)
  await page.locator("[data-e2e=auth-form-login]").waitFor()
}

/** Chooses Sign out in the account menu, which may first ask about unsent changes. */
async function askToSignOut(page: Page): Promise<void> {
  await page.locator("[data-e2e=account-menu-button]").click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
}

/**
 * Opens `path` with no network and waits until the app has started from the worker's cache. A load
 * is made again only when a network change broke it, as everywhere else (`gotoApp`).
 */
async function openOffline(page: Page, path: string): Promise<void> {
  await gotoApp(page, path, online(page))
  await expect(online(page)).not.toHaveText("Online")
}

test.describe("the app with the local-data module switched off", () => {
  test("a person signs up, signs in again, makes a group and a note and reads every screen, and the page creates no IndexedDB database", async ({ browser, request }) => {
    test.setTimeout(90_000)
    const email = "e2e_local_data_off@example.com"
    await cleanup(request, email)
    const { context, page } = await configured(browser, { offline: false })
    try {
      await signUpInPage(page, email, password, online(page))
      await expect(online(page)).toHaveText("Online")
      await signOut(page)
      await signIn(page, email, password)

      // A group.
      await page.getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: "Groups" }).click()
      await createGroupInBrowser(page, "Online-only team")

      // A note: created, edited, and read again after a reload.
      await openNotes(page, "Online-only team")
      const titles = page.locator("[data-e2e=note-item-title]")
      await page.locator("[data-e2e=note-new]").click()
      await page.locator("[data-e2e=note-title]").fill("Groceries")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await page.locator("[data-e2e=page-back]").click()
      await page.getByRole("link", { name: "Groceries" }).click()
      await page.locator("[data-e2e=note-title]").fill("Groceries for Friday")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL("/notes")
      // Through `gotoApp`, as every online load: a plain reload that a network change breaks
      // leaves the page blank and the list empty, with nothing in the report saying why.
      await gotoApp(page, "/notes", titles.first(), () => page.reload())
      await expect(titles).toHaveText(["Groceries for Friday"])

      // The other list screens read from the server.
      await openGroups(page)
      await openGroup(page, "Online-only team")
      const groupPath = new URL(page.url()).pathname
      await gotoApp(page, `${groupPath}/members`, page.locator("[data-e2e=group-member]"))
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)
      await gotoApp(page, `${groupPath}/billing`, page.locator("[data-e2e=billing-plan]"))
      await gotoApp(page, `${groupPath}/activity`, page.locator("[data-e2e=activity-list]"))
      await gotoApp(page, "/notifications", page.getByRole("heading", { level: 1 }))
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=session-current]"))
      await expect(page.locator("[data-e2e=sessions-saved-copy]")).toBeEmpty()

      expect(await databases(page)).toEqual([])
      await signOut(page)
      expect(await databases(page)).toEqual([])
    } finally {
      await context.close()
      await cleanup(request, email)
    }
  })
})

test.describe("the app with no network, after one visit online", () => {
  test("every list screen shows what it showed last, and the lists that can mislead say when they were saved", async ({ browser, request }) => {
    test.setTimeout(120_000)
    const id = uuidV7().slice(-8)
    const user = `e2e-kept-user-${id}@example.com`
    const other = `e2e-kept-other-${id}@example.com`
    for (const email of [user, other]) await cleanup(request, email)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    const otherContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      await signUp(otherContext.request, other)
      const page = await context.newPage()
      await signIn(page, user, password)
      await expect(online(page)).toHaveText("Online")
      const groupId = await createGroup(page.request, "Kept team")
      await createNote(page.request, groupId, "Written online")
      await selectGroup(page.request, groupId)

      // Somebody else's group, and a change of role in it: one notification for the person.
      const otherApi = otherContext.request
      const theirs = await createGroup(otherApi, "Their team")
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: user, groupId: theirs, role: EDITOR },
      })
      expect(added.status(), await added.text()).toBe(200)
      const members = await (await otherApi.get(`${apiBase}/api/groups/${theirs}/members`)).json()
      const userId: number = members.members.find((m: { email?: string }) =>
        m.email === user
      ).userId
      const changed = await otherApi.patch(`${apiBase}/api/groups/${theirs}/members/${userId}`, {
        headers,
        data: { role: VIEWER },
      })
      expect(changed.status(), await changed.text()).toBe(200)

      // The one visit online, under the service worker, to every list screen.
      await gotoApp(page, "/notes", online(page))
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
      })
      await gotoApp(page, "/notes", page.locator("[data-e2e=note-list]"))
      await expect(page.locator("[data-e2e=note-item-title]")).toHaveText(["Written online"])

      await gotoApp(page, "/groups", page.locator("[data-e2e=group-list]"))
      const groupNames = page.locator("[data-e2e=group-item-name]")
      await expect(groupNames.filter({ hasText: /^(Kept|Their) team$/ })).toHaveCount(2)

      await gotoApp(
        page,
        `/groups/${groupId}/members`,
        page.locator("[data-e2e=group-general-name]"),
      )
      await page.getByRole("link", { name: "Invite" }).click()
      await page.locator("[data-e2e=invitation-create]").click()
      await page.locator("[data-e2e=invitation-done]").click()
      await expect(page).toHaveURL(`/groups/${groupId}/members`)
      const invitations = page.locator("[data-e2e=group-section-invitations] [data-e2e=invitation]")
      await expect(invitations).toHaveCount(1)
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)
      // Once more, so the copy on the device holds the invitation just made.
      await gotoApp(page, `/groups/${groupId}/members`, invitations)
      const plan = page.locator("[data-e2e=billing-plan]")
      await gotoApp(page, `/groups/${groupId}/billing`, plan)
      await expect(plan).toHaveAttribute("data-plan", "free")

      const activity = page.locator("[data-e2e=activity-list] [data-e2e=activity-text]")
      await gotoApp(page, `/groups/${groupId}/activity`, activity.first())
      const activityOnline = await activity.allTextContents()

      const notifications = page.locator(
        "[data-e2e=notifications-list] [data-e2e=notification-text]",
      )
      await gotoApp(page, "/notifications", notifications.first())
      const notificationsOnline = await notifications.allTextContents()

      await gotoApp(page, "/profile/security", page.locator("[data-e2e=session-current]"))
      await expect(page.locator("[data-e2e=sessions-saved-copy]")).toBeEmpty()
      await gotoApp(page, "/profile/api-tokens", page.locator("[data-e2e=api-token-create-open]"))
      await page.locator("[data-e2e=api-token-create-open]").click()
      await page.locator("[data-e2e=api-token-name]").fill("Kept token")
      await page.locator("[data-e2e=api-token-password]").fill(password)
      await page.locator("[data-e2e=api-token-create]").click()
      await page.locator("[data-e2e=api-token-done]").click()
      await expect(page).toHaveURL("/profile/api-tokens")
      const tokens = page.locator("[data-e2e=api-token-details]")
      await expect(tokens).toHaveCount(1)
      // Once more, so the copy on the device holds the token just made.
      await gotoApp(page, "/profile/api-tokens", tokens)
      await expect(page.locator("[data-e2e=api-tokens-saved-copy]")).toBeEmpty()
      await gotoApp(page, "/profile/account", page.locator("[data-e2e=profile-name]"))
      const name = await page.locator("[data-e2e=profile-name]").textContent()

      await context.setOffline(true)

      await openOffline(page, "/notes")
      await expect(page.locator("[data-e2e=note-item-title]")).toHaveText(["Written online"])

      await openOffline(page, "/groups")
      await expect(groupNames.filter({ hasText: /^(Kept|Their) team$/ })).toHaveCount(2)

      await openOffline(page, `/groups/${groupId}/members`)
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)
      await expect(invitations).toHaveCount(1)
      await openOffline(page, `/groups/${groupId}/billing`)
      await expect(plan).toHaveAttribute("data-plan", "free")

      await openOffline(page, `/groups/${groupId}/activity`)
      await expect(activity).toHaveText(activityOnline)

      await openOffline(page, "/notifications")
      await expect(notifications).toHaveText(notificationsOnline)

      await openOffline(page, "/profile/account")
      await expect(page.locator("[data-e2e=profile-name]")).toHaveText(name ?? "")
      await openOffline(page, "/profile/security")
      await expect(page.locator("[data-e2e=session-current]")).toBeVisible()
      await expect(page.locator("[data-e2e=sessions-saved-copy]")).toHaveAttribute(
        "data-saved-at",
        /^\d{4}-/,
      )
      await openOffline(page, "/profile/api-tokens")
      await expect(page.locator("[data-e2e=api-tokens]")).toContainText("Kept token")
      await expect(page.locator("[data-e2e=api-tokens-saved-copy]")).toHaveAttribute(
        "data-saved-at",
        /^\d{4}-/,
      )
    } finally {
      await context.close()
      await otherContext.close()
      for (const email of [user, other]) await cleanup(request, email)
    }
  })
})

test.describe("what a device keeps", () => {
  test.describe.configure({ timeout: 60_000 })

  /** A signed-in page of a person who owns one group with one note. */
  async function deviceWithNote(context: BrowserContext, request: APIRequestContext, user: string) {
    await signUp(request, user)
    const page = await context.newPage()
    await signIn(page, user, password)
    await expect(online(page)).toHaveText("Online")
    const groupId = await createGroup(page.request, "Device team")
    const noteId = await createNote(page.request, groupId, "Before the update")
    await selectGroup(page.request, groupId)
    await gotoApp(page, "/notes", page.locator("[data-e2e=note-list]"))
    return { page, groupId, noteId, userId: await userIdOnDevice(page) }
  }

  /** Puts `entry` into the user's queue the way the earlier version of the app wrote it. */
  async function queueAsEarlierVersion(page: Page, userId: number, entry: unknown): Promise<void> {
    await page.evaluate(async ({ name, entry }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open(name, 1)
        opening.onupgradeneeded = () =>
          opening.result.createObjectStore("entries", { keyPath: "seq", autoIncrement: true })
        opening.onsuccess = () => resolve(opening.result)
        opening.onerror = () => reject(opening.error)
      })
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("entries", "readwrite")
        transaction.objectStore("entries").add(entry)
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      db.close()
    }, { name: `offline:user:${userId}:outbox`, entry })
  }

  const editQueuedLastWeek = (groupId: string, noteId: string) => ({
    key: uuidV7(),
    entityId: noteId,
    kind: "update",
    payload: { groupId, title: "Edited before the update", body: "" },
    baseVersion: 1,
    attempted: false,
    status: "pending",
    queuedAt: "2026-10-01T08:00:00.000Z",
  })

  test("an edit the earlier version of the app left queued in IndexedDB is sent after the update", async ({ browser, request }) => {
    const user = "e2e_local_data_queue@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, user)
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))

      await gotoApp(page, "/notes", page.locator("[data-e2e=note-list]"))

      await expect(page.locator("[data-e2e=note-item-title]")).toHaveText([
        "Edited before the update",
      ])
      await expect.poll(async () => {
        const response = await page.request.get(`${apiBase}/api/groups/${groupId}/notes`)
        return (await response.json()).notes.map((note: { title: string }) => note.title)
      }).toEqual(["Edited before the update"])
      await expect.poll(() => recordsIn(page, `offline:user:${userId}:outbox`)).toBe(0)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("the groups database of the earlier version is removed after the update", async ({ browser, request }) => {
    const user = "e2e_local_data_groups@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const { page, userId } = await deviceWithNote(context, request, user)
      const old = `offline:user:${userId}:groups`
      await page.evaluate(async (name) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const opening = indexedDB.open(name, 1)
          opening.onupgradeneeded = () =>
            opening.result.createObjectStore("items", { keyPath: ["scope", "id"] })
              .createIndex("byScope", "scope")
          opening.onsuccess = () => resolve(opening.result)
          opening.onerror = () => reject(opening.error)
        })
        db.close()
      }, old)
      expect(await databases(page)).toContain(old)

      await gotoApp(page, "/groups", page.locator("[data-e2e=group-list]"))

      await expect.poll(() => databases(page)).not.toContain(old)
      await expect(
        page.locator("[data-e2e=group-item-name]").filter({ hasText: "Device team" }),
      ).toHaveCount(1)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("signing out deletes every database and local storage key of the app, a write that was never sent included", async ({ browser, request }) => {
    const user = "e2e_local_data_sign_out@example.com"
    await cleanup(request, user)
    // Without the socket every write is a POST, which this test fails as a dead network would.
    const { context, page: unused } = await configured(browser, { realtime: false })
    await unused.close()
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, user)
      await gotoApp(page, "/groups", page.locator("[data-e2e=group-list]"))
      await expect.poll(() => recordsIn(page, `reads:${userId}`)).toBeGreaterThan(0)
      await expect.poll(() => recordsIn(page, `offline:user:${userId}:notes`)).toBeGreaterThan(0)
      await context.route("**/api/call/note.update", (route) => route.abort("internetdisconnected"))
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=session-current]"))

      await askToSignOut(page)
      await page.locator("[data-e2e=unsent-sign-out-anyway]").click()
      await page.locator("[data-e2e=auth-form-login]").waitFor()

      await expect.poll(() => databases(page)).toEqual([])
      // Only what finishes a sign-out and the device's own answers may stay (`KEPT_KEYS`).
      const left = await page.evaluate(() => Object.keys(localStorage))
      expect(
        left.filter((key) =>
          !["auth:sign-out-owed", "theme", "install-prompt-dismissed", "last-sign-in"].includes(key)
        ),
      ).toEqual([])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("signing out with an unsent edit asks first, and Send, then sign out sends it before signing out", async ({ browser, request }) => {
    const user = "e2e_local_data_sign_out_wait@example.com"
    await cleanup(request, user)
    const { context, page: unused } = await configured(browser, { realtime: false })
    await unused.close()
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, user)
      await context.route("**/api/call/note.update", (route) => route.abort("internetdisconnected"))
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=session-current]"))

      await askToSignOut(page)
      const dialog = page.getByRole("dialog", { name: "You have 1 unsent change" })
      await expect(dialog).toBeVisible()
      await expect(page.locator("[data-e2e=unsent-wait]")).toBeFocused()
      await page.locator("[data-e2e=unsent-wait]").click()
      await expect(page.locator("[data-e2e=unsent-status]")).toContainText(
        "Couldn't reach the server. Trying again…",
      )
      await expect(page.locator("[data-e2e=session-current]")).toBeAttached()

      await context.unroute("**/api/call/note.update")
      await page.locator("[data-e2e=auth-form-login]").waitFor({ timeout: 30_000 })

      expect(await recordsIn(page, `offline:user:${userId}:outbox`)).toBe(0)
      const api = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      try {
        const signedIn = await api.newPage()
        await signIn(signedIn, user, password)
        await expect.poll(async () => {
          const response = await signedIn.request.get(`${apiBase}/api/groups/${groupId}/notes`)
          return (await response.json()).notes.map((note: { title: string }) => note.title)
        }).toEqual(["Edited before the update"])
      } finally {
        await api.close()
      }
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("Cancel in the unsent-changes question keeps the person signed in with the queue", async ({ browser, request }) => {
    const user = "e2e_local_data_sign_out_cancel@example.com"
    await cleanup(request, user)
    const { context, page: unused } = await configured(browser, { realtime: false })
    await unused.close()
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, user)
      await context.route("**/api/call/note.update", (route) => route.abort("internetdisconnected"))
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=session-current]"))

      await askToSignOut(page)
      await page.locator("[data-e2e=unsent-dialog]").waitFor()
      await page.locator("[data-e2e=unsent-cancel]").click()

      await expect(page.locator("[data-e2e=unsent-dialog]")).toHaveCount(0)
      // A fresh start asks the server who is signed in, so a sign-out in flight cannot pass.
      await gotoApp(page, "/profile/security", page.locator("[data-e2e=session-current]"))
      expect(await recordsIn(page, `offline:user:${userId}:outbox`)).toBe(1)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a queue left on the device is sent once after the module is switched off, and the device then holds none", async ({ browser, request }) => {
    const user = "e2e_local_data_off_queue@example.com"
    await cleanup(request, user)
    const { context, page: unused } = await configured(browser, {})
    await unused.close()
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, user)
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))
      await context.unroute("**/config.json")
      await context.route(
        "**/config.json",
        (route) => route.fulfill({ json: { env: "dev", offline: false } }),
      )

      await gotoApp(page, "/notes", page.locator("[data-e2e=note-list]"))

      await expect.poll(async () => {
        const response = await page.request.get(`${apiBase}/api/groups/${groupId}/notes`)
        return (await response.json()).notes.map((note: { title: string }) => note.title)
      }).toEqual(["Edited before the update"])
      await expect.poll(() => databases(page)).not.toContain(`offline:user:${userId}:outbox`)
      await expect(page.locator("[data-e2e=offline-queue-refused]")).toHaveCount(0)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("with the module switched off, a queued write the server refuses is dropped and named in a warning", async ({ browser, request }) => {
    const user = "e2e_local_data_off_refused@example.com"
    await cleanup(request, user)
    const { context, page: unused } = await configured(browser, {})
    await unused.close()
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, user)
      // The note moves on to version 2, so an edit made on version 1 is refused.
      const moved = await page.request.patch(`${apiBase}/api/groups/${groupId}/notes/${noteId}`, {
        headers,
        data: { title: "Changed elsewhere", body: "", version: 1 },
      })
      expect(moved.ok(), await moved.text()).toBe(true)
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))
      await context.unroute("**/config.json")
      await context.route(
        "**/config.json",
        (route) => route.fulfill({ json: { env: "dev", offline: false } }),
      )

      await gotoApp(page, "/notes", page.locator("[data-e2e=note-list]"))

      await expect(page.locator("[data-e2e=offline-queue-refused]")).toContainText(
        `1 change you made offline couldn't be saved: "Edited before the update".`,
      )
      await expect.poll(() => databases(page)).not.toContain(`offline:user:${userId}:outbox`)
      await expect(page.locator("[data-e2e=note-item-title]")).toHaveText(["Changed elsewhere"])
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a start while the proxy answers 502 for the API keeps the person signed in on their saved notes", async ({ browser, request }) => {
    const user = "e2e_local_data_deploy@example.com"
    await cleanup(request, user)
    // Without the socket every call is an HTTP request, which this test answers as the proxy does.
    const { context, page: unused } = await configured(browser, { realtime: false })
    await unused.close()
    try {
      const { page, userId } = await deviceWithNote(context, request, user)
      await expect(page.locator("[data-e2e=note-list]")).toContainText("Before the update")
      await expect.poll(() => recordsIn(page, `reads:${userId}`)).toBeGreaterThan(0)
      await expect.poll(() => recordsIn(page, `offline:user:${userId}:notes`)).toBeGreaterThan(0)

      // A deploy: the API's container is being replaced, and the proxy answers in its place.
      await context.route(
        (url) => url.pathname.startsWith("/api/"),
        (route) =>
          route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad Gateway</h1>" }),
      )
      await gotoApp(page, "/notes", page.locator("[data-e2e=note-list]"))

      await expect(page.locator("[data-e2e=note-list]")).toContainText("Before the update")
      await expect(page.locator("[data-e2e=auth-form-login]")).toHaveCount(0)
      expect(await recordsIn(page, `reads:${userId}`)).toBeGreaterThan(0)
      expect(await recordsIn(page, `offline:user:${userId}:notes`)).toBeGreaterThan(0)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("a start with another person's session, as a provider sign-in's redirect brings it, deletes the copies and the queue of the person the browser remembered", async ({ browser, request }) => {
    const first = "e2e_local_data_switch_first@example.com"
    const second = "e2e_local_data_switch_second@example.com"
    await cleanup(request, first)
    await cleanup(request, second)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    const elsewhere = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const { page, groupId, noteId, userId } = await deviceWithNote(context, request, first)
      await gotoApp(page, "/groups", page.locator("[data-e2e=group-list]"))
      await expect.poll(() => recordsIn(page, `reads:${userId}`)).toBeGreaterThan(0)
      await expect.poll(() => recordsIn(page, `offline:user:${userId}:notes`)).toBeGreaterThan(0)
      // A tag, so the tags copy holds something to delete.
      const tags = new TagsPage(page)
      await tags.open()
      await tags.create("Urgent")
      await expect.poll(() => recordsIn(page, `offline:user:${userId}:tags`)).toBeGreaterThan(0)
      await queueAsEarlierVersion(page, userId, editQueuedLastWeek(groupId, noteId))
      await signUp(request, second)
      const other = await elsewhere.newPage()
      await signIn(other, second, password)
      const me = await other.request.get(`${apiBase}/api/auth/me`)
      expect(me.ok(), await me.text()).toBe(true)
      const secondId = (await me.json() as { id: number }).id

      // The provider's callback sets the second person's session cookie and redirects to the app,
      // which this browser still remembers as the first person's. No sign-out happens in between.
      await context.clearCookies()
      await context.addCookies(await elsewhere.cookies())
      await gotoApp(page, "/groups", page.locator("[data-e2e=group-list]"))
      // The app has seen the second person's session: it remembers them now.
      await expect.poll(() =>
        page.evaluate(() => JSON.parse(localStorage.getItem("offline:session") ?? "null")?.id)
      ).toBe(secondId)

      await expect.poll(() => recordsIn(page, `reads:${userId}`)).toBe(0)
      expect(await recordsIn(page, `offline:user:${userId}:notes`)).toBe(0)
      expect(await recordsIn(page, `offline:user:${userId}:tags`)).toBe(0)
      expect(await recordsIn(page, `offline:user:${userId}:outbox`)).toBe(0)
    } finally {
      await elsewhere.close()
      await context.close()
      await cleanup(request, first)
      await cleanup(request, second)
    }
  })

  test("a start that finds no session deletes the read copies of the person it remembered, before the sign-in page", async ({ browser, request }) => {
    const user = "e2e_local_data_no_session@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      const { page, userId } = await deviceWithNote(context, request, user)
      await gotoApp(page, "/groups", page.locator("[data-e2e=group-list]"))
      await expect.poll(() => recordsIn(page, `reads:${userId}`)).toBeGreaterThan(0)

      // The session ends elsewhere: the cookie is gone, and the server says so at the next start.
      await context.clearCookies()
      await gotoApp(page, "/notes", page.locator("[data-e2e=auth-form-login]"))

      expect(await recordsIn(page, `reads:${userId}`)).toBe(0)
      expect(await recordsIn(page, `offline:user:${userId}:notes`)).toBe(0)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})
