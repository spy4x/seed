import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The people actions of the admin app (#425): an administrator finds their own row marked "You",
 * exports the filtered list as CSV, ends one of a person's two sessions, changes their role and
 * mails them the "Forgot password" link, and each shows on the person's Activity tab.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const ADMINISTRATOR = 4

function address(name: string): string {
  return `e2e-admin-users-${name}-${uuidV7().slice(-8)}@example.com`
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Creates `email`'s account over the API and signs that request out again. */
async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const signedOut = await request.post(`${appBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
}

/** Signs `email` in on the admin host and opens the people. */
async function openAdmin(admin: BrowserContext, email: string): Promise<Page> {
  const ops = await admin.newPage()
  await ops.goto(`${adminBase}/sign-in`)
  await ops.locator("[data-e2e=auth-form-login]").fill(email)
  await ops.locator("[data-e2e=auth-form-password]").fill(password)
  await ops.locator("[data-e2e=auth-form-submit]").click()
  await expect(ops).toHaveURL(`${adminBase}/`)
  await ops.goto(`${adminBase}/users`)
  await expect(ops.locator("[data-e2e=admin-users-title]")).toBeVisible()
  return ops
}

async function search(ops: Page, query: string): Promise<void> {
  await ops.locator("[data-e2e=admin-users-search]").fill(query)
  await ops.locator("[data-e2e=admin-users-submit]").click()
  await expect(ops).toHaveURL(new RegExp(`\\?q=${encodeURIComponent(query)}`))
  await expect(ops.locator("[data-e2e=admin-users-list] tbody tr")).toHaveCount(1)
}

test.describe("the people actions of the admin app", () => {
  test("an administrator exports, ends one session, changes a role and sends a reset link", async ({ browser, page, request }) => {
    const adminEmail = address("admin")
    const targetEmail = address("ada")
    let admin: BrowserContext | null = null
    let laptop: BrowserContext | null = null
    try {
      await signUp(request, adminEmail)
      await signUp(request, targetEmail)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: adminEmail, role: ADMINISTRATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      // The person is signed in on two devices.
      await signIn(page, targetEmail, password)
      laptop = await browser.newContext()
      await signIn(await laptop.newPage(), targetEmail, password)

      admin = await browser.newContext({ baseURL: adminBase, acceptDownloads: true })
      const ops = await openAdmin(admin, adminEmail)

      // The administrator's own row says "You"; the person, who set no name, shows their address
      // once.
      await search(ops, adminEmail)
      await expect(ops.locator("[data-e2e=admin-user-you]")).toHaveCount(1)
      await search(ops, targetEmail)
      await expect(ops.locator("[data-e2e=admin-user-you]")).toHaveCount(0)
      const row = ops.locator("[data-e2e=admin-users-list] tbody tr")
      expect((await row.textContent())?.split(targetEmail).length).toBe(2)

      // The export holds exactly the filtered list.
      const downloaded = ops.waitForEvent("download")
      await ops.locator("[data-e2e=admin-users-export]").click()
      const download = await downloaded
      expect(download.suggestedFilename()).toMatch(/^users-\d{4}-\d{2}-\d{2}\.csv$/)
      const csv = (await Deno.readTextFile(await download.path())).replace(/^\uFEFF/, "")
      const lines = csv.trim().split("\r\n")
      expect(lines[0]).toBe(
        "ID,First name,Last name,Address,Role,Status,Created,Last seen,Blocked at",
      )
      expect(lines.length).toBe(2)
      expect(lines[1]).toContain(`,${targetEmail},viewer,active,`)

      // Ends the session of one device; the other stays.
      await row.locator("a").first().click()
      await expect(ops.locator("[data-e2e=admin-user-title]")).toHaveText(targetEmail)
      await ops.getByRole("tab", { name: /Sessions/ }).click()
      const sessions = ops.locator("[data-e2e=admin-user-sessions] li")
      await expect(sessions).toHaveCount(2)
      await sessions.first().locator("[data-e2e=admin-session-end-open]").click()
      await expect(ops.locator("[data-e2e=admin-action-session]")).toBeVisible()
      await ops.locator("[data-e2e=admin-action-submit]").click()
      await expect(ops.locator("[data-e2e=toasts]")).toContainText("One session of")
      await expect(sessions).toHaveCount(1)

      // Changes the role in the dialog's picker.
      await ops.locator("[data-e2e=admin-user-menu]").click()
      await ops.locator("[data-e2e=admin-change-role-open]").click()
      const dialog = ops.locator("[data-e2e=admin-action-dialog]")
      await expect(dialog.getByRole("radio")).toHaveCount(3)
      await dialog.getByRole("radio", { name: "Supervisor" }).check()
      await ops.locator("[data-e2e=admin-action-submit]").click()
      await expect(ops.locator("[data-e2e=toasts]")).toContainText("is now supervisor")
      await expect(ops.locator("[data-e2e=admin-user-card]")).toContainText("Supervisor")

      // Mails the "Forgot password" link.
      await ops.locator("[data-e2e=admin-user-menu]").click()
      await ops.locator("[data-e2e=admin-password-reset-open]").click()
      await expect(dialog).toContainText(targetEmail)
      await ops.locator("[data-e2e=admin-action-submit]").click()
      await expect(ops.locator("[data-e2e=toasts]")).toContainText("password-reset link")
      await expect.poll(async () => {
        const response = await request.post(`${appBase}/api/test/last-mail`, {
          data: { email: targetEmail },
        })
        return response.ok() ? ((await response.json()) as { subject: string }).subject : null
      }, { timeout: 20_000, message: "the worker mails the reset link" }).toBe(
        "Reset your password",
      )

      // Each action is on the person's trail.
      await ops.getByRole("tab", { name: "Activity" }).click()
      const trail = ops.locator("[data-e2e=admin-user-audits]")
      await expect(trail).toContainText("Role changed")
      await expect(trail).toContainText("from viewer to supervisor")
      await expect(trail).toContainText("Password-reset link sent by an operator")
      await expect(trail).toContainText("Sessions ended")
    } finally {
      await laptop?.close()
      await admin?.close()
      await cleanup(request, targetEmail)
      await cleanup(request, adminEmail)
    }
  })
})
