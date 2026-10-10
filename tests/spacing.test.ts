/// <reference lib="deno.ns" />
/**
 * Holds every spacing class in `apps/` and `libs/` to the scale `@spy4x/preact-theme/spacing`
 * owns: padding, margin, gap, `space-x/y` and scroll spacing use only its steps, never an
 * arbitrary value. The library's `docs/spacing.md` says which step goes where.
 */

import { registerSpacingTests } from "@spy4x/preact-theme/spacing-runner"

registerSpacingTests({
  test: Deno.test,
  root: new URL("../", import.meta.url),
  directories: ["apps", "libs"],
  // An empty walk would pass silently, so require a file the SPA cannot lose.
  requiredFiles: ["apps/spa/src/app.tsx"],
})
