import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { lastMail, mailedCode, nextCode } from "./fixtures/sign-up.ts"
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

// Back from the app is not tested: Chromium skips a history entry that navigated on without a user
// gesture, as `/try` does, so the test could not tell `location.replace` from `assign`.
test(`"Try it now" opens the app as a guest in one click`, async ({ page }) => {
  try {
    await tryItNow(page)
    await expect(page.locator(`[data-e2e=guest-banner]`)).toBeVisible()
    expect((await me(page)).guestSince).not.toBeNull()
  } finally {
    await deleteGuest(page)
  }
})

test(`keeping a guest account by e-mail keeps its user id, drops the banner and signs in anew without a reload`, async ({ page, request }) => {
  const email = `e2e-guest-keep-${uuidV7().slice(-8)}@example.com`
  const sessionCookie = async () =>
    (await page.context().cookies()).find((c) => c.name === `sessionIdToken`)?.value
  try {
    await tryItNow(page)
    const guest = await me(page)
    const guestCookie = await sessionCookie()
    expect(guestCookie).toBeTruthy()

    await page.locator(`[data-e2e=guest-banner-keep]`).click()
    await expect(page).toHaveURL(`/keep`)
    const before = await lastMail(request, lastMailUrl, email)
    await page.locator(`[data-e2e=keep-email]`).fill(email)
    await page.locator(`[data-e2e=keep-password]`).fill(`Passw0rd!`)
    await page.locator(`[data-e2e=keep-email-submit]`).click()
    await expect(page.getByRole(`heading`, { level: 1, name: `Check your inbox` })).toBeVisible()
    const field = page.locator(`[data-e2e=mailed-code-step-code]`)
    await field.pressSequentially(await nextCode(request, lastMailUrl, email, before))
    await field.press(`Enter`)

    await expect(page.locator(`[data-e2e=keep-done]`)).toContainText(`your email`)
    const kept = await me(page)
    expect(kept).toMatchObject({ id: guest.id, guestSince: null })
    await expect(page.locator(`[data-e2e=guest-banner]`)).toHaveCount(0)
    // The guest's session ended with the keep (#374): a new cookie, and the socket opens on it.
    expect(await sessionCookie()).not.toBe(guestCookie)
    // A screen that asks the server through the socket opens, rather than signing the page out.
    await page.getByRole(`navigation`, { name: `Main navigation` })
      .getByRole(`link`, { name: `Overview` }).click()
    await expect(page.locator(`[data-e2e="overview-widget-notes.added"]`)).toBeVisible()
    await expect(page).toHaveURL(/\/overview\/[0-9a-f-]{36}$/)
    await expect(page.locator(`[data-e2e=shell-ws-status]`)).toHaveText(`Online`)
  } finally {
    await cleanup(request, email)
  }
})

test(`a guest who signs in by a code to a new address keeps the guest account`, async ({ page, request }) => {
  const email = `e2e-guest-code-${uuidV7().slice(-8)}@example.com`
  try {
    await tryItNow(page)
    const guest = await me(page)

    await gotoApp(page, `/sign-in/code`, page.locator(`[data-e2e=sign-in-code-email]`))
    await expect(page.locator(`[data-e2e=sign-in-code-guest]`)).toBeVisible()
    await page.locator(`[data-e2e=sign-in-code-email]`).fill(email)
    await page.locator(`[data-e2e=sign-in-code-submit]`).click()
    const field = page.locator(`[data-e2e=mailed-code-step-code]`)
    await expect(field).toBeFocused()
    await field.pressSequentially(
      await mailedCode(request, lastMailUrl, email, `Your sign-in code for `),
    )
    await field.press(`Enter`)

    await page.waitForURL(`/keep`)
    expect(await me(page)).toMatchObject({ id: guest.id, guestSince: null })
  } finally {
    await cleanup(request, email)
  }
})
