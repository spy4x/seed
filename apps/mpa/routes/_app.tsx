import type { JSX } from "preact"
import { REPOSITORY_URL } from "../brand.ts"
import type { State } from "../utils.ts"
import { define } from "../utils.ts"

/**
 * The document around every page. `data-theme="ink"` picks the near-black dark palette, which
 * applies only once `/theme.js` adds `dark` for a device that asks for it; without JavaScript the
 * page stays light. The script is a file, not inline, because the content security policy allows
 * scripts from this origin only.
 */
export default define.page(function App({ Component, state, url }) {
  return (
    <html lang="en" data-theme="ink" class="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Seed</title>
        {/* The browser's own frame takes the canvas of the palette the device asks for. */}
        <meta name="theme-color" content="#f3f4f6" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#080b10" media="(prefers-color-scheme: dark)" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script src="/theme.js"></script>
        <link
          rel="preload"
          href="/fonts/geist-sans.var.woff2"
          as="font"
          type="font/woff2"
          crossorigin="anonymous"
        />
        <AnalyticsScripts state={state} url={url} />
      </head>
      <body class="theme-base min-h-full bg-canvas font-sans antialiased">
        <Component />
      </body>
    </html>
  )
})

/**
 * Umami's tracker and the website's own events (`/analytics.js`), when analytics is on
 * (`docs/analytics.md`). Both are files from origins the content security policy names, deferred,
 * so no page waits for them or needs them. The tracker counts only on the website's own host and
 * honours Do Not Track. A page whose address carries a token (a newsletter link) loads neither, so
 * the token never reaches the analytics.
 */
function AnalyticsScripts({ state, url }: { state: State; url: URL }): JSX.Element | null {
  const analytics = state.analytics
  if (!analytics || url.searchParams.has("token")) return null
  return (
    <>
      <script
        defer
        src={`${analytics.origin}/script.js`}
        data-website-id={analytics.websiteId}
        data-domains={new URL(state.webAppOrigin).hostname}
        data-do-not-track="true"
        data-performance="true"
      >
      </script>
      <script
        defer
        src="/analytics.js"
        data-spa-origin={state.spaOrigin}
        data-repository={REPOSITORY_URL}
      >
      </script>
    </>
  )
}
