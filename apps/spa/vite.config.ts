/// <reference lib="deno.ns" />
import { build, defineConfig } from "vite"
import { fromFileUrl } from "@std/path"
import deno from "@deno/vite-plugin"
import preact from "@preact/preset-vite"
import tailwindcss from "@tailwindcss/vite"
import { themeBootstrapScript } from "@spy4x/preact-signals/theme"
import {
  denoModuleIds,
  npmSpecifiers,
  preactThemeCss,
  requireComponentCss,
  serviceWorker,
  webManifest,
} from "@spy4x/preact-theme/vite"
import { nginxAddHeaders, securityHeaderList } from "@spy4x/server/http/security-headers"
import { PROVIDER_AVATAR_ORIGINS } from "@domain/identity"

const SW_ENTRY = fromFileUrl(new URL("./src/sw.ts", import.meta.url))
const BUILT_PAGE = fromFileUrl(new URL("./dist/index.html", import.meta.url))
const SECURITY_HEADERS = fromFileUrl(new URL("./security-headers.conf", import.meta.url))

/**
 * The nginx variable that holds the origin of the error tracker, or nothing. The container sets it
 * when it starts (`csp-connect.sh`), because the tracker differs per deployment and the image is
 * built once.
 */
const ERROR_TRACKER_VARIABLE = "$csp_error_tracker"

/**
 * What the SPA loads from another origin, added to the defaults of the library's policy:
 *
 * - the error tracker the reporter posts to, when the deployment has one;
 * - the Google and GitHub image hosts, for the provider's picture of the person on "Create a new
 *   account?" (#142). The API drops a picture from any other host before it reaches the page.
 *
 * The API and its WebSocket are on the SPA's own origin (the proxy routes `/api` and `/ws`), so
 * `'self'` covers them, as it covers the service worker, the web manifest and the fonts
 * (`public/fonts`).
 */
const EXTRA_SOURCES = {
  connectSrc: [ERROR_TRACKER_VARIABLE],
  imgSrc: [...PROVIDER_AVATAR_ORIGINS],
}

/**
 * Selectors, escaped as in the built CSS, that the build must contain: two only
 * preact-components renders, then two no file of this app uses, so only a scan of libs/ui emits
 * them. A container build once lost libs/ui's classes and still exited 0 (libs/ui/sources.css
 * says why).
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
    // One id per Deno module, so a context such as the date format's loads once and the screens
    // read the copy the app provides (spy4x/preact-components#785). It must come before `deno()`.
    denoModuleIds(),
    npmSpecifiers({ readTextFile: Deno.readTextFile }),
    deno(),
    preact(),
    preactThemeCss(),
    tailwindcss(),
    // Fails the build when its CSS lacks preact-components' classes or libs/ui's.
    requireComponentCss({ selectors: REQUIRED_SELECTORS }),
    // A build writes `dist/sw.js`, named after a hash of the built files. The dev server serves the
    // same worker from memory at `/sw.js`, so the e2e specs that run against it have one.
    serviceWorker({
      entry: SW_ENTRY,
      build,
      plugins: [deno()],
      readDir: Deno.readDir,
      readFile: Deno.readFile,
    }),
    webManifest({
      writeTextFile: Deno.writeTextFile,
      manifest: {
        // Seed's own site: see docs/start-a-product.md
        name: `Seed`,
        short_name: `Seed`,
        // The light palette's canvas, as index.html's light theme-color: a manifest holds one.
        theme_color: `#f3f4f6`,
        background_color: `#f3f4f6`,
        icons: [
          {
            src: `/img/android/android-launchericon-192-192.png`,
            sizes: `192x192`,
            type: `image/png`,
          },
          {
            src: `/img/android/android-launchericon-512-512.png`,
            sizes: `512x512`,
            type: `image/png`,
          },
          {
            src: `/img/pwa/maskable-192.png`,
            sizes: `192x192`,
            type: `image/png`,
            purpose: `maskable`,
          },
          {
            src: `/img/pwa/maskable-512.png`,
            sizes: `512x512`,
            type: `image/png`,
            purpose: `maskable`,
          },
        ],
      },
    }),
    {
      // Paints the stored (or system) light/dark choice before the first frame, so a dark reader
      // never sees a light flash. `index.html` cannot call the library, so the build injects it.
      name: "theme-bootstrap",
      transformIndexHtml: () => [{
        tag: "script",
        children: themeBootstrapScript(),
        injectTo: "head-prepend" as const,
      }],
    },
    {
      // nginx serves the built page, so it sends the security headers: the ones `securityHeaders`
      // of @spy4x/server sends, as one `add_header … always;` line each. The policy holds the hash
      // of each inline block of the built `index.html`, so the file nginx includes is written from
      // that page after every build, next to `dist` (`nginx.conf` says where it goes). The hook
      // is the one that runs once the page is written and never after a failed build, whose own
      // error it would otherwise hide.
      name: "nginx-security-headers",
      apply: "build" as const,
      writeBundle: async () => {
        const page = await Deno.readTextFile(BUILT_PAGE)
        const headers = await securityHeaderList({ shellHtml: page, extraSources: EXTRA_SOURCES })
        await Deno.writeTextFile(
          SECURITY_HEADERS,
          "# Written by the SPA's build (apps/spa/vite.config.ts) from the built index.html.\n" +
            "# Do not edit: change EXTRA_SOURCES in apps/spa/vite.config.ts and build again.\n" +
            nginxAddHeaders(headers, { allowedVariables: [ERROR_TRACKER_VARIABLE] }),
        )
      },
    },
  ],
  resolve: {
    // Vite, not the Deno plugin, must load libs/ui: the Deno plugin compiles JSX for React, so a
    // screen loaded through it fails at runtime with "React is not defined".
    alias: [{
      find: /^@ui\//,
      replacement: fromFileUrl(new URL("../../libs/ui/", import.meta.url)),
    }],
  },
  optimizeDeps: {
    // These come in through the Deno plugin's resolver, which the dev server's dependency scan
    // does not follow: tailwind-merge (through the JSR package @spy4x/preact-cn) and
    // arktype (through @spy4x/validation and its siblings). Found late, each triggers a re-bundle
    // that leaves a page that loaded meanwhile blank ("Outdated Optimize Dep"), so they are named
    // up front.
    include: ["tailwind-merge", "arktype"],
  },
  server: {
    host: "0.0.0.0",
    watch: {
      ignored: [
        "!../../libs/domain/**",
        "!../../libs/platform/**",
        "!../../libs/ui/**",
      ],
    },
  },
})
