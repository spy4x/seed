// Seed's own site: see docs/start-a-product.md
/**
 * The product's name, as the apps show it: the SPA's brand mark and web app manifest, both apps'
 * tab titles ({@link pageTitle}) and the admin app's brand mark. The browser specs read it too, so a
 * product that renames itself here passes them unchanged. It has no imports, so the Vite config and
 * Playwright load it.
 */
export const PRODUCT_NAME = `Seed`

/**
 * A browser tab's title: the given parts, then the product's name, joined by ` · ` (`Notes · Seed`,
 * `Users · Admin · Seed`). An empty part is left out, so a page with no name reads `Seed`.
 */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  return [...parts, PRODUCT_NAME].filter(Boolean).join(` · `)
}
