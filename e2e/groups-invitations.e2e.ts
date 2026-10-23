import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { BILLING_WEBHOOK_PATH, proWebhook } from "./fixtures/billing.ts"
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

const settingsReady = (page: Page) => page.locator("[data-e2e=group-general-name]")

test.describe("group invitations", () => {
  test("an admin creates a link that a signed-out person follows, signs in and accepts with its role", async ({ page, browser, request }) => {
    const id = uuidV7().slice(-8)
    const owner = `e2e-invite-owner-${id}@example.com`
    const admin = `e2e-invite-admin-${id}@example.com`
    const invitee = `e2e-invite-guest-${id}@example.com`
    for (const email of [owner, admin, invitee]) await cleanup(request, email)
    let inviteePage: Page | null = null
    try {
      // The owner makes the group through the API; the admin is the one who invites.
      await signUp(request, owner)
      const groupId = uuidV7()
      const created = await request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      await signUp(request, admin)
      await signUp(request, invitee)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: admin, groupId, role: 3 },
      })
      expect(added.status(), await added.text()).toBe(200)
      // Inviting an editor is a paid feature: on the free plan an invitation adds viewers only.
      const upgraded = await request.post(
        `${apiBase}${BILLING_WEBHOOK_PATH}`,
        await proWebhook(groupId),
      )
      expect(upgraded.status(), await upgraded.text()).toBe(200)

      await signIn(page, admin, password)
      await gotoApp(page, `/groups/${groupId}/members`, settingsReady(page))
      // "Invite", in the Members tab's header, opens the group's invitation page, not a dialog.
      await page.getByRole("link", { name: "Invite", exact: true }).click()
      await expect(page).toHaveURL(`/groups/${groupId}/invitations/new`)
      const section = page.locator("main")
      await expect(section.locator("[data-e2e=invitation-new-title]")).toHaveText("New invitation")
      // An admin invites at most editors.
      await expect(section.locator("[data-e2e=invitation-role] option")).toHaveText([
        "Viewer",
        "Editor",
      ])
      await section.locator("[data-e2e=invitation-role]").selectOption({ label: "Editor" })
      await section.locator("[data-e2e=invitation-uses]").fill("2")
      // Pro is billed per member: the admin sees what one more member costs and must accept it.
      const seatPrice = section.locator("[data-e2e=seat-price]")
      await expect(seatPrice).toContainText(
        "with one more member the group pays €27.00 instead of €18.00",
      )
      await section.locator("[data-e2e=invitation-create]").click()
      await expect(seatPrice.locator("#invitation-seat-price-error")).toBeVisible()
      await expect(section.locator("[data-e2e=seat-price-accept]")).toBeFocused()
      await section.locator("[data-e2e=seat-price-accept]").check()
      await section.locator("[data-e2e=invitation-create]").click()
      const link = await section.locator("[data-e2e=invitation-created] code").textContent()
      expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
      await section.locator("[data-e2e=invitation-done]").click()
      await expect(page).toHaveURL(`/groups/${groupId}/members`)
      await expect(page.locator("[data-e2e=group-section-invitations] [data-e2e=invitation]"))
        .toHaveCount(1)
      const invitePath = new URL(link!).pathname

      const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      inviteePage = await context.newPage()
      await gotoApp(inviteePage, invitePath, inviteePage.locator("[data-e2e=auth-form-login]"))
      // Most invited people have no account yet: the link opens sign-up, which names the
      // invitation, and its "Sign in" link keeps it for those who have one.
      const nextQuery = new URLSearchParams({ next: invitePath })
      await expect(inviteePage).toHaveURL(`/sign-up?${nextQuery}`)
      await expect(inviteePage.locator("h1")).toHaveText("You're invited to a group")
      await inviteePage.getByRole("link", { name: "Sign in", exact: true }).click()
      await expect(inviteePage).toHaveURL(`/sign-in?${nextQuery}`)
      await expect(inviteePage.locator("h1")).toHaveText("You're invited to a group")
      await inviteePage.locator("[data-e2e=auth-form-login]").fill(invitee)
      await inviteePage.locator("[data-e2e=auth-form-password]").fill(password)
      const card = inviteePage.locator("[data-e2e=invitation-card]")
      await gotoApp(inviteePage, invitePath, card, async () => {
        await inviteePage!.locator("[data-e2e=auth-form-submit]").click()
        await inviteePage!.waitForURL(invitePath)
      })
      await expect(card.locator("[data-e2e=invitation-group]")).toHaveText("Team")
      await expect(card).toContainText("Editor")

      await card.locator("[data-e2e=invitation-accept]").click()
      await expect(inviteePage).toHaveURL("/notes")
      // The page changed without a load: focus is on the new page's heading, not on a button
      // that is gone.
      await expect(inviteePage.locator("main h1")).toBeFocused()
      await gotoApp(inviteePage, `/groups/${groupId}`, settingsReady(inviteePage))
      await expect(inviteePage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")

      await gotoApp(page, `/groups/${groupId}/members`, settingsReady(page))
      await expect(page.locator("[data-e2e=group-member]")).toHaveCount(3)
      await expect(page.locator("[data-e2e=invitation]")).toContainText("used 1 of 2")
    } finally {
      await inviteePage?.context().close()
      for (const email of [owner, admin, invitee]) await cleanup(request, email, { soft: true })
    }
  })

  test("declining keeps focus on the page: the next invitation, then New group, then the groups page's heading", async ({ page, request }) => {
    const id = uuidV7().slice(-8)
    const owner = `e2e-decline-owner-${id}@example.com`
    const guest = `e2e-decline-guest-${id}@example.com`
    for (const email of [owner, guest]) await cleanup(request, email)
    try {
      // The owner invites the guest's address to two groups, and makes a link to a third.
      await signUp(request, owner)
      const tokens: string[] = []
      for (const [name, email] of [["Team", guest], ["Family", guest], ["Club", null]]) {
        const groupId = uuidV7()
        const created = await request.post(`${apiBase}/api/groups`, {
          headers,
          data: { id: groupId, name },
        })
        expect(created.status(), await created.text()).toBe(201)
        const invited = await request.post(`${apiBase}/api/groups/${groupId}/invitations`, {
          headers,
          data: { role: 1, expiresInDays: 7, maxUses: 1, email, sendEmail: false },
        })
        expect(invited.status(), await invited.text()).toBe(201)
        tokens.push(((await invited.json()) as { token: string }).token)
      }

      // Invitations are listed for a proved address only; sign-up's code proved the guest's.
      await signUp(request, guest)

      await signIn(page, guest, password)
      const mine = page.locator("[data-e2e=my-invitations]")
      await gotoApp(page, "/groups", mine)
      await expect(mine.locator("[data-e2e=invitation-card]")).toHaveCount(2)
      const first = await mine.locator("[data-e2e=invitation-group]").first().textContent()
      const second = await mine.locator("[data-e2e=invitation-group]").nth(1).textContent()

      await page.getByRole("button", { name: `Decline the invitation to ${first}` }).click()
      await expect(mine.locator("[data-e2e=invitation-card]")).toHaveCount(1)
      await expect(page.getByRole("button", { name: `Decline the invitation to ${second}` }))
        .toBeFocused()

      await page.getByRole("button", { name: `Decline the invitation to ${second}` }).click()
      await expect(mine).toHaveCount(0)
      await expect(page.locator("[data-e2e=group-new]")).toBeFocused()

      const card = page.locator("[data-e2e=invitation-card]")
      await gotoApp(page, `/invite/${tokens[2]}`, card)
      await card.locator("[data-e2e=invitation-decline]").click()
      await expect(page).toHaveURL("/groups")
      await expect(page.locator("main h1")).toBeFocused()
    } finally {
      for (const email of [owner, guest]) await cleanup(request, email, { soft: true })
    }
  })
})
