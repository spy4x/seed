import type { OfflineShellOptions } from "@spy4x/platform/browser/offline-shell"

/** The build id the dev server gives the worker (`serviceWorker()` in `vite.config.ts`). */
const DEV_BUILD_ID = `dev`

/**
 * Where the Vite dev server serves the app's modules one by one. They are never cached offline (an
 * offline start needs the built SPA), so the dev worker leaves them to the browser: answered by a
 * worker whose own fetch failed, a page's module requests fail as `net::ERR_FAILED` and the page
 * never boots (spy4x/seed#893).
 */
const DEV_MODULE_PATHS = [`/@id`, `/@fs`, `/@vite`, `/src`, `/node_modules`]

/**
 * What the service worker caches. `/config.json` (the runtime settings) is stored with the page
 * because the app reads it before it renders. `/api` and `/ws` (the route Traefik sends to the API)
 * are never touched: the data comes from the offline layer's IndexedDB store, not from this cache.
 * On the dev server, neither are its modules. The cache is named after the build, so a deploy drops
 * the old one.
 */
export function shellOptions(buildId: string): OfflineShellOptions {
  return {
    cacheName: `shell-${buildId}`,
    shellUrls: [`/`, `/config.json`],
    neverCache: [`/api`, `/ws`, ...(buildId === DEV_BUILD_ID ? DEV_MODULE_PATHS : [])],
  }
}
