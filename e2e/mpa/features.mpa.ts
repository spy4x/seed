import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

const REPOSITORY = `https://github.com/spy4x/template`
/** The repository root, where each code link's path must exist. */
const ROOT = new URL(`../../`, import.meta.url)
/** The home page links to these sections of `/features`. */
const HOME_ANCHORS = [`sign-in`, `billing`, `realtime`, `teams`, `admin`, `website`] as const

/** Runs axe-core over the whole page and returns each violation's rule and the elements it hit. */
async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze()
  return result.violations.map((v) =>
    `${v.id}: ${v.nodes.map((node) => node.target.join(` `)).join(`, `)}`
  )
}

test.describe(`without JavaScript`, () => {
  test.use({ javaScriptEnabled: false })

  test(`the features page shows its heading and every in-page link lands on a section`, async ({ page }) => {
    await page.goto(`/features`)
    await expect(page.getByRole(`heading`, { level: 1 })).toHaveText(
      `Everything Seed ships, and what it does not yet`,
    )

    const hrefs = await page.getByRole(`navigation`, { name: `On this page` }).getByRole(`link`)
      .evaluateAll((links) => links.map((link) => link.getAttribute(`href`)!))
    expect(hrefs.length).toBeGreaterThanOrEqual(10)
    for (const anchor of HOME_ANCHORS) expect(hrefs).toContain(`#${anchor}`)
    for (const href of hrefs) {
      await expect(page.locator(`section${href}`), href).toHaveCount(1)
    }
  })

  test(`every code link points at a file or folder that exists in the repository`, async ({ page }) => {
    await page.goto(`/features`)
    const hrefs = await page.locator(`[data-e2e=feature-code-link]`)
      .evaluateAll((links) => links.map((link) => link.getAttribute(`href`)!))
    expect(hrefs.length).toBeGreaterThanOrEqual(10)
    for (const href of hrefs) {
      const match = href.match(/^https:\/\/github\.com\/spy4x\/template\/(tree|blob)\/main\/(.+)$/)
      expect(match, href).not.toBeNull()
      const info = Deno.statSync(new URL(match![2], ROOT))
      expect(info.isDirectory, href).toBe(match![1] === `tree`)
    }
    expect(hrefs.every((href) => href.startsWith(REPOSITORY))).toBe(true)
  })

  test(`the demo button opens the app's sign-up`, async ({ page }) => {
    await page.goto(`/features`)
    await page.locator(`[data-e2e=features-try-demo]`).click()
    await expect(page).toHaveURL(/\/sign-up$/)
  })

  test(`the features page fits a 375 px phone with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/features`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})

// axe-core runs as a script in the page, so these checks keep JavaScript on: /theme.js then picks
// the theme the device asks for, as it does for most visitors.
for (const scheme of [`light`, `dark`] as const) {
  test.describe(`in the ${scheme} theme`, () => {
    test.use({ colorScheme: scheme })

    for (const width of [375, 1280]) {
      test(`axe finds no accessibility problem in the ${scheme} theme at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/features`)
        // The dark tokens apply once /theme.js marks the root; check the page that people see.
        const root = expect(page.locator(`html`))
        await (scheme === `dark` ? root : root.not).toHaveClass(/\bdark\b/)
        expect(await violations(page)).toEqual([])
      })
    }
  })
}
