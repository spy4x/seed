import { type APIRequestContext, type Page } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const ADMIN = 3

/** The WCAG A and AA rules axe-core checks a page against. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** Every axe-core violation inside the page's `<main>`, as `rule: target` lines. */
async function violationsInMain(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).include("main").withTags(WCAG_TAGS)
    .analyze()
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

/** How far the page scrolls sideways; 0 or less when it does not. */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe("group screens in the shared column", () => {
  test("New group in the group switcher opens the create dialog, and closing it drops ?new", async ({ page, request }) => {
    const email = "e2e_groups_layout_new@example.com"
    await cleanup(request, email)
    try {
      await signUp(request, email)
      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.locator("[data-e2e=group-picker]").click()
      await page.getByRole("menuitem", { name: "New group" }).click()
      await expect(page).toHaveURL("/groups?new")
      const dialog = page.getByRole("dialog", { name: "New group" })
      await expect(dialog.getByLabel("Name")).toBeFocused()

      await dialog.getByRole("button", { name: "Cancel" }).click()
      await expect(dialog).toBeHidden()
      await expect(page).toHaveURL("/groups")

      // Again from the groups page itself, then through to a created group.
      await page.locator("[data-e2e=group-picker]").click()
      await page.getByRole("menuitem", { name: "New group" }).click()
      await dialog.getByLabel("Name").fill("Book club")
      await dialog.getByRole("button", { name: "Create group" }).click()
      await expect(dialog).toBeHidden()
      await expect(page).toHaveURL("/groups")
      await expect(page.locator("[data-e2e=group-item-name]").filter({ hasText: "Book club" }))
        .toHaveCount(1)
    } finally {
      await cleanup(request, email, true)
    }
  })

  test("groups, settings, activity and pricing pass axe-core and fit a phone and a desktop", async ({ page, request }) => {
    const owner = "e2e_groups_layout_owner@example.com"
    const admin = "e2e_groups_layout_admin@example.com"
    for (const email of [owner, admin]) await cleanup(request, email)
    try {
      for (const email of [owner, admin]) await signUp(request, email)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "A team with a long name that has to wrap on a phone" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: admin, groupId, role: ADMIN },
      })
      expect(added.status(), await added.text()).toBe(200)
      const invited = await page.request.post(`${apiBase}/api/groups/${groupId}/invitations`, {
        headers,
        data: { role: 1, expiresInDays: 7, maxUses: 1, email: null, sendEmail: false },
      })
      expect(invited.status(), await invited.text()).toBe(201)
      const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: uuidV7(), title: "Plan", body: "" },
      })
      expect(note.status(), await note.text()).toBe(201)

      const screens = [
        { path: "/groups", ready: page.locator("[data-e2e=group-list]") },
        { path: `/groups/${groupId}`, ready: page.locator("[data-e2e=group-member]").first() },
        {
          path: `/groups/${groupId}/activity`,
          ready: page.locator("[data-e2e=activity-note-link]").first(),
        },
        { path: `/groups/${groupId}/pricing`, ready: page.locator("[data-e2e=pricing-plans]") },
      ]
      // Tall enough that no row sits under the phone's fixed tab bar: axe-core's target-size
      // rule counts a control the bar covers as too small, wherever the page happens to scroll.
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 1600 })
        for (const { path, ready } of screens) {
          await gotoApp(page, path, ready)
          await expect(ready).toBeVisible()
          expect(await violationsInMain(page), `${path} at ${width} px`).toEqual([])
          expect(await overflow(page), `${path} scrolls sideways at ${width} px`)
            .toBeLessThanOrEqual(0)
        }
      }

      // "Open the note" is a link that looks like one and opens the note.
      const link = page.locator("[data-e2e=activity-note-link]").first()
      await gotoApp(page, `/groups/${groupId}/activity`, link)
      expect(await link.evaluate((element) => getComputedStyle(element).textDecorationLine))
        .toBe("underline")
      await expect(page.getByRole("link", { name: "Back to group settings" })).toHaveCount(0)
      await link.click()
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)

      // The one plan's card sits in the middle of the column.
      const plans = page.locator("[data-e2e=pricing-plans]")
      await gotoApp(page, `/groups/${groupId}/pricing`, plans)
      const { left, right } = await plans.evaluate((element) => {
        const own = element.getBoundingClientRect()
        const column = element.parentElement!.getBoundingClientRect()
        return { left: own.left - column.left, right: column.right - own.right }
      })
      expect(left).toBeGreaterThan(0)
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
    } finally {
      for (const email of [owner, admin]) await cleanup(request, email, true)
    }
  })
})
