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

test(`a guest who opens a sign-in link asked for in another browser stays the same guest`, async ({ page, request }) => {
  const email = `e2e-guest-link-${uuidV7().slice(-8)}@example.com`
  try {
    await tryItNow(page)
    const guest = await me(page)
    // Another browser asks for the link: the `request` context shares no cookie with the page.
    const asked = await request.post(`${apiBase}/api/auth/link`, {
      headers: { origin: apiBase, "sec-fetch-site": `same-origin` },
      data: { email },
    })
    expect(asked.ok(), await asked.text()).toBe(true)
    let link = ``
    await expect.poll(async () => {
      link = (await lastMail(request, lastMailUrl, email))?.text.match(/https?:\/\/\S+/)?.[0] ?? ``
      return link
    }, { timeout: 20_000, message: `the worker mails the sign-in link` }).not.toBe(``)

    const go = page.locator(`[data-e2e=sign-in-link-continue]`)
    const url = new URL(link)
    await gotoApp(page, url.pathname + url.hash, go)
    await expect(page.locator(`[data-e2e=sign-in-link-guest]`)).toBeVisible()
    await go.click()

    await expect(
      page.getByRole(`heading`, { level: 1, name: `This link was asked for in another browser` }),
    ).toBeVisible()
    await expect(page.locator(`[data-e2e=sign-in-link-new]`)).toBeFocused()
    expect(await me(page)).toMatchObject({ id: guest.id, guestSince: guest.guestSince })
  } finally {
    await deleteGuest(page)
    await cleanup(request, email)
  }
})
