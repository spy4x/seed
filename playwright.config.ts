import { defineConfig, devices } from "@playwright/test"
// The npm name of `@spy4x/preact-system`: Playwright loads this file itself and finds only
// packages in `node_modules`, where a `jsr:` import puts nothing.
import { playwrightBaseConfig } from "@jsr/spy4x__preact-system/playwright"

/**
 * Playwright Configuration for SPA E2E Tests
 *
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  ...playwrightBaseConfig({
    baseURL: "http://app.localhost",
    ci: !!Deno.env.get("CI"),
    chromium: devices["Desktop Chrome"],
    use: { actionTimeout: 30_000, navigationTimeout: 30_000 },
  }),
  // The base config retries twice in CI; a test that fails once must fail the run (#394).
  retries: 0,
  // A machine running several stacks at once is slow: the base 30 s per test, 5 s per assertion and
  // 10 s per action or navigation (`use` above) fail healthy specs there. A real hang still fails,
  // only later.
  timeout: 60_000,
  expect: { timeout: 10_000 },
})
