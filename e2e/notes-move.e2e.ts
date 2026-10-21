import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { openNotes } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

const VIEWER = 1

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string): Promise<void> {
  const response = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
}

async function signInOnline(page: Page, email: string): Promise<void> {
  await signIn(page, email, password)
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

test.describe("moving notes to another group", () => {
  test("moves notes from a note's page, a row's menu and a selection, deletes one from its row, and members of both groups see it live", async ({ browser, request }) => {
    const owner = "e2e_notes_move_owner@example.com"
    const inSource = "e2e_notes_move_source@example.com"
    const inTarget = "e2e_notes_move_target@example.com"
    const baseURL = test.info().project.use.baseURL
    const emails = [owner, inSource, inTarget]
    for (const email of emails) await cleanup(request, email)
    const contexts = await Promise.all(emails.map(() => browser.newContext({ baseURL })))
    try {
      for (const email of emails) await signUp(request, email)
      const [ownerPage, sourcePage, targetPage] = await Promise.all(
        contexts.map((context) => context.newPage()),
      )
      const framesSent: string[] = []
      ownerPage.on("websocket", (socket) => {
        socket.on("framesent", (frame) => framesSent.push(String(frame.payload)))
      })
      await signInOnline(ownerPage, owner)

      const groups = { Source: uuidV7(), Target: uuidV7() }
      for (const [name, id] of Object.entries(groups)) {
        const created = await ownerPage.request.post(`${apiBase}/api/groups`, {
          headers,
          data: { id, name },
        })
        expect(created.status(), await created.text()).toBe(201)
      }
      for (const [member, groupId] of [[inSource, groups.Source], [inTarget, groups.Target]]) {
        const added = await request.post(`${apiBase}/api/test/add-member`, {
          data: { login: member, groupId, role: VIEWER },
        })
        expect(added.status(), await added.text()).toBe(200)
      }
      for (const title of ["One", "Two", "Three", "Four"]) {
        const created = await ownerPage.request.post(
          `${apiBase}/api/groups/${groups.Source}/notes`,
          { headers, data: { id: uuidV7(), title, body: "" } },
        )
        expect(created.status(), await created.text()).toBe(201)
      }

      await signInOnline(sourcePage, inSource)
      await openNotes(sourcePage, "Source")
      await signInOnline(targetPage, inTarget)
      await openNotes(targetPage, "Target")
      const sourceTitles = sourcePage.locator("[data-e2e=note-item-title]")
      const targetTitles = targetPage.locator("[data-e2e=note-item-title]")
      await expect(sourceTitles).toHaveCount(4)
      await expect(targetPage.getByText("No notes yet")).toBeVisible()

      await openNotes(ownerPage, "Source")
      const ownerTitles = ownerPage.locator("[data-e2e=note-item-title]")

      // One note, from its own page's menu: the person lands on the list, which no longer has it.
      await ownerPage.getByRole("link", { name: "One", exact: true }).click()
      await ownerPage.locator("[data-e2e=note-menu]").click()
      await ownerPage.getByRole("menuitem", { name: "Move to group…" }).click()
      await ownerPage.locator("[data-e2e=note-move-dialog]").getByRole("button", { name: "Target" })
        .click()
      await expect(ownerPage).toHaveURL("/notes")
      await expect(ownerPage.locator("[data-e2e=note-moved]")).toContainText("moved to Target")
      await expect(ownerTitles).toHaveCount(3)
      await expect(ownerPage.getByRole("link", { name: "One", exact: true })).toHaveCount(0)
      await expect(sourceTitles).toHaveCount(3, { timeout: 5_000 })
      await expect(targetTitles).toHaveText(["One"], { timeout: 5_000 })

      // The move went over the socket, as one command with an idempotency key.
      const single = framesSent.map((payload) => JSON.parse(payload)).find(
        (frame) => frame.kind === "client.command" && frame.name === "note.move",
      )
      expect(single?.idempotencyKey).toBeTruthy()
      expect(single?.payload.noteIds).toHaveLength(1)

      // One note, from its row's menu on the list.
      await ownerPage.getByRole("button", { name: "Actions for Two" }).click()
      await ownerPage.getByRole("menuitem", { name: "Move to group…" }).click()
      await ownerPage.locator("[data-e2e=note-move-dialog]").getByRole("button", { name: "Target" })
        .click()
      await expect(ownerTitles).toHaveCount(2)
      await expect(targetTitles).toHaveCount(2, { timeout: 5_000 })

      // Ticked notes, from the list: tick boxes appear only once the person asks to select.
      await expect(ownerPage.locator("[data-e2e=note-select]")).toHaveCount(0)
      await ownerPage.getByRole("button", { name: "More actions" }).click()
      await ownerPage.getByRole("menuitem", { name: "Select notes" }).click()
      // Nothing ticked yet: a hint, and no way to move nothing.
      await expect(ownerPage.getByText("Tick the notes to move")).toBeVisible()
      await expect(ownerPage.locator("[data-e2e=notes-move-submit]")).toHaveCount(0)
      await ownerPage.getByLabel("Tick Three").check()
      await ownerPage.getByLabel("Tick Four").check()
      await expect(ownerPage.getByText("2 selected")).toBeVisible()
      await ownerPage.locator("[data-e2e=notes-move-to]").selectOption({ label: "Target" })
      await ownerPage.locator("[data-e2e=notes-move-submit]").click()
      await expect(ownerPage.getByText("No notes yet")).toBeVisible()
      await expect(targetTitles).toHaveCount(4, { timeout: 5_000 })
      await expect(sourcePage.getByText("No notes yet")).toBeVisible({ timeout: 5_000 })

      // Delete from a row's menu goes at once, with Undo in a toast; the members see it go.
      await openNotes(ownerPage, "Target")
      await expect(ownerTitles).toHaveCount(4)
      await ownerPage.getByRole("button", { name: "Actions for One" }).click()
      await ownerPage.getByRole("menuitem", { name: "Delete" }).click()
      await expect(ownerPage.locator("[data-e2e=note-undo-toast]")).toBeVisible()
      await expect(ownerTitles).toHaveCount(3)
      await expect(ownerPage.getByRole("link", { name: "One", exact: true })).toHaveCount(0)
      await expect(targetTitles).toHaveCount(3, { timeout: 5_000 })
    } finally {
      for (const context of contexts) await context.close()
      for (const email of emails) await cleanup(request, email)
    }
  })
})
