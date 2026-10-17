/// <reference lib="deno.ns" />
/**
 * Holds every module in `libs/ui` to the screen contract in `AGENTS.md`: no store, no router, no
 * app import, no `fetch` or page global, and no `RailShell` (the rule's default `forbiddenNames`).
 * Walks the folder, so a new file is checked without being listed anywhere. The rule is
 * `@spy4x/preact-system/boundary`; this repository adds its app aliases and the `apps` folder.
 *
 * The apps themselves may hold state and call the API, so only the name rule runs over them: every
 * app draws the library's `AppShell` (through `libs/ui`), never `RailShell` on its own (#516).
 */

import { relative } from "@std/path"
import { walk } from "@std/fs/walk"
import { checkModule, DEFAULT_FORBIDDEN_NAMES } from "@spy4x/preact-system/boundary"
import { registerBoundaryTests } from "@spy4x/preact-system/boundary-runner"

const root = new URL("../", import.meta.url)

registerBoundaryTests({
  test: Deno.test,
  root,
  directories: ["libs/ui"],
  // The runner also skips `build`, `.vite` and `_fresh` by default; a screen there is still a screen.
  skipDirectories: ["node_modules", "dist"],
  boundary: { appAliases: ["@api/", "@spa/", "@mpa/", "@worker/"], appDirectories: ["apps"] },
  // An empty walk would pass silently, so require a file the screens cannot lose.
  requiredFiles: ["libs/ui/auth-screen.tsx"],
  refusedImports: ["../../apps/spa/src/state/auth.ts"],
  allowedImports: ["./progressive.tsx"],
})

Deno.test("no app imports RailShell: every app's frame is the library's AppShell", async () => {
  const appsDir = new URL("apps/", root).pathname
  const files: string[] = []
  for await (
    const entry of walk(appsDir, {
      exts: [".ts", ".tsx"],
      includeDirs: false,
      skip: [/\/(node_modules|dist|build|_fresh|\.vite)\//],
    })
  ) files.push(entry.path)
  // An empty walk would pass silently, so require the SPA's frame wiring.
  if (!files.some((file) => file.endsWith("apps/spa/src/views/AppShell.tsx"))) {
    throw new Error(`The walk of ${appsDir} missed apps/spa/src/views/AppShell.tsx.`)
  }
  const found: string[] = []
  for (const filename of files) {
    const options = {
      filename,
      forbiddenPackages: [],
      forbiddenGlobals: [],
      forbiddenNames: DEFAULT_FORBIDDEN_NAMES,
    }
    for (const violation of checkModule(await Deno.readTextFile(filename), options)) {
      found.push(`${relative(appsDir, filename)}: ${violation.message}`)
    }
  }
  if (found.length > 0) throw new Error(`RailShell is imported in:\n${found.join("\n")}`)
})
