// Seed's own site: see docs/start-a-product.md
import { type FreshContext, HttpError } from "fresh"
import { Button } from "@spy4x/preact-ui/button"
import { HIRE_PAGE_URL } from "./hire.ts"
import { REPOSITORY_URL, SiteFrame, spaLinks, TRY_ENTRY, TRY_REL } from "./site.tsx"
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
  const title = notFound ? `Page not found` : `Something went wrong`
  const description = notFound
    ? `There is no page at this address.`
    : `The page could not be shown. Try again in a minute.`
  const spa = spaLinks(ctx.state.spaOrigin)
  return Promise.resolve(ctx.render(
    <SiteFrame
      state={ctx.state}
      path={ctx.url.pathname}
      head={{ title, description, noindex: true }}
    >
      <section
        aria-labelledby="error-title"
        class="site-glow flex min-h-[60vh] items-center"
        data-e2e="error-page"
        data-analytics-view={notFound ? "not-found" : "error-page"}
      >
        <div class="mx-auto flex w-full max-w-md flex-col items-start gap-6 px-4 py-16">
          <p class="font-mono text-6xl font-semibold text-muted" aria-hidden="true">
            {notFound ? 404 : 500}
          </p>
          <h1 id="error-title" class="text-3xl font-semibold tracking-tight">{title}</h1>
          <p class="text-muted text-pretty">
            {notFound
              ? `The link may be old, or the page moved when this site was rebuilt. Here is where most people are headed:`
              : description}
          </p>
          {notFound
            ? (
              <>
                <div class="flex w-full flex-col gap-4 sm:flex-row">
                  <Button
                    href={spa.try}
                    rel={TRY_REL}
                    data-umami-event="try-demo"
                    data-umami-event-from="not-found"
                  >
                    {TRY_ENTRY.label}
                  </Button>
                  <Button href="/" variant="outline">Back to the home page</Button>
                </div>
                <ul class="flex flex-wrap gap-x-6 gap-y-2 font-medium">
                  <li>
                    <a href="/features" class="text-primary underline">See the features</a>
                  </li>
                  <li>
                    <a
                      href={HIRE_PAGE_URL}
                      class="text-primary underline"
                      data-umami-event="hire-me"
                      data-umami-event-from="not-found"
                    >
                      Hire me to build your MVP
                    </a>
                  </li>
                </ul>
                <p class="text-sm text-muted">
                  If a link on this site sent you here,{" "}
                  <a href={`${REPOSITORY_URL}/issues`} class="underline">tell me on GitHub</a>.
                </p>
              </>
            )
            : (
              <div class="flex w-full flex-col gap-4 sm:flex-row">
                <Button href={ctx.url.pathname}>Try again</Button>
                <Button href="/" variant="outline">Back to the home page</Button>
              </div>
            )}
        </div>
      </section>
    </SiteFrame>,
    { status },
  ))
}
