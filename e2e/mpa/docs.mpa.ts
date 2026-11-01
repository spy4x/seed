import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/** The WCAG A and AA rules axe-core checks a page against. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** Every axe-core violation on the page, as `rule: target` lines a failure message can show. */
async function accessibilityViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

// capacity has the widest table of the guides; /ar/ is the right-to-left frame around English.
const PAGES = ["/changelog", "/docs", "/docs/capacity", "/ar/docs/capacity"]

for (const path of PAGES) {
  test(`${path} fits a 390 px phone without sideways scrolling or cut-off parts`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(path)

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(pageWidth).toBeLessThanOrEqual(390)
    // A right-to-left page clips what overflows to the right instead of scrolling to it, so the
    // English column's parts are measured too: each must lie inside the screen.
    const outside = await page.locator(`main [lang="en"] > *`).evaluateAll((parts) =>
      parts.map((part) => part.getBoundingClientRect())
        .filter(({ left, right }) => left < 0 || right > 390)
        .map(({ left, right }) => `${left}..${right}`)
    )
    expect(outside).toEqual([])
  })
}

// The dark theme needs the theme script, so these run with JavaScript, in both colour schemes.
for (const path of ["/changelog", "/docs/capacity"]) {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const width of [390, 1440]) {
      test(`${path} has no accessibility violations in the ${colorScheme} theme at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme })
        await page.goto(path)
        if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/)
        else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)

        expect(await accessibilityViolations(page)).toEqual([])
      })
    }
  }
}

test("a reader moves from the docs index to a guide, through its sections, to the next guide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/docs")
  await page.getByRole("link", { name: /^Deploy and operate/ }).click()

  await expect(page).toHaveURL(/\/docs\/deploy$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deploy and operate")
  const sections = page.getByRole("navigation", { name: "On this page" })
  await sections.getByRole("link").filter({ visible: true }).first().click()
  await expect(page).toHaveURL(/\/docs\/deploy#.+/)
  await page.locator("a[rel=next]").click()
  await expect(page).not.toHaveURL(/\/docs\/deploy/)
  await expect(page).toHaveURL(/\/docs\/[a-z-]+$/)
})

test("an internal doc answers 404 with the way back to the docs", async ({ page }) => {
  const response = await page.goto("/docs/handoff")

  expect(response?.status()).toBe(404)
  await page.getByRole("link", { name: "See all docs" }).click()
  await expect(page).toHaveURL(/\/docs$/)
})
