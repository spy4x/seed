// Seed's own site: see docs/start-a-product.md
import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/** The table's accessible name: its caption, which also names the region it scrolls in. */
const CAPTION = "Capabilities of Seed and five other SaaS starters, checked on 16 Oct 2026"
const PRODUCTS = [
  "Seed",
  "ShipFast",
  "Supastarter",
  "Makerkit",
  "Next.js SaaS Starter",
  "Open SaaS",
]
/** The WCAG levels the site promises (docs: design, "Accessibility"). */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

/** Every axe-core violation on the page, as `rule: target` lines, so a failure names the element. */
async function axeViolations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  return result.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

test.describe("without JavaScript", () => {
  // The public website is plain links and forms: a visitor needs no script to read it.
  test.use({ javaScriptEnabled: false })

  test("a visitor reads the comparison: its title, check date, a captioned table with headers, and the sources", async ({ page }) => {
    await page.goto("/compare")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "How Seed compares to other SaaS starters",
    )
    await expect(page.locator("[data-e2e=page-hero-meta] time[datetime='2026-10-16']"))
      .toHaveText("16 Oct 2026")

    const table = page.getByRole("table", { name: CAPTION })
    await expect(table.locator("caption")).toHaveText(CAPTION)
    await expect(table.locator("thead th[scope=col]")).toHaveCount(PRODUCTS.length + 1)
    for (const product of PRODUCTS) {
      await expect(table.getByRole("columnheader", { name: product })).toBeVisible()
    }
    await expect(table.getByRole("rowheader", { name: /^Passkeys/ })).toBeVisible()
    // Every body row is headed by its capability, and every cell says its value in words.
    const rows = await table.locator("tbody tr").count()
    expect(rows).toBeGreaterThan(10)
    await expect(table.locator("tbody th[scope=row]")).toHaveCount(rows)
    await expect(table.locator("tbody td")).toHaveCount(rows * PRODUCTS.length)
    for (const text of await table.locator("tbody td").allInnerTexts()) {
      expect(["Yes", "Partial", "No"]).toContain(text.trim())
    }

    await expect(page.getByText("Method", { exact: true })).toBeVisible()
    await expect(page.getByText("Seed is not for you if")).toBeVisible()
    const shipfast = page.locator("#shipfast")
    await expect(shipfast.getByRole("link", { name: "Licence" })).toHaveAttribute(
      "href",
      "https://shipfa.st/license",
    )
  })

  test("the page fits a 375 px phone: only the table scrolls sideways, inside its named region", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto("/compare")

    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(pageWidth).toBeLessThanOrEqual(375)
    const region = page.getByRole("region", { name: CAPTION })
    await expect(region).toHaveAttribute("tabindex", "0")
    const box = await region.evaluate((scroller) => ({
      client: scroller.clientWidth,
      scroll: scroller.scrollWidth,
    }))
    expect(box.scroll).toBeGreaterThan(box.client)
  })

  test("on a 390 × 700 phone both hero buttons and the byline show without scrolling, the disclosure under them", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 700 })
    await page.goto("/compare")
    const hero = page.locator("[data-e2e=page-hero]")
    const demo = hero.locator("[data-e2e=compare-try-demo]")
    await expect(demo).toBeInViewport({ ratio: 1 })
    await expect(hero.getByRole("link", { name: "View on GitHub" })).toBeInViewport({ ratio: 1 })
    const meta = hero.locator("[data-e2e=page-hero-meta]")
    await expect(meta).toBeInViewport({ ratio: 1 })
    // The disclosure is the hero's note, after the byline: above the buttons it pushed them down.
    const note = hero.locator("[data-e2e=page-hero-note]")
    await expect(note).toContainText("I build Seed, so I am not neutral.")
    const [metaBox, noteBox] = [await meta.boundingBox(), await note.boundingBox()]
    expect(noteBox!.y).toBeGreaterThanOrEqual(metaBox!.y + metaBox!.height)
  })

  test("at 390 px no capability label in the table wraps to more than two lines", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/compare")
    const table = page.getByRole("table", { name: CAPTION })
    // The label is the header's first text node; the note under it is a block of its own.
    const lines = await table.locator("tbody th[scope=row]").evaluateAll((headers) =>
      headers.map((header) => {
        const range = document.createRange()
        range.selectNodeContents(header.firstChild!)
        const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
        return `${header.firstChild!.textContent}: ${tops.size}`
      })
    )
    expect(lines.length).toBeGreaterThan(10)
    expect(lines.filter((line) => Number(line.split(": ").pop()) > 2)).toEqual([])
  })
})

// axe-core runs inside the page, so it needs JavaScript: these checks turn it on. The light page
// is the same markup a visitor without JavaScript gets; the dark palette exists only with
// `/theme.js`, so this is the only way a visitor ever sees it.
for (const scheme of ["light", "dark"] as const) {
  test.describe(`with JavaScript, on a device that asks for ${scheme}`, () => {
    test.use({ javaScriptEnabled: true, colorScheme: scheme })

    for (const width of [375, 1280]) {
      test(`axe-core finds no WCAG violation in the ${scheme} theme at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto("/compare")
        // Fails loudly if the palette is not the one asked for, instead of checking one twice.
        const html = page.locator("html")
        await (scheme === "dark"
          ? expect(html).toHaveClass(/\bdark\b/)
          : expect(html).not.toHaveClass(/\bdark\b/))
        expect(await axeViolations(page)).toEqual([])
      })
    }
  })
}
