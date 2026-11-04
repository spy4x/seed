/// <reference lib="deno.ns" />
import deno from "@deno/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import { fromFileUrl, relative, SEPARATOR } from "@std/path"
import { walk } from "@std/fs/walk"
import {
  denoModuleIds,
  npmSpecifiers,
  preactThemeCss,
  requireComponentCss,
} from "@spy4x/preact-theme/vite"
import {
  BROWSER_SUITE_FOLDER,
  countBrowserSuites,
  COUNTED_FOLDERS,
  countTestFiles,
} from "./repo-facts.ts"
import { website } from "@spy4x/preact-server/vite"

/**
 * Selectors, escaped as in the built CSS, that the client build must contain: two only
 * preact-components renders, then two no file of this app uses, so only a scan of libs/ui emits
 * them (libs/ui/sources.css says how a container build once lost them), and the one that flips
 * the sideways arrows in Arabic.
 */
const REQUIRED_SELECTORS = [
  ".lg\\:w-64",
  ".focus\\:not-sr-only",
  ".sm\\:justify-end",
  ".sm\\:flex-wrap",
  // Flips preact-icons' sideways arrows under dir="rtl"; rtl.test.ts checks the icons carry it.
  ".\\[\\&\\:dir\\(rtl\\)\\]\\:\\[transform\\:scaleX\\(-1\\)\\]",
]

/** Every file under the counted folders and the browser suites' folder, relative to the repository root (`repo-facts.ts`). */
async function repositoryFiles(): Promise<string[]> {
  const root = fromFileUrl(new URL("../../", import.meta.url))
  const paths: string[] = []
  for (const folder of [...COUNTED_FOLDERS, BROWSER_SUITE_FOLDER]) {
    const entries = walk(`${root}${folder}`, {
      includeDirs: false,
      skip: [/node_modules/, /dist/],
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
  define: await repositoryFiles().then(async (files) => ({
    // The site's proof numbers, counted from the files the build sees (`repo-facts.ts`).
    __SEED_TEST_FILES__: JSON.stringify(countTestFiles(files)),
    __SEED_BROWSER_SUITES__: JSON.stringify(countBrowserSuites(files)),
    // The changelog and the docs' dates (`changelog.ts`).
    __SEED_CHANGELOG__: await changelogData(),
  })),
  plugins: [
    {
      name: "markdown-text",
      enforce: "pre",
      transform: (code, id) => id.endsWith(".md") ? `export default ${JSON.stringify(code)}` : null,
    },
    // One id per Deno module, so a context loads once (spy4x/preact-components#785); before `deno()`.
    denoModuleIds(),
    npmSpecifiers({ readTextFile: Deno.readTextFile }),
    deno(),
    website({
      readDir: Deno.readDir,
      readFile: Deno.readFile,
      isFile: (path) => Deno.stat(path).then((info) => info.isFile, () => false),
      buildId: Deno.env.get("DENO_DEPLOYMENT_ID") ?? Deno.env.get("GITHUB_SHA") ??
        Deno.env.get("CI_COMMIT_SHA"),
    }),
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
