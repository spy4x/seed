import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App } from "fresh"
import type { PublicBlogPost, PublicBlogPostSummary } from "@domain/blog"
import AppWrapper from "./routes/_app.tsx"
import Home from "./routes/index.tsx"
import { handler as blogIndex } from "./routes/blog/index.tsx"
import { handler as blogPost, POST_NOT_FOUND } from "./routes/blog/[slug].tsx"
import { handler as rss } from "./routes/rss.xml.ts"
import { handler as sitemap } from "./routes/sitemap.xml.ts"
import { handler as llms } from "./routes/llms.txt.ts"
import { blogLinkMiddleware } from "./blog.ts"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://www.example.com",
  apiOrigin: "https://app.example.com",
}
const site = config.webAppOrigin
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

const NEWER: PublicBlogPostSummary = {
  slug: `cron-jobs`,
  title: `Cron jobs without a cron`,
  description: `How the worker runs repeating jobs.`,
  topic: `Engineering`,
  publishedAt: `2026-10-20T09:00:00.000Z`,
  updatedAt: `2026-10-22T09:00:00.000Z`,
  readingMinutes: 4,
}
const OLDER: PublicBlogPostSummary = {
  slug: `hello-world`,
  title: `Hello, world`,
  description: `Why we built this.`,
  topic: `Product`,
  publishedAt: `2026-10-02T09:00:00.000Z`,
  updatedAt: null,
  readingMinutes: 6,
}

/** The newer post as the API answers it in full, with a cover and an update. */
const FULL: PublicBlogPost = {
  ...NEWER,
  seoTitle: `Cron jobs in Seed`,
  tldr: [`One table holds every job.`, `A failed job is tried again.`],
  coverUrl: `https://images.example.com/cron.png`,
  coverAlt: `A clock over a server rack`,
  html: `<p>The worker <strong>wakes</strong> every second.</p>`,
  headings: [{ id: `why`, text: `Why`, depth: 2 }],
  authorName: `Ada Lovelace`,
}

/** A long post with two sections: long enough for "On this page". */
const LONG: PublicBlogPost = {
  ...FULL,
  updatedAt: null,
  coverUrl: null,
  coverAlt: null,
  authorName: null,
  readingMinutes: 9,
  headings: [
    { id: `first`, text: `First part`, depth: 2 },
    { id: `detail`, text: `A detail`, depth: 3 },
    { id: `second`, text: `Second part`, depth: 2 },
  ],
}

/** What the fake API answers, by path with its query; anything else is a 404. */
type Answers = Record<string, () => Response>

/** A fake API that answers `answers` and records every path it was asked. */
function fakeApi(answers: Answers) {
  const asked: string[] = []
  const fetch = ((input: string | URL | Request) => {
    const url = new URL(new Request(input).url)
    const path = `${url.pathname}${url.search}`
    asked.push(path)
    const answer = answers[path]
    return Promise.resolve(
      answer ? answer() : Response.json({ error: `Not found` }, { status: 404 }),
    )
  }) as typeof globalThis.fetch
  return { asked, fetch }
}

const listing = (posts: PublicBlogPostSummary[]): Answers => ({
  "/api/blog/posts": () => Response.json({ posts }),
})

/** The website's blog routes behind its middleware, the home page beside them for the header. */
async function blogSite(answers: Answers, { newsletter = true } = {}) {
  const api = fakeApi(answers)
  const handler = new App<State>()
    .use(pageMiddleware(config, api.fetch, () => newsletter))
    .use(await blogLinkMiddleware(config, api.fetch))
    .appWrapper(view(AppWrapper))
    .route("/", { component: view(Home) })
    .get("/blog", blogIndex.GET!)
    .get("/blog/:slug", blogPost.GET!)
    .get("/rss.xml", rss.GET!)
    .get("/sitemap.xml", sitemap.GET!)
    .get("/llms.txt", llms.GET!)
    .handler()
  const get = async (path: string) => {
    const response = await handler(new Request(`${site}${path}`), info)
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      body: await response.text(),
    }
  }
  return { get, asked: api.asked }
}

/** Runs `run` with `console.error` silenced: an API failure is logged by design. */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  try {
    return await run()
  } finally {
    console.error = original
  }
}

function metaContent(html: string, key: string): string | undefined {
  return html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1]
}

function canonical(html: string): string | undefined {
  return html.match(/<link rel="canonical" href="([^"]*)"/)?.[1]
}

function jsonLdGraph(html: string): Record<string, unknown>[] {
  const scripts = [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ]
  return scripts.flatMap((match) => JSON.parse(match[1])["@graph"])
}

/** The opening tag of the `<a>` whose text is `text`, or `undefined`. */
function linkNamed(html: string, text: string): string | undefined {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
    .find((match) => textOf(match[1]).trim() === text)?.[0].match(/<a\b[^>]*>/)?.[0]
}

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
}

const header = (html: string) => html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? ``
const footer = (html: string) => html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? ``

describe("the blog index", () => {
  it("lists the live posts newest first with their date, reading time and link", async () => {
    const { get } = await blogSite(listing([NEWER, OLDER]))
    const { status, body } = await get("/blog")

    expect(status).toBe(200)
    const text = textOf(body)
    expect(text).toContain(`20 Oct 2026 · 4 min read`)
    expect(text.indexOf(NEWER.title)).toBeLessThan(text.indexOf(OLDER.title))
    expect(body).toContain(`href="/blog/cron-jobs"`)
    expect(body).toContain(`href="/rss.xml"`)
    expect(canonical(body)).toBe(`${site}/blog`)
    expect(metaContent(body, "robots")).toBe("index, follow")
    expect(jsonLdGraph(body).map((node) => node["@type"])).toEqual([`Blog`, `BreadcrumbList`])
  })

  it("filters by topic through a plain link, marks it, and keeps the canonical address", async () => {
    const { get } = await blogSite(listing([NEWER, OLDER]))
    const { body } = await get("/blog?topic=Product")

    expect(body).toContain(`href="/blog/hello-world"`)
    expect(body).not.toContain(`href="/blog/cron-jobs"`)
    expect(body).toMatch(/<a href="\/blog\?topic=Product" aria-current="page"/)
    expect(linkNamed(body, `All topics`)).toContain(`href="/blog"`)
    expect(linkNamed(body, `All topics`)).toContain(`aria-current="false"`)
    expect(canonical(body)).toBe(`${site}/blog`)
  })

  it("says a topic has no posts yet, links back to all posts and keeps out of search", async () => {
    const { get } = await blogSite(listing([NEWER]))
    const { status, body } = await get("/blog?topic=Nothing")

    expect(status).toBe(200)
    expect(textOf(body)).toContain(`No posts on this topic yet`)
    expect(metaContent(body, "robots")).toBe("noindex, nofollow")
  })

  it("answers 200 with no posts yet, the newsletter form, noindex and no Blog or RSS link", async () => {
    const { get } = await blogSite(listing([]))
    const { status, body } = await get("/blog")

    expect(status).toBe(200)
    expect(textOf(body)).toContain(`No posts yet`)
    expect(textOf(body)).toContain(`The first one is on its way. Get it by email:`)
    expect(body).toContain(`data-e2e="blog-subscribe-email"`)
    // The footer's form steps aside for the one in the page.
    expect(body).not.toContain(`data-e2e="footer-subscribe-email"`)
    expect(metaContent(body, "robots")).toBe("noindex, nofollow")
    expect(header(body)).not.toContain(`href="/blog"`)
    expect(body).not.toContain(`application/rss+xml`)
    expect(body).not.toContain(`data-e2e="blog-rss"`)
  })

  it("offers no form on an empty blog while the newsletter is off", async () => {
    const { get } = await blogSite(listing([]), { newsletter: false })
    const { body } = await get("/blog")

    expect(textOf(body)).toContain(`The first one is on its way.`)
    expect(body).not.toContain(`<form`)
  })

  it("answers 502 with the error page when the API cannot list the posts", async () => {
    const { get } = await blogSite({})
    const { status, body } = await quietly(() => get("/blog"))

    expect(status).toBe(502)
    expect(textOf(body)).toContain(`Something went wrong`)
  })
})

describe("a blog post", () => {
  const answers = (post: PublicBlogPost, readNext = [OLDER]): Answers => ({
    ...listing([NEWER, OLDER]),
    [`/api/blog/posts/${post.slug}`]: () => Response.json({ post, readNext }),
  })

  it("shows the trail, topic, title, dates, reading time, author, cover, key points and body", async () => {
    const { get } = await blogSite(answers(FULL))
    const { status, body } = await get("/blog/cron-jobs")

    expect(status).toBe(200)
    const text = textOf(body)
    expect(body).toMatch(
      /<nav aria-label="Breadcrumb"[\s\S]*?href="\/blog"[\s\S]*?href="\/blog\?topic=Engineering"/,
    )
    expect(body).toMatch(/<h1[^>]*>\s*Cron jobs without a cron\s*<\/h1>/)
    expect(text).toContain(
      `Published 20 Oct 2026 · Updated 22 Oct 2026 · 4 min read · Ada Lovelace`,
    )
    expect(body).toMatch(
      /<img src="https:\/\/images\.example\.com\/cron\.png" alt="A clock over a server rack"[^>]*fetchpriority="high"/,
    )
    expect(text).toContain(`In short One table holds every job. A failed job is tried again.`)
    expect(body).toContain(`<p>The worker <strong>wakes</strong> every second.</p>`)
  })

  it("says Updated only for a post that was updated", async () => {
    const { get } = await blogSite(answers({ ...FULL, updatedAt: null }))
    const { body } = await get("/blog/cron-jobs")

    expect(textOf(body)).not.toContain(`Updated`)
    expect(metaContent(body, "article:modified_time")).toBeUndefined()
  })

  it("describes itself to search engines and link previews as an article", async () => {
    const { get } = await blogSite(answers(FULL))
    const { body } = await get("/blog/cron-jobs")

    // The SEO title names the site already, so the site's name is not added again.
    expect(body).toContain(`<title>Cron jobs in Seed</title>`)
    expect(metaContent(body, "description")).toBe(FULL.description)
    expect(canonical(body)).toBe(`${site}/blog/cron-jobs`)
    expect(metaContent(body, "og:type")).toBe(`article`)
    expect(metaContent(body, "og:image")).toBe(FULL.coverUrl!)
    expect(metaContent(body, "og:image:alt")).toBe(FULL.coverAlt!)
    expect(metaContent(body, "article:published_time")).toBe(FULL.publishedAt)
    expect(metaContent(body, "article:modified_time")).toBe(FULL.updatedAt!)
    const [posting, trail] = jsonLdGraph(body)
    expect(posting).toMatchObject({
      "@type": `BlogPosting`,
      headline: FULL.title,
      description: FULL.description,
      image: FULL.coverUrl,
      datePublished: FULL.publishedAt,
      dateModified: FULL.updatedAt,
      author: { "@type": `Person`, name: `Ada Lovelace` },
      publisher: { "@id": `https://antonshubin.com/#person` },
      mainEntityOfPage: { "@id": `${site}/blog/cron-jobs` },
      articleSection: `Engineering`,
      inLanguage: `en`,
      timeRequired: `PT4M`,
      isPartOf: { "@type": `Blog`, "@id": `${site}/blog#blog` },
    })
    expect(trail).toMatchObject({
      "@type": `BreadcrumbList`,
      itemListElement: [
        { position: 1, name: `Seed` },
        { position: 2, name: `Blog`, item: `${site}/blog` },
        { position: 3, name: FULL.title },
      ],
    })
  })

  it("shares the site's own image when the post has no cover", async () => {
    const { get } = await blogSite(answers(LONG))
    const { body } = await get("/blog/cron-jobs")

    expect(metaContent(body, "og:image")).toBe(`${site}/og/home.png`)
    expect(body).not.toContain(`data-e2e="blog-post-cover"`)
  })

  it("keeps a title that tries to close the script element inside the JSON-LD", async () => {
    const title = `</script><script>alert(1)</script>`
    const { get } = await blogSite(answers({ ...FULL, title }))
    const { body } = await get("/blog/cron-jobs")

    expect(body).not.toContain(`<script>alert(1)`)
    expect(jsonLdGraph(body)[0].headline).toBe(title)
  })

  it("lists its sections in On this page only when it takes eight minutes or more", async () => {
    const long = await (await blogSite(answers(LONG))).get("/blog/cron-jobs")
    const short = await (await blogSite(answers(FULL))).get("/blog/cron-jobs")

    expect(long.body).toContain(`data-e2e="blog-post-toc"`)
    expect(long.body).toContain(`href="#first"`)
    expect(long.body).toContain(`href="#second"`)
    expect(long.body).not.toContain(`href="#detail"`)
    expect(short.body).not.toContain(`data-e2e="blog-post-toc"`)
  })

  it("ends with the newsletter form while it is on, and the footer leaves its own out", async () => {
    const { get } = await blogSite(answers(FULL))
    const { body } = await get("/blog/cron-jobs")

    expect(body).toContain(`data-e2e="post-subscribe-email"`)
    expect(body).not.toContain(`data-e2e="footer-subscribe-email"`)
    expect(body).not.toContain(`data-e2e="cta-github"`)
  })

  it("ends with the demo's call to action while the newsletter is off", async () => {
    const { get } = await blogSite(answers(FULL), { newsletter: false })
    const { body } = await get("/blog/cron-jobs")

    expect(body).toContain(`data-e2e="cta-github"`)
    expect(body).not.toContain(`<form`)
  })

  it("offers up to three posts to read next, then all posts", async () => {
    const { get } = await blogSite(answers(FULL))
    const { body } = await get("/blog/cron-jobs")

    const readNext = body.match(/data-e2e="blog-read-next"[\s\S]*?<\/section>/)?.[0] ?? ``
    expect(textOf(readNext)).toContain(`Read next`)
    expect(readNext).toContain(`href="/blog/hello-world"`)
    expect(linkNamed(readNext, `All posts`)).toContain(`href="/blog"`)
  })

  it("answers 404 This post is not here for a post that is not live", async () => {
    const { get, asked } = await blogSite(listing([NEWER]))
    const { status, body } = await get("/blog/draft-pricing-notes")

    expect(status).toBe(404)
    expect(asked).toContain(`/api/blog/posts/draft-pricing-notes`)
    expect(body).toMatch(new RegExp(`<h1[^>]*>\\s*${POST_NOT_FOUND.title}\\s*</h1>`))
    expect(textOf(body)).toContain(POST_NOT_FOUND.description)
    expect(body).toContain(`href="/blog"`)
    expect(metaContent(body, "robots")).toBe("noindex, nofollow")
  })

  it("answers 404 for an address that is no slug without asking the API", async () => {
    const { get, asked } = await blogSite(listing([NEWER]))
    const { status } = await get("/blog/Not%20A%20Slug")

    expect(status).toBe(404)
    expect(asked.filter((path) => path.startsWith(`/api/blog/posts/`))).toEqual([])
  })

  it("answers 502 with the error page when the API fails", async () => {
    const { get } = await blogSite({
      ...listing([NEWER]),
      "/api/blog/posts/cron-jobs": () => new Response(`boom`, { status: 500 }),
    })
    const { status } = await quietly(() => get("/blog/cron-jobs"))

    expect(status).toBe(502)
  })
})

describe("the RSS feed", () => {
  const feed = (posts: unknown[]): Answers => ({
    ...listing([]),
    "/api/blog/feed": () => Response.json({ posts }),
  })

  it("carries every post the API gives with its link, date and full HTML", async () => {
    const { get } = await blogSite(feed([FULL]))
    const { status, type, body } = await get("/rss.xml")

    expect(status).toBe(200)
    expect(type).toBe(`application/rss+xml; charset=utf-8`)
    expect(body).toContain(`<atom:link href="${site}/rss.xml" rel="self"`)
    expect(body).toContain(`<link>${site}/blog</link>`)
    expect(body).toContain(`<title>Cron jobs without a cron</title>`)
    expect(body).toContain(`<guid isPermaLink="true">${site}/blog/cron-jobs</guid>`)
    expect(body).toContain(`<pubDate>Tue, 20 Oct 2026 09:00:00 GMT</pubDate>`)
    expect(body).toContain(`<content:encoded><![CDATA[${FULL.html}]]></content:encoded>`)
  })

  it("is a valid feed with no items while no post is live", async () => {
    const { get } = await blogSite(feed([]))
    const { status, body } = await get("/rss.xml")

    expect(status).toBe(200)
    expect(body).toContain(`<channel>`)
    expect(body).not.toContain(`<item>`)
  })

  it("answers 502 when the API cannot give the feed", async () => {
    const { get } = await blogSite({})
    const { status } = await quietly(() => get("/rss.xml"))

    expect(status).toBe(502)
  })
})

describe("the blog in the sitemap and llms.txt", () => {
  it("lists the blog and each post, dated by its last update or else its publishing", async () => {
    const { get } = await blogSite(listing([NEWER, OLDER]))
    const { body } = await get("/sitemap.xml")

    expect(body).toContain(
      `<loc>${site}/blog</loc>\n    <lastmod>2026-10-22T09:00:00.000Z</lastmod>`,
    )
    expect(body).toContain(
      `<loc>${site}/blog/cron-jobs</loc>\n    <lastmod>2026-10-22T09:00:00.000Z</lastmod>`,
    )
    expect(body).toContain(
      `<loc>${site}/blog/hello-world</loc>\n    <lastmod>2026-10-02T09:00:00.000Z</lastmod>`,
    )
  })

  it("leaves the blog out of both while no post is live, and while the API cannot answer", async () => {
    for (const answers of [listing([]), {}]) {
      const { get } = await blogSite(answers)
      const map = (await quietly(() => get("/sitemap.xml"))).body
      const text = (await quietly(() => get("/llms.txt"))).body

      expect(map).toContain(`<loc>${site}/</loc>`)
      expect(map).not.toContain(`/blog`)
      expect(text).not.toContain(`## Blog`)
    }
  })

  it("gives llms.txt a Blog section with every post and its description", async () => {
    const { get } = await blogSite(listing([NEWER]))
    const { body } = await get("/llms.txt")

    expect(body).toContain(`## Blog`)
    expect(body).toContain(
      `[Cron jobs without a cron](${site}/blog/cron-jobs): ${NEWER.description}`,
    )
  })
})

describe("the Blog link", () => {
  it("shows in the header and footer, with the RSS link, once a post is live", async () => {
    const { get } = await blogSite(listing([NEWER]))
    const { body } = await get("/")

    expect(header(body)).toContain(`href="/blog"`)
    expect(footer(body)).toContain(`href="/blog"`)
    expect(body).toContain(
      `<link rel="alternate" type="application/rss+xml" title="Seed blog" href="${site}/rss.xml"`,
    )
  })

  it("is hidden while no post is live, and while the API has never answered", async () => {
    for (const answers of [listing([]), {}]) {
      const { get } = await blogSite(answers)
      const { body } = await get("/")

      expect(header(body)).not.toContain(`href="/blog"`)
      expect(footer(body)).not.toContain(`href="/blog"`)
      expect(body).not.toContain(`application/rss+xml`)
    }
  })
})
