import { defineConfig, devices } from "@playwright/test"
import { playwrightBaseConfig } from "@jsr/spy4x__preact-system/playwright"

/**
 * Playwright configuration for the SPA as production serves it: the built files in the nginx
 * container of `apps/spa/dockerfile.prod`, behind one origin with the API. The root configuration
 * runs `*.e2e.ts` against the development stack, where Vite serves the SPA and nginx plays no part,
 * so what nginx adds (the security headers) is checked here. `e2e/spa/run.sh` builds the image,
 * starts the stack and runs these specs; `SPA_BASE_URL` names the origin.
 */
const baseURL = Deno.env.get("SPA_BASE_URL")
if (!baseURL) throw new Error("SPA_BASE_URL is required: run these specs through e2e/spa/run.sh")

export default defineConfig({
  ...playwrightBaseConfig({
    baseURL,
    ci: !!Deno.env.get("CI"),
    chromium: devices["Desktop Chrome"],
  }),
  // The base config retries twice in CI; a test that fails once must fail the run (#394).
  retries: 0,
  testDir: ".",
  testMatch: /.*\.spa\.ts/,
  outputDir: "../results/spa",
  timeout: 60_000,
  reporter: [["list"]],
})
