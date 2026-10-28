import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { readdir } from "node:fs/promises"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The admin app's System page (#429): an operator sees the database, the cache and the migrations
 * of the stack the test runs on badged OK, the job queue and the build, and checks again. No
 * setting, address or secret of the stack shows on it.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

/**
 * The newest migration in the repository, which the System page names as the last one applied. The
 * path is relative to the repository root, where Playwright runs: `e2e:local` runs a copy of this
 * spec from another folder, so `import.meta.url` would point elsewhere.
 */
async function newestMigration(): Promise<string> {
  const dir = `libs/server/db/migrations`
  const names = (await readdir(dir)).filter((name) => name.endsWith(`.sql`)).sort()
  const newest = names.at(-1)
  if (!newest) throw new Error(`no migration found in ${dir}`)
  return newest.replace(/(\.no_transaction)?\.sql$/, ``)
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

test.describe("the admin System page", () => {
  test("an operator sees the health of each part of the stack and checks again", async ({ browser, request }) => {
    const operatorEmail = `e2e-system-ops-${uuidV7().slice(-8)}@example.com`
    let admin: BrowserContext | null = null
    try {
      const signedUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email: operatorEmail, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: operatorEmail, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/`)
      await expect(ops).toHaveURL(`${adminBase}/sign-in`)
      await expect(ops.locator("[data-e2e=auth-form-login]")).toBeVisible()
      await ops.locator("[data-e2e=auth-form-login]").fill(operatorEmail)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()

      await ops.getByRole("navigation", { name: "Admin sections" })
        .getByRole("link", { name: "System" }).click()
      await expect(ops).toHaveURL(`${adminBase}/system`)
      await expect(ops.locator("[data-e2e=admin-system-title]")).toBeVisible()

      const badge = (card: string) => ops.locator(`[data-e2e=${card}] [data-health]`)
      await expect(badge("admin-system-database")).toHaveAttribute("data-health", "ok")
      await expect(badge("admin-system-cache")).toHaveAttribute("data-health", "ok")
      await expect(badge("admin-system-migrations")).toHaveAttribute("data-health", "ok")
      await expect(ops.locator("[data-e2e=admin-system-database]")).toContainText("Postgres 18")
      await expect(ops.locator("[data-e2e=admin-system-migrations]")).toContainText(
        await newestMigration(),
      )
      await expect(ops.locator("[data-e2e=admin-system-queue]")).toContainText("Due now")
      await expect(ops.locator("[data-e2e=admin-system-build]")).toContainText("Runtime")

      // Names and states only: no password, connection string or address of a service.
      const text = await ops.locator("main").innerText()
      expect(text).not.toMatch(/postgres(ql)?:\/\/|redis:\/\/|valkey:\/\/|DB_PASS|PASSWORD=/i)

      // Check again reads the stack anew.
      const answered = ops.waitForResponse((response) =>
        response.url().endsWith("/api/admin/system") && response.ok()
      )
      await ops.locator("[data-e2e=admin-system-refresh]").click()
      await answered
      await expect(badge("admin-system-database")).toHaveAttribute("data-health", "ok")

      // At 1440 px each label and the newest migration's name stay on one line (#453).
      await ops.setViewportSize({ width: 1440, height: 900 })
      const wrapped = await ops.locator(
        "[data-e2e=admin-system-cards] dt, [data-e2e=admin-system-migrations] dd",
      ).evaluateAll((all) =>
        all.filter((el) =>
          el.getBoundingClientRect().height > 1.5 * parseFloat(getComputedStyle(el).lineHeight)
        ).map((el) => el.textContent)
      )
      expect(wrapped).toEqual([])

      // On a phone the cards stack and the page never scrolls sideways.
      await ops.setViewportSize({ width: 390, height: 800 })
      expect(await ops.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      )
    } finally {
      await admin?.close()
      await cleanup(request, operatorEmail)
    }
  })
})
