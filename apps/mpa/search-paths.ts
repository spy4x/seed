// Apart from `search.ts`, which renders the pages: the frame every page draws needs these, and
// importing `search.ts` there would import every page from inside one.
import type { Translator } from "@spy4x/platform/universal/i18n"

/** Where the search index is served, in each language: `/search.json`, `/de/search.json`. */
export const SEARCH_INDEX_PATH = `/search.json`

/** The results page for visitors without JavaScript, `?q=` holding the query. */
export const SEARCH_PAGE_PATH = `/search`

/** The search's result groups in the order the palette lists them, in the language of `t`. */
export function searchGroups(t: Translator<string>): { pages: string; sections: string } {
  return { pages: t.t(`SiteIndex.pages`), sections: t.t(`SiteIndex.sections`) }
}
