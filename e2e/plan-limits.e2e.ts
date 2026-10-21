import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { BILLING_WEBHOOK_PATH, proWebhook } from "./fixtures/billing.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const FREE_NOTES = 10
const EDITOR = 2

async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function upgrade(request: APIRequestContext, groupId: string): Promise<void> {
  const delivered = await request.post(
    `${apiBase}${BILLING_WEBHOOK_PATH}`,
    await proWebhook(groupId),
  )
  expect(delivered.status(), await delivered.text()).toBe(200)
}

async function addNote(page: Page, groupId: string, title: string): Promise<number> {
  const response = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: uuidV7(), title, body: "" },
  })
  return response.status()
}

test.describe("plan limits", () => {
  test("the owner of a free group at its note cap is offered an upgrade, and the note is not added", async ({ page, request }) => {
    const owner = "e2e_plan_notes_owner@example.com"
    await cleanup(request, owner)
    try {
      await signUp(request, owner)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const { groupId } = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      // The worker adds a welcome note (#165) that counts against the cap. Wait for it, so the
      // person's own notes fill the rest of the free plan and the cap is hit at the same count.
      await expect.poll(async () => {
        const listed = await page.request.get(`${apiBase}/api/groups/${groupId}/notes?limit=100`)
        return (await listed.json()).notes.map((note: { title: string }) => note.title)
      }, { message: "the worker makes the welcome note", timeout: 15_000 }).toEqual(["Welcome"])
      for (let index = 1; index < FREE_NOTES; index++) {
        expect(await addNote(page, groupId, `Note ${index}`)).toBe(201)
      }

      const title = page.locator("[data-e2e=note-title]")
      await gotoApp(page, "/notes/new", title)
      await title.fill("One too many")
      await page.locator("[data-e2e=note-save]").click()

      const refusal = page.locator("[data-e2e=plan-refusal]")
      await expect(refusal).toBeFocused()
      await expect(refusal).toContainText(`up to ${FREE_NOTES} notes`)
      await expect(title).toHaveValue("One too many")
      const listed = await page.request.get(`${apiBase}/api/groups/${groupId}/notes?limit=100`)
      expect((await listed.json()).notes).toHaveLength(FREE_NOTES)

      // Following it would leave the typed draft, so the unsaved-text guard would ask first.
      await expect(refusal.getByRole("link", { name: "Open Plan and billing" }))
        .toHaveAttribute("href", `/groups/${groupId}/billing`)

      await upgrade(request, groupId)
      expect(await addNote(page, groupId, "On Pro")).toBe(201)
    } finally {
      await cleanup(request, owner, { soft: true })
    }
  })

  test("a free group's owner who promotes a member is offered an upgrade, and the promotion works on Pro", async ({ page, request }) => {
    const owner = "e2e_plan_roles_owner@example.com"
    const member = "e2e_plan_roles_member@example.com"
    await cleanup(request, owner)
    await cleanup(request, member)
    try {
      await signUp(request, owner)
      await signUp(request, member)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: EDITOR },
      })
      expect(added.status(), await added.text()).toBe(200)

      await gotoApp(
        page,
        `/groups/${groupId}/members`,
        page.locator("[data-e2e=group-general-name]"),
      )
      const row = page.locator("[data-e2e=group-member]").filter({ hasText: member })
      await row.getByRole("button", { name: `Actions for ${member}` }).click()
      await page.getByRole("menuitem", { name: "Make Admin" }).click()

      const refusal = row.locator("[data-e2e=plan-refusal]")
      await expect(refusal).toBeFocused()
      await expect(refusal.getByRole("link", { name: "Open Plan and billing" }))
        .toHaveAttribute("href", `/groups/${groupId}/billing`)
      await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Editor")

      await upgrade(request, groupId)
      await row.getByRole("button", { name: `Actions for ${member}` }).click()
      await page.getByRole("menuitem", { name: "Make Admin" }).click()
      await expect(row.locator("[data-e2e=group-member-role]")).toHaveText("Admin")
      await expect(refusal).toHaveCount(0)
    } finally {
      await cleanup(request, owner, { soft: true })
      await cleanup(request, member, { soft: true })
    }
  })
})
