// Seed's own site: see docs/start-a-product.md
import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/** antonshubin.com's MVP page, tagged with the site that sent the founder (spy4x/seed#264). */
const HIRE_PAGE =
  "https://antonshubin.com/catalog/zero-to-production-saas-mvp?utm_source=seedsaas&utm_medium=referral&utm_campaign=mvp"

/** The WCAG A and AA rules axe-core checks a page against. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** Every axe-core violation on the page, as `rule: target` lines a failure message can show. */
async function accessibilityViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

test("the old /mvp address answers a permanent redirect to the hire page", async ({ request }) => {
  const response = await request.get("/mvp", { maxRedirects: 0 })

  expect(response.status()).toBe(301)
  expect(response.headers()["location"]).toBe(HIRE_PAGE)
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("a founder on the pricing page reaches the hire page from the build card", async ({ page }) => {
    await page.goto("/pricing")

    await expect(page.locator("[data-e2e=pricing-mvp]")).toHaveAttribute("href", HIRE_PAGE)
  })

  test("a founder on a missing page still finds the hire page", async ({ page }) => {
    await page.goto("/no-such-page")

    await expect(page.getByRole("link", { name: "Hire me to build your MVP" }))
      .toHaveAttribute("href", HIRE_PAGE)
  })

  test("/pricing fits a 375 px phone without sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/pricing")

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(pageWidth).toBeLessThanOrEqual(375)
  })
})

// The dark theme needs the theme script, so these run with JavaScript, in both colour schemes.
for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [375, 1280]) {
    test(`/pricing has no accessibility violations in the ${colorScheme} theme at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await page.goto("/pricing")
      if (colorScheme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/)
      else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)

      expect(await accessibilityViolations(page)).toEqual([])
    })
  }
}
