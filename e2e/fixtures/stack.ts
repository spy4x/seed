import { type APIRequestContext, type Browser, expect, test as base } from "@playwright/test"
import { gotoApp, signIn } from "./app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./sign-up.ts"

const WARM_PASSWORD = "Passw0rd!"

/**
 * Loads every screen of the signed-in app once, so Vite's dev server has compiled the modules
 * before the first spec needs them. On a cold dev server the first load of a route takes longer
 * than the 10 s navigation timeout when the machine is busy, and whichever spec ran first failed
 * with `page.goto: Timeout 10000ms exceeded`.
 */
async function warmUp(browser: Browser, api: APIRequestContext, baseURL: string, email: string) {
  const headers = { origin: new URL(baseURL).origin, "sec-fetch-site": "same-origin" }
  const cleanup = async () => {
    const response = await api.post("/api/test/cleanup-user", { data: { login: email } })
    if (!response.ok()) {
      throw new Error(`warm-up cleanup failed: ${response.status()} ${await response.text()}`)
    }
  }
  await cleanup()
  const signUp = await signUpWithCode(api, "/api/auth/password/sign-up", {
    headers,
    data: { email, password: WARM_PASSWORD },
  })
  if (!signUp.ok()) throw new Error(`warm-up sign-up failed: ${signUp.status()}`)
  const context = await browser.newContext({ baseURL })
  try {
    const page = await context.newPage()
    await signIn(page, email, WARM_PASSWORD)
    // The selected group is the personal group sign-up creates; one note in it opens the editor.
    const selected = await page.request.get("/api/groups/selected")
    const { groupId } = await selected.json()
    if (!groupId) throw new Error(`warm-up found no selected group: ${selected.status()}`)
    const noteId = uuidV7()
    const note = await page.request.post(`/api/groups/${groupId}/notes`, {
      headers,
      data: { id: noteId, title: "Warm-up", body: "" },
    })
    if (note.status() !== 201) {
      throw new Error(`warm-up note failed: ${note.status()} ${await note.text()}`)
    }
    await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
    await gotoApp(page, `/groups/${groupId}`, page.locator("[data-e2e=group-general-name]"))
    await gotoApp(page, "/notes", page.locator("[data-e2e=note-new]"))
    await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=note-title]"))
    await gotoApp(page, "/profile/account", page.locator("[data-e2e=email-current]"))
    await page.waitForLoadState("networkidle")
  } catch (error) {
    // The warm-up's own error is the one to report; a cleanup that fails as well is added to it.
    await cleanup().catch((cleanupError) => {
      if (error instanceof Error) error.message += `\nThe cleanup failed as well: ${cleanupError}`
    })
    throw error
  } finally {
    await context.close()
  }
  await cleanup()
}

/**
 * `test` with one automatic worker fixture that warms the dev server before the first spec. The
 * specs that need the full stack import it from here; `url-filters` serves its own page and keeps
 * the plain one.
 */
export const test = base.extend<object, { warmDevServer: void }>({
  warmDevServer: [async ({ browser, playwright }, use, workerInfo) => {
    const baseURL = String(workerInfo.project.use.baseURL)
    // Its own request context: one shared with the browser context would hold the session cookie
    // and the sign-in page would redirect.
    const api = await playwright.request.newContext({ baseURL })
    try {
      await warmUp(browser, api, baseURL, `e2e_warm_up_user_${workerInfo.workerIndex}@example.com`)
    } finally {
      await api.dispose()
    }
    await use()
  }, { scope: "worker", auto: true, timeout: 120_000 }],
})

export { expect }
