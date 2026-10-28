import { expect, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import en from "../../i18n/site/en.json" with { type: "json" }
import ru from "../../i18n/site/ru.json" with { type: "json" }
import es from "../../i18n/site/es.json" with { type: "json" }
import de from "../../i18n/site/de.json" with { type: "json" }
import ptBr from "../../i18n/site/pt-BR.json" with { type: "json" }
import ar from "../../i18n/site/ar.json" with { type: "json" }

/**
 * One page per language (#276): its address, the English page's address (`x-default`), its
 * direction and its heading from the language's catalog.
 */
const PAGES = [
  {
    language: `en`,
    path: `/pricing`,
    english: `/pricing`,
    dir: `ltr`,
    heading: en[`PricingHero.title`],
  },
  {
    language: `ru`,
    path: `/ru/features`,
    english: `/features`,
    dir: `ltr`,
    heading: ru[`FeaturesHero.title`],
  },
  { language: `es`, path: `/es`, english: `/`, dir: `ltr`, heading: es[`HomeHero.title`] },
  {
    language: `de`,
    path: `/de/pricing`,
    english: `/pricing`,
    dir: `ltr`,
    heading: de[`PricingHero.title`],
  },
  {
    language: `pt-BR`,
    path: `/pt-BR/compare`,
    english: `/compare`,
    dir: `ltr`,
    heading: ptBr[`Compare.heroTitle`],
  },
  {
    language: `ar`,
    path: `/ar/admin`,
    english: `/admin`,
    dir: `rtl`,
    heading: ar[`AdminTour.heroTitle`],
  },
] as const

test.describe(`the website in every language, without JavaScript`, () => {
  test.use({ javaScriptEnabled: false })

  for (const { language, path, english, dir, heading } of PAGES) {
    test(`${path} answers in ${language}, with its own canonical address and every alternate`, async ({ page }) => {
      const response = await page.goto(path)

      expect(response?.status()).toBe(200)
      await expect(page.locator(`html`)).toHaveAttribute(`lang`, language)
      await expect(page.locator(`html`)).toHaveAttribute(`dir`, dir)
      await expect(page.getByRole(`heading`, { level: 1 })).toHaveText(heading)
      const canonical = await page.locator(`link[rel=canonical]`).getAttribute(`href`)
      expect(new URL(canonical!).pathname).toBe(path)
      await expect(page.locator(`link[rel=alternate][hreflang]`)).toHaveCount(7)
      const fallback = await page.locator(`link[rel=alternate][hreflang=x-default]`)
        .getAttribute(`href`)
      expect(new URL(fallback!).pathname).toBe(english)
    })
  }

  test(`the footer's language picker opens the same page in another language`, async ({ page }) => {
    await page.goto(`/ar/pricing`)
    await page.locator(`[data-e2e=site-languages] a[hreflang=de]`).click()

    await expect(page).toHaveURL(/\/de\/pricing$/)
    await expect(page.getByRole(`heading`, { level: 1 })).toHaveText(de[`PricingHero.title`])
  })

  test(`a legal page stays English at a translated address and says so`, async ({ page }) => {
    await page.goto(`/de/terms`)

    await expect(page.locator(`[data-e2e=english-only]`)).toHaveText(
      de[`LegalPage.englishOnly`],
    )
    await expect(page.locator(`link[rel=alternate][hreflang]`)).toHaveCount(0)
  })

  test(`/en/pricing answers 301 to /pricing, and /xx/pricing answers 404`, async ({ request }) => {
    const english = await request.get(`/en/pricing`, { maxRedirects: 0 })
    expect(english.status()).toBe(301)
    expect(english.headers()[`location`]).toBe(`/pricing`)

    expect((await request.get(`/xx/pricing`, { maxRedirects: 0 })).status()).toBe(404)
  })
})

// axe-core runs in the page, so this check needs JavaScript.
test(`an Arabic page, read right to left, has no accessibility violations`, async ({ page }) => {
  await page.goto(`/ar`)

  const result = await new AxeBuilder({ page }).analyze()
  expect(result.violations.map((v) => v.id)).toEqual([])
})
