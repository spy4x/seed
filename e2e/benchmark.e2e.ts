import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The benchmark page (#440) on a small group: choose it, run every measure, and read the results
 * line. The dev server serves the SPA here, which is what opens the page.
 */

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** A group of the person's with `count` notes, made through the normal API. */
async function smallGroup(page: Page, name: string, count: number): Promise<string> {
  const id = uuidV7()
  const created = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id, name },
  })
  expect(created.status(), await created.text()).toBe(201)
  for (let index = 1; index <= count; index++) {
    const note = await page.request.post(`${apiBase}/api/groups/${id}/notes`, {
      headers,
      data: { id: uuidV7(), title: `Bench note ${index}`, body: `Body ${index}` },
    })
    expect(note.status(), await note.text()).toBe(201)
  }
  return id
}

test("runs every measure on a small group and gives one results line without the person in it", async ({ page, request }) => {
  const email = `bench-${uuidV7()}@example.com`
  try {
    const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
      headers,
      data: { email, password },
    })
    expect(signedUp.ok(), await signedUp.text()).toBe(true)
    await signIn(page, email, password)
    await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
    const groupId = await smallGroup(page, "Bench small", 6)

    await gotoApp(page, "/benchmark", page.locator("[data-e2e=benchmark-run]"))
    // No group here has more than 1,000 notes, so the page offers the generator's command.
    await expect(page.locator("[data-e2e=benchmark-no-large-group]")).toContainText(
      `deno task load:group M --member ${email}`,
    )
    await page.locator("[data-e2e=benchmark-group]").selectOption(groupId)
    await page.locator("[data-e2e=benchmark-run]").click()
    await expect(page.locator("[data-e2e=benchmark-stop]")).toBeFocused()

    await expect(page.locator("[data-e2e=benchmark-summary]")).toBeFocused({ timeout: 60_000 })
    const line = await page.locator("[data-e2e=benchmark-json]").inputValue()
    const results = JSON.parse(line)
    expect(results.group).toEqual({ name: "Bench small", notes: 6, tier: null })
    const states = Object.values(results.measures).map((measure) =>
      (measure as { state: string }).state
    )
    expect(states).toHaveLength(10)
    // Chromium reports memory and storage; a measure it does not report stays "unavailable".
    expect(states.every((state) => state === "done" || state === "unavailable")).toBe(true)
    expect(results.measures.download.ms).toBeGreaterThan(0)
    expect(results.errors).toEqual([])
    expect(line).not.toContain(email)
    expect(line).not.toContain(groupId)
  } finally {
    await cleanup(request, email)
  }
})
