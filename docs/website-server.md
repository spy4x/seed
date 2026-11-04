# The website's server

The public website (`apps/mpa`) runs on a small server layer, the shared package
[`@spy4x/preact-server`](https://jsr.io/@spy4x/preact-server) from spy4x/preact-components. It
replaced Fresh ([#623](https://github.com/spy4x/seed/issues/623)) and
keeps Fresh 2's API shape, so the routes, middleware and islands read as they did. It is built
on web standards (`Request`, `Response`, `URL`, Web Crypto) and Preact, and Vite builds it.

## What it offers

- **The app** (`@spy4x/preact-server`): `App` with `use()` for middleware, `get()`, `post()`, `all()`
  and `route()`, and `handler()`, a `(Request) => Response` function for `Deno.serve`,
  `Bun.serve` or a Node adapter.
- **The context**: `ctx.req`, `ctx.url`, `ctx.params`, `ctx.state`, `ctx.next()`,
  `ctx.render()` and `ctx.redirect()`, which collapses repeated slashes so `//evil.com/` stays on
  the site. Repeated slashes in the request path collapse before anything routes.
- **Typed helpers**: `createDefine()` gives `define.page`, `define.layout`, `define.middleware` and
  `define.handlers`; `page(data, init)` hands data and a status to a page; `HttpError` carries a
  status.
- **File routes** (`@spy4x/preact-server`): `routes/a/b.tsx` serves `/a/b`, `index.tsx` its
  folder, `[x]` a segment, `[[x]]` an optional one and `[...x]` the rest. `_middleware.ts` runs
  for its folder and below, `_layout.tsx` wraps its folder's pages, and `_app.tsx` wraps the
  document. A route with no parameter is tried first, then the more specific one. A route module
  loads on its first request.
- **Rendering** (`@spy4x/preact-server`): the page renders inside its layouts, then `_app` around
  it. `<Head>` puts elements into `<head>`, replacing the one with the same key, such as
  `<title>`. A link to the current page gets `aria-current="page"`, and one to an ancestor
  `aria-current="true"`. `asset()` and every `<img>` or `<source>` on the site carry the build id
  (`?__v=`).
- **Islands** (`@spy4x/preact-server/client`): every export of a file in `islands/` is an island. Its
  server HTML is marked with comments, its props go to the browser as JSON (a prop JSON cannot
  carry is refused), and the client script wakes it in place, loading that file's chunk only
  when the page has it. In production a page without an island loads no island script.

## Build and dev

`deno task build` in `apps/mpa` runs `vite build` with the plugin in `@spy4x/preact-server/vite`. It
writes `dist/`:

- `dist/client/`: `static/` as it is, and `client.ts` (the styles and the island loader) with its
  chunks, hashed under `assets/`;
- `dist/server/server-entry.mjs` with its chunks in `dist/server/assets/`, and `dist/server.js`,
  which `deno task start` (`deno serve`) runs.

The build hands the server the client build's file list, stylesheets, script and build id. The
build id is `DENO_DEPLOYMENT_ID`, `GITHUB_SHA` or `CI_COMMIT_SHA`, else a hash of the client files.
A page with islands answers with a `Link: rel="modulepreload"` header for the client script and its
islands' chunks, so the browser fetches them while it parses.

Static files (`@spy4x/preact-server`) get a weak `ETag` and `304` on a match. An address with this
build's id, or a hashed file under `/assets/`, is cached for a year as `immutable`; an address
with another build's id answers `307` to the address without it. Any other file is sent as
`no-store`, which `staticFilesMiddleware` (`apps/mpa/middleware.ts`) turns into one hour.

`deno task dev` runs Vite's dev server. Vite serves `static/`, the client code and hot reload; every
other request goes to `server-entry.ts`, loaded through Vite.

## What it leaves out

Only what the website uses is built. Compared with Fresh 2 it has no:

- `_error.tsx` or `_404.tsx` routes: `pageMiddleware` renders the error page, inside the security
  headers;
- `trailingSlashes()` or other built-in middleware: the website's own middleware does that;
- inline scripts or a CSP nonce: island props travel in a JSON `<script>`, and the loader is a
  file, so `script-src 'self'` covers it;
- partials, client-side navigation, a plugin API or a `Range`-aware static server (the video route
  uses `serveFile` for that).

## Not final

This is a first version. Later sessions should fix and improve it as they find gaps, keeping the
website's tests and `e2e/mpa` green, rather than reaching for Fresh again.
