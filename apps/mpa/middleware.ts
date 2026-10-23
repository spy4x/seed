import type { MpaConfig } from "./config.ts"
import { createApi } from "./api.ts"
import { renderErrorPage } from "./error-page.tsx"
import { createNewsletterStatus } from "./newsletter.ts"
import { define, type State } from "./utils.ts"
import { HttpError, staticFiles } from "fresh"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { HTTPException } from "hono/http-exception"
import { createSameOriginCheck } from "@spy4x/server/http/same-origin"
import { securityHeaderList, withSecurityHeaders } from "@spy4x/server/http/security-headers"

/**
 * The header set `securityHeaders` of `@spy4x/server` sends; the helper itself is Hono middleware
 * and the MPA runs on Fresh. A page here loads one stylesheet from its own origin and no script,
 * inline block or font, so the policy is the library's strictest: everything from `'self'` only,
 * no plugins and no framing, images aside (below). Its `Referrer-Policy: no-referrer` also covers
 * the newsletter pages, whose address carries a token.
 *
 * Two things widen it. The pricing page's form posts to the MPA, which redirects to the SPA's
 * sign-up, and a browser applies `form-action` to that redirect too: on a domain of its own the
 * MPA therefore allows the SPA's origin there. With analytics on, the Umami origin is allowed in
 * `script-src` (its tracker) and `connect-src` (the events it sends), and nowhere else. A blog
 * post's cover and the images in its body are `https:` addresses wherever the operator keeps them,
 * so `img-src` allows any `https:` image. Only operators write posts, and an image runs no code.
 */
function securityHeaderSet(config: MpaConfig): Promise<[string, string][]> {
  const umami = config.analytics?.origin
  return securityHeaderList({
    extraSources: {
      ...(config.apiOrigin === config.webAppOrigin ? {} : { formAction: [config.apiOrigin] }),
      imgSrc: [`https:`],
      ...(umami ? { scriptSrc: [umami], connectSrc: [umami] } : {}),
    },
  })
}

/**
 * Puts the security headers on every response: pages, static files, redirects, refusals and the
 * answer to an error a route throws. It goes first in the app, before the static files.
 */
export async function securityHeadersMiddleware(config: MpaConfig) {
  const set = await securityHeaderSet(config)
  return define.middleware(async (ctx) => {
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
 * 3. tells the route whether the newsletter is on, as `newsletter()` says. It is required, so a
 *    caller cannot leave the status out by accident: the website starts through
 *    {@link newsletterPageMiddleware}, and where analytics go, if anywhere;
 * 4. answers a form it cannot read with the status `readFormBody` names (413, 408 or 400);
 * 5. answers any other error, the 404 of an unknown address included, with the error page inside
 *    the site's frame (`error-page.tsx`);
 * 6. lets a browser keep a page but ask again before showing it (`no-cache`, which leaves the
 *    back/forward cache working), and keeps every newsletter answer out of all caches
 *    (`no-store`), since the newsletter pages carry a token in their address.
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
 * the error page, because it came from a static file or from rendering that page. It is what
 * Fresh's default handler answers; Fresh makes that answer outside every middleware, so it would
 * leave without the security headers.
 */
function errorResponse(error: unknown): Response {
  if (error instanceof HttpError && error.status < 500) {
    return new Response(error.message, { status: error.status })
  }
  console.error(error)
  const status = error instanceof HttpError ? error.status : 500
  return new Response("Internal server error", { status })
}

function remoteAddress(info: Deno.ServeHandlerInfo): string {
  const address = info.remoteAddr
  return address.transport === "tcp" || address.transport === "udp" ? address.hostname : ""
}

const NEWSLETTER_PATHS: string[] = Object.values(FORM_ACTIONS)

function withPageHeaders(response: Response, path: string): Response {
  const headers = new Headers(response.headers)
  if (NEWSLETTER_PATHS.includes(path)) {
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

/** What Fresh sends with a static file whose address carries no build id. */
const FRESH_NO_STORE = "no-cache, no-store, max-age=0, must-revalidate"

/** How long a browser keeps a static file whose address carries no build id: one hour. */
export const UNVERSIONED_FILE_CACHE = "public, max-age=3600"

/**
 * Fresh's `staticFiles`, with a shorter rule for files whose address carries no build id.
 *
 * Fresh sends a file as immutable for a year when its address carries the build id (`?__frsh_c=`,
 * which Fresh adds to every `<img>`) or a hashed name (`/assets/`). Any other file, such as a font
 * the stylesheet names or the Open Graph image a crawler fetches, it sends as never to be stored,
 * so every page view downloads it again. Such a file can change in the next deploy under the same
 * address, so it must not be immutable: a browser keeps it for {@link UNVERSIONED_FILE_CACHE} and
 * then revalidates it with its ETag. In development Fresh's own rule stays.
 */
export function staticFilesMiddleware() {
  const serve = staticFiles<State>()
  return define.middleware(async (ctx) => {
    const response = await serve(ctx)
    if (
      ctx.config.mode !== "development" &&
      response.headers.get("cache-control") === FRESH_NO_STORE
    ) {
      response.headers.set("cache-control", UNVERSIONED_FILE_CACHE)
    }
    return response
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
