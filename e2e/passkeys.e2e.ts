import type { APIRequestContext, CDPSession, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, openProfile, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/**
 * Gives `page` a device that holds passkeys and verifies the person at once, as a phone with a
 * fingerprint would: Chromium's virtual authenticator, through the DevTools protocol. Throws in a
 * browser without that protocol, so the test fails instead of passing without a passkey.
 */
async function virtualAuthenticator(
  page: Page,
): Promise<{ cdp: CDPSession; authenticatorId: string }> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("WebAuthn.enable")
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  return { cdp, authenticatorId }
}

test.describe("passkeys", () => {
  test("a person adds a passkey on the profile, then signs in with it from the autofill and the button", async ({ page, request }) => {
    const email = `e2e-passkey-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      const signUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok(), await signUp.text()).toBe(true)
      const { cdp, authenticatorId } = await virtualAuthenticator(page)

      await signIn(page, email, password)
      await openProfile(page, "security")
      await page.locator("[data-e2e=sign-in-method-add-passkey]").click()
      await page.locator("[data-e2e=sign-in-method-link-password]").fill(password)
      await page.locator("[data-e2e=sign-in-method-link-submit]").click()
      await expect(page.locator("[data-e2e=passkey-status]"))
        .toHaveText(/^Passkey added as ".+"\. Rename it if you like\.$/)
      await expect(page.locator("[data-e2e=sign-in-method-passkey]")).toBeVisible()
      // The device keeps one discoverable passkey for this site.
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId })
      expect(credentials).toHaveLength(1)
      expect(credentials[0].isResidentCredential).toBe(true)

      // Signed out, the login field's autofill offers the passkey, and this device, which needs
      // no pick, answers that request as soon as the sign-in page makes it.
      await page.context().clearCookies()
      await gotoApp(page, "/sign-in", page.locator("[data-e2e=shell-ws-status]"))
      await expect(page).toHaveURL("/notes")
      await openProfile(page, "security")
      await expect(page.locator("[data-e2e=sign-in-method-passkey]"))
        .toContainText("Used on this device")

      // A browser whose autofill has no passkeys: the button asks the device instead.
      await page.addInitScript(() => {
        PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
      })
      await page.context().clearCookies()
      await gotoApp(page, "/sign-in", page.locator("[data-e2e=passkey-sign-in]"))
      await expect(page.locator("[data-e2e=auth-form-login]")).toHaveAttribute(
        "autocomplete",
        "username",
      )
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"), async () => {
        await page.locator("[data-e2e=passkey-sign-in]").click()
        await page.waitForURL("/notes")
      })
    } finally {
      await cleanup(request, email, true)
    }
  })
})
