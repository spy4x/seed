/// <reference lib="deno.ns" />
/**
 * Holds every module in `libs/ui` to the screen contract in `AGENTS.md`: no store, no router, no
 * app import, no `fetch` or page global. Walks the folder, so a new file is checked without being
 * listed anywhere. The rule is `@spy4x/preact-system/boundary`; this repository adds its app
 * aliases and the `apps` folder.
 */

import { registerBoundaryTests } from "@spy4x/preact-system/boundary-runner"

registerBoundaryTests({
  test: Deno.test,
  root: new URL("../", import.meta.url),
  directories: ["libs/ui"],
  // The runner also skips `build`, `.vite` and `_fresh` by default; a screen there is still a screen.
  skipDirectories: ["node_modules", "dist"],
  boundary: { appAliases: ["@api/", "@spa/", "@mpa/", "@worker/"], appDirectories: ["apps"] },
  // An empty walk would pass silently, so require a file the screens cannot lose.
  requiredFiles: ["libs/ui/auth-screen.tsx"],
  refusedImports: ["../../apps/spa/src/state/auth.ts"],
  allowedImports: ["./progressive.tsx"],
})
