// Seed's own site: see docs/start-a-product.md
/**
 * Draws the link-preview card of each of Seed's own posts: `deno task og:blog` in
 * `apps/mpa`. It renders `blog-og.html` at 1200×630 once per post file, each language's own words
 * over the post's shared cover, and writes `libs/server/blog/seed-posts/og/<slug>.jpg`, which the
 * website serves at `/blog/og/<slug>.jpg` as the post's `og:image`.
 *
 * The cards are files in the repository, made here and never on a request, so no address of the
 * website renders text it was sent. Run it again after a post's title, cover or length changes;
 * `og-cards.test.ts` fails while a post has no card. Needs `magick`; the fonts come
 * from the pinned `geist` package that `capture.ts` downloads.
 */
import { chromium } from "playwright"
import { join } from "@std/path"
import { denoFileSystem } from "@spy4x/platform/server/deno-fs"
import { readSeedPosts, SEED_COVERS_DIR, SEED_POSTS_DIR } from "@server/blog/seed-posts.ts"
import { blogBodyLength } from "@server/blog/render.ts"
import { siteTranslator } from "../languages.ts"
import { CACHE, geistFonts, MASTERS, run } from "./capture.ts"

const SCREENSHOTS = new URL(".", import.meta.url).pathname
const OG_DIR = join(SEED_POSTS_DIR, `og`)
/** A card stays under this, so a link preview loads at once. */
const BUDGET = 150 * 1024

/** The words on one post's card. */
export interface BlogCard {
  slug: string
  lang: string
  title: string
  /** "seedsaas.com · 6 min read", in the post's language. */
  footer: string
  coverFile: string
}

/** Every Seed post's card, read from its file. A post without a cover gets none. */
export async function blogCards(): Promise<BlogCard[]> {
  const posts = await readSeedPosts(denoFileSystem)
  return posts.flatMap(({ fields, coverFile }) => {
    if (coverFile === null) return []
    const { readingMinutes } = blogBodyLength(fields.bodyMd)
    const minutes = siteTranslator(fields.language).t(`Blog.minutes`, { count: readingMinutes })
    return [{
      slug: fields.slug,
      lang: fields.language,
      title: fields.title,
      footer: `seedsaas.com ${minutes}`,
      coverFile,
    }]
  })
}

async function main(): Promise<void> {
  for (const dir of [MASTERS, CACHE, OG_DIR]) await Deno.mkdir(dir, { recursive: true })
  await geistFonts()
  const cards = await blogCards()
  const failures: string[] = []
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    })
    const origin = `http://og.invalid`
    // The made-up origin maps to this folder, the cached fonts and the covers; nothing else loads.
    await context.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname
      const file = path.startsWith(`/fonts/`)
        ? join(CACHE, path.slice(7))
        : path.startsWith(`/covers/`)
        ? join(SEED_COVERS_DIR, path.slice(8))
        : join(SCREENSHOTS, path.slice(1))
      await route.fulfill({ path: file }).catch(() => route.fulfill({ status: 404 }))
    })
    await context.route((url) => !url.href.startsWith(origin), (route) => route.abort())
    for (const card of cards) {
      const page = await context.newPage()
      const query = new URLSearchParams({
        lang: card.lang,
        title: card.title,
        footer: card.footer,
        cover: `/covers/${card.coverFile}`,
      })
      await page.goto(`${origin}/blog-og.html?${query}`)
      await page.locator(`body[data-ready], body[data-error]`).waitFor({ state: `attached` })
      if (await page.locator(`body[data-error]`).count()) {
        failures.push(`${card.slug}: the cover ${card.coverFile} did not load`)
        await page.close()
        continue
      }
      const master = join(MASTERS, `blog-og-${card.slug}.png`)
      await page.screenshot({ path: master })
      await page.close()
      const target = join(OG_DIR, `${card.slug}.jpg`)
      let quality = 85
      for (;;) {
        await run(`magick`, [master, `-strip`, `-quality`, String(quality), target])
        if ((await Deno.stat(target)).size <= BUDGET || quality <= 60) break
        quality -= 5
      }
      if ((await Deno.stat(target)).size > BUDGET) failures.push(`${target} is over 150 KB`)
    }
    await context.close()
  } finally {
    await browser.close()
  }
  console.log(`${cards.length - failures.length} of ${cards.length} cards in ${OG_DIR}`)
  if (failures.length) {
    console.error(failures.join(`\n`))
    Deno.exit(1)
  }
}

if (import.meta.main) await main()
