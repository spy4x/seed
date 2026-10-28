// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { type FreshContext, HttpError } from "fresh"
import { Button } from "@spy4x/preact-ui/button"
import { HIRE_PAGE_URL } from "./hire.ts"
import { pathLanguage } from "./languages.ts"
import { SiteLanguage, useSite } from "./use-site.tsx"
import { REPOSITORY_URL, SiteFrame, spaLinks, TRY_ENTRY, TRY_REL } from "./site.tsx"
import type { State } from "./utils.ts"

/**
 * The page for an error no route handled, inside the site's frame and in the language of its
 * address: "Page not found" for the 404 of
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
  const { language, path } = pathLanguage(ctx.url.pathname)
  return Promise.resolve(ctx.render(
    <SiteLanguage language={language}>
      <ErrorPage state={ctx.state} path={path} notFound={status === 404} />
    </SiteLanguage>,
    { status },
  ))
}

/** The error page's content, in the language of the address that failed. */
function ErrorPage(
  { state, path, notFound }: { state: State; path: string; notFound: boolean },
): JSX.Element {
  const { t, href, rich } = useSite()
  const title = t.t(notFound ? `ErrorPage.notFoundTitle` : `ErrorPage.errorTitle`)
  const description = t.t(notFound ? `ErrorPage.notFoundDescription` : `ErrorPage.errorDescription`)
  const spa = spaLinks(state.spaOrigin)
  return (
    <SiteFrame state={state} path={path} head={{ title, description, noindex: true }}>
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
            {notFound ? t.t(`ErrorPage.notFoundLead`) : description}
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
                    {t.t(TRY_ENTRY.label)}
                  </Button>
                  <Button href={href(`/`)} variant="outline">{t.t(`ErrorPage.home`)}</Button>
                </div>
                <ul class="flex flex-wrap gap-x-6 gap-y-2 font-medium">
                  <li>
                    <a href={href(`/features`)} class="text-primary underline">
                      {t.t(`ErrorPage.features`)}
                    </a>
                  </li>
                  <li>
                    <a
                      href={HIRE_PAGE_URL}
                      class="text-primary underline"
                      data-umami-event="hire-me"
                      data-umami-event-from="not-found"
                    >
                      {t.t(`ErrorPage.hire`)}
                    </a>
                  </li>
                </ul>
                <p class="text-sm text-muted">
                  {rich(`ErrorPage.report`, {
                    issues: (text) => (
                      <a href={`${REPOSITORY_URL}/issues`} class="underline">{text}</a>
                    ),
                  })}
                </p>
              </>
            )
            : (
              <div class="flex w-full flex-col gap-4 sm:flex-row">
                <Button href={href(path)}>{t.t(`ErrorPage.retry`)}</Button>
                <Button href={href(`/`)} variant="outline">{t.t(`ErrorPage.home`)}</Button>
              </div>
            )}
        </div>
      </section>
    </SiteFrame>
  )
}
