import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

/** The header's search trigger: a link to `/search` before hydration, a button after. */
const TRIGGER = `[data-e2e=site-search-open]`
/** The palette's dialog. */
const PALETTE = `dialog[data-e2e=site-search]`

/** Opens `path` and waits until the search island has hydrated. */
async function ready(page: Page, path = `/`) {
  await page.goto(path)
  await expect(page.locator(`button${TRIGGER}`)).toBeVisible()
}

/**
 * Types `query` into the palette and clicks the result named `label`. Pages list above sections,
 * so a section is not always the first row.
 */
async function pick(page: Page, query: string, label: string) {
  await page.keyboard.press(`ControlOrMeta+k`)
  const palette = page.locator(PALETTE)
  await expect(palette).toBeVisible()
  await palette.getByRole(`combobox`).fill(query)
  await palette.getByRole(`option`, { name: label, exact: true }).click()
}

test.describe(`the header's search trigger`, () => {
  test(`is an icon at 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await ready(page)
    const box = (await page.locator(TRIGGER).boundingBox())!
    expect(box.width).toBeLessThanOrEqual(44)
    await expect(page.locator(`${TRIGGER} kbd`).first()).toBeHidden()
  })

  test(`is a field with the shortcut at 1440 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await ready(page)
    const box = (await page.locator(TRIGGER).boundingBox())!
    expect(box.width).toBeGreaterThan(200)
    await expect(page.locator(`${TRIGGER} kbd`).first()).toBeVisible()
  })

  test(`leaves the page without horizontal scrolling at 1024 px`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await ready(page)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBe(0)
  })
})

test.describe(`the search palette`, () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  for (const key of [`ControlOrMeta+k`, `/`]) {
    test(`opens with ${key}`, async ({ page }) => {
      await ready(page)
      await page.keyboard.press(key)
      await expect(page.locator(PALETTE)).toBeVisible()
      await expect(page.locator(PALETTE).getByRole(`combobox`)).toBeFocused()
    })
  }

  const CASES = [
    {
      query: `free`,
      label: `Seed pricing: a free, MIT-licensed SaaS starter`,
      path: `/pricing`,
      heading: null,
    },
    {
      query: `stripe`,
      label: `Per-member billing, through Stripe`,
      path: `/features`,
      heading: `billing-title`,
    },
    {
      query: `self-host`,
      label: `One server, one command`,
      path: `/features`,
      heading: `deploy-title`,
    },
    { query: `supastarter`, label: `Supastarter`, path: `/compare`, heading: `supastarter-title` },
  ] as const
  for (const { query, label, path, heading } of CASES) {
    test(`“${query}” opens ${path}${heading ? `#${heading}` : ``} below the sticky header`, async ({ page }) => {
      await ready(page)
      await pick(page, query, label)
      await expect(page).toHaveURL(new RegExp(`${path}${heading ? `#${heading}` : `$`}`))
      if (heading === null) return
      const target = page.locator(`#${heading}`)
      await expect(target).toBeVisible()
      const header = page.locator(`header:has([data-e2e=site-brand])`)
      // Wait for the jump to the heading, then compare the edges.
      await expect.poll(async () => (await target.boundingBox())!.y).toBeLessThan(200)
      const top = (await target.boundingBox())!.y
      const bottom = (await header.boundingBox())!
      expect(top).toBeGreaterThanOrEqual(bottom.y + bottom.height)
    })
  }

  test(`offers the docs, then the demo, when nothing matches`, async ({ page }) => {
    await ready(page)
    await page.keyboard.press(`ControlOrMeta+k`)
    const palette = page.locator(PALETTE)
    await palette.getByRole(`combobox`).fill(`zzqqxx`)
    await expect(palette.getByRole(`option`)).toHaveText([`Read the docs`, `Try the demo`])
  })

  for (const colorScheme of [`light`, `dark`] as const) {
    test(`has no accessibility violations while open in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme })
      await ready(page)
      if (colorScheme === `dark`) await expect(page.locator(`html`)).toHaveClass(/\bdark\b/)
      await page.keyboard.press(`ControlOrMeta+k`)
      await page.locator(PALETTE).getByRole(`combobox`).fill(`pricing`)
      await expect(page.locator(PALETTE).getByRole(`option`).first()).toBeVisible()
      const result = await new AxeBuilder({ page }).include(PALETTE).analyze()
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(`, `)}`))
        .toEqual([])
    })
  }
})

test.describe(`without JavaScript`, () => {
  test.use({ javaScriptEnabled: false })

  test(`the trigger links to /search, which lists the results for “stripe”`, async ({ page }) => {
    await page.goto(`/`)
    await expect(page.locator(`a${TRIGGER}`)).toHaveAttribute(`href`, /^\/search\b/)
    await page.goto(`/search?q=stripe`)
    const results = page.locator(`[data-e2e=search-page-results] a`)
    await expect(results.first()).toHaveAttribute(`href`, `/features#billing-title`)
    await results.first().click()
    await expect(page).toHaveURL(/\/features#billing-title$/)
  })

  test(`/search offers the docs and the demo when nothing matches`, async ({ page }) => {
    await page.goto(`/search?q=zzqqxx`)
    const none = page.locator(`[data-e2e=search-page-none]`)
    await expect(none.getByRole(`link`)).toHaveCount(2)
    await expect(none.getByRole(`link`).last()).toHaveAttribute(`href`, /\/try$/)
  })
})
