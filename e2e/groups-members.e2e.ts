import { type APIRequestContext, type Browser, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { groupLink } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** Removes `email`'s account; `soft` only records a failure, for the `finally` of a test. */
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

/** A signed-in page in its own browser context, so two people use the app side by side. */
async function personPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  return page
}

/** Creates a group as the person signed in on `page` and adds `member` to it with `role`. */
async function teamWith(
  page: Page,
  request: APIRequestContext,
  member: string,
  role: number,
): Promise<string> {
  const groupId = uuidV7()
  const created = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name: "Team" },
  })
  expect(created.status(), await created.text()).toBe(201)
  const added = await request.post(`${apiBase}/api/test/add-member`, {
    data: { login: member, groupId, role },
  })
  expect(added.status(), await added.text()).toBe(200)
  return groupId
}

/**
 * Makes every WebSocket the page opens from now on start `ms` late, so the page has read the
 * group over REST well before the server adopts its socket. A page on a slow machine is in this
 * state for a moment after every load.
 */
async function delaySockets(page: Page, ms: number) {
  await page.addInitScript((delay) => {
    const Native = globalThis.WebSocket
    class Delayed extends EventTarget {
      readyState = 0
      binaryType = "blob"
      real: WebSocket | null = null
      constructor(url: string, protocols?: string | string[]) {
        super()
        setTimeout(() => {
          const real = new Native(url, protocols)
          this.real = real
          for (const type of ["open", "message", "close", "error"]) {
            real.addEventListener(type, (event) => {
              this.readyState = real.readyState
              const copy = event instanceof MessageEvent
                ? new MessageEvent(type, { data: event.data })
                : event instanceof CloseEvent
                ? new CloseEvent(type, { code: event.code, reason: event.reason })
                : new Event(type)
              this.dispatchEvent(copy)
              ;(this as unknown as Record<string, ((e: Event) => void) | undefined>)[`on${type}`]?.(
                copy,
              )
            })
          }
        }, delay)
      }
      send(data: string) {
        this.real?.send(data)
      }
      close(code?: number, reason?: string) {
        this.real?.close(code, reason)
      }
    }
    Object.assign(Delayed, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    Object.assign(globalThis, { WebSocket: Delayed })
  }, ms)
}

const settingsReady = (page: Page) => page.locator("[data-e2e=group-general-name]")

test.describe("group members", () => {
  test("the owner demotes and then removes a member, and the member's open page follows without a reload", async ({ page, browser, request }) => {
    const owner = "e2e_members_owner@example.com"
    const member = "e2e_members_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = await teamWith(page, request, member, 2)

      memberPage = await personPage(browser, member)
      await gotoApp(memberPage, `/groups/${groupId}/members`, settingsReady(memberPage))
      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")
      // An editor reads the members but has no control over them.
      await expect(memberPage.locator("[data-e2e=group-member]")).toHaveCount(2)
      await expect(memberPage.locator("[data-e2e=group-member-menu]")).toHaveCount(0)
      // Mark the page, so a reload would show as a missing mark.
      await memberPage.evaluate(() => Object.assign(globalThis, { notReloaded: true }))

      await gotoApp(page, `/groups/${groupId}/members`, settingsReady(page))
      const row = page.locator("[data-e2e=group-member]").filter({ hasText: member })
      await row.getByRole("button", { name: `Actions for ${member}` }).click()
      await page.getByRole("menuitem", { name: "Make Viewer" }).click()
      await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Viewer")

      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Viewer")
      await expect(memberPage.locator(`[data-user-id] [data-e2e=group-member-role]`).last())
        .toHaveText("Viewer")

      await row.getByRole("button", { name: `Actions for ${member}` }).click()
      await page.getByRole("menuitem", { name: "Remove from group" }).click()
      await page.locator("[data-e2e=group-member-remove-dialog]")
        .getByRole("button", { name: "Remove member" }).click()
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)

      await expect(memberPage.getByText("This group does not exist.")).toBeVisible()
      expect(await memberPage.evaluate(() => "notReloaded" in globalThis)).toBe(true)
      const refused = await memberPage.request.get(`${apiBase}/api/groups/${groupId}/members`)
      expect(refused.status()).toBe(404)
    } finally {
      await memberPage?.context().close()
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })

  test("a member's page that opens its socket late still learns of a role change made before it", async ({ page, browser, request }) => {
    const owner = "e2e_members_late_owner@example.com"
    const member = "e2e_members_late_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = await teamWith(page, request, member, 2)

      memberPage = await personPage(browser, member)
      await delaySockets(memberPage, 2_500)
      await gotoApp(memberPage, `/groups/${groupId}/members`, settingsReady(memberPage))
      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")
      await expect(memberPage.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")

      // The member's page has its answer from REST, and its socket is not yet known to the server.
      await gotoApp(page, `/groups/${groupId}/members`, settingsReady(page))
      const row = page.locator("[data-e2e=group-member]").filter({ hasText: member })
      await row.getByRole("button", { name: `Actions for ${member}` }).click()
      await page.getByRole("menuitem", { name: "Make Viewer" }).click()
      await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Viewer")
      await expect(memberPage.locator("[data-e2e=shell-ws-status]")).not.toHaveText("Online")

      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Viewer", {
        timeout: 15_000,
      })
    } finally {
      await memberPage?.context().close()
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })

  test("a member leaves a group, and the owner has no way to leave it", async ({ page, browser, request }) => {
    const owner = "e2e_members_leave_owner@example.com"
    const member = "e2e_members_leave_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    let memberPage: Page | null = null
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = await teamWith(page, request, member, 1)

      await gotoApp(page, `/groups/${groupId}/members`, settingsReady(page))
      await page.getByRole("button", { name: "More actions" }).click()
      await expect(page.getByRole("menuitem", { name: "Delete group" })).toBeVisible()
      await expect(page.locator("[data-e2e=group-leave-open]")).toHaveCount(0)
      await page.keyboard.press("Escape")

      memberPage = await personPage(browser, member)
      await gotoApp(memberPage, `/groups/${groupId}/members`, settingsReady(memberPage))
      await memberPage.getByRole("button", { name: "More actions" }).click()
      await memberPage.getByRole("menuitem", { name: "Leave group" }).click()
      const dialog = memberPage.locator("[data-e2e=group-leave-dialog]")
      await expect(dialog).toContainText('Leave "Team"?')
      await dialog.getByRole("button", { name: "Leave group" }).click()
      await expect(memberPage).toHaveURL("/groups")
      await expect(memberPage.locator("[data-e2e=group-item-name]")).toHaveText(["Personal"])

      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(1)
    } finally {
      await memberPage?.context().close()
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })

  test("the groups list draws each group as one link, with no member avatars", async ({ page, request }) => {
    const owner = "e2e_members_stack_owner@example.com"
    const member = "e2e_members_stack_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await teamWith(page, request, member, 1)

      const heading = page.getByRole("heading", { level: 1, name: "Groups" })
      await gotoApp(page, "/groups", heading)
      await expect(groupLink(page, "Team")).toBeVisible()
      await expect(groupLink(page, "Personal")).toBeVisible()
      await expect(page.getByLabel(/^Members of /)).toHaveCount(0)
    } finally {
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })
})
