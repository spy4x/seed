import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, submitAuthForm } from "./fixtures/app.ts"

/**
 * The core flows on a page whose `/config.json` says `realtime: false` (ADR 003, "the proof of the
 * swap"): the page signs up and in, writes notes and groups over `POST /api/call/<name>`, and a
 * second browser follows through the timer. Every context here fails its test when a WebSocket is
 * opened.
 */

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

const EDITOR = 2
/** The page reads again every 30 seconds while it is visible; one period, and time to read. */
const WITHIN_ONE_POLL = 45_000

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

interface SocketFree {
  context: BrowserContext
  page: Page
  /** The URLs of the WebSockets the page opened, and the calls it posted. */
  sockets: string[]
  calls: string[]
}

/**
 * A browser whose app is told to run without the socket. The service worker is blocked so the
 * answer to `/config.json` is the test's, not a stored one.
 */
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

async function signUpInBrowser(page: Page, email: string): Promise<void> {
  await gotoApp(page, "/sign-up", page.locator("[data-e2e=auth-form-login]"))
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await submitAuthForm(page, "/", page.locator("[data-e2e=shell-ws-status]"))
}

async function signInBrowser(page: Page, email: string): Promise<void> {
  await gotoApp(page, "/sign-in", page.locator("[data-e2e=auth-form-login]"))
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await submitAuthForm(page, "/", page.locator("[data-e2e=shell-ws-status]"))
}

async function openGroups(page: Page): Promise<void> {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", {
    name: "Groups",
  }).click()
}

async function openNotes(page: Page, groupName: string): Promise<void> {
  await openGroups(page)
  await page.getByRole("button", { name: `Open notes in ${groupName}` }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Notes", exact: true })).toBeVisible()
  await expect(page.locator("[data-e2e=notes-group]")).toHaveText(groupName)
}

test.describe("the app with the WebSocket module switched off", () => {
  test("a person signs up, signs in again, and creates a group and creates, edits and deletes a note without a socket", async ({ browser, request }) => {
    const email = "e2e_realtime_off_solo@example.com"
    await cleanup(request, email)
    const { context, page, sockets, calls } = await socketFree(browser)
    try {
      await signUpInBrowser(page, email)
      // With no socket the indicator shows the browser's network.
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      // Sign out and in again, through the forms.
      await page.locator("[data-e2e=shell-user-menu-button]").click()
      await page.getByRole("menuitem", { name: "Sign out" }).click()
      await page.locator("[data-e2e=signin-required]").waitFor()
      await signInBrowser(page, email)

      // A group.
      await openGroups(page)
      await page.locator("[data-e2e=group-new]").click()
      await page.locator("[data-e2e=group-name]").fill("Socket-free team")
      await page.locator("[data-e2e=group-create]").click()
      await expect(
        page.locator("[data-e2e=group-item-name]").filter({ hasText: "Socket-free team" }),
      ).toHaveCount(1)

      // A note: created, edited, deleted.
      await openNotes(page, "Socket-free team")
      const titles = page.locator("[data-e2e=note-item-title]")
      await page.locator("[data-e2e=note-new]").click()
      await page.locator("[data-e2e=note-title]").fill("Groceries")
      await page.locator("[data-e2e=note-body]").fill("milk")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await page.locator("[data-e2e=page-back]").click()
      await expect(titles).toHaveText(["Groceries"])

      await page.getByRole("link", { name: "Groceries" }).click()
      await page.locator("[data-e2e=note-title]").fill("Groceries for Friday")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL("/notes")
      await expect(titles).toHaveText(["Groceries for Friday"])

      // A reload reads the same list from the server.
      await page.reload()
      await expect(titles).toHaveText(["Groceries for Friday"])

      await page.getByRole("link", { name: "Groceries for Friday" }).click()
      await page.locator("[data-e2e=note-menu]").click()
      await page.getByRole("menuitem", { name: "Delete" }).click()
      await page.locator("[data-e2e=note-delete-dialog]")
        .getByRole("button", { name: "Delete", exact: true }).click()
      await expect(page).toHaveURL("/notes")
      await expect(titles).toHaveCount(0)

      expect(calls).toEqual(
        expect.arrayContaining(["group.create", "note.create", "note.update", "note.delete"]),
      )
      expect(sockets).toEqual([])
    } finally {
      await context.close()
      await cleanup(request, email)
    }
  })

  test("a note written in one browser shows in another browser's open tab within one poll, without a socket or a reload", async ({ browser, request }) => {
    test.setTimeout(150_000)
    const owner = "e2e_realtime_off_owner@example.com"
    const member = "e2e_realtime_off_member@example.com"
    for (const email of [owner, member]) await cleanup(request, email)
    const first = await socketFree(browser)
    const second = await socketFree(browser)
    try {
      for (const email of [owner, member]) {
        const response = await request.post(`${apiBase}/api/auth/password/sign-up`, {
          headers,
          data: { email, password },
        })
        expect(response.ok(), await response.text()).toBe(true)
      }
      await signInBrowser(first.page, owner)
      const groupId = crypto.randomUUID()
      const created = await first.page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Polling team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: EDITOR },
      })
      expect(added.status(), await added.text()).toBe(200)

      await signInBrowser(second.page, member)
      await openNotes(second.page, "Polling team")
      await expect(second.page.getByText("No notes yet.")).toBeVisible()
      let loads = 0
      second.page.on("load", () => loads++)

      await first.page.reload()
      await openNotes(first.page, "Polling team")
      await first.page.locator("[data-e2e=note-new]").click()
      await first.page.locator("[data-e2e=note-title]").fill("From the first browser")
      await first.page.locator("[data-e2e=note-save]").click()
      await expect(first.page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)

      // The second browser is told nothing: its timer finds the group's sequence moved.
      const memberTitles = second.page.locator("[data-e2e=note-item-title]")
      await expect(memberTitles).toHaveText(["From the first browser"], {
        timeout: WITHIN_ONE_POLL,
      })

      // And the other way round.
      await first.page.locator("[data-e2e=page-back]").click()
      await second.page.locator("[data-e2e=note-new]").click()
      await second.page.locator("[data-e2e=note-title]").fill("From the second browser")
      await second.page.locator("[data-e2e=note-save]").click()
      await expect(second.page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await expect(first.page.locator("[data-e2e=note-item-title]")).toHaveText(
        ["From the second browser", "From the first browser"],
        { timeout: WITHIN_ONE_POLL },
      )

      expect(loads).toBe(0)
      expect([...first.sockets, ...second.sockets]).toEqual([])
    } finally {
      await first.context.close()
      await second.context.close()
      for (const email of [owner, member]) await cleanup(request, email)
    }
  })
})
