import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

const REPOSITORY = `https://github.com/spy4x/seed`
/** The repository root, where each code link's path must exist. */
const ROOT = new URL(`../../`, import.meta.url)
/** The home page links to these sections of `/features`. */
const HOME_ANCHORS = [`sign-in`, `billing`, `realtime`, `teams`, `website`] as const

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
      `Everything Seed ships, and what it doesn't yet`,
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
      const match = href.match(new RegExp(`^${REPOSITORY}/(tree|blob)/main/(.+)$`))
      expect(match, href).not.toBeNull()
      const info = Deno.statSync(new URL(match![2], ROOT))
      expect(info.isDirectory, href).toBe(match![1] === `tree`)
    }
    expect(hrefs.every((href) => href.startsWith(REPOSITORY))).toBe(true)
  })

  test(`the demo button opens the app's /try, which starts a guest account`, async ({ page }) => {
    await page.goto(`/features`)
    await page.locator(`[data-e2e=features-try-demo]`).click()
    await expect(page).toHaveURL(/\/try$/)
  })

  test(`the admin section shows a still of the admin panel linked to /admin, with a link to watch it`, async ({ page }) => {
    await page.goto(`/features`)
    const section = page.locator(`section#admin`)
    await expect(section.locator(`video`)).toHaveCount(0)
    const still = section.locator(`a[data-e2e=admin-video-still]`)
    await expect(still).toHaveAttribute(`href`, `/admin`)
    await expect(still.locator(`img`)).toHaveAttribute(`loading`, `lazy`)
    const src = (await still.locator(`img`).getAttribute(`src`))!
    expect((await page.request.get(src)).status(), src).toBe(200)
    const watch = section.locator(`[data-e2e=features-admin-watch]`)
    await expect(watch).toHaveText(`Watch it in 59 seconds`)
    await expect(watch).toHaveAttribute(`href`, `/admin`)
  })

  test(`the admin panel's old screenshots are gone`, async ({ page }) => {
    for (const theme of [`light`, `dark`]) {
      for (const width of [1280, 640]) {
        const path = `/shots/admin-overview-${theme}-${width}.webp`
        expect((await page.request.get(path)).status(), path).toBe(404)
      }
    }
  })

  test(`the features page fits a 375 px phone with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/features`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})

// Through the built server's own routing: `routes/[[lang]]/admin.tsx` also fits this address, and
// a unit test that calls the feature page's handler cannot see which route Fresh picks.
test(`/features/admin answers a permanent redirect to the admin panel's page`, async ({ request }) => {
  const response = await request.get(`/features/admin`, { maxRedirects: 0 })

  expect(response.status()).toBe(301)
  expect(response.headers()[`location`]).toBe(`/admin`)
})

test(`the admin still loads only when its section nears the screen`, async ({ page }) => {
  const asked: string[] = []
  page.on(`request`, (request) => asked.push(new URL(request.url()).pathname))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/features`, { waitUntil: `networkidle` })
  expect(asked).not.toContain(`/video/admin-panel-poster-1280.webp`)

  await page.locator(`section#admin`).scrollIntoViewIfNeeded()
  await expect.poll(() => asked).toContain(`/video/admin-panel-poster-1280.webp`)
})

/** The three feature loops, the page each plays on, and the name its play button carries. */
const LOOPS = [
  [`realtime`, `/features/realtime`, `Realtime sync`],
  [`offline`, `/features/offline`, `Offline editing`],
  [`shortcuts`, `/features/shortcuts`, `Keyboard shortcuts`],
] as const

for (const [loop, path, name] of LOOPS) {
  test(`${path} plays the ${loop} loop, captioned, with a button that names it`, async ({ page }) => {
    await page.goto(path)
    const figure = page.locator(`[data-e2e=loop-${loop}]`)
    await expect(figure.locator(`figcaption`)).not.toBeEmpty()
    await expect(figure.locator(`img`)).toHaveAttribute(
      `src`,
      new RegExp(`/video/${loop}-loop-light-`),
    )
    await expect(figure.getByRole(`button`, { name: new RegExp(`: ${name}$`) })).toBeVisible()
  })
}

test(`the video route answers a byte range of every loop and of the hero's demo`, async ({ request }) => {
  const files = [
    ...LOOPS.flatMap(([loop]) =>
      [`light`, `dark`].flatMap((theme) =>
        [`webm`, `mp4`].map((ext) => `${loop}-loop-${theme}.${ext}`)
      )
    ),
    `demo.webm`,
    `demo.mp4`,
  ]
  for (const name of files) {
    const response = await request.get(`/video/${name}`, { headers: { Range: `bytes=0-99` } })
    expect(response.status(), name).toBe(206)
    expect((await response.body()).byteLength, name).toBe(100)
  }
})

test.describe(`a screenshot's lightbox`, () => {
  test.use({ colorScheme: `dark` })

  test(`opens the widest file of the page's theme from the keyboard and gives focus back`, async ({ page }) => {
    await page.goto(`/features`)
    const shot = page.getByRole(`button`, { name: /^Zoom: / }).first()
    await shot.focus()
    await page.keyboard.press(`Enter`)

    const viewer = page.getByRole(`dialog`)
    await expect(viewer).toBeVisible()
    await expect(viewer.locator(`img`)).toHaveAttribute(`src`, /-dark-1280\.webp(\?|$)/)
    await page.keyboard.press(`Escape`)
    await expect(viewer).toBeHidden()
    await expect(shot).toBeFocused()
  })

  test(`zooms the page's screenshots but never a feature loop's poster`, async ({ page }) => {
    await page.goto(`/features`)
    await expect(page.getByRole(`button`, { name: /^Zoom: / }).first()).toBeVisible()
    for (const [loop] of LOOPS) {
      const figure = page.locator(`[data-e2e=loop-${loop}]`)
      await expect(figure.locator(`img`).first()).toBeAttached()
      // Once the clip is live the poster is hidden from the accessibility tree, so the zoom marks
      // are read off the element: a zoomable image is a Tab stop with a button's role.
      await expect(figure.locator(`img[role=button], img[tabindex]`)).toHaveCount(0)
    }
  })

  // A feature page loads the lightbox only when its picture is a screenshot: deploy draws a diagram.
  for (
    const [path, loads] of [[`/pricing`, false], [`/features/deploy`, false], [
      `/features/sign-in`,
      true,
    ]] as const
  ) {
    test(`${path} ${loads ? `loads` : `does not load`} the lightbox's JavaScript`, async ({ page }) => {
      const asked: string[] = []
      page.on(`request`, (request) => asked.push(request.url()))
      await page.goto(path, { waitUntil: `networkidle` })
      expect(asked.some((url) => url.includes(`shot_lightbox`))).toBe(loads)
    })
  }
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
