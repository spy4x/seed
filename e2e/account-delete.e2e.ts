import { type APIRequestContext, type BrowserContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** Removes `email`'s account; `soft` only records a failure, for the `finally` of a test. */
async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** A fresh address per run, so a rerun never meets the previous run's account. */
function address(name: string): string {
  return `e2e-delete-${name}-${uuidV7().slice(-8)}@example.com`
}

/** Opens the profile's danger zone and its deletion dialog. */
async function openDeletion(page: Page): Promise<void> {
  await gotoApp(page, "/profile/danger-zone", page.locator("[data-e2e=danger-zone]"))
  await page.locator("[data-e2e=account-delete-open]").click()
  await expect(page.locator("[data-e2e=account-delete-dialog]")).toBeVisible()
}

test("deleting my account signs me out on every device, and signing in during the wait restores it", async ({ browser, page, request }) => {
  const email = address("ann")
  await cleanup(request, email)
  let other: BrowserContext | null = null
  try {
    await signUp(request, email)
    other = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    // The other device is not open: an open tab would sign itself out on the announcement, and
    // the server's own sign-out would go untested.
    const otherPage = await other.newPage()
    await signIn(otherPage, email, password)
    await otherPage.close()
    expect((await other.request.get(`${apiBase}/api/auth/me`)).status()).toBe(200)
    await signIn(page, email, password)

    await openDeletion(page)
    await page.locator("[data-e2e=account-delete-password]").fill("not-my-password")
    await page.locator("[data-e2e=account-delete-submit]").click()
    await expect(page.locator("[data-e2e=account-delete-dialog]")).toContainText(
      "Invalid password",
    )
    await page.locator("[data-e2e=account-delete-password]").fill(password)
    await page.locator("[data-e2e=account-delete-submit]").click()

    await expect(page).toHaveURL("/sign-in")
    await expect(page.locator("[data-e2e=account-deleted]")).toContainText("Account deleted")
    expect((await page.request.get(`${apiBase}/api/auth/me`)).status()).toBe(401)

    await signIn(page, email, password)
    expect((await page.request.get(`${apiBase}/api/auth/me`)).status()).toBe(200)
    // The other device's session ended with the request: the restore brings back the account,
    // not that session. It is not asked during the wait, since a request refused for a deleted
    // user could end the session by itself.
    expect((await other.request.get(`${apiBase}/api/auth/me`)).status()).toBe(401)
  } finally {
    await other?.close()
    await cleanup(request, email, { soft: true })
  }
})

test("a group other people still use stops the deletion and links to that group", async ({ page, request }) => {
  const owner = address("owner")
  const member = address("member")
  await cleanup(request, owner)
  await cleanup(request, member)
  try {
    await signUp(request, owner)
    await signUp(request, member)
    await signIn(page, owner, password)
    const groupId = uuidV7()
    const created = await page.request.post(`${apiBase}/api/groups`, {
      headers,
      data: { id: groupId, name: "Shared team" },
    })
    expect(created.status(), await created.text()).toBe(201)
    const added = await request.post(`${apiBase}/api/test/add-member`, {
      data: { login: member, groupId, role: 2 },
    })
    expect(added.status(), await added.text()).toBe(200)

    await openDeletion(page)
    const blocker = page.locator(`[data-e2e=account-delete-blocker-${groupId}]`)
    await expect(blocker).toHaveText("Shared team")
    await expect(page.locator("[data-e2e=account-delete-password]")).toHaveCount(0)
    await blocker.click()

    await expect(page).toHaveURL(`/groups/${groupId}/members`)
    expect((await page.request.get(`${apiBase}/api/auth/me`)).status()).toBe(200)
  } finally {
    await cleanup(request, owner, { soft: true })
    await cleanup(request, member, { soft: true })
  }
})
