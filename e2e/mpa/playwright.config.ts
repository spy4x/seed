import { defineConfig, devices } from "@playwright/test"
import { playwrightBaseConfig } from "@jsr/spy4x__preact-system/playwright"

/**
 * Playwright configuration for the MPA (`apps/mpa`), apart from the SPA's: the root configuration
 * runs `*.e2e.ts` against a stack that serves the SPA, and these specs need one that serves the
 * MPA on its own host. `MPA_BASE_URL` names that origin; `SPA_BASE_URL` names the app's, where
 * `/api` goes to the API (`e2e/mpa/run.sh` sets both).
 *
 * Run from `apps/mpa`: `deno task e2e`.
 */
export default defineConfig({
  ...playwrightBaseConfig({
    baseURL: Deno.env.get("MPA_BASE_URL") ?? "http://app.localhost",
    ci: !!Deno.env.get("CI"),
    chromium: devices["Desktop Chrome"],
  }),
  // The base config retries twice in CI; a test that fails once must fail the run (#394).
  retries: 0,
  testDir: ".",
  testMatch: /.*\.mpa\.ts/,
  outputDir: "../results/mpa",
  reporter: [["list"]],
})
