import type { JSX } from "preact"
import { useEffect } from "preact/hooks"
import { type Catalog, createTranslator } from "@spy4x/platform/universal/i18n"
import { createThemeStore, ThemeValue } from "@spy4x/preact-signals/theme"
import { I18nContext } from "@spy4x/preact-ui/i18n"
import { SiteSearch, type SiteSearchCommand } from "@spy4x/preact-ui/site-search"

/** The prefixes of the components' catalog keys the search reads, sent to the browser. */
export const SITE_SEARCH_KEY_PREFIXES = [`CommandPalette.`, `SiteSearch.`, `Kbd.`] as const

/** A command that opens an address, such as "Sign in". */
export interface SiteSearchLink {
  id: string
  label: string
  href: string
}

/** Props of {@link SiteSearchIsland}: plain data, since the server renders it and sends them. */
export interface SiteSearchIslandProps {
  language: string
  /** The components' words the palette shows, in the page's language. */
  messages: Catalog
  /** The index of the page's language, such as `/de/search.json`. */
  src: string
  /** The result groups, first to last. */
  groupOrder: readonly string[]
  /** The commands that open an address, in the order the palette lists them. */
  links: readonly SiteSearchLink[]
  /** The theme command's name and the words of its state badge. */
  theme: { label: string; light: string; dark: string }
}

/**
 * The reader's theme: the same storage key and values as the script in `<head>` (`/theme.js`), so
 * a choice made here paints the next page before its first frame.
 */
const theme = createThemeStore()

/**
 * The header's search: a magnifier on a phone, a field with its Ctrl/⌘+K hint from `sm`, and the
 * palette it opens on a click, Ctrl/⌘+K or `/`, over the site's index and its commands. Without
 * JavaScript the trigger is a link to `/search`.
 */
export default function SiteSearchIsland(props: SiteSearchIslandProps): JSX.Element {
  useEffect(() => theme.attach(), [])
  const dark = theme.actual.value === ThemeValue.DARK
  const links: SiteSearchCommand[] = props.links.map(({ id, label, href }) => ({
    id,
    label,
    run: () => location.assign(href),
  }))
  // When nothing matches, the palette offers the docs, then the demo, as `/search` does.
  const fallback = [`docs`, `try`].flatMap((id) => links.filter((link) => link.id === id))
  const commands: SiteSearchCommand[] = [
    ...links,
    {
      id: `theme`,
      label: props.theme.label,
      state: dark ? props.theme.dark : props.theme.light,
      keepOpen: true,
      run: () => theme.toggle(),
    },
  ]
  return (
    <I18nContext.Provider
      value={createTranslator({ language: props.language, catalogs: [{ source: props.messages }] })}
    >
      <SiteSearch
        src={props.src}
        fetch={(src) => fetch(src)}
        commands={commands}
        fallback={fallback}
        groupOrder={props.groupOrder}
        dataE2E="site-search"
        // A magnifier on a phone, the field with its hint from `sm`: the field's words go below it.
        class="max-sm:w-11 max-sm:justify-center max-sm:border-transparent max-sm:bg-transparent max-sm:px-0 max-sm:[&>span]:hidden sm:w-56 lg:w-44 xl:w-64"
      />
    </I18nContext.Provider>
  )
}
