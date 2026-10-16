/**
 * Where the signed-out cards and the notifications inbox sit on a phone and on a desktop, in both
 * palettes, measured in a real browser with the app's own CSS: the unit tests see class names,
 * this sees whether Tailwind emitted them. Each page is checked with axe-core and photographed
 * into the test's output folder.
 */
import { type APIRequestContext, type Locator, type Page } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
const VIEWER = 1

/** The widths of the spec (#433) and of the design review, a phone's and a desktop's, in both palettes. */
const VIEWS = [375, 390, 1280, 1440].flatMap((width) =>
  (["light", "dark"] as const).map((scheme) => ({ width, scheme }))
)

/** Every axe-core violation on the page, as `rule: target` lines a failure message can show. */
async function accessibilityViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error(`${locator} has no box`)
  return found
}

/** The page scrolls sideways when its content is wider than the window. */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > globalThis.innerWidth)
}

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

test.describe("layout of the signed-out cards and the inbox", () => {
  test("sign-in, sign-up, forgot-password and subscribe sit in a padded 28 rem column with a full-width button", async ({ page }) => {
    test.setTimeout(240_000)
    for (const { width, scheme } of VIEWS) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme: scheme })
      for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/subscribe"]) {
        const view = `${path} at ${width} px, ${scheme}`
        const card = page.locator("main .pc-card").first()
        await gotoApp(page, path, card.locator("button[type=submit]"))
        const cardBox = await box(card)
        const submit = await box(card.locator("button[type=submit]"))
        // The brand row above the card keeps its top padding (`pt-8`).
        expect(cardBox.y, view).toBeGreaterThanOrEqual(32)
        // The submit button spans the card's body: the card less its border and its padding (at
        // most 32 px) on each side.
        expect(submit.width, view).toBeGreaterThanOrEqual(cardBox.width - 2 * (1 + 32))
        if (width >= 1280) {
          expect(cardBox.width, view).toBeLessThanOrEqual(448)
          const left = cardBox.x
          const right = width - (cardBox.x + cardBox.width)
          expect(Math.abs(left - right), view).toBeLessThanOrEqual(1)
        } else {
          // The column fills the phone, less the 16 px gutter on each side.
          expect(cardBox.width, view).toBeGreaterThanOrEqual(width - 2 * 16 - 1)
        }
        expect(await scrollsSideways(page), view).toBe(false)
        expect(await accessibilityViolations(page), view).toEqual([])
        await page.screenshot({
          path: test.info().outputPath(`${path.slice(1)}-${scheme}-${width}.png`),
          fullPage: true,
        })
      }
    }
  })

  test("the inbox shares the 48 rem column and marks the unread row", async ({ page, browser, request }) => {
    test.setTimeout(240_000)
    const id = uuidV7().slice(-8)
    const owner = `e2e-layout-owner-${id}@example.com`
    const member = `e2e-layout-member-${id}@example.com`
    for (const email of [owner, member]) await cleanup(request, email)
    const ownerContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    const ownerApi = ownerContext.request
    try {
      await signUp(ownerApi, owner)
      const groupId = uuidV7()
      const created = await ownerApi.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      await signUp(request, member)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: 2 },
      })
      expect(added.status(), await added.text()).toBe(200)
      const members = await (await ownerApi.get(`${apiBase}/api/groups/${groupId}/members`)).json()
      const memberId: number = members.members.find((m: { email?: string }) =>
        m.email === member
      ).userId
      // Two notifications for the member: a role change, then a removal; the first is read.
      const changed = await ownerApi.patch(`${apiBase}/api/groups/${groupId}/members/${memberId}`, {
        headers,
        data: { role: VIEWER },
      })
      expect(changed.status(), await changed.text()).toBe(200)
      const removed = await ownerApi.delete(
        `${apiBase}/api/groups/${groupId}/members/${memberId}`,
        { headers },
      )
      expect(removed.status(), await removed.text()).toBe(200)

      await signIn(page, member, password)
      const inbox = await (await page.request.get(`${apiBase}/api/notifications`)).json()
      const oldest = inbox.notifications.at(-1).id
      const read = await page.request.post(`${apiBase}/api/notifications/${oldest}/read`, {
        headers,
      })
      expect(read.status(), await read.text()).toBe(200)

      for (const { width, scheme } of VIEWS) {
        const view = `/notifications at ${width} px, ${scheme}`
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme: scheme })
        const list = page.locator("[data-e2e=notifications-list]")
        await gotoApp(page, "/notifications", list.locator("li").nth(1))
        await expect(list.locator("li[data-unread=true]"), view).toHaveCount(1)
        const main = await box(page.locator("main"))
        const card = await box(list.locator(".."))
        const header = await box(page.locator("[data-e2e=page-header]"))
        // The list and the page header share one column, centred in the content area.
        expect(Math.abs(card.x - header.x), view).toBeLessThanOrEqual(1)
        expect(Math.abs(card.width - header.width), view).toBeLessThanOrEqual(1)
        expect(card.width, view).toBeLessThanOrEqual(768)
        const left = card.x - main.x
        const right = main.x + main.width - (card.x + card.width)
        expect(Math.abs(left - right), view).toBeLessThanOrEqual(1)
        for (const row of await list.locator("[data-e2e=notification-link]").all()) {
          expect((await box(row)).height, view).toBeGreaterThanOrEqual(56)
        }
        expect(await scrollsSideways(page), view).toBe(false)
        expect(await accessibilityViolations(page), view).toEqual([])
        await page.screenshot({
          path: test.info().outputPath(`notifications-${scheme}-${width}.png`),
          fullPage: true,
        })
      }
    } finally {
      await ownerContext.close()
      for (const email of [owner, member]) await cleanup(request, email, { soft: true })
    }
  })
})
