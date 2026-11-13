import type { JSX } from "preact"
import { type Context, HttpError } from "@spy4x/preact-server"
import type { PublicCatalogItem, PublicCatalogResponse } from "@domain/catalog"
import {
  breadcrumbListJsonLd,
  productJsonLd,
  type ProductVariant,
} from "@spy4x/platform/universal/seo"
import { responsiveImage, type ResponsiveImageVariant } from "@spy4x/platform/universal/srcset"
import { Breadcrumbs } from "@spy4x/preact-ui/breadcrumbs"
import {
  CATALOG_PATH,
  catalogHead,
  catalogLanguages,
  catalogText,
  categoryPath,
  itemPath,
  photoLargest,
  photoVariants,
  readCatalog,
  readItem,
} from "../../../catalog.ts"
import { catalogPrice, NO_PHOTO, Swatch } from "../../../components/catalog.tsx"
import { DEFAULT_LANGUAGE, localePath, siteTranslator } from "../../../languages.ts"
import { SITE_NAME, SiteFrame } from "../../../site.tsx"
import { useSite } from "../../../use-site.tsx"
import { define, type State } from "../../../utils.ts"

/** The query that picks a colour and a size, by id: what each variant's address sets. */
const COLOUR = `colour`
const SIZE = `size`
/** The id of the colours and sizes, where a pick link lands so a phone keeps its place. */
const OPTIONS = `options`

/**
 * One published item at `/<category>/<item>`, the address tracking links lead to: its photos, cover
 * first, its name, price, colours and sizes with the sold-out ones marked in text, what it is made
 * of, how it fits and its care, and the trail back to its category. The colours and sizes are links
 * that pick one (`?colour=<id>&size=<id>`), and a picked colour and size say whether that one is in
 * stock: the pages each variant's structured data points at.
 *
 * Every page with a fixed first segment wins over this route (`/blog/<slug>`, `/de/pricing`), so it
 * answers only what no other page does. An item that is not published, the wrong category, the
 * catalog off, and a language the catalog does not keep are the site's 404 page. A two-segment
 * address whose first segment is a language (`/de/<x>`) is a language page that does not exist.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const language = ctx.state.language
    // The router reads `/de/<x>` as the category `de`; that address is German, and no item.
    if (!ctx.params.lang && language !== DEFAULT_LANGUAGE) throw new HttpError(404)
    const [catalog, item] = await Promise.all([
      readCatalog(ctx.state.api),
      readItem(ctx.state.api, ctx.params.slug ?? ``),
    ])
    if (catalog === null || item === null || item.categorySlug !== ctx.params.category) {
      throw new HttpError(404)
    }
    const languages = catalogLanguages(catalog.settings)
    if (!languages.includes(language)) throw new HttpError(404)
    return renderItem(ctx, catalog, item, languages)
  },
})

/** The item's page, once every check has passed. */
function renderItem(
  ctx: Context<State>,
  catalog: PublicCatalogResponse,
  item: PublicCatalogItem,
  languages: readonly State[`language`][],
): Response | Promise<Response> {
  const { settings } = catalog
  const language = ctx.state.language
  const t = siteTranslator(language)
  const text = (value: Record<string, string>) => catalogText(value, language, settings)
  const origin = ctx.state.webAppOrigin
  const address = (path: string) => `${origin}${localePath(language, path)}`
  const path = itemPath(item)
  const url = address(path)
  const name = text(item.name)
  const description = text(item.description).text
  const category = catalog.categories.find(({ slug }) => slug === item.categorySlug)
  const categoryName = category ? text(category.name).text : item.categorySlug
  const images = item.photos.flatMap((photo) => {
    const src = photoLargest(photo)
    return src ? [`${origin}${src}`] : []
  })
  const inStock = item.stock !== `sold-out`
  return ctx.render(
    <SiteFrame
      state={ctx.state}
      path={path}
      head={{
        title: name.text,
        description: summary(description) || t.t(`CatalogItem.intro`, { item: name.text }),
        alternates: languages.map((version) => ({ language: version, path })),
        elsewhere: `/`,
        ...(images.length > 0 ? { image: { url: images[0], alt: name.text } } : {}),
        jsonLd: [
          // Google needs a photo for a product; an item without one has no product data yet.
          ...(images.length === 0 ? [] : [productJsonLd({
            url,
            name: name.text,
            ...(description ? { description } : {}),
            images,
            sku: item.slug,
            category: categoryName,
            price: item.price,
            currency: settings.currency,
            inStock,
            variants: variants(item, url, origin, text),
          })]),
          breadcrumbListJsonLd(url, [
            { name: SITE_NAME, href: address(`/`) },
            { name: catalogHead(t).title, href: address(CATALOG_PATH) },
            { name: categoryName, href: address(categoryPath(item.categorySlug)) },
            { name: name.text },
          ]),
        ],
      }}
    >
      <ItemBody
        item={item}
        catalog={catalog}
        categoryName={categoryName}
        picked={{
          colour: ctx.url.searchParams.get(COLOUR),
          size: ctx.url.searchParams.get(SIZE),
        }}
      />
    </SiteFrame>,
  )
}

/** The first 160 characters of the description at a word's end, on one line, for search results. */
function summary(description: string): string {
  const line = description.replace(/\s+/g, ` `).trim()
  if (line.length <= 160) return line
  return `${line.slice(0, 159).replace(/\s+\S*$/, ``)}…`
}

/** Whether the item's combination of `colourId` and `sizeId` is sold out. */
function soldOut(item: PublicCatalogItem, colourId: string | null, sizeId: string | null): boolean {
  return item.soldOut.some((combination) =>
    combination.colourId === colourId && combination.sizeId === sizeId
  )
}

/** The query that picks `colourId` and `sizeId`, each left out when `null`. */
function pickQuery(colourId: string | null, sizeId: string | null): string {
  const query = new URLSearchParams()
  if (colourId !== null) query.set(COLOUR, colourId)
  if (sizeId !== null) query.set(SIZE, sizeId)
  return `?${query}`
}

/**
 * One variant per colour and size combination, sold-out ones included as out of stock, each at the
 * address that picks it and with the photos of its colour when it has any. None for an item with
 * neither colours nor sizes.
 */
function variants(
  item: PublicCatalogItem,
  url: string,
  origin: string,
  text: (value: Record<string, string>) => { text: string },
): ProductVariant[] {
  const colours = item.colours.length > 0 ? item.colours : [null]
  const sizes = item.sizes.length > 0 ? item.sizes : [null]
  if (item.colours.length === 0 && item.sizes.length === 0) return []
  return colours.flatMap((colour) =>
    sizes.map((size) => {
      const colourId = colour?.id ?? null
      const sizeId = size?.id ?? null
      const images = item.photos.filter((photo) => colour && photo.colourId === colour.id)
        .flatMap((photo) => {
          const src = photoLargest(photo)
          return src ? [`${origin}${src}`] : []
        })
      return {
        sku: [item.slug, colourId, sizeId].filter((part) => part !== null).join(`-`),
        url: `${url}${pickQuery(colourId, sizeId)}`,
        ...(colour ? { color: text(colour.name).text } : {}),
        ...(size ? { size: size.label } : {}),
        ...(images.length > 0 ? { images } : {}),
        inStock: !soldOut(item, colourId, sizeId),
      }
    })
  )
}

/** How wide the first photo is drawn: about 7/12 of the page from 1024 px, else the screen. */
const COVER_SIZES = `(min-width: 80rem) 704px, (min-width: 64rem) 55vw, 100vw`

/** How wide each other photo is drawn: half the first's column. */
const PHOTO_SIZES = `(min-width: 80rem) 344px, (min-width: 64rem) 27vw, 50vw`

/** One photo as a `<picture>` with a width per stored size, 3:4. */
function Photo(
  { variants, alt, sizes, priority = false }: {
    variants: readonly ResponsiveImageVariant[]
    alt: string
    sizes: string
    priority?: boolean
  },
): JSX.Element {
  const image = responsiveImage(variants, sizes)
  return (
    <picture class="block overflow-hidden rounded-primary bg-hover">
      {image.sources.map((source) => (
        <source key={source.type} type={source.type} srcset={source.srcset} sizes={image.sizes} />
      ))}
      <img
        src={image.src}
        srcset={image.srcset}
        sizes={image.sizes}
        width={image.width}
        height={image.height}
        alt={alt}
        loading={priority ? `eager` : `lazy`}
        fetchpriority={priority ? `high` : undefined}
        decoding="async"
        class="block aspect-3/4 w-full object-cover"
      />
    </picture>
  )
}

/** The classes of a colour or size link; the picked one carries the accent's ring. */
function chipClass(picked: boolean): string {
  return `inline-flex min-h-11 items-center gap-2 rounded-control border px-3 text-sm font-medium tabular-nums hover:bg-hover focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus ${
    picked ? `border-primary ring-1 ring-primary` : `border-subtle`
  }`
}

/** The page's content: the trail, the photos, then the item's facts beside them from 1024 px. */
function ItemBody(
  { item, catalog, categoryName, picked }: {
    item: PublicCatalogItem
    catalog: PublicCatalogResponse
    categoryName: string
    picked: { colour: string | null; size: string | null }
  },
): JSX.Element {
  const { t, href, language } = useSite()
  const { settings } = catalog
  const text = (value: Record<string, string>) => catalogText(value, language, settings)
  const own = (lang: string) => (lang === language ? undefined : lang)
  const name = text(item.name)
  const description = text(item.description)
  const colour = item.colours.find(({ id }) => id === picked.colour) ?? null
  const size = item.sizes.find(({ id }) => id === picked.size) ?? null
  const price = catalogPrice(item.price, settings.currency, language)
  const allSoldOut = item.stock === `sold-out`
  // A picked combination says whether it is in stock once every side the item has is picked.
  const complete = (colour || size) && (item.colours.length === 0 || colour) &&
    (item.sizes.length === 0 || size)
  const choice = [colour && text(colour.name).text, size?.label].filter(Boolean).join(`, `)
  const details = ([
    [`CatalogItem.material`, item.material],
    [`CatalogItem.fit`, item.fit],
    [`CatalogItem.care`, item.care],
  ] as const).map(([key, value]) => ({ label: t.t(key), ...text(value) }))
    .filter((detail) => detail.text !== ``)
  const photoAlt = (alt: Record<string, string>) => text(alt).text || name.text
  return (
    <div
      class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 lg:py-12"
      data-e2e="catalog-item"
    >
      <Breadcrumbs
        items={[
          { label: t.t(`Catalog.title`), href: href(CATALOG_PATH) },
          { label: categoryName, href: href(categoryPath(item.categorySlug)) },
        ]}
      />
      <div class="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
        <section aria-label={t.t(`CatalogItem.photos`)} class="flex flex-col gap-4">
          {item.photos.length === 0
            ? <Photo variants={NO_PHOTO} alt="" sizes={COVER_SIZES} priority />
            : (
              <>
                <Photo
                  variants={photoVariants(item.photos[0])}
                  alt={photoAlt(item.photos[0].alt)}
                  sizes={COVER_SIZES}
                  priority
                />
                {item.photos.length > 1 && (
                  <ul class="grid grid-cols-2 gap-4">
                    {item.photos.slice(1).map((photo) => (
                      <li key={photo.id}>
                        <Photo
                          variants={photoVariants(photo)}
                          alt={photoAlt(photo.alt)}
                          sizes={PHOTO_SIZES}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
        </section>
        <div class="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <div class="flex flex-col gap-2">
            <h1
              class="text-3xl font-semibold tracking-tight text-balance lg:text-4xl"
              lang={own(name.lang)}
              dir="auto"
            >
              {name.text}
            </h1>
            <p class="flex flex-wrap items-baseline gap-x-3 text-2xl font-bold tabular-nums">
              {allSoldOut ? <s class="text-muted">{price}</s> : price}
              {allSoldOut && <span class="text-base font-semibold">{t.t(`LookTile.soldOut`)}</span>}
            </p>
          </div>
          <div id={OPTIONS} class="flex scroll-mt-16 flex-col gap-6">
            {item.colours.length > 0 && (
              <div class="flex flex-col gap-2">
                <h2 class="text-sm font-semibold">{t.t(`LookTile.colors`)}</h2>
                <ul class="flex flex-wrap gap-2" data-e2e="catalog-item-colours">
                  {item.colours.map((option) => {
                    const label = text(option.name)
                    const here = option.id === colour?.id
                    return (
                      <li key={option.id}>
                        <a
                          href={`${pickQuery(option.id, size?.id ?? null)}#${OPTIONS}`}
                          aria-current={here ? `true` : undefined}
                          class={chipClass(here)}
                        >
                          <Swatch color={option.swatch} class="size-4" />
                          <span lang={own(label.lang)} class={option.soldOut ? `text-muted` : ``}>
                            {option.soldOut ? <s>{label.text}</s> : label.text}
                          </span>
                          {option.soldOut && (
                            <span class="sr-only">{`, ${t.t(`LookTile.sizeSoldOut`)}`}</span>
                          )}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {item.sizes.length > 0 && (
              <div class="flex flex-col gap-2">
                <h2 class="text-sm font-semibold">{t.t(`LookTile.sizes`)}</h2>
                <ul class="flex flex-wrap gap-2" data-e2e="catalog-item-sizes">
                  {item.sizes.map((option) => {
                    const here = option.id === size?.id
                    return (
                      <li key={option.id}>
                        <a
                          href={`${pickQuery(colour?.id ?? null, option.id)}#${OPTIONS}`}
                          aria-current={here ? `true` : undefined}
                          class={chipClass(here)}
                        >
                          <span class={option.soldOut ? `text-muted` : ``}>
                            {option.soldOut ? <s>{option.label}</s> : option.label}
                          </span>
                          {option.soldOut && (
                            <span class="sr-only">{`, ${t.t(`LookTile.sizeSoldOut`)}`}</span>
                          )}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            {complete && (
              <p class="font-semibold" data-e2e="catalog-item-choice">
                {soldOut(item, colour?.id ?? null, size?.id ?? null)
                  ? t.t(`CatalogItem.soldOut`, { choice })
                  : t.t(`CatalogItem.inStock`, { choice })}
              </p>
            )}
          </div>
          {description.text !== `` && (
            <p
              class="whitespace-pre-line text-pretty text-muted"
              lang={own(description.lang)}
              dir="auto"
            >
              {description.text}
            </p>
          )}
          {details.length > 0 && (
            <dl class="flex flex-col gap-3 border-t border-subtle pt-4">
              {details.map((detail) => (
                <div key={detail.label} class="flex flex-col gap-1">
                  <dt class="text-sm font-semibold">{detail.label}</dt>
                  <dd
                    class="whitespace-pre-line text-pretty text-muted"
                    lang={own(detail.lang)}
                    dir="auto"
                  >
                    {detail.text}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  )
}
