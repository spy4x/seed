import { expect } from "@std/expect"
import { describe, it } from "@std/testing/bdd"
import { App, fsRoutes } from "@spy4x/preact-server"
import {
  catalogItemPath,
  type PublicCatalogItem,
  type PublicCatalogResponse,
} from "@domain/catalog"
import { DEFAULT_ITEM_PATH } from "@server/catalog/tracking.ts"
import Layout from "./routes/_layout.tsx"
import AppWrapper from "./routes/_app.tsx"
import { handler as catalogIndex } from "./routes/[[lang]]/catalog/index.tsx"
import { handler as categoryPage } from "./routes/[[lang]]/catalog/[category].tsx"
import { handler as itemPage } from "./routes/[[lang]]/[category]/[slug].tsx"
import { handler as photoFile } from "./routes/catalog/photos/[id]/[file].ts"
import { handler as sitemap } from "./routes/sitemap.xml.ts"
import { handler as llms } from "./routes/llms.txt.ts"
import { itemPath } from "./catalog.ts"
import { pageMiddleware } from "./middleware.ts"
import type { State } from "./utils.ts"

const config = {
  apiUrl: "http://api:8000",
  webAppOrigin: "https://shop.example.com",
  apiOrigin: "https://app.example.com",
}
const site = config.webAppOrigin
const info = {
  remoteAddr: { transport: "tcp", hostname: "192.0.2.7", port: 4000 },
  completed: Promise.resolve(),
} as Deno.ServeHandlerInfo<Deno.NetAddr>

const view = (component: unknown) => component as Parameters<App<State>["appWrapper"]>[0]

const COVER_ID = `0199a000-0000-7000-8000-000000000001`
const BACK_ID = `0199a000-0000-7000-8000-000000000002`
const BROWN = `0199a000-0000-7000-8000-0000000000b1`
const BLACK = `0199a000-0000-7000-8000-0000000000b2`
const SMALL = `0199a000-0000-7000-8000-0000000000c1`
const MEDIUM = `0199a000-0000-7000-8000-0000000000c2`

const variants = [
  { file: `480.avif`, width: 480, height: 640, type: `image/avif` },
  { file: `960.avif`, width: 960, height: 1280, type: `image/avif` },
  { file: `480.webp`, width: 480, height: 640, type: `image/webp` },
  { file: `960.webp`, width: 960, height: 1280, type: `image/webp` },
]

const cover = { id: COVER_ID, colourId: null, alt: { en: `The jacket, front` }, variants }

const CATALOG: PublicCatalogResponse = {
  settings: { currency: `USD`, languages: [`en`, `de`] },
  categories: [
    { slug: `jackets`, name: { en: `Jackets`, de: `Jacken` } },
    { slug: `shirts`, name: { en: `Shirts` } },
  ],
  items: [
    {
      slug: `zip-jacket`,
      categorySlug: `jackets`,
      name: { en: `Brown zip jacket`, de: `Braune Zip-Jacke` },
      price: 1999,
      stock: `some-sold-out`,
      cover,
      sizes: [{ label: `S`, soldOut: false }, { label: `M`, soldOut: true }],
      colours: [
        { name: { en: `Brown` }, swatch: `#7a5230`, soldOut: false },
        { name: { en: `Black` }, swatch: `#111111`, soldOut: false },
      ],
      publishedAt: `2026-11-01T10:00:00.000Z`,
      updatedAt: `2026-11-05T10:00:00.000Z`,
    },
    {
      slug: `linen-shirt`,
      categorySlug: `shirts`,
      name: { en: `Linen shirt` },
      price: 2500,
      stock: `sold-out`,
      cover: null,
      sizes: [],
      colours: [],
      publishedAt: `2026-11-02T10:00:00.000Z`,
      updatedAt: `2026-11-03T10:00:00.000Z`,
    },
  ],
}

const JACKET: PublicCatalogItem = {
  ...CATALOG.items[0],
  description: { en: `A warm jacket with a zip.\nLined.` },
  material: { en: `Wool` },
  fit: {},
  care: { en: `Dry clean only` },
  colours: [
    { id: BROWN, name: { en: `Brown`, de: `Braun` }, swatch: `#7a5230`, soldOut: false },
    { id: BLACK, name: { en: `Black` }, swatch: `#111111`, soldOut: false },
  ],
  sizes: [
    { id: SMALL, label: `S`, heightCm: null, weightKg: null, soldOut: false },
    { id: MEDIUM, label: `M`, heightCm: null, weightKg: null, soldOut: true },
  ],
  soldOut: [{ colourId: BROWN, sizeId: MEDIUM }, { colourId: BLACK, sizeId: MEDIUM }],
  photos: [cover, { id: BACK_ID, colourId: BLACK, alt: {}, variants }],
}

/** What the fake API answers, by path; anything else is a 404, as with the catalog off. */
type Answers = Record<string, () => Response>

const catalogOn = (item: PublicCatalogItem = JACKET): Answers => ({
  "/api/catalog": () => Response.json(CATALOG),
  [`/api/catalog/items/${item.slug}`]: () => Response.json({ item }),
  "/api/blog/posts": () => Response.json({ posts: [] }),
})

/** The website's catalog routes behind its middleware, beside the sitemap and `llms.txt`. */
function catalogSite(answers: Answers) {
  const asked: string[] = []
  const fetch = ((input: string | URL | Request) => {
    const path = new URL(new Request(input).url).pathname
    asked.push(path)
    const answer = answers[path]
    return Promise.resolve(
      answer ? answer() : Response.json({ error: { code: `not_found` } }, { status: 404 }),
    )
  }) as typeof globalThis.fetch
  const handler = new App<State>()
    .use(pageMiddleware(config, fetch, () => false))
    .appWrapper(view(AppWrapper))
    .layout("*", view(Layout))
    .get("/catalog/photos/:id/:file", photoFile.GET!)
    .get("{/:lang}?/catalog", catalogIndex.GET!)
    .get("{/:lang}?/catalog/:category", categoryPage.GET!)
    .get("/sitemap.xml", sitemap.GET!)
    .get("/llms.txt", llms.GET!)
    .get("{/:lang}?/:category/:slug", itemPage.GET!)
    .handler()
  const get = async (path: string) => {
    const response = await handler(new Request(`${site}${path}`), info)
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      cache: response.headers.get("cache-control"),
      body: await response.text(),
    }
  }
  return { get, asked }
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

function jsonLdGraph(html: string): Record<string, unknown>[] {
  const scripts = [
    ...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ]
  return scripts.flatMap((match) => JSON.parse(match[1])["@graph"])
}

const node = (html: string, type: string) =>
  jsonLdGraph(html).find((entry) => entry["@type"] === type) as Record<string, unknown> | undefined

function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
}

/** The page's `<main>`, without the build stamp the layout adds to every local address. */
const main = (html: string) =>
  (html.match(/<main[\s\S]*<\/main>/)?.[0] ?? ``).replaceAll(`?__v=dev`, ``)

describe("the catalog page", () => {
  it("shows every published item as a tile with its photo, name, price, sizes and colours", async () => {
    const { status, body } = await catalogSite(catalogOn()).get(`/catalog`)

    expect(status).toBe(200)
    const content = main(body)
    expect(content).toContain(`href="/jackets/zip-jacket"`)
    expect(content).toContain(`href="/shirts/linen-shirt"`)
    expect(textOf(content)).toContain(`Brown zip jacket US$19.99`)
    expect(content).toContain(`type="image/avif" srcset="/catalog/photos/${COVER_ID}/480.avif 480w`)
    expect(content).toContain(`alt="The jacket, front"`)
    expect(content).toMatch(/<s>M<\/s><span class="sr-only">, sold out<\/span>/)
    expect(content).toContain(`<span class="sr-only">Brown</span>`)
    // The shirt has no photo yet, and nothing left: a neutral picture, the price struck, said.
    expect(content).toContain(`src="/catalog-no-photo.svg`)
    expect(textOf(content)).toContain(`Sold out`)
    expect(content).toContain(`href="/catalog/jackets"`)
  })

  it("publishes an ItemList of every item's page and a BreadcrumbList", async () => {
    const { body } = await catalogSite(catalogOn()).get(`/catalog`)

    expect(node(body, `ItemList`)?.itemListElement).toEqual([
      { "@type": `ListItem`, position: 1, url: `${site}/jackets/zip-jacket` },
      { "@type": `ListItem`, position: 2, url: `${site}/shirts/linen-shirt` },
    ])
    expect(node(body, `BreadcrumbList`)).toBeDefined()
  })

  it("speaks a language both the site and the catalog keep, and no other", async () => {
    const { get } = catalogSite(catalogOn())
    const german = await get(`/de/catalog`)
    const french = await get(`/fr/catalog`)

    expect(german.status).toBe(200)
    expect(main(german.body)).toContain(`href="/de/jackets/zip-jacket"`)
    expect(textOf(main(german.body))).toContain(`Braune Zip-Jacke`)
    // A text the catalog has only in its default language is shown in it, marked as such.
    expect(main(german.body)).toMatch(/lang="en"[^>]*>[^<]*Shirts/)
    expect(german.body).toContain(`<link rel="alternate" hreflang="de" href="${site}/de/catalog"`)
    expect(german.body).not.toContain(`<link rel="alternate" hreflang="fr"`)
    expect(french.status).toBe(404)
  })

  it("says nothing is for sale yet and keeps out of search while no item is published", async () => {
    const empty = { ...CATALOG, categories: [], items: [] }
    const { status, body } = await catalogSite({
      "/api/catalog": () => Response.json(empty),
    }).get(`/catalog`)

    expect(status).toBe(200)
    expect(textOf(body)).toContain(`Nothing for sale yet`)
    expect(body).toContain(`<meta name="robots" content="noindex, nofollow"`)
    expect(node(body, `ItemList`)).toBeUndefined()
  })

  it("answers 502 with the error page when the API answers something else", async () => {
    const { status } = await quietly(() =>
      catalogSite({ "/api/catalog": () => Response.json({ items: 1 }) }).get(`/catalog`)
    )

    expect(status).toBe(502)
  })
})

describe("a category page", () => {
  it("shows only that category's items, with an ItemList and the trail back to the catalog", async () => {
    const { status, body } = await catalogSite(catalogOn()).get(`/catalog/jackets`)

    expect(status).toBe(200)
    expect(main(body)).toContain(`href="/jackets/zip-jacket"`)
    expect(main(body)).not.toContain(`href="/shirts/linen-shirt"`)
    expect(main(body)).toMatch(/<a href="\/catalog\/jackets" aria-current="page"/)
    expect(node(body, `ItemList`)?.itemListElement).toEqual([
      { "@type": `ListItem`, position: 1, url: `${site}/jackets/zip-jacket` },
    ])
    expect(node(body, `BreadcrumbList`)?.itemListElement).toEqual([
      { "@type": `ListItem`, position: 1, name: `Seed`, item: `${site}/` },
      { "@type": `ListItem`, position: 2, name: `Catalog`, item: `${site}/catalog` },
      { "@type": `ListItem`, position: 3, name: `Jackets`, item: `${site}/catalog/jackets` },
    ])
  })

  it("is the 404 page for a category the catalog does not have", async () => {
    const { status } = await catalogSite(catalogOn()).get(`/catalog/hats`)

    expect(status).toBe(404)
  })
})

describe("an item page", () => {
  it("shows the photos cover first, the name, price, colours, sizes, texts and the trail", async () => {
    const { status, body } = await catalogSite(catalogOn()).get(`/jackets/zip-jacket`)

    expect(status).toBe(200)
    const content = main(body)
    const images = content.match(/<img [^>]*>/g) ?? []
    expect(images).toHaveLength(2)
    expect(images[0]).toContain(`src="/catalog/photos/${COVER_ID}/960.webp`)
    expect(images[0]).toContain(`alt="The jacket, front"`)
    expect(images[0]).toContain(`fetchpriority="high"`)
    // A photo without its own text is described by the item's name.
    expect(images[1]).toContain(`alt="Brown zip jacket"`)
    expect(images[1]).toContain(`loading="lazy"`)
    expect(content).toContain(
      `<source type="image/avif" srcset="/catalog/photos/${COVER_ID}/480.avif 480w, /catalog/photos/${COVER_ID}/960.avif 960w"`,
    )
    const text = textOf(content)
    expect(text).toContain(`Brown zip jacket US$19.99`)
    expect(text).toMatch(/Colours Brown Black Sizes S M , sold out/)
    expect(content).toContain(`fill="#7a5230"`)
    expect(content).toContain(`href="?colour=${BROWN}#options"`)
    expect(content).toContain(`id="options"`)
    expect(body).toContain(`<title>Brown zip jacket · Seed</title>`)
    expect(body).toContain(`<meta property="og:title" content="Brown zip jacket · Seed"`)
    expect(text).toContain(`A warm jacket with a zip. Lined.`)
    expect(text).toContain(`Material Wool Care Dry clean only`)
    expect(text).not.toContain(`Fit`)
    expect(content).toContain(`href="/catalog/jackets"`)
  })

  it("publishes a ProductGroup with the fields Google's product result requires", async () => {
    const { body } = await catalogSite(catalogOn()).get(`/jackets/zip-jacket`)
    const group = node(body, `ProductGroup`)!

    expect(group.name).toBe(`Brown zip jacket`)
    expect(group.url).toBe(`${site}/jackets/zip-jacket`)
    expect(group.productGroupID).toBe(`zip-jacket`)
    expect(group.variesBy).toEqual([`https://schema.org/color`, `https://schema.org/size`])
    const products = group.hasVariant as Record<string, unknown>[]
    expect(products).toHaveLength(4)
    for (const product of products) {
      expect((product.image as string[])[0]).toMatch(/^https:\/\/shop\.example\.com\/catalog\//)
      expect(product.offers).toMatchObject({
        "@type": `Offer`,
        price: 19.99,
        priceCurrency: `USD`,
      })
    }
    expect(node(body, `BreadcrumbList`)?.itemListElement).toEqual([
      { "@type": `ListItem`, position: 1, name: `Seed`, item: `${site}/` },
      { "@type": `ListItem`, position: 2, name: `Catalog`, item: `${site}/catalog` },
      { "@type": `ListItem`, position: 3, name: `Jackets`, item: `${site}/catalog/jackets` },
      {
        "@type": `ListItem`,
        position: 4,
        name: `Brown zip jacket`,
        item: `${site}/jackets/zip-jacket`,
      },
    ])
  })

  it("marks a sold-out size's offers OutOfStock, and InStock again once it is back", async () => {
    const availability = async (item: PublicCatalogItem) => {
      const { body } = await catalogSite(catalogOn(item)).get(`/jackets/zip-jacket`)
      const products = node(body, `ProductGroup`)!.hasVariant as Record<string, unknown>[]
      return Object.fromEntries(products.map((product) => [
        `${product.color} ${product.size}`,
        (product.offers as { availability: string }).availability.replace(
          `https://schema.org/`,
          ``,
        ),
      ]))
    }

    expect(await availability(JACKET)).toEqual({
      "Brown S": `InStock`,
      "Brown M": `OutOfStock`,
      "Black S": `InStock`,
      "Black M": `OutOfStock`,
    })
    expect(await availability({ ...JACKET, soldOut: [{ colourId: BROWN, sizeId: MEDIUM }] }))
      .toMatchObject({ "Brown M": `OutOfStock`, "Black M": `InStock` })
  })

  it("publishes a Product with one Offer for an item with neither colours nor sizes", async () => {
    const plain = { ...JACKET, colours: [], sizes: [], soldOut: [], stock: `sold-out` as const }
    const { body } = await catalogSite(catalogOn(plain)).get(`/jackets/zip-jacket`)
    const product = node(body, `Product`)!

    expect(product.name).toBe(`Brown zip jacket`)
    expect(product.image).toEqual([
      `${site}/catalog/photos/${COVER_ID}/960.webp`,
      `${site}/catalog/photos/${BACK_ID}/960.webp`,
    ])
    expect(product.offers).toMatchObject({
      price: 19.99,
      priceCurrency: `USD`,
      availability: `https://schema.org/OutOfStock`,
    })
  })

  it("says whether the colour and size a variant's address picks is in stock", async () => {
    const { get } = catalogSite(catalogOn())
    const soldOut = await get(`/jackets/zip-jacket?colour=${BROWN}&size=${MEDIUM}`)
    const inStock = await get(`/jackets/zip-jacket?colour=${BLACK}&size=${SMALL}`)

    expect(textOf(soldOut.body)).toContain(`Brown, M: sold out`)
    expect(textOf(inStock.body)).toContain(`Black, S: in stock`)
    expect(inStock.body).toContain(`<link rel="canonical" href="${site}/jackets/zip-jacket"`)
  })

  it("is the 404 page in the wrong category, unpublished, or under a language's prefix", async () => {
    const { get } = catalogSite(catalogOn())

    expect((await get(`/shirts/zip-jacket`)).status).toBe(404)
    expect((await get(`/jackets/no-such-item`)).status).toBe(404)
    expect((await get(`/fr/jackets/zip-jacket`)).status).toBe(404)
    expect((await get(`/de/jackets/zip-jacket`)).status).toBe(200)
  })

  it("is the 404 page for an item whose category is named like a language", async () => {
    const shadowed = { ...JACKET, categorySlug: `de` }
    const { get } = catalogSite(catalogOn(shadowed))

    // `/de/zip-jacket` is German for the address `/zip-jacket`, never the category `de`.
    expect((await get(`/de/zip-jacket`)).status).toBe(404)
  })

  it("asks the API nothing for an address whose item slug climbs out of the catalog", async () => {
    const { get, asked } = catalogSite(catalogOn())

    expect((await get(`/jackets/..%2F..%2Fadmin%2Fx`)).status).toBe(404)
    expect(asked).toEqual([`/api/catalog`])
  })

  it("lives at the address tracking links lead to by default", () => {
    expect(itemPath({ slug: `zip-jacket`, categorySlug: `jackets` })).toBe(
      catalogItemPath(DEFAULT_ITEM_PATH, { itemSlug: `zip-jacket`, categorySlug: `jackets` }),
    )
  })
})

describe("the catalog's markup", () => {
  it("draws every page, colour dots included, without a style attribute, which the site's policy blocks", async () => {
    const { get } = catalogSite(catalogOn())

    for (const path of [`/catalog`, `/catalog/jackets`, `/jackets/zip-jacket`]) {
      const content = main((await get(path)).body)
      expect(content).toContain(`fill="#7a5230"`)
      expect(content).not.toContain(`style=`)
    }
  })
})

describe("the catalog switched off", () => {
  it("makes every catalog page the 404 page and leaves the catalog out of the sitemap and llms.txt", async () => {
    const { get } = catalogSite({ "/api/blog/posts": () => Response.json({ posts: [] }) })

    expect((await get(`/catalog`)).status).toBe(404)
    expect((await get(`/catalog/jackets`)).status).toBe(404)
    expect((await get(`/jackets/zip-jacket`)).status).toBe(404)
    expect((await get(`/catalog/photos/${COVER_ID}/960.webp`)).status).toBe(404)
    const map = (await get(`/sitemap.xml`)).body
    expect(map).toContain(`<loc>${site}/pricing</loc>`)
    expect(map).not.toContain(`<loc>${site}/catalog`)
    expect(map).not.toContain(`zip-jacket`)
    expect((await get(`/llms.txt`)).body).not.toContain(`Catalog`)
  })
})

describe("the sitemap and llms.txt", () => {
  it("list the catalog's, each category's and each item's page, items with their cover", async () => {
    const map = (await catalogSite(catalogOn()).get(`/sitemap.xml`)).body

    for (const path of [`/catalog`, `/de/catalog`, `/catalog/jackets`, `/jackets/zip-jacket`]) {
      expect(map).toContain(`<loc>${site}${path}</loc>`)
    }
    expect(map).toMatch(
      new RegExp(
        `<loc>${site}/jackets/zip-jacket</loc>[\\s\\S]*?<image:loc>${site}/catalog/photos/${COVER_ID}/960.webp</image:loc>`,
      ),
    )
    expect(map).toContain(
      `<xhtml:link rel="alternate" hreflang="de" href="${site}/de/jackets/zip-jacket"/>`,
    )
    expect(map).not.toContain(`${site}/fr/catalog`)
  })

  it("names the catalog and each category in a Catalog section of llms.txt", async () => {
    const text = (await catalogSite(catalogOn()).get(`/llms.txt`)).body

    expect(text).toContain(`## Catalog`)
    expect(text).toContain(`- [Catalog](${site}/catalog)`)
    expect(text).toContain(
      `- [Jackets](${site}/catalog/jackets): Jackets: prices, sizes and colours.`,
    )
  })
})

describe("a catalog photo", () => {
  it("is served from the website's own host with the API's type and cache rule", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const { get, asked } = catalogSite({
      [`/api/catalog/photos/${COVER_ID}/960.webp`]: () =>
        new Response(bytes, {
          headers: { "content-type": `image/webp`, "cache-control": `public, max-age=86400` },
        }),
    })
    const photo = await get(`/catalog/photos/${COVER_ID}/960.webp`)

    expect(photo.status).toBe(200)
    expect(photo.type).toBe(`image/webp`)
    expect(photo.cache).toBe(`public, max-age=86400`)
    expect(asked).toContain(`/api/catalog/photos/${COVER_ID}/960.webp`)
  })

  it("passes on only an image, and asks the API nothing for a name that is no photo width", async () => {
    const { get, asked } = catalogSite({
      [`/api/catalog/photos/${COVER_ID}/960.webp`]: () =>
        new Response(`<script>`, { headers: { "content-type": `text/html` } }),
    })

    expect((await quietly(() => get(`/catalog/photos/${COVER_ID}/960.webp`))).status).toBe(502)
    expect((await get(`/catalog/photos/${COVER_ID}/..%2F..%2Fsecret`)).status).toBe(404)
    expect((await get(`/catalog/photos/not-an-id/960.webp`)).status).toBe(404)
    expect(asked).toEqual([`/api/catalog/photos/${COVER_ID}/960.webp`])
  })
})

describe("the website's routes", () => {
  /**
   * Every route file of `routes/`, loaded the way the website loads them (`fsRoutes`), each
   * answering with its own file name, so a request shows which route won.
   */
  async function routeFiles(): Promise<Record<string, () => Promise<Record<string, unknown>>>> {
    const files: Record<string, () => Promise<Record<string, unknown>>> = {}
    const walk = async (dir: URL, prefix: string) => {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory) {
          await walk(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`)
        } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(`.test.`)) {
          const key = `./routes/${prefix}${entry.name}`
          files[key] = () =>
            Promise.resolve(
              entry.name.startsWith(`_middleware`)
                ? { handler: (ctx: { next: () => Promise<Response> }) => ctx.next() }
                : entry.name.startsWith(`_`)
                ? {}
                : { handler: () => new Response(key) },
            )
        }
      }
    }
    await walk(new URL(`./routes/`, import.meta.url), ``)
    return files
  }

  it("lets every page with a fixed segment win over the item page's two-segment address", async () => {
    const app = new App()
    const files = await routeFiles()
    expect(Object.keys(files)).toContain(`./routes/[[lang]]/[category]/[slug].tsx`)
    await fsRoutes(app, files as Parameters<typeof fsRoutes>[1])
    const handler = app.handler()
    const routeOf = async (path: string) =>
      await (await handler(new Request(`${site}${path}`), info)).text()

    const expected: Record<string, string> = {
      "/blog/some-post": `./routes/[[lang]]/blog/[slug].tsx`,
      "/docs/catalog": `./routes/[[lang]]/docs/[slug].tsx`,
      "/features/admin": `./routes/features/admin.ts`,
      "/features/realtime": `./routes/[[lang]]/features/[slug].tsx`,
      "/de/pricing": `./routes/[[lang]]/pricing.tsx`,
      "/de/blog": `./routes/[[lang]]/blog/index.tsx`,
      "/docs/api": `./routes/[[lang]]/docs/api.tsx`,
      "/s/abcdefgh": `./routes/s/[code].ts`,
      "/catalog/jackets": `./routes/[[lang]]/catalog/[category].tsx`,
      "/de/catalog": `./routes/[[lang]]/catalog/index.tsx`,
      [`/catalog/photos/${COVER_ID}/960.webp`]: `./routes/catalog/photos/[id]/[file].ts`,
      "/jackets/zip-jacket": `./routes/[[lang]]/[category]/[slug].tsx`,
      "/de/jackets/zip-jacket": `./routes/[[lang]]/[category]/[slug].tsx`,
    }
    const actual: Record<string, string> = {}
    for (const path of Object.keys(expected)) actual[path] = await routeOf(path)
    expect(actual).toEqual(expected)
  })
})
