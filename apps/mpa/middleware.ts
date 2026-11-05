import type { MpaConfig } from "./config.ts"
import { createApi } from "./api.ts"
import { renderErrorPage } from "./error-page.tsx"
import { DEFAULT_LANGUAGE, pathLanguage, segmentLanguage } from "./languages.ts"
import { createNewsletterStatus } from "./newsletter.ts"
import { BLOG_PATH } from "./blog.ts"
import { define, type State } from "./utils.ts"
import { HttpError, type ServeInfo, staticFiles } from "@spy4x/preact-server"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { HTTPException } from "hono/http-exception"
import { createSameOriginCheck } from "@spy4x/server/http/same-origin"
import { securityHeaderList, withSecurityHeaders } from "@spy4x/server/http/security-headers"

/**
 * The header set `securityHeaders` of `@spy4x/server` sends; the helper itself is Hono middleware
 * and the MPA's server is not Hono. A page here loads one stylesheet from its own origin and no
 * font, so the policy is the library's strictest: everything from `'self'` only, no plugins and no
 * framing, images aside (below). Its
 * `Referrer-Policy: no-referrer` also covers the newsletter pages, whose address carries a token.
 *
 * Two things widen it. The pricing page's form posts to the MPA, which redirects to the SPA's
 * sign-up, and a browser applies `form-action` to that redirect too: on a domain of its own the
 * MPA therefore allows the SPA's origin there. With analytics on, the Umami origin is allowed in
 * `script-src` (its tracker) and `connect-src` (the events it sends), and nowhere else.
 *
 * With `postImages`, `img-src` also allows any `https:` image: a blog post's cover and the images
 * in its body are `https:` addresses wherever the operator keeps them. Only operators write posts,
 * and an image runs no code. Only the blog's post pages get it ({@link isPostPage}); every other
 * page keeps `img-src 'self' data:`.
 */
function securityHeaderSet(
  config: MpaConfig,
  { postImages }: { postImages: boolean },
): Promise<[string, string][]> {
  const umami = config.analytics?.origin
  // Vite's dev server injects the styles it hot-reloads and talks to the page over a WebSocket.
  const dev: boolean = import.meta.env?.DEV ?? false
  return securityHeaderList({
    extraSources: {
      ...(config.apiOrigin === config.webAppOrigin ? {} : { formAction: [config.apiOrigin] }),
      ...(postImages ? { imgSrc: [`https:`] } : {}),
      ...(umami ? { scriptSrc: [umami], connectSrc: [umami] } : {}),
      ...(dev
        ? { styleSrc: [`'unsafe-inline'`], connectSrc: [...(umami ? [umami] : []), `ws:`] }
        : {}),
    },
  })
}

/** Whether `pathname` is under `/blog/` in any language: a post's page, which shows its images. */
export function isPostPage(pathname: string): boolean {
  return pathLanguage(pathname).path.startsWith(`${BLOG_PATH}/`)
}

/**
 * Puts the security headers on every response: pages, static files, redirects, refusals and the
 * answer to an error a route throws. It goes first in the app, before the static files. The page
 * has no inline script: its islands wake from a script file (`@spy4x/preact-server`), so `'self'`
 * covers it.
 */
export async function securityHeadersMiddleware(config: MpaConfig) {
  const site = await securityHeaderSet(config, { postImages: false })
  const posts = await securityHeaderSet(config, { postImages: true })
  return define.middleware(async (ctx) => {
    const set = isPostPage(ctx.url.pathname) ? posts : site
    let response: Response
    try {
      response = await ctx.next()
    } catch (error) {
      response = errorResponse(error)
    }
    return withSecurityHeaders(response, set)
  })
}

/**
 * Runs around every page and action:
 *
 * 1. refuses a post from another site with 403 before anything else runs: the API's own rule
 *    (`Sec-Fetch-Site: same-origin`, and `Origin` equal to `webAppOrigin` or `null`), without its
 *    session cookie check, since the MPA has no session;
 * 2. gives the route an API client bound to this request, which presents an MPA on its own domain
 *    to the API as the API's origin once step 1 has passed;
 * 3. tells the route its language, from the address alone (`pathLanguage`), and whether the
 *    newsletter is on, as `newsletter()` says. It is required, so a
 *    caller cannot leave the status out by accident: the website starts through
 *    {@link newsletterPageMiddleware}, and where analytics go, if anywhere;
 * 4. answers a form it cannot read with the status `readFormBody` names (413, 408 or 400);
 * 5. answers any other error, the 404 of an unknown address included, with the error page inside
 *    the site's frame (`error-page.tsx`);
 * 6. lets a browser keep a page but ask again before showing it (`no-cache`, which leaves the
 *    back/forward cache working), and keeps every newsletter answer out of all caches
 *    (`no-store`), since the newsletter pages carry a token in their address.
 *
 * Between steps 1 and 2, a `GET` or `HEAD` of an address that ends in a slash answers 301 to the
 * same address without it, query kept (`/de/pricing/` → `/de/pricing`).
 *
 * Framing is forbidden by {@link securityHeadersMiddleware}, which runs before this one.
 */
export function pageMiddleware(
  config: MpaConfig,
  fetch: typeof globalThis.fetch,
  newsletter: () => boolean,
) {
  const crossSiteRefusal = createSameOriginCheck({
    expectedOrigin: config.webAppOrigin,
    requireSessionCookie: false,
  })
  return define.middleware(async (ctx) => {
    if (crossSiteRefusal(ctx.req)) {
      return withPageHeaders(
        new Response("Cross-site request refused", { status: 403 }),
        ctx.url.pathname,
      )
    }
    const { pathname, search } = ctx.url
    if (pathname.endsWith(`/`) && pathname !== `/` && READS.includes(ctx.req.method)) {
      // `ctx.url` and `ctx.redirect` both collapse repeated slashes, so `//evil.com/` stays here.
      return withPageHeaders(
        ctx.redirect(`${pathname.replace(/\/+$/, ``) || `/`}${search}`, 301),
        pathname,
      )
    }
    ctx.state.language = pathLanguage(pathname).language
    ctx.state.webAppOrigin = config.webAppOrigin
    ctx.state.spaOrigin = config.apiOrigin
    ctx.state.api = createApi({
      apiUrl: config.apiUrl,
      request: ctx.req,
      remoteAddress: remoteAddress(ctx.info),
      origins: config.webAppOrigin === config.apiOrigin
        ? undefined
        : { page: config.webAppOrigin, api: config.apiOrigin },
      fetch,
    })
    ctx.state.newsletter = newsletter()
    ctx.state.analytics = config.analytics
    let response: Response
    try {
      response = await ctx.next()
    } catch (error) {
      response = error instanceof HTTPException
        ? new Response(error.message, { status: error.status })
        : await renderErrorPage(ctx, error)
    }
    return withPageHeaders(response, ctx.url.pathname)
  })
}

/**
 * The last resort, in plain text: the answer to an error {@link pageMiddleware} did not turn into
 * the error page, because it came from a static file or from rendering that page. It is what the
 * website's server answers to an error that leaves every middleware (`@spy4x/preact-server`); that
 * answer would leave without the security headers.
 */
function errorResponse(error: unknown): Response {
  if (error instanceof HttpError && error.status < 500) {
    return new Response(error.message, { status: error.status })
  }
  console.error(error)
  const status = error instanceof HttpError ? error.status : 500
  return new Response("Internal server error", { status })
}

function remoteAddress(info: ServeInfo): string {
  const address = info.remoteAddr
  return address.transport === "tcp" || address.transport === "udp" ? address.hostname : ""
}

/** The methods a trailing slash is redirected for: a 301 would turn a `POST` into a `GET`. */
const READS = [`GET`, `HEAD`]

const NEWSLETTER_PATHS: string[] = Object.values(FORM_ACTIONS)

function withPageHeaders(response: Response, pathname: string): Response {
  const headers = new Headers(response.headers)
  if (NEWSLETTER_PATHS.includes(pathLanguage(pathname).path)) {
    headers.set("cache-control", "no-store")
  } else if (headers.get("content-type")?.startsWith("text/html")) {
    headers.set("cache-control", "no-cache")
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Guards the language segment of every page's address (`routes/[[lang]]/_middleware.ts`), before
 * the page or anything else reads it: no segment or a served language goes on, the default
 * language's own prefix answers 301 to the same page without it (`/en/pricing` → `/pricing`, query
 * kept), and anything else is the 404 page.
 */
export const languageMiddleware = define.middleware((ctx) => {
  // The router hands an address without the segment an empty one. An empty segment in the address
  // itself never arrives: the server collapses `//pricing` to `/pricing` before it routes.
  const asked = segmentLanguage(ctx.params.lang || undefined)
  if (asked.kind === `missing`) throw new HttpError(404)
  if (asked.kind === `redirect`) {
    const path = ctx.url.pathname.slice(`/${DEFAULT_LANGUAGE}`.length) || `/`
    return new Response(null, { status: 301, headers: { location: `${path}${ctx.url.search}` } })
  }
  return ctx.next()
})

/** What `staticFiles` sends with a static file whose address carries no build id. */
const NO_STORE = "no-cache, no-store, max-age=0, must-revalidate"

/** How long a browser keeps a static file whose address carries no build id: one hour. */
export const UNVERSIONED_FILE_CACHE = "public, max-age=3600"

/**
 * The server's `staticFiles` (`@spy4x/preact-server`), with a shorter rule for files whose address
 * carries no build id.
 *
 * `staticFiles` sends a file as immutable for a year when its address carries the build id
 * (`?__v=`, which the renderer adds to every `<img>`) or a hashed name (`/assets/`). Any other
 * file, such as a font
 * the stylesheet names or the Open Graph image a crawler fetches, it sends as never to be stored,
 * so every page view downloads it again. Such a file can change in the next deploy under the same
 * address, so it must not be immutable: a browser keeps it for {@link UNVERSIONED_FILE_CACHE} and
 * then revalidates it with its ETag. In development Vite serves the files and this rule does not
 * apply.
 */
export function staticFilesMiddleware() {
  const serve = staticFiles<State>()
  return define.middleware(async (ctx) => {
    const response = await serve(ctx)
    if (response.headers.get("cache-control") === NO_STORE) {
      response.headers.set("cache-control", UNVERSIONED_FILE_CACHE)
    }
    return response
  })
}

/**
 * Answers `GET /<key>.txt` with the site's IndexNow key as plain text, which is how IndexNow checks
 * that the worker's pings come from this site (docs/blog.md). Without a key it passes every
 * request on, so the address is a 404 like any other.
 */
export function indexNowKeyMiddleware(config: Pick<MpaConfig, "indexNowKey">) {
  const key = config.indexNowKey
  return define.middleware((ctx) => {
    if (!key || ctx.url.pathname !== `/${key}.txt` || !["GET", "HEAD"].includes(ctx.req.method)) {
      return ctx.next()
    }
    return new Response(ctx.req.method === "HEAD" ? null : key, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  })
}

/**
 * `pageMiddleware` wired to the API's own word on the newsletter, as the website runs it. The API
 * is asked once here, before the first page, so that page already knows; after that, see
 * `NewsletterStatus.isOn`.
 */
export async function newsletterPageMiddleware(
  config: MpaConfig,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const newsletter = createNewsletterStatus({ apiUrl: config.apiUrl, fetch })
  await newsletter.refresh()
  return pageMiddleware(config, fetch, newsletter.isOn)
}
