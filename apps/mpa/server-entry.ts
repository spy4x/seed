/**
 * The website's server, as the build bundles it (`vite.config.ts`): `deno serve` runs its
 * `fetch`, and so does the dev server. The build hands it what it produced (`__WEBSITE_BUILD__`):
 * the stylesheets, the client script, the build id and the static files. `null` means the dev
 * server, where Vite serves the files and the scripts. The files are read through the running
 * runtime's file system, so the same build serves on Deno, Node and Bun.
 */
import { runtimeStaticFs } from "@spy4x/server/static"
import { fromFileUrl } from "@std/path"
import { registerIslands, setAssets, setStaticFiles, type WebsiteBuild } from "@spy4x/preact-server"
import { app } from "./main.ts"

/** What the build produced, or `null` in development. */
declare const __WEBSITE_BUILD__: WebsiteBuild | null

const build = __WEBSITE_BUILD__

registerIslands(
  // @ts-ignore: Vite replaces `import.meta.glob`; Deno's types do not know it.
  import.meta.glob([`./islands/**/*.tsx`, `!**/*.test.*`], { eager: true }),
)
setAssets(
  build ? { ...build, devScripts: [] } : {
    buildId: `dev`,
    css: [`/styles.css`],
    script: `/client.ts`,
    preload: null,
    devScripts: [`/@vite/client`],
  },
)
setStaticFiles(
  build &&
    { files: build.files, root: fromFileUrl(new URL(`../`, import.meta.url)), fs: runtimeStaticFs },
)

export default { fetch: app.handler() }
