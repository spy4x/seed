import { type RenderedMarkdown, renderMarkdown } from "@spy4x/platform/universal/markdown"
import source from "../../docs/token-api.md" with { type: "text" }
import { API_DOCS_PATH } from "@ui/progressive.tsx"
import { SITE_NAME } from "./brand.ts"

export { API_DOCS_PATH }

/** The file the reference is written in, from the repository's root. */
export const API_DOCS_SOURCE = `docs/token-api.md`

/** The origin the reference's examples use; the page puts the product's own in its place. */
export const EXAMPLE_ORIGIN = `https://app.example.com`

/** The reference's title, summary and the date its text last changed. */
export const API_DOCS_HEAD = {
  title: `${SITE_NAME} API reference: personal API tokens`,
  description: `Use a personal API token to list, read and create notes from a script or ` +
    `another service. Quick start, endpoints, limits and every error.`,
  updated: `2026-10-23`,
} as const

/**
 * The reference as HTML, with the examples' origin replaced by `apiOrigin`, the host the API
 * answers on. The file's `#` heading is left out: the page draws its own.
 */
export function renderApiDocs(apiOrigin: string): RenderedMarkdown {
  const body = source.replace(/^# .*\n/, ``).replaceAll(EXAMPLE_ORIGIN, apiOrigin)
  return renderMarkdown(body)
}
