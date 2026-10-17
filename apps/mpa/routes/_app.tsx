import { define } from "../utils.ts"

/**
 * The document around every page. `data-theme="ink"` picks the near-black dark palette, which
 * applies only once `/theme.js` adds `dark` for a device that asks for it; without JavaScript the
 * page stays light. The script is a file, not inline, because the content security policy allows
 * scripts from this origin only.
 */
export default define.page(function App({ Component }) {
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
      </head>
      <body class="theme-base min-h-full bg-canvas font-sans antialiased">
        <Component />
      </body>
    </html>
  )
})
