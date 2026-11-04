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
const PAGES = ["/changelog", "/docs", "/docs/get-started", "/docs/capacity", "/ar/docs/capacity"]

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
for (const path of ["/changelog", "/docs", "/docs/get-started", "/docs/capacity"]) {
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

for (const width of [390, 1440]) {
  test(`a visitor at ${width} px opens Docs from the header and starts with Get started`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/features")
    if (width < 1024) await page.locator("header summary").last().click()
    const nav = page.getByRole("navigation", { name: "Main navigation" }).filter({ visible: true })
    await nav.getByRole("link", { name: "Docs", exact: true }).click()

    await expect(page).toHaveURL(/\/docs$/)
    await page.locator("[data-e2e=docs-first]").getByRole("link", { name: "Get started" }).click()
    await expect(page).toHaveURL(/\/docs\/get-started$/)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Get started")
    if (width < 1024) await page.locator("header summary").last().click()
    await expect(nav.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    )
  })
}

test("a reader moves from the docs index to a guide, through its sections, to the next guide", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto("/docs")
  await page.getByRole("link", { name: /^Deploy to a server/ }).click()

  await expect(page).toHaveURL(/\/docs\/deploy$/)
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deploy to a server")
  const sections = page.getByRole("navigation", { name: "On this page" })
  await sections.getByRole("link").filter({ visible: true }).first().click()
  await expect(page).toHaveURL(/\/docs\/deploy#.+/)
  await page.locator("a[rel=next]").click()
  await expect(page).not.toHaveURL(/\/docs\/deploy(#|$)/)
  await expect(page).toHaveURL(/\/docs\/[a-z-]+$/)
})

test("an internal doc answers 404 with the way back to the docs", async ({ page }) => {
  const response = await page.goto("/docs/handoff")

  expect(response?.status()).toBe(404)
  await page.getByRole("link", { name: "See all docs" }).click()
  await expect(page).toHaveURL(/\/docs$/)
})

test("a press on a guide's copy button copies the command and says it did", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL })
  await page.goto("/docs/load-tests")
  const block = page.locator("main [data-prose-code]").first()

  await block.getByRole("button", { name: "Copy" }).click()

  await expect(block.getByRole("status")).toHaveText("Copied")
  const command = (await block.locator("pre").textContent())?.replace(/\n$/, "")
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command)
})

test.describe("with JavaScript off", () => {
  test.use({ javaScriptEnabled: false })

  test("a guide shows no copy button that could not work", async ({ page }) => {
    await page.goto("/docs/load-tests")

    const buttons = page.locator("main button[data-prose-copy]")
    expect(await buttons.count()).toBeGreaterThan(0)
    await expect(buttons.filter({ visible: true })).toHaveCount(0)
  })

  test("the API reference names its copy buttons in English at every language's address", async ({ page }) => {
    await page.goto("/de/docs/api")

    await expect(page.locator("main button[data-prose-copy]").first()).toHaveAttribute(
      "aria-label",
      "Copy",
    )
  })
})
