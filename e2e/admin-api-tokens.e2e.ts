import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The operator area's API tokens (#427) on the admin host: an operator finds a person's token on
 * the API tokens page and revokes it, then removes the person's push device from their page. The
 * token stops working, and the person's activity names both changes.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

function address(name: string): string {
  return `e2e-admin-tokens-${name}-${uuidV7().slice(-8)}@example.com`
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Creates `email`'s account over the API; `request` stays signed in as them. */
async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

/** Signs the operator in on the admin host, in a context of its own. */
async function adminPage(context: BrowserContext, email: string): Promise<Page> {
  const ops = await context.newPage()
  await ops.goto(`${adminBase}/sign-in`)
  await ops.locator("[data-e2e=auth-form-login]").fill(email)
  await ops.locator("[data-e2e=auth-form-password]").fill(password)
  await ops.locator("[data-e2e=auth-form-submit]").click()
  await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()
  return ops
}

test.describe("the admin app's API tokens", () => {
  test("an operator revokes a person's token and removes their device, and both are audited", async ({ browser, playwright, request }) => {
    const operatorEmail = address("ops")
    const personEmail = address("ada")
    const tokenName = `Deploy ${uuidV7().slice(-6)}`
    const person = await playwright.request.newContext()
    let admin: BrowserContext | null = null
    try {
      // The person makes a group, an API token in it and registers a push device.
      await signUp(person, personEmail)
      const groupId = uuidV7()
      const group = await person.post(`${appBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Family" },
      })
      expect(group.status(), await group.text()).toBe(201)
      const created = await person.post(`${appBase}/api/tokens`, {
        headers,
        data: { name: tokenName, groupId, access: 2, expiresInDays: null, password },
      })
      expect(created.status(), await created.text()).toBe(201)
      const { secret } = await created.json()
      const deviceId = `e2e-device-${uuidV7().slice(-8)}`
      const device = await person.post(`${appBase}/api/push`, {
        headers,
        data: {
          deviceId,
          subscription: {
            endpoint: `https://push.example.com/${deviceId}`,
            expirationTime: null,
            keys: { auth: "e2e-auth-key", p256dh: "e2e-p256dh-key" },
          },
        },
      })
      expect(device.ok(), await device.text()).toBe(true)
      const works = await request.get(`${appBase}/api/v1/groups/${groupId}/notes`, {
        headers: { authorization: `Bearer ${secret}` },
      })
      expect(works.status(), await works.text()).toBe(200)

      await signUp(request, operatorEmail)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: operatorEmail, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)
      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await adminPage(admin, operatorEmail)

      // The sidebar opens every token; the live filter keeps it in the address.
      await ops.getByRole("navigation", { name: "Admin sections" })
        .getByRole("link", { name: "API tokens" }).click()
      await expect(ops.locator("[data-e2e=admin-api-tokens-title]")).toBeVisible()
      await ops.locator("[data-e2e=admin-api-tokens-state]").getByRole("button", { name: /^Live/ })
        .click()
      await expect(ops).toHaveURL(`${adminBase}/api-tokens?state=live`)
      const row = ops.locator("[data-e2e=admin-api-tokens-list] tr", { hasText: tokenName })
      await expect(row).toContainText(personEmail)
      await expect(row).toContainText("Read and write")
      await expect(row).not.toContainText(secret)

      // Revoking only confirms; it asks for no password.
      await row.getByRole("button", { name: `Revoke ${tokenName}` }).click()
      await ops.locator("[data-e2e=admin-api-tokens-confirm]").click()
      await expect(ops.locator("[data-e2e=toasts]")).toContainText(`${tokenName} is revoked.`)
      await expect(row).toHaveCount(0)
      const refused = await request.get(`${appBase}/api/v1/groups/${groupId}/notes`, {
        headers: { authorization: `Bearer ${secret}` },
      })
      expect(refused.status()).toBe(401)

      // The owner's name opens their tokens tab, where the token now shows revoked.
      await ops.locator("[data-e2e=admin-api-tokens-state]").getByRole("button", {
        name: /^Revoked/,
      }).click()
      await ops.locator("[data-e2e=admin-api-tokens-list] tr", { hasText: tokenName })
        .getByRole("link").click()
      await expect(ops).toHaveURL(/\/users\/\d+\?tab=api-tokens$/)
      await expect(ops.locator("[data-e2e=admin-person-api-tokens]")).toContainText(tokenName)
      await expect(ops.locator("[data-e2e=admin-api-token-state-revoked]")).toBeVisible()

      // The device shows by its label only, and goes after a confirm.
      await ops.getByRole("tab", { name: "Devices" }).click()
      const devices = ops.locator("[data-e2e=admin-person-devices]")
      await expect(devices).toContainText(`Device ${deviceId.slice(-8)}`)
      await expect(devices).not.toContainText("push.example.com")
      await devices.getByRole("button", { name: `Remove device ${deviceId.slice(-8)}` }).click()
      await ops.locator("[data-e2e=admin-api-tokens-confirm]").click()
      await expect(ops.locator("[data-e2e=toasts]")).toContainText("is removed.")
      await expect(devices).toHaveText("No device gets push notifications.")
      const left = await person.get(`${appBase}/api/push/devices`, { headers })
      expect((await left.json()).data).toEqual([])

      await ops.getByRole("tab", { name: "Notifications" }).click()
      await expect(ops.locator("[data-e2e=admin-person-notifications-count]")).toBeVisible()

      // The person's activity names both, and who did them. The person page read it when it
      // opened, before the removal, so the page is read again.
      await ops.reload()
      await ops.getByRole("tab", { name: "Activity" }).click()
      const activity = ops.locator("[data-e2e=admin-user-audits]")
      await expect(activity).toContainText("Push device removed by an operator")
      await expect(activity).toContainText("API token revoked")
      await expect(activity).toContainText("reason=operator:")
    } finally {
      await admin?.close()
      await person.dispose()
      await cleanup(request, personEmail)
      await cleanup(request, operatorEmail)
    }
  })
})
