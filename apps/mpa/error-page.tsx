import { type FreshContext, HttpError } from "fresh"
import { Button } from "@spy4x/preact-ui/button"
import { SiteFrame } from "./site.tsx"
import type { State } from "./utils.ts"

/**
 * The page for an error no route handled, inside the site's frame: "Page not found" for the 404 of
 * an unknown address, "Something went wrong" for anything else. `pageMiddleware` renders it, not a
 * `routes/_error.tsx`: Fresh would render that one outside every middleware, without the security
 * headers.
 *
 * A server error is logged with the request's method and path. The query is left out: a
 * newsletter page's query holds the visitor's token.
 */
export function renderErrorPage(ctx: FreshContext<State>, error: unknown): Promise<Response> {
  const status = error instanceof HttpError ? error.status : 500
  if (status >= 500) console.error(`${ctx.req.method} ${ctx.url.pathname} failed:`, error)
  const notFound = status === 404
  const title = notFound ? "Page not found" : "Something went wrong"
  const description = notFound
    ? "There is no page at this address."
    : "The page could not be shown. Try again in a minute."
  return Promise.resolve(ctx.render(
    <SiteFrame
      state={ctx.state}
      path={ctx.url.pathname}
      head={{ title, description, noindex: true }}
    >
      <section
        class="mx-auto flex w-full max-w-md flex-col items-start gap-4"
        data-e2e="error-page"
      >
        <h1 class="text-3xl font-bold">{title}</h1>
        <p class="text-muted">{description}</p>
        <Button href="/" variant="secondary">Back to the home page</Button>
      </section>
    </SiteFrame>,
    { status },
  ))
}
