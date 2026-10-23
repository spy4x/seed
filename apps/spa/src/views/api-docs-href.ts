import { API_DOCS_PATH } from "@ui/progressive.tsx"

/** The API reference on the website at `site`, or `null` when the product has no website. */
export function apiDocsHref(site: string | null): string | null {
  return site === null ? null : `${site}${API_DOCS_PATH}`
}
