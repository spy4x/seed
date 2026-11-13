import type { JSX } from "preact"
import type { PublicCatalogResponse } from "@domain/catalog"
import { formatMoney, type MoneyOptions } from "@spy4x/platform/universal/money-core"
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

/** A swatch the API may send: `#rrggbb`, the only value that reaches an SVG `fill`. */
const SWATCH = /^#[0-9a-f]{6}$/

/**
 * A colour's dot. The colour is an SVG `fill`, not a `style` attribute, which the site's
 * `style-src 'self'` policy would block. Hidden from screen readers: the colour's name says it.
 * Nothing for a value that is not `#rrggbb`.
 */
export function Swatch({ color, class: className }: { color: string; class: string }) {
  if (!SWATCH.test(color)) return null
  return (
    <span
      aria-hidden="true"
      class={`block shrink-0 overflow-hidden rounded-full border border-strong ${className}`}
    >
      <svg viewBox="0 0 1 1" class="block size-full">
        <rect width="1" height="1" fill={color} />
      </svg>
    </span>
  )
}

/**
 * A price in the catalog's currency, as the page's language writes it: `$19.99`, `250.000 ₫`.
 * English is British English, like the rest of the site.
 */
export function catalogPrice(
  price: number,
  currency: string,
  language: string,
  options?: MoneyOptions,
): string {
  return formatMoney(price, currency, language === `en` ? `en-GB` : language, options)
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
 * first. The dots are drawn here under each `LookTile`, as {@link Swatch}es: `LookTile` paints its
 * own with a `style` attribute, which the site's policy blocks.
 */
export function CatalogGrid(
  { catalog, items, label }: {
    catalog: PublicCatalogResponse
    items: PublicCatalogResponse[`items`]
    label: string
  },
): JSX.Element | null {
  const { t, href, language } = useSite()
  const { settings } = catalog
  return (
    <LookGrid label={label}>
      {items.map((item, index) => {
        const name = catalogText(item.name, language, settings).text
        const alt = item.cover ? catalogText(item.cover.alt, language, settings).text : ``
        return (
          <div key={item.slug} class="flex flex-col gap-2">
            <LookTile
              href={href(itemPath(item))}
              name={name}
              price={catalogPrice(item.price, settings.currency, language)}
              photo={item.cover
                ? { variants: photoVariants(item.cover), alt: alt || name }
                : { variants: NO_PHOTO, alt: `` }}
              sizes={item.sizes}
              soldOut={item.stock === `sold-out`}
              priority={index === 0}
            />
            {item.colours.length > 0 && (
              <ul aria-label={t.t(`LookTile.colors`)} class="flex gap-1">
                {item.colours.map((colour, at) => (
                  <li key={at}>
                    <Swatch color={colour.swatch} class="size-3" />
                    <span class="sr-only">{catalogText(colour.name, language, settings).text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </LookGrid>
  )
}
