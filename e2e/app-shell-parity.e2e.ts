import type { APIRequestContext, Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The SPA and the admin draw the same frame, the library's `AppShell` (#516): at 1440 px the same
 * 72 px rail of 48 px cells with the page centred in the rest of the window, and at 390 px the same
 * tab bar in place of the rail. Measured in a real browser, because happy-dom lays nothing out.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

/**
 * The onboarding tour's targets in the rail's bottom zone, as `TOUR_STEPS` in
 * `libs/ui/onboarding-card.tsx` names them (its unit test pins the same strings). A step whose
 * target matches nothing loses its spotlight without failing anything else.
 */
const TOUR_TARGETS = [
  `[data-e2e="rail-shell-rail"] a[href="/notes"]`,
  `[data-e2e="rail-shell-rail"] a[href="/groups"]`,
  `[data-e2e="rail-shell-bottom"] a[href="/notifications"]`,
  `[data-e2e="rail-shell-bottom"] [data-e2e="account-menu-button"]`,
]

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

interface Layout {
  /** The rail's own width, without the border that divides it from the page. */
  rail: number
  cell: { width: number; height: number }
  /** The gap between the rail and the page's column, and between the column and the window. */
  gaps: { left: number; right: number }
  /** How far the rail starts from the window's left edge. */
  railX: number
}

/** Where the page's column and its heading start from the top of the window. */
interface Tops {
  column: number
  heading: number
}

/** The rail's width, its first navigation cell, and where the page's column sits beside it. */
async function measure(page: Page): Promise<Layout> {
  const column = page.locator("[data-e2e=rail-shell-column]")
  const cell = page.locator("[data-e2e=rail-shell-rail] [data-e2e=rail-shell-entry]").first()
  const content = page.locator("[data-e2e=app-shell-content]")
  await expect(column).toBeVisible()
  const [railBox, cellBox, contentBox] = await Promise.all([
    column.boundingBox(),
    cell.boundingBox(),
    content.boundingBox(),
  ])
  if (!railBox || !cellBox || !contentBox) throw new Error("The shell drew no rail or no page.")
  const windowWidth = await page.evaluate(() => document.documentElement.clientWidth)
  return {
    // Inside its 1 px border, which `boundingBox` would count.
    rail: await column.evaluate((element) => element.clientWidth),
    cell: { width: cellBox.width, height: cellBox.height },
    gaps: {
      left: contentBox.x - (railBox.x + railBox.width),
      right: windowWidth - (contentBox.x + contentBox.width),
    },
    railX: railBox.x,
  }
}

/** The top of the page's column and of its first heading, at the current window size. */
async function tops(page: Page): Promise<Tops> {
  const heading = page.locator("[data-e2e=app-shell-content] h1").first()
  await expect(heading).toBeVisible()
  const [columnBox, headingBox] = await Promise.all([
    page.locator("[data-e2e=app-shell-content]").boundingBox(),
    heading.boundingBox(),
  ])
  if (!columnBox || !headingBox) throw new Error("The shell drew no page or no heading.")
  return { column: columnBox.y, heading: headingBox.y }
}

/**
 * A colour as the pixel it paints, `r,g,b,a`, so one colour written two ways (`oklch(…)` and
 * `oklab(…)`, as the browser may report the same token) compares equal.
 */
async function paint(page: Page, color: string): Promise<string> {
  return await page.evaluate((value) => {
    const context = document.createElement("canvas").getContext("2d")!
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    return context.getImageData(0, 0, 1, 1).data.join(",")
  }, color)
}

/** What makes a tooltip's bubble look like the rail's: its colours and the weight of its words. */
async function bubbleStyle(bubble: Locator): Promise<Record<string, string>> {
  const style = await bubble.evaluate((element) => {
    const { backgroundColor, color, fontWeight, fontSize } = getComputedStyle(element)
    return { backgroundColor, color, fontWeight, fontSize }
  })
  const page = bubble.page()
  return {
    background: await paint(page, style.backgroundColor),
    color: await paint(page, style.color),
    fontWeight: style.fontWeight,
    fontSize: style.fontSize,
  }
}

/** The keyboard focus ring a control draws while it has `:focus-visible`. */
async function focusRing(control: Locator): Promise<Record<string, string>> {
  // A key press first, so the next focus counts as keyboard focus and `:focus-visible` matches.
  await control.page().keyboard.press("Shift")
  await control.focus()
  const ring = await control.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      focusVisible: String(element.matches(":focus-visible")),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
    }
  })
  return { ...ring, outlineColor: await paint(control.page(), ring.outlineColor) }
}

/**
 * The group switcher's tooltip and focus ring are the rail's own: the same bubble as a navigation
 * cell's, held back for a moment when the pointer arrives, and the same ring on keyboard focus.
 */
async function expectSwitcherLikeRail(page: Page): Promise<void> {
  const notes = page.locator(`[data-e2e="rail-shell-rail"] a[href="/notes"]`)
  const picker = page.locator("[data-e2e=group-picker]")
  const noteTip = page.locator("[data-e2e=rail-shell-rail] [data-e2e=rail-shell-tooltip]", {
    hasText: "Notes",
  }).locator("span")
  // The switcher's tip says the group's name and the person's role there: `Home · Owner`.
  const switcherTip = page.getByText(/ · Owner$/)

  await notes.hover()
  await expect(noteTip).toBeVisible()
  const railBubble = await bubbleStyle(noteTip)

  await page.mouse.move(700, 450)
  await picker.hover()
  await page.waitForTimeout(100)
  // The rail waits 300 ms before it shows a tip under a resting pointer.
  await expect(switcherTip).toBeHidden({ timeout: 1 })
  await expect(switcherTip).toBeVisible()
  expect(await bubbleStyle(switcherTip)).toEqual(railBubble)
  await page.mouse.move(700, 450)

  const railRing = await focusRing(notes)
  expect(railRing.focusVisible).toBe("true")
  expect(await focusRing(picker)).toEqual(railRing)
  await page.locator("body").focus()
}

/**
 * Checks the 1440 px frame, then the 390 px one, on the page as it is, and returns where its column
 * and heading start at each width, so the two apps can be compared.
 */
async function expectSharedFrame(page: Page): Promise<{ wide: Tops; narrow: Tops }> {
  await page.setViewportSize({ width: 1440, height: 900 })
  const wide = await measure(page)
  const wideTops = await tops(page)
  expect(wide.railX).toBe(0)
  expect(wide.rail).toBe(72)
  expect(wide.cell).toEqual({ width: 48, height: 48 })
  expect(wide.gaps.left).toBeGreaterThan(0)
  expect(Math.abs(wide.gaps.left - wide.gaps.right)).toBeLessThanOrEqual(1)
  await expect(page.locator("[data-e2e=rail-shell-tabbar]")).toBeHidden()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator("[data-e2e=rail-shell-tabbar]")).toBeVisible()
  await expect(page.locator("[data-e2e=rail-shell-column]")).toBeHidden()
  expect(
    await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ),
  ).toBeLessThanOrEqual(0)
  return { wide: wideTops, narrow: await tops(page) }
}

test.describe("one frame for the SPA and the admin", () => {
  test("both draw a 72 px rail at the window's edge, 48 px cells and a centred page at the same height at 1440 px, and a tab bar at 390 px; the group switcher's tooltip and focus ring are the rail's", async ({ browser, page, request }) => {
    const email = `e2e-shell-${uuidV7().slice(-8)}@example.com`
    const admin = await browser.newContext({ baseURL: adminBase })
    try {
      const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(response.ok(), await response.text()).toBe(true)
      const signedOut = await request.post(`${appBase}/api/auth/sign-out`, { headers })
      expect(signedOut.ok(), await signedOut.text()).toBe(true)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: email, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      await page.setViewportSize({ width: 1440, height: 900 })
      await signIn(page, email, password)
      await page.goto("/notes")
      await expect(page.locator("[data-e2e=rail-shell-column]")).toBeVisible()
      for (const target of TOUR_TARGETS) await expect(page.locator(target)).toHaveCount(1)
      await expectSwitcherLikeRail(page)
      const product = await expectSharedFrame(page)

      const ops = await admin.newPage()
      await ops.setViewportSize({ width: 1440, height: 900 })
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(email)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()
      await expect(ops).toHaveTitle("Dashboard · Admin · Seed")
      // A verified person sees no banner, so nothing may push the product's page below the admin's.
      expect(product).toEqual(await expectSharedFrame(ops))
    } finally {
      await admin.close()
      await cleanup(request, email)
    }
  })
})
