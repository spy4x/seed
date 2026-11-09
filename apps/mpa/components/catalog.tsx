import type { JSX } from "preact"
import type { PublicCatalogResponse } from "@domain/catalog"
import { formatMoney } from "@spy4x/platform/universal/money-core"
import type { ResponsiveImageVariant } from "@spy4x/platform/universal/srcset"
import { IconCheck } from "@spy4x/preact-icons"
import { badgeClasses } from "@spy4x/preact-ui/badge"
import { LookGrid } from "@spy4x/preact-ui/look-grid"
import { LookTile } from "@spy4x/preact-ui/look-tile"
import { CATALOG_PATH, catalogText, categoryPath, itemPath, photoVariants } from "../catalog.ts"
import { useSite } from "../use-site.tsx"

/**
 * What an item without a ready photo shows in its place: a neutral 3:4 picture, which says
 * nothing a screen reader needs, so its text alternative is empty.
 */
export const NO_PHOTO: readonly ResponsiveImageVariant[] = [
  { url: `/catalog-no-photo.svg`, width: 600, height: 800, type: `image/svg+xml` },
]

/**
 * A price in the catalog's currency, as the page's language writes it: `$19.99`, `250.000 ₫`.
 * English is British English, like the rest of the site.
 */
export function catalogPrice(price: number, currency: string, language: string): string {
  return formatMoney(price, currency, language === `en` ? `en-GB` : language)
}

/**
 * The catalog's categories as links, "All" first, the one the page shows marked. Nothing when the
 * catalog has fewer than two, where the links would add nothing.
 */
export function CategoryLinks(
  { catalog, current }: { catalog: PublicCatalogResponse; current: string | null },
): JSX.Element | null {
  const { t, href, language } = useSite()
  if (catalog.categories.length < 2) return null
  const options = [
    { label: t.t(`Catalog.all`), lang: undefined, path: CATALOG_PATH, slug: null },
    ...catalog.categories.map((category) => {
      const name = catalogText(category.name, language, catalog.settings)
      return {
        label: name.text,
        lang: name.lang,
        path: categoryPath(category.slug),
        slug: category.slug,
      }
    }),
  ]
  return (
    <nav aria-label={t.t(`Catalog.categories`)} data-e2e="catalog-categories">
      <ul class="flex flex-wrap gap-2">
        {options.map(({ label, lang, path, slug }) => {
          const here = slug === current
          return (
            <li key={path}>
              <a
                href={href(path)}
                lang={lang === language ? undefined : lang}
                aria-current={here ? `page` : undefined}
                class={badgeClasses(
                  here ? `purple` : `gray`,
                  here ? `filled` : `outline`,
                  `normal-case gap-1 min-h-11 sm:min-h-8 px-3 focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-focus focus-visible:outline-hidden ${
                    here ? `` : `bg-surface text-foreground border-subtle hover:bg-hover`
                  }`,
                )}
              >
                {here && <IconCheck class="size-3.5" aria-hidden="true" />}
                {label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/**
 * The items as tiles: the cover (or {@link NO_PHOTO}), the name, the price, the sizes with the
 * sold-out ones struck through and said, and the colours as dots. The first tile's photo loads
 * first.
 */
export function CatalogGrid(
  { catalog, items, label }: {
    catalog: PublicCatalogResponse
    items: PublicCatalogResponse[`items`]
    label: string
  },
): JSX.Element | null {
  const { href, language } = useSite()
  const { settings } = catalog
  return (
    <LookGrid label={label}>
      {items.map((item, index) => {
        const name = catalogText(item.name, language, settings).text
        const alt = item.cover ? catalogText(item.cover.alt, language, settings).text : ``
        return (
          <LookTile
            key={item.slug}
            href={href(itemPath(item))}
            name={name}
            price={catalogPrice(item.price, settings.currency, language)}
            photo={item.cover
              ? { variants: photoVariants(item.cover), alt: alt || name }
              : { variants: NO_PHOTO, alt: `` }}
            sizes={item.sizes}
            colors={item.colours.map((colour) => ({
              name: catalogText(colour.name, language, settings).text,
              color: colour.swatch,
            }))}
            soldOut={item.stock === `sold-out`}
            priority={index === 0}
          />
        )
      })}
    </LookGrid>
  )
}
