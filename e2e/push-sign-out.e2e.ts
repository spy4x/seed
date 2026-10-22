import type { Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { openProfile, signIn } from "./fixtures/app.ts"
import { cleanup, password, signUp } from "./fixtures/tags.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

/**
 * Sign-out ends this browser's push subscription (#409), so the account's notifications stop
 * reaching a shared computer. Chromium under test has no push service to subscribe with, so the
 * page's `PushManager` is replaced by one that keeps a single subscription in memory; everything
 * else is the real app: the service worker, the profile's "Add this device", the API that stores
 * the subscription, and the account menu's sign-out.
 */

function email(name: string): string {
  return `e2e-push-sign-out-${name}-${uuidV7().slice(-8)}@example.com`
}

/** Replaces `PushManager` with an in-memory one before the app loads. */
async function fakePushManager(page: Page): Promise<void> {
  await page.addInitScript((endpoint) => {
    let current: PushSubscription | null = null
    const subscription = {
      endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: null },
      getKey: () => null,
      toJSON: () => ({
        endpoint,
        expirationTime: null,
        keys: { auth: "e2e-auth", p256dh: "e2e-p256dh" },
      }),
      unsubscribe: () => {
        const had = current !== null
        current = null
        return Promise.resolve(had)
      },
    } as unknown as PushSubscription
    PushManager.prototype.subscribe = () => {
      current = subscription
      return Promise.resolve(subscription)
    }
    PushManager.prototype.getSubscription = () => Promise.resolve(current)
  }, `https://push.example/${uuidV7()}`)
}

/** Whether the browser holds a push subscription, asked the way the app asks. */
async function holdsSubscription(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return (await registration?.pushManager.getSubscription()) != null
  })
}

/** Signs in, adds this browser on the profile page and waits until the API lists it. */
async function signInWithNotifications(page: Page, user: string): Promise<void> {
  await fakePushManager(page)
  await signIn(page, user, password)
  await openProfile(page, "notifications")
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.locator("[data-e2e=push-register]").first().click()
  await expect(page.locator("[data-e2e^=push-device-]")).toHaveCount(1)
  expect(await holdsSubscription(page)).toBe(true)
}

async function signOutFromMenu(page: Page): Promise<void> {
  await page.locator("[data-e2e=account-menu-button]").click()
  await page.getByRole("menuitem", { name: "Sign out" }).click()
  await page.locator("[data-e2e=auth-form-login]").waitFor()
}

test.describe("push subscription at sign-out", () => {
  test("after a sign-out the browser holds no push subscription", async ({ page, request }) => {
    const user = email("online")
    await cleanup(request, user)
    try {
      await signUp(request, user)
      await signInWithNotifications(page, user)

      await signOutFromMenu(page)

      await expect.poll(() => holdsSubscription(page)).toBe(false)
    } finally {
      await cleanup(request, user)
    }
  })

  test("a sign-out without a connection still ends the browser's push subscription", async ({ page, context, request }) => {
    const user = email("offline")
    await cleanup(request, user)
    try {
      await signUp(request, user)
      await signInWithNotifications(page, user)

      await context.setOffline(true)
      await signOutFromMenu(page)

      await expect.poll(() => holdsSubscription(page)).toBe(false)
    } finally {
      await context.setOffline(false)
      await cleanup(request, user)
    }
  })
})
