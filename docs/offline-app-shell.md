# The app shell

> Also on the website: [seedsaas.com/docs/offline-app-shell](https://seedsaas.com/docs/offline-app-shell).

This page explains how the SPA's service worker lets the app start with no network, and why its
offline tests run against the built app.

## What the service worker caches

`apps/spa/src/sw.ts` calls `installOfflineShell` from `@spy4x/platform/browser/offline-shell`, with
the options in `src/sw-options.ts`. On install it stores `/`, `/config.json`, and every script,
style and image the page names. Then:

- **Files under `/assets/`** are answered from the cache first. The build names them by content
  hash, so a copy is never stale.
- **Every other request** goes to the network first, and to the cache only when the network fails.
  A deploy shows at once. Every route is the same page, so any page load is stored under `/`.
- **`/api` and `/ws`** are never touched. An e2e test checks that no cached URL starts with either.
- **On the dev server**, Vite's modules (`/@id`, `/@fs`, `/@vite`, `/src`, `/node_modules`) are
  never touched either. When the worker's own fetch of one failed, the page saw `net::ERR_FAILED`
  and never booted (spy4x/seed#893).

`/config.json` holds the runtime settings the app reads before it renders, so it is cached on
install too, and the app starts offline.

The cache is named `shell-<build id>`. The build id is a hash of every built file, so a deploy
installs a new worker and deletes the old cache when it activates.

## How the worker is built

A browser cannot load a worker that imports a `jsr:` specifier. So `serviceWorker()` from
`@spy4x/preact-theme/vite`, in `vite.config.ts`, bundles `src/sw.ts` into one `dist/sw.js`. On the
dev server it serves the bundle from memory at `/sw.js`, with the build id `dev`. `webManifest()` in
the same file writes `manifest.webmanifest`.

Keep `sw.js` uncached in nginx (`apps/spa/nginx.conf`), or browsers never see an update.

`SWUpdater` from `@spy4x/preact-system` registers `/sw.js`, which also handles push notifications.
The worker answers its `skipWaiting` message when a visitor accepts "New version available".

The worker installs on the first, online, visit. The app can start offline from then on.

## Offline tests run against the built SPA

Five e2e specs start the app with no network: `e2e/offline.e2e.ts`, `e2e/local-data.e2e.ts`,
`e2e/search-offline.e2e.ts`, `e2e/tags-offline.e2e.ts` and `e2e/notes-restore-offline.e2e.ts`.
`deno task e2e:local` runs them against the image of `apps/spa/dockerfile.prod`, in a Playwright
pass of their own (`OFFLINE_SPECS` in
`infra/scripts/e2e-local-plan.ts`). Every other spec runs against the dev server.

The built app is what a person runs offline: a few files named by hash. The dev server serves
hundreds of modules fetched one by one, so a pass or a failure there says little.

On the dev server, about one full run in two once left an offline page blank: module scripts were
aborted and nothing rendered (spy4x/template#322). The cause is not known, and it was never seen on
the built SPA. A page that fails to start now names its errors, failed requests and console in the
test's error (`gotoApp`, `e2e/fixtures/app.ts`). If a blank start shows on the built SPA, start
there: it is a bug in the product, not the harness.

## Next

- [How offline reads work](offline-data.md).
- [Offline in the SPA](offline.md).
