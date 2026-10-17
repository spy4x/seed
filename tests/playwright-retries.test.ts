/// <reference lib="deno.ns" />
/**
 * Holds that CI never retries a browser test. With a retry, a test that fails every second run
 * shows green, and the flake reaches `main` unseen (spy4x/template#394). Each Playwright
 * configuration is loaded the way CI loads it, with `CI` set.
 */

import { expect } from "@std/expect"
import { walk } from "@std/fs"
import { fromFileUrl, relative } from "@std/path"

const ROOT = fromFileUrl(new URL("../", import.meta.url))

/** Loads every configuration with `CI` set. A new one is added here; the second test holds that. */
async function loadConfigs(): Promise<Record<string, { default: { retries?: number } }>> {
  Deno.env.set("CI", "true")
  // e2e/spa refuses to load without the origin its run script names.
  Deno.env.set("SPA_BASE_URL", "http://app.localhost")
  return {
    "playwright.config.ts": await import("../playwright.config.ts"),
    "e2e/spa/playwright.config.ts": await import("../e2e/spa/playwright.config.ts"),
    "e2e/mpa/playwright.config.ts": await import("../e2e/mpa/playwright.config.ts"),
  }
}

Deno.test("no browser test configuration retries a failed test in CI", async () => {
  for (const [path, config] of Object.entries(await loadConfigs())) {
    expect({ path, retries: config.default.retries }).toEqual({ path, retries: 0 })
  }
})

Deno.test("every Playwright configuration of the repository is checked", async () => {
  const found: string[] = []
  for await (
    const entry of walk(ROOT, {
      match: [/playwright\.config\.[cm]?[jt]s$/],
      // .volumes holds the development stack's data, which its containers own and often hide.
      skip: [/(^|\/)(\.git|node_modules|\.volumes)$/],
    })
  ) found.push(relative(ROOT, entry.path))
  expect(found.sort()).toEqual(Object.keys(await loadConfigs()).sort())
})
