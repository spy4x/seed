import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

const REPOSITORY = `https://github.com/spy4x/seed`
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
      const match = href.match(new RegExp(`^${REPOSITORY}/(tree|blob)/main/(.+)$`))
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

  test(`the admin section offers its video on click only, in two formats, with a transcript`, async ({ page }) => {
    await page.goto(`/features`)
    const section = page.locator(`section#admin`)
    const video = section.locator(`video[data-e2e=admin-video]`)
    await expect(video).toHaveCount(1)
    for (const name of [`controls`, `muted`, `playsinline`]) {
      await expect(video, name).toHaveAttribute(name, ``)
    }
    await expect(video).toHaveAttribute(`preload`, `none`)
    for (const name of [`autoplay`, `loop`]) await expect(video, name).not.toHaveAttribute(name)
    await expect(video).toHaveAttribute(`width`, `1920`)
    await expect(video).toHaveAttribute(`height`, `1200`)

    // The WebM first, so a browser that plays AV1 never fetches the MP4. Each file is served.
    const sources = await video.locator(`source`).evaluateAll((all) =>
      all.map((source) => [source.getAttribute(`src`)!, source.getAttribute(`type`)!])
    )
    expect(sources.map(([, type]) => type.split(`;`)[0])).toEqual([`video/webm`, `video/mp4`])
    const poster = (await video.getAttribute(`poster`))!
    for (const [path, type] of [...sources, [poster, `image/webp`]]) {
      const response = await page.request.get(path)
      expect(response.status(), path).toBe(200)
      expect(response.headers()[`content-type`], path).toBe(type.split(`;`)[0])
    }

    const transcript = section.locator(`details[data-e2e=admin-video-transcript]`)
    await expect(transcript.locator(`summary`)).toHaveText(`Read what the video shows`)
    await expect(transcript.locator(`li`)).toHaveCount(9)
    await expect(transcript).toContainText(
      `The people and groups in the video are made-up sample data.`,
    )
  })

  test(`the admin video is followed by a link to the admin app's code`, async ({ page }) => {
    await page.goto(`/features`)
    const link = page.locator(
      `section#admin details[data-e2e=admin-video-transcript] + a[data-e2e=admin-video-code-link]`,
    )
    await expect(link).toHaveText(`Read the admin app`)
    await expect(link).toHaveAttribute(`href`, /\/tree\/main\/apps\/admin\/?$/)
  })

  test(`the features page fits a 375 px phone with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/features`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})

test(`the admin video file loads its header under the site's security headers`, async ({ page }) => {
  await page.goto(`/features`)
  const video = page.locator(`video[data-e2e=admin-video]`)
  // What a click on play starts: the browser picks a source and reads the file's header.
  const size = await video.evaluate((element: HTMLVideoElement) =>
    new Promise<string>((resolve, reject) => {
      element.addEventListener(`loadedmetadata`, () => {
        resolve(`${element.videoWidth}x${element.videoHeight}`)
      })
      // When no source plays, the last one reports the error.
      element.querySelector(`source:last-of-type`)!.addEventListener(
        `error`,
        () => reject(new Error(`no source of the video loaded`)),
      )
      element.load()
    })
  )
  expect(size).toBe(`1920x1200`)
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

test(`each admin video answers a byte range with 206 and exactly those bytes, as Safari asks`, async ({ request }) => {
  for (const name of [`admin-panel.webm`, `admin-panel.mp4`]) {
    const response = await request.get(`/video/${name}`, { headers: { Range: `bytes=0-99` } })
    expect(response.status(), name).toBe(206)
    expect(response.headers()[`content-range`], name).toMatch(/^bytes 0-99\/\d+$/)
    expect((await response.body()).byteLength, name).toBe(100)
    expect(response.headers()[`cache-control`], name).toContain(`max-age=`)
    expect(response.headers()[`content-security-policy`], name).toContain(`default-src 'self'`)
  }
})

test(`the video route serves only its listed files`, async ({ request }) => {
  for (
    const path of [
      `/video/admin-panel.mov`,
      `/video/..%2F..%2Fdeno.json`,
      `/video/%2E%2E%2Fmain.ts`,
    ]
  ) {
    expect((await request.get(path)).status(), path).toBe(404)
  }
})
