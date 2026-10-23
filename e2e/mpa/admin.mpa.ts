import { expect, type Page, test } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"

const REPOSITORY = `https://github.com/spy4x/seed`
/** What the page says about the video: its length, its sound, and one line per shot. */
const SECONDS = 59
const SHOTS = 12
const MP4_SIZE = `5 MB`

/** Runs axe-core over the whole page and returns each violation's rule and the elements it hit. */
async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).analyze()
  return result.violations.map((v) =>
    `${v.id}: ${v.nodes.map((node) => node.target.join(` `)).join(`, `)}`
  )
}

/** The entities of every JSON-LD `@graph` on the page. */
async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  const scripts = await page.locator(`script[type="application/ld+json"]`).allTextContents()
  return scripts.flatMap((text) => JSON.parse(text)[`@graph`] ?? [JSON.parse(text)])
}

test.describe(`without JavaScript`, () => {
  test.use({ javaScriptEnabled: false })

  test(`/admin opens on the video: the native player, which waits for a click and keeps its sound`, async ({ page }) => {
    await page.goto(`/admin`)
    await expect(page.getByRole(`heading`, { level: 1 })).toHaveText(
      `An admin panel for the people who run your product`,
    )
    const video = page.locator(`[data-e2e=page-hero] video[data-e2e=admin-video]`)
    await expect(video).toHaveCount(1)
    for (const name of [`controls`, `playsinline`]) {
      await expect(video, name).toHaveAttribute(name, ``)
    }
    for (const name of [`muted`, `autoplay`, `loop`]) {
      await expect(video, name).not.toHaveAttribute(name)
    }
    await expect(video).toHaveAttribute(`preload`, `none`)
    await expect(video).toHaveAttribute(`width`, `1920`)
    await expect(video).toHaveAttribute(`height`, `1200`)
    await expect(video).toHaveAttribute(`poster`, `/video/admin-panel-poster-1920.webp`)
    await expect(video).toHaveAttribute(
      `aria-label`,
      `The Seed admin panel, a video of ${SECONDS} seconds with music and no speech`,
    )

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
  })

  test(`the line under the player gives the length and the sound, and its link lands on the transcript`, async ({ page }) => {
    await page.goto(`/admin`)
    await expect(page.locator(`[data-e2e=admin-video-meta]`)).toHaveText(
      `${SECONDS} seconds · Music, no speech · Sample data`,
    )
    await page.locator(`[data-e2e=admin-transcript-jump]`).click()
    await expect(page).toHaveURL(/\/admin#transcript$/)
    await expect(page.locator(`section#transcript`)).toBeInViewport()
  })

  test(`the transcript is an open section with one line per shot and a download of the MP4 it sizes right`, async ({ page }) => {
    await page.goto(`/admin`)
    const transcript = page.locator(`section#transcript`)
    await expect(transcript.getByRole(`heading`, { level: 2 })).toHaveText(`What the video shows`)
    await expect(transcript.locator(`details`)).toHaveCount(0)
    await expect(transcript.locator(`ol > li`)).toHaveCount(SHOTS)
    await expect(transcript).toContainText(`Music plays under the video. There is no speech.`)
    await expect(transcript).toContainText(
      `The people and groups in the video are made-up sample data.`,
    )

    const download = transcript.locator(`[data-e2e=admin-video-download]`)
    await expect(download).toHaveText(`Download the video (MP4, ${MP4_SIZE})`)
    await expect(download).toHaveAttribute(`href`, `/video/admin-panel.mp4`)
    const response = await page.request.head(`/video/admin-panel.mp4`)
    const megabytes = Number(response.headers()[`content-length`]) / 1_000_000
    expect(`${Math.round(megabytes)} MB`).toBe(MP4_SIZE)
  })

  test(`the JSON-LD describes the video as the page shows it, with its length and absolute addresses`, async ({ page, baseURL }) => {
    await page.goto(`/admin`)
    const origin = new URL(baseURL!).origin
    const graph = await jsonLd(page)
    const video = graph.find((entity) => entity[`@type`] === `VideoObject`)!
    expect(video).toBeDefined()
    expect(video.duration).toBe(`PT${SECONDS}S`)
    expect(video.name).toBe(await page.getByRole(`heading`, { level: 1 }).textContent())
    expect(video.description).toBe(
      await page.locator(`[data-e2e=page-hero] h1 + p`).textContent(),
    )
    expect(video.uploadDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(video.thumbnailUrl).toBe(`${origin}/video/admin-panel-poster-1920.webp`)
    expect(video.contentUrl).toBe(`${origin}/video/admin-panel.mp4`)
    for (const url of [video.thumbnailUrl, video.contentUrl] as string[]) {
      expect((await page.request.head(url)).status(), url).toBe(200)
    }
    expect(String(video.transcript).length).toBeGreaterThan(200)

    const crumbs = graph.find((entity) => entity[`@type`] === `BreadcrumbList`)!
    const items = crumbs.itemListElement as { name: string }[]
    expect(items.map((item) => item.name)).toEqual([`Seed`, `Admin panel`])
  })

  test(`the sitemap lists /admin with when it changed, and the video sitemap its video`, async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const pages = await (await request.get(`/sitemap.xml`)).text()
    expect(pages).toMatch(
      new RegExp(
        `<loc>${origin}/admin</loc>\\s*<lastmod>\\d{4}-\\d{2}-\\d{2}T00:00:00\\.000Z</lastmod>`,
      ),
    )
    const xml = await (await request.get(`/video-sitemap.xml`)).text()
    expect(xml).toContain(`xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"`)
    const entry = xml.match(new RegExp(`<url><loc>${origin}/admin</loc>.*?</url>`))?.[0]
    expect(entry).toBeDefined()
    expect(entry).toContain(
      `<video:thumbnail_loc>${origin}/video/admin-panel-poster-1920.webp</video:thumbnail_loc>`,
    )
    expect(entry).toContain(
      `<video:content_loc>${origin}/video/admin-panel.mp4</video:content_loc>`,
    )
    expect(entry).toContain(`<video:duration>${SECONDS}</video:duration>`)
    expect(entry).toContain(
      `<video:title>An admin panel for the people who run your product</video:title>`,
    )
  })

  test(`the page asks once, for GitHub, and offers the admin app's code instead of the demo`, async ({ page }) => {
    await page.goto(`/admin`)
    const main = page.locator(`main`)
    await expect(main.getByRole(`link`, { name: `Try the live demo` })).toHaveCount(0)
    const band = main.locator(`section[aria-labelledby=cta-title]`)
    await expect(band.locator(`[data-e2e=cta-github]`)).toHaveAttribute(`href`, REPOSITORY)
    for (
      const link of [
        band.locator(`[data-e2e=cta-code]`),
        main.locator(`[data-e2e=admin-roles-code]`),
      ]
    ) {
      await expect(link).toHaveText(`Read the admin app's code`)
      await expect(link).toHaveAttribute(`href`, `${REPOSITORY}/tree/main/apps/admin`)
    }
  })

  test(`the page lists the nine modules, the three roles and what is not built yet`, async ({ page }) => {
    await page.goto(`/admin`)
    await expect(page.locator(`[data-e2e=admin-modules] h3`)).toHaveText([
      `Dashboard`,
      `Users`,
      `Groups`,
      `Billing`,
      `Newsletter`,
      `Audit log`,
      `Jobs`,
      `System`,
      `API tokens`,
    ])
    await expect(page.locator(`[data-e2e=admin-roles] dt`)).toHaveText([
      `Operator`,
      `Supervisor`,
      `Administrator`,
    ])
    await expect(page.locator(`main`).getByText(`Not built yet`)).toBeVisible()
  })

  test(`the home page's admin card and the footer lead to /admin`, async ({ page }) => {
    await page.goto(`/`)
    await expect(page.locator(`[role=article][aria-labelledby=feature-admin] a`)).toHaveAttribute(
      `href`,
      `/admin`,
    )
    await expect(page.locator(`footer`).getByRole(`link`, { name: `Admin panel` }))
      .toHaveAttribute(`href`, `/admin`)
  })

  test(`/admin fits a 375 px phone with no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto(`/admin`)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  })
})

test(`the video is as long as the page says, and its file loads under the site's security headers`, async ({ page }) => {
  await page.goto(`/admin`)
  const video = page.locator(`video[data-e2e=admin-video]`)
  // What a click on play starts: the browser picks a source and reads the file's header.
  const loaded = await video.evaluate((element: HTMLVideoElement) =>
    new Promise<{ size: string; seconds: number }>((resolve, reject) => {
      element.addEventListener(`loadedmetadata`, () => {
        resolve({
          size: `${element.videoWidth}x${element.videoHeight}`,
          seconds: Math.round(element.duration),
        })
      })
      // When no source plays, the last one reports the error.
      element.querySelector(`source:last-of-type`)!.addEventListener(
        `error`,
        () => reject(new Error(`no source of the video loaded`)),
      )
      element.load()
    })
  )
  // The seconds the line under the player names, which the label, JSON-LD and sitemap share.
  const said = (await page.locator(`[data-e2e=admin-video-meta]`).textContent())!
  expect(loaded).toEqual({ size: `1920x1200`, seconds: Number(said.match(/^(\d+) seconds/)![1]) })
})

// axe-core runs as a script in the page, so these checks keep JavaScript on: /theme.js then picks
// the theme the device asks for, as it does for most visitors.
for (const scheme of [`light`, `dark`] as const) {
  test.describe(`in the ${scheme} theme`, () => {
    test.use({ colorScheme: scheme })

    for (const width of [375, 1280]) {
      test(`axe finds no accessibility problem on /admin in the ${scheme} theme at ${width} px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/admin`)
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
