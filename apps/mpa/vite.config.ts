/// <reference lib="deno.ns" />
import { fresh } from "@fresh/plugin-vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { fromFileUrl } from "@std/path"
import { preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite"

/**
 * Selectors, escaped as in the built CSS, that the client build must contain: two only
 * preact-components renders, then two no file of this app uses, so only a scan of libs/ui emits
 * them (libs/ui/sources.css says how a container build once lost them).
 */
const REQUIRED_SELECTORS = [
  ".lg\\:w-64",
  ".focus\\:not-sr-only",
  ".sm\\:justify-end",
  ".sm\\:flex-wrap",
]

export default defineConfig({
  plugins: [
    {
      name: "markdown-text",
      enforce: "pre",
      transform: (code, id) => id.endsWith(".md") ? `export default ${JSON.stringify(code)}` : null,
    },
    fresh(),
    preactThemeCss({ stylesheet: "/apps/mpa/styles.css" }),
    tailwindcss(),
    // The client build carries the stylesheet; the server build has none to check.
    {
      ...requireComponentCss({ selectors: REQUIRED_SELECTORS }),
      applyToEnvironment: (environment) => environment.name === "client",
    },
  ],
  resolve: {
    // As in the SPA: Vite, not the Deno loader, must load libs/ui, or its JSX compiles for React.
    alias: [{
      find: /^@ui\//,
      replacement: fromFileUrl(new URL("../../libs/ui/", import.meta.url)),
    }],
  },
})
