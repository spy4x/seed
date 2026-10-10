import { defineConfig, devices } from "@playwright/test"

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
  testDir: ".",
  testMatch: /.*\.spa\.ts/,
  outputDir: "../results/spa",
  forbidOnly: !!Deno.env.get("CI"),
  retries: Deno.env.get("CI") ? 2 : 0,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 10_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
