import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { lastMail, nextCode } from "./fixtures/sign-up.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const lastMailUrl = `${apiBase}/api/test/last-mail`

/** The signed-in person as the API sees them, read with the page's own cookies. */
async function me(page: Page): Promise<{ id: number; guestSince: string | null }> {
  return await page.evaluate(async () => {
    const response = await fetch(`/api/auth/me`)
    return await response.json()
  })
}

/** Deletes the page's guest account, as the Profile's "Delete my account" does. */
async function deleteGuest(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const response = await fetch(`/api/auth/guest/delete`, {
      method: `POST`,
      headers: { "content-type": `application/json` },
      body: JSON.stringify({ confirm: `delete` }),
    })
    return response.status
  })
  expect.soft(status).toBe(200)
}

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Opens the sign-up page and presses "Try it now", waiting for the app to open as the guest. */
async function tryItNow(page: Page): Promise<void> {
  await gotoApp(page, `/sign-up`, page.locator(`[data-e2e=try-it-now]`))
  await gotoApp(page, `/notes`, page.locator(`[data-e2e=shell-ws-status]`), async () => {
    await page.locator(`[data-e2e=try-it-now] a`).click()
    await page.waitForURL(`/notes`)
  })
}

test(`"Try it now" opens the app as a guest in one click, and Back does not make a second one`, async ({ page }) => {
  try {
    await tryItNow(page)
    await expect(page.locator(`[data-e2e=guest-banner]`)).toBeVisible()
    const guest = await me(page)
    expect(guest.guestSince).not.toBeNull()

    await page.goBack()
    await expect(page).toHaveURL(`/sign-up`)
    expect((await me(page)).id).toBe(guest.id)
  } finally {
    await deleteGuest(page)
  }
})

test(`keeping a guest account by e-mail keeps its user id and drops the banner`, async ({ page, request }) => {
  const email = `e2e-guest-keep-${uuidV7().slice(-8)}@example.com`
  try {
    await tryItNow(page)
    const guest = await me(page)

    await page.locator(`[data-e2e=guest-banner-keep]`).click()
    await expect(page).toHaveURL(`/keep`)
    const before = await lastMail(request, lastMailUrl, email)
    await page.locator(`[data-e2e=keep-email]`).fill(email)
    await page.locator(`[data-e2e=keep-password]`).fill(`Passw0rd!`)
    await page.locator(`[data-e2e=keep-email-submit]`).click()
    await expect(page.getByRole(`heading`, { level: 1, name: `Check your inbox` })).toBeVisible()
    await page.locator(`[data-e2e=sign-up-code-input]`)
      .fill(await nextCode(request, lastMailUrl, email, before))
    await page.locator(`[data-e2e=sign-up-code-submit]`).click()

    await expect(page.locator(`[data-e2e=keep-done]`)).toContainText(`your e-mail address`)
    const kept = await me(page)
    expect(kept).toMatchObject({ id: guest.id, guestSince: null })
    await expect(page.locator(`[data-e2e=guest-banner]`)).toHaveCount(0)
  } finally {
    await cleanup(request, email)
  }
})
