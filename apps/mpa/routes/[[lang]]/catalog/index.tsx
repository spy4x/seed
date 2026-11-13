import { type Context, HttpError } from "@spy4x/preact-server"
import { breadcrumbListJsonLd, itemListJsonLd } from "@spy4x/platform/universal/seo"
import {
  CATALOG_PATH,
  catalogHead,
  catalogLanguages,
  catalogText,
  categoryPath,
  itemPath,
  readCatalog,
} from "../../../catalog.ts"
import { CatalogGrid, CategoryLinks } from "../../../components/catalog.tsx"
import { localePath, siteTranslator } from "../../../languages.ts"
import { SITE_NAME, SiteFrame } from "../../../site.tsx"
import { define, type State } from "../../../utils.ts"

/**
 * The catalog's page (`slug` `null`) or one category's: the categories as links, then the items
 * as tiles, in the catalog's order. While the catalog is off, for a category that holds no
 * published item, and in a language the catalog does not keep, it is the site's 404 page. With
 * no published item yet, the catalog's page says so and keeps out of search results.
 */
export async function renderCatalogPage(
  ctx: Context<State>,
  slug: string | null,
): Promise<Response> {
  const catalog = await readCatalog(ctx.state.api)
  if (catalog === null) throw new HttpError(404)
  const { settings } = catalog
  const language = ctx.state.language
  const languages = catalogLanguages(settings)
  if (!languages.includes(language)) throw new HttpError(404)
  const category = slug === null
    ? null
    : catalog.categories.find((category) => category.slug === slug)
  if (category === undefined) throw new HttpError(404)
  const items = category === null
    ? catalog.items
    : catalog.items.filter((item) => item.categorySlug === category.slug)
  if (category !== null && items.length === 0) throw new HttpError(404)
  const t = siteTranslator(language)
  const origin = ctx.state.webAppOrigin
  const address = (path: string) => `${origin}${localePath(language, path)}`
  const path = category === null ? CATALOG_PATH : categoryPath(category.slug)
  const catalogTitle = catalogHead(t).title
  const name = category && catalogText(category.name, language, settings)
  const head = name
    ? { title: name.text, description: t.t(`Catalog.categoryIntro`, { category: name.text }) }
    : catalogHead(t)
  const empty = items.length === 0
  return ctx.render(
    <SiteFrame
      state={ctx.state}
      path={path}
      head={{
        ...head,
        noindex: empty,
        alternates: languages.map((version) => ({ language: version, path })),
        elsewhere: `/`,
        jsonLd: [
          ...(empty ? [] : [
            itemListJsonLd(address(path), items.map((item) => address(itemPath(item)))),
          ]),
          breadcrumbListJsonLd(address(path), [
            { name: SITE_NAME, href: address(`/`) },
            ...(name
              ? [{ name: catalogTitle, href: address(CATALOG_PATH) }, { name: name.text }]
              : [{ name: catalogTitle }]),
          ]),
        ],
      }}
    >
      <div
        class="mx-auto flex w-full max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
        data-e2e="catalog"
      >
        <header class="flex flex-col gap-4">
          <h1
            class="text-3xl font-semibold tracking-tight text-balance lg:text-5xl"
            lang={name && name.lang !== language ? name.lang : undefined}
          >
            {head.title}
          </h1>
          {!name && <p class="text-lg text-muted text-pretty lg:text-xl">{head.description}</p>}
        </header>
        {empty
          ? (
            <section
              aria-labelledby="catalog-empty"
              class="flex flex-col gap-2 rounded-card border border-subtle bg-surface p-6"
              data-e2e="catalog-empty"
            >
              <h2 id="catalog-empty" class="text-xl font-semibold">{t.t(`Catalog.empty`)}</h2>
              <p class="text-muted text-pretty">{t.t(`Catalog.emptyLead`)}</p>
            </section>
          )
          : (
            <>
              <CategoryLinks catalog={catalog} current={category?.slug ?? null} />
              <CatalogGrid catalog={catalog} items={items} label={head.title} />
            </>
          )}
      </div>
    </SiteFrame>,
  )
}

export const handler = define.handlers({
  GET: (ctx) => renderCatalogPage(ctx, null),
})
