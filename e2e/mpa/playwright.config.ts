import { defineConfig, devices } from "@playwright/test"
import { playwrightBaseConfig } from "@jsr/spy4x__preact-system/playwright"

/**
 * Playwright configuration for the MPA (`apps/mpa`), apart from the SPA's: the root configuration
 * runs `*.e2e.ts` against a stack that serves the SPA, and these specs need one that serves the
 * MPA at the same origin, with `/api` going to the API. `MPA_BASE_URL` names that origin.
 *
 * Run from `apps/mpa`: `deno task e2e`.
 */
export default defineConfig({
  ...playwrightBaseConfig({
    baseURL: Deno.env.get("MPA_BASE_URL") ?? "http://app.localhost",
    ci: !!Deno.env.get("CI"),
    chromium: devices["Desktop Chrome"],
  }),
  testDir: ".",
  testMatch: /.*\.mpa\.ts/,
  outputDir: "../results/mpa",
  reporter: [["list"]],
})
