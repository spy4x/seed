/// <reference lib="deno.ns" />
import { fresh } from "@fresh/plugin-vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { fromFileUrl, relative, SEPARATOR } from "@std/path"
import { walk } from "@std/fs/walk"
import { preactThemeCss, requireComponentCss } from "@spy4x/preact-theme/vite"
import { COUNTED_FOLDERS, countTestFiles } from "./repo-facts.ts"

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

/** Every file under the counted folders, relative to the repository root (`repo-facts.ts`). */
async function repositoryFiles(): Promise<string[]> {
  const root = fromFileUrl(new URL("../../", import.meta.url))
  const paths: string[] = []
  for (const folder of COUNTED_FOLDERS) {
    const entries = walk(`${root}${folder}`, {
      includeDirs: false,
      skip: [/node_modules/, /_fresh/],
    })
    for await (const entry of entries) {
      paths.push(relative(root, entry.path).split(SEPARATOR).join("/"))
    }
  }
  return paths
}

/**
 * What `deno task changelog` wrote (`changelog-write.ts`), as JSON text, or `null` when it has not
 * run: the changelog then shows its empty state and the docs no date.
 */
async function changelogData(): Promise<string> {
  try {
    return await Deno.readTextFile(new URL(`./changelog.json`, import.meta.url))
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return `null`
    throw error
  }
}

export default defineConfig({
  define: {
    // The home page's proof numbers, counted from the files the build sees (`repo-facts.ts`).
    __SEED_TEST_FILES__: JSON.stringify(countTestFiles(await repositoryFiles())),
    // The changelog and the docs' dates (`changelog.ts`).
    __SEED_CHANGELOG__: await changelogData(),
  },
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
