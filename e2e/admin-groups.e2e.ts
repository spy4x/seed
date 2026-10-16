import type { APIRequestContext, BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The admin app's groups module (#426): an operator finds a group by its name, sees its members,
 * its invitations and its activity, removes a member and revokes an invitation, and the group's
 * activity says an operator did both. The person page links to the group.
 */

// In double quotes: `deno task e2e:local` adds its ports to these two strings only in that form.
const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": `same-origin` }
const password = `Passw0rd!`
const OPERATOR = 2
const EDITOR = 2

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Creates `email`'s account over the API; the request stays signed in as them. */
async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function signOut(request: APIRequestContext) {
  const response = await request.post(`${appBase}/api/auth/sign-out`, { headers })
  expect(response.ok(), await response.text()).toBe(true)
}

test.describe(`the admin app's groups`, () => {
  test(`an operator finds a group, removes a member and revokes an invitation, both on its activity`, async ({ browser, request }) => {
    const id = uuidV7().slice(-8)
    const ownerEmail = `e2e-admin-groups-owner-${id}@example.com`
    const memberEmail = `e2e-admin-groups-member-${id}@example.com`
    const operatorEmail = `e2e-admin-groups-ops-${id}@example.com`
    const groupName = `Admin team ${id}`
    let admin: BrowserContext | null = null
    try {
      // The owner makes a group with an invitation link; a second person joins it as an editor.
      await signUp(request, ownerEmail)
      const groupId = uuidV7()
      const created = await request.post(`${appBase}/api/groups`, {
        headers,
        data: { id: groupId, name: groupName },
      })
      expect(created.status(), await created.text()).toBe(201)
      const invited = await request.post(`${appBase}/api/groups/${groupId}/invitations`, {
        headers,
        data: { role: 1, expiresInDays: 7, maxUses: 1, email: null, sendEmail: false },
      })
      expect(invited.status(), await invited.text()).toBe(201)
      await signOut(request)
      await signUp(request, memberEmail)
      await signOut(request)
      const added = await request.post(`${appBase}/api/test/add-member`, {
        data: { login: memberEmail, groupId, role: EDITOR },
      })
      expect(added.status(), await added.text()).toBe(200)
      await signUp(request, operatorEmail)
      await signOut(request)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: operatorEmail, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator(`[data-e2e=auth-form-login]`).fill(operatorEmail)
      await ops.locator(`[data-e2e=auth-form-password]`).fill(password)
      await ops.locator(`[data-e2e=auth-form-submit]`).click()
      await expect(ops.locator(`[data-e2e=admin-dashboard-title]`)).toBeVisible()

      // The sidebar opens the groups; the search finds the group by its name.
      await ops.getByRole(`navigation`, { name: `Admin sections` })
        .getByRole(`link`, { name: `Groups` }).click()
      await expect(ops).toHaveURL(`${adminBase}/groups`)
      await expect(ops.locator(`[data-e2e=admin-groups-title]`)).toBeVisible()
      await ops.locator(`[data-e2e=admin-groups-search]`).fill(groupName)
      await ops.locator(`[data-e2e=admin-groups-submit]`).click()
      await expect(ops.locator(`[data-e2e=admin-groups-count]`)).toHaveText(`1 group`)
      const row = ops.locator(`[data-e2e=admin-groups-list] tbody tr`)
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(ownerEmail)

      // At 1280px every column fits without scrolling, the table is as tall as its one row, and
      // the owner's long address stays on one line with the full address in its tooltip.
      const box = ops.locator(`[data-e2e=admin-groups-list] table`).locator(`..`)
      const fit = await box.evaluate((element) => ({
        scrolls: element.scrollWidth > element.clientWidth,
        spare: element.clientHeight - element.querySelector(`table`)!.offsetHeight,
      }))
      expect(fit.scrolls).toBe(false)
      expect(fit.spare).toBeLessThan(8)
      const owner = row.locator(`[data-e2e=admin-groups-owner]`)
      await expect(owner).toHaveAttribute(`title`, ownerEmail)
      expect((await owner.boundingBox())!.height).toBeLessThan(30)

      // On a phone only the group and its member count stay, and they fit. The group's cell names
      // the owner instead, with the whole address as text: a touch screen opens no tooltip.
      const columns = ops.locator(`[data-e2e=admin-groups-list] th:visible`)
      await ops.setViewportSize({ width: 390, height: 844 })
      await expect(columns).toHaveText([/Group/, /Members/])
      await expect(row.locator(`[data-e2e=admin-groups-owner-phone]`)).toBeVisible()
      await expect(row.locator(`[data-e2e=admin-groups-owner-phone]`)).toContainText(ownerEmail)
      expect(await box.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
      // Between the two, the plan, the note count and the creation date go, and nothing scrolls.
      await ops.setViewportSize({ width: 1024, height: 768 })
      await expect(columns).toHaveText([/Group/, `Owner`, /Members/, /Last activity/])
      expect(await box.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false)
      await ops.setViewportSize({ width: 1280, height: 720 })
      await expect(columns).toHaveCount(7)
      await ops.locator(`[data-e2e=admin-group-${groupId}]`).click()

      // The group's page: the header card and its members with their roles.
      await expect(ops).toHaveURL(`${adminBase}/groups/${groupId}`)
      await expect(ops.locator(`[data-e2e=admin-group-title]`)).toHaveText(groupName)
      await expect(ops.locator(`[data-e2e=admin-group-owner]`)).toHaveText(ownerEmail)
      const members = ops.locator(`[data-e2e=admin-group-members] > li`)
      await expect(members).toHaveCount(2)
      const member = members.filter({ hasText: memberEmail })
      await expect(member).toContainText(`Editor`)
      await expect(members.filter({ hasText: ownerEmail })).toContainText(`Owner`)

      // Removes the member: the dialog only confirms, it asks for no password.
      await member.locator(`[data-e2e=admin-group-member-menu]`).click()
      await ops.locator(`[data-e2e=admin-group-remove-open]`).click()
      await expect(ops.locator(`[data-e2e=admin-group-dialog] input`)).toHaveCount(0)
      await ops.locator(`[data-e2e=admin-group-action-submit]`).click()
      await expect(ops.locator(`[data-e2e=toasts]`)).toContainText(`is no longer in ${groupName}`)
      await expect(members).toHaveCount(1)

      // Revokes the invitation link from its tab.
      await ops.getByRole(`tab`, { name: /Invitations/ }).click()
      await expect(ops).toHaveURL(/\?tab=invitations$/)
      const state = ops.locator(`[data-e2e=admin-group-invitation-state]`)
      await expect(state).toHaveText(`Pending`)
      await ops.locator(`[data-e2e=admin-group-invitation-menu]`).click()
      await ops.locator(`[data-e2e=admin-group-revoke-open]`).click()
      await ops.locator(`[data-e2e=admin-group-action-submit]`).click()
      await expect(ops.locator(`[data-e2e=toasts]`)).toContainText(`invitation`)
      await expect(state).toHaveText(`Revoked`)

      // The activity names both, as done from the admin area.
      await ops.getByRole(`tab`, { name: `Activity` }).click()
      const activity = ops.locator(`[data-e2e=admin-group-activity]`)
      await expect(activity.locator(`[data-e2e=admin-group-event-group\\.member_removed]`))
        .toContainText(`By an operator`)
      await expect(activity.locator(`[data-e2e=admin-group-event-group\\.invitation_revoked]`))
        .toContainText(`By an operator`)

      // The owner's page in the admin app links back to the group.
      await ops.locator(`[data-e2e=admin-group-owner]`).click()
      await ops.getByRole(`tab`, { name: /Groups/ }).click()
      await ops.locator(`[data-e2e=admin-user-group-${groupId}]`).click()
      await expect(ops).toHaveURL(`${adminBase}/groups/${groupId}`)
    } finally {
      await admin?.close()
      for (const email of [memberEmail, operatorEmail, ownerEmail]) await cleanup(request, email)
    }
  })
})
