import { type APIRequestContext, type Page } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

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
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
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
  test("New group in the group switcher opens the create page, which creates the group with every field in one go", async ({ page, request }) => {
    const email = "e2e_groups_layout_new@example.com"
    await cleanup(request, email)
    try {
      await signUp(request, email)
      const framesSent: string[] = []
      page.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      await signIn(page, email, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")

      await page.locator("[data-e2e=group-picker]").click()
      await page.getByRole("menuitem", { name: "New group" }).click()
      await expect(page).toHaveURL("/groups/new")
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("New group")
      await expect(page.getByRole("dialog")).toHaveCount(0)

      // Cancel goes back to the list; leaving an untouched form asks nothing.
      await page.locator("[data-e2e=group-cancel]").click()
      await expect(page).toHaveURL("/groups")

      // Again, through to a created group with a description, a colour and an emoji.
      await page.locator("[data-e2e=group-picker]").click()
      await page.getByRole("menuitem", { name: "New group" }).click()
      await page.getByLabel("Name").fill("Book club")
      await page.locator("[data-e2e=group-description]").fill("One book a month")
      await page.locator("[data-e2e=group-color]").getByTitle("Purple", { exact: true }).click()
      await page.locator("[data-e2e=group-emoji]").fill("📚")
      await expect(page.getByRole("radio", { name: "Purple" })).toBeChecked()
      await page.getByRole("button", { name: "Create group" }).click()

      await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Book club")
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused()
      await expect(page.locator("[data-e2e=group-created]")).toContainText("Book club")
      await expect(page.locator("[data-e2e=group-current]")).toBeVisible()
      await expect(page.locator("[data-e2e=page-header] [data-e2e=group-mark]")).toHaveText("📚")

      // Read again from the server: one write stored every field.
      await page.reload()
      await expect(page.locator("[data-e2e=group-description]")).toHaveValue("One book a month")
      await expect(page.getByRole("radio", { name: "Purple" })).toBeChecked()
      await expect(page.locator("[data-e2e=group-emoji]")).toHaveValue("📚")
      // One command carried every field; no rename or details update followed it. Making the
      // group current is a choice of the person, not a write to the group, so it is left out.
      const groupCommands = framesSent.map((payload) => JSON.parse(payload)).filter(
        (frame) =>
          frame.kind === "client.command" && String(frame.name).startsWith("group.") &&
          frame.name !== "group.select",
      )
      expect(groupCommands.map((frame) => frame.name)).toEqual(["group.create"])
      const sent = JSON.stringify(groupCommands[0])
      for (const field of ["One book a month", "#7e22ce", "📚"]) expect(sent).toContain(field)
    } finally {
      await cleanup(request, email, true)
    }
  })

  test("groups, each tab of a group and import pass axe-core and fit a phone and a desktop", async ({ page, request }) => {
    // Six screens at two widths, each through axe-core on the dev server, outgrow the default 30 s.
    test.setTimeout(90_000)
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
        { path: `/groups/${groupId}`, ready: page.locator("[data-e2e=group-name]") },
        {
          path: `/groups/${groupId}/members`,
          ready: page.locator("[data-e2e=group-member]").first(),
        },
        {
          path: `/groups/${groupId}/activity`,
          ready: page.locator("[data-e2e=activity-note-link]").first(),
        },
        { path: `/groups/${groupId}/billing`, ready: page.locator("[data-e2e=billing-plan]") },
        { path: `/groups/import`, ready: page.locator("[data-e2e=group-import-title]") },
      ]
      // Tall enough that no row sits under the phone's fixed tab bar: axe-core's target-size
      // rule counts a control the bar covers as too small, wherever the page happens to scroll.
      // A group's General tab holds its whole editor, so it needs the most.
      for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 2400 })
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
    } finally {
      for (const email of [owner, admin]) await cleanup(request, email, true)
    }
  })
})
