/// <reference lib="deno.ns" />
import { readFileSync } from "node:fs"
import { defineConfig } from "vite"
import { fromFileUrl } from "@std/path"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { themeBootstrapScript } from "@spy4x/preact-signals/theme"
import { npmSpecifiers, preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite"
import { nginxAddHeaders, securityHeaderList } from "@spy4x/server/http/security-headers"

// The date format module at the deno.jsonc pin, as in apps/spa/vite.config.ts.
const PREACT_UI_VERSION = readFileSync(new URL(`../../deno.jsonc`, import.meta.url), `utf8`)
  .match(/"jsr:@spy4x\/preact-ui@([^"]+)"/)?.[1]
if (!PREACT_UI_VERSION) throw new Error(`deno.jsonc pins no @spy4x/preact-ui version`)
const PREACT_UI_FORMAT = `https://jsr.io/@spy4x/preact-ui/${PREACT_UI_VERSION}/format.tsx`

const BUILT_PAGE = fromFileUrl(new URL("./dist/index.html", import.meta.url))
const SECURITY_HEADERS = fromFileUrl(new URL("./security-headers.conf", import.meta.url))

/**
 * What the admin app loads from another origin, added to the defaults of the library's policy: the
 * Google Fonts stylesheet `index.html` links, and the font files it names. The API is on the app's
 * own origin (the proxy routes `/api`), so `'self'` covers it. Unlike the SPA, the app has no
 * service worker, no web manifest and no error tracker, so nothing differs per deployment.
 */
const EXTRA_SOURCES = {
  styleSrc: ["https://fonts.googleapis.com"],
  fontSrc: ["https://fonts.gstatic.com"],
}

/**
 * Selectors, escaped as in the built CSS, that the build must contain: two only
 * preact-components renders, then two no file of this app uses, so only a scan of libs/ui emits
 * them.
 */
const REQUIRED_SELECTORS = [
  ".lg\\:w-64",
  ".focus\\:not-sr-only",
  ".sm\\:justify-end",
  ".sm\\:flex-wrap",
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    npmSpecifiers({ readTextFile: Deno.readTextFile }),
    deno(),
    preact(),
    preactThemeCss(),
    tailwindcss(),
    // Fails the build when its CSS lacks preact-components' classes or libs/ui's, as in the SPA.
    requireComponentCss({ selectors: REQUIRED_SELECTORS }),
    {
      // Paints the stored (or system) light/dark choice before the first frame, as in the SPA.
      name: "theme-bootstrap",
      transformIndexHtml: () => [{
        tag: "script",
        children: themeBootstrapScript(),
        injectTo: "head-prepend" as const,
      }],
    },
    {
      // nginx sends the security headers, written from the built page after every build, as the
      // SPA's build does (apps/spa/vite.config.ts explains why).
      name: "nginx-security-headers",
      apply: "build" as const,
      writeBundle: async () => {
        const page = await Deno.readTextFile(BUILT_PAGE)
        const headers = await securityHeaderList({ shellHtml: page, extraSources: EXTRA_SOURCES })
        await Deno.writeTextFile(
          SECURITY_HEADERS,
          "# Written by the admin app's build (apps/admin/vite.config.ts) from the built index.html.\n" +
            "# Do not edit: change EXTRA_SOURCES in apps/admin/vite.config.ts and build again.\n" +
            nginxAddHeaders(headers),
        )
      },
    },
  ],
  resolve: {
    // Vite, not the Deno plugin, must load libs/ui: the Deno plugin compiles JSX for React.
    alias: [{
      find: /^@ui\//,
      replacement: fromFileUrl(new URL("../../libs/ui/", import.meta.url)),
    }, {
      // One copy of the date format's context, as in the SPA (apps/spa/vite.config.ts says why).
      find: /^@spy4x\/preact-ui\/format$/,
      replacement: PREACT_UI_FORMAT,
    }],
  },
  optimizeDeps: {
    // Found late through the Deno plugin's resolver, each would re-bundle and blank a page that
    // loaded meanwhile; the SPA names them up front for the same reason.
    include: ["tailwind-merge", "arktype"],
  },
  server: {
    host: "0.0.0.0",
    // The SPA's dev server takes 5173.
    port: 5174,
    watch: {
      ignored: [
        "!../../libs/domain/**",
        "!../../libs/platform/**",
        "!../../libs/ui/**",
      ],
    },
  },
})
