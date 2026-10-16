import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/** The calendar of a free call on antonshubin.com, tagged with the page that sent the founder. */
const BOOK_CALL =
  "https://antonshubin.com/book?utm_source=seedsaas&utm_medium=referral&utm_campaign=mvp"

/** The two pages that name a price: what Seed costs, and what having it built costs. */
const PRICED_PAGES = ["/pricing", "/mvp"] as const

/** The WCAG A and AA rules axe-core checks a page against. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** Every axe-core violation on the page, as `rule: target` lines a failure message can show. */
async function accessibilityViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("a founder sees the outcome, the starting price and a call to book on antonshubin.com", async ({ page }) => {
    await page.goto("/mvp")

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Your product, live and taking payments, in weeks rather than months.",
    )
    await expect(page.getByText("From $8,000", { exact: true })).toBeVisible()
    const book = page.getByRole("link", { name: "Book a free 30-minute call" })
    await expect(book).toHaveCount(2)
    for (const link of await book.all()) await expect(link).toHaveAttribute("href", BOOK_CALL)
    await expect(page.getByRole("link", { name: "Or send a written brief" }).first())
      .toHaveAttribute("href", `${BOOK_CALL}#brief`)
    // Founders came to hire: no second ask in the footer.
    await expect(page.locator("[data-e2e=footer-subscribe-email]")).toHaveCount(0)
  })

  test("a founder on the pricing page reaches /mvp from the build card", async ({ page }) => {
    await page.goto("/pricing")

    await page.locator("[data-e2e=pricing-mvp]").click()
    await expect(page).toHaveURL("/mvp")
  })

  for (const path of PRICED_PAGES) {
    test(`${path} fits a 375 px phone without sideways scrolling`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 })
      await page.goto(path)

      const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(pageWidth).toBeLessThanOrEqual(375)
    })
  }
})

// The dark theme needs the theme script, so these run with JavaScript, in both colour schemes.
for (const colorScheme of ["light", "dark"] as const) {
  for (const width of [375, 1280]) {
    for (const path of PRICED_PAGES) {
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
