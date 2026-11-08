import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { BILLING_WEBHOOK_PATH, proWebhook } from "./fixtures/billing.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { BILLING_LANDING, freePlanAllowsNothing, signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const EDITOR = 2

async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** Signs `email` up and keeps its group on the free plan, which this spec is about. */
async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  }, { keepFree: true })
  expect(response.ok(), await response.text()).toBe(true)
}

async function upgrade(request: APIRequestContext, groupId: string): Promise<void> {
  const delivered = await request.post(
    `${apiBase}${BILLING_WEBHOOK_PATH}`,
    await proWebhook(groupId),
  )
  expect(delivered.status(), await delivered.text()).toBe(200)
}

async function addNote(page: Page, groupId: string, title: string): Promise<NoteAdded> {
  const response = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: uuidV7(), title, body: "" },
  })
  return { status: response.status(), body: await response.json() }
}

interface NoteAdded {
  status: number
  body: { error?: { details?: { entitlement?: string; limit?: number } } }
}

/**
 * Adds notes until the group's plan refuses one, and answers the note cap the refusal names. The
 * cap is the catalog's, so a product that changes its free plan keeps this spec. The worker's
 * welcome note may land at any point: it counts against the same cap, and past the cap it is
 * refused too.
 */
async function fillToNoteCap(page: Page, groupId: string): Promise<number> {
  for (let index = 1; index <= 1000; index++) {
    const added = await addNote(page, groupId, `Note ${index}`)
    if (added.status === 201) continue
    expect(added.body.error?.details?.entitlement, JSON.stringify(added.body)).toBe("maxNotes")
    return added.body.error!.details!.limit!
  }
  throw new Error("the free plan took 1000 notes without a cap")
}

test.describe("plan limits", () => {
  test("a new owner lands on the Billing tab and can add no note when the free plan allows nothing, and on the notes otherwise", async ({ page, request }) => {
    const owner = "e2e_plan_landing_owner@example.com"
    await cleanup(request, owner)
    try {
      await signUp(request, owner)
      await signIn(page, owner, password)
      const { groupId } = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      if (await freePlanAllowsNothing(request, apiBase)) {
        await expect(page).toHaveURL(BILLING_LANDING)
        expect(page.url()).toContain(groupId)
        const added = await addNote(page, groupId, "Before paying")
        expect(added.status, JSON.stringify(added.body)).toBe(402)
        expect(added.body.error?.details).toMatchObject({ entitlement: "maxNotes", limit: 0 })
      } else {
        await expect(page).toHaveURL(/\/notes$/)
        expect((await addNote(page, groupId, "On Free")).status).toBe(201)
      }
    } finally {
      await cleanup(request, owner, { soft: true })
    }
  })

  test("the owner of a free group at its note cap is offered an upgrade, and the note is not added", async ({ page, request }) => {
    const owner = "e2e_plan_notes_owner@example.com"
    await cleanup(request, owner)
    try {
      await signUp(request, owner)
      await signIn(page, owner, password)
      await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
      const { groupId } = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      const freeNotes = await fillToNoteCap(page, groupId)

      const title = page.locator("[data-e2e=note-title]")
      await gotoApp(page, "/notes/new", title)
      await title.fill("One too many")
      await page.locator("[data-e2e=note-save]").click()

      const refusal = page.locator("[data-e2e=plan-refusal]")
      await expect(refusal).toBeFocused()
      await expect(refusal).toContainText(
        freeNotes > 0 ? `up to ${freeNotes} note` : "Choose a plan to start adding.",
      )
      await expect(title).toHaveValue("One too many")
      const listed = await page.request.get(`${apiBase}/api/groups/${groupId}/notes?limit=100`)
      expect((await listed.json()).notes).toHaveLength(freeNotes)

      // Following it would leave the typed draft, so the unsaved-text guard would ask first.
      await expect(refusal.getByRole("link", { name: "Open the Billing tab" }))
        .toHaveAttribute("href", `/groups/${groupId}/billing`)

      await upgrade(request, groupId)
      expect((await addNote(page, groupId, "On Pro")).status).toBe(201)
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
      await expect(refusal.getByRole("link", { name: "Open the Billing tab" }))
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
