import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

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

/** A group of the signed-in person with one note in it. */
async function groupWithNote(page: Page, name: string, title: string, body: string) {
  const groupId = uuidV7()
  const noteId = uuidV7()
  const group = await page.request.post(`${apiBase}/api/groups`, {
    headers,
    data: { id: groupId, name },
  })
  expect(group.status(), await group.text()).toBe(201)
  const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title, body },
  })
  expect(note.status(), await note.text()).toBe(201)
  return { groupId, noteId }
}

/** Opens `groupId`'s notes online; the page saves them on the device as it lists them. */
async function openNotes(page: Page, groupId: string, title: string): Promise<void> {
  const selected = await page.request.put(`${apiBase}/api/groups/selected`, {
    headers,
    data: { groupId },
  })
  expect(selected.ok(), await selected.text()).toBe(true)
  await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
  await expect(page.locator("[data-e2e=note-item-title]").filter({ hasText: title })).toHaveCount(1)
}

const palette = (page: Page) => page.locator("[data-e2e=search]")
const field = (page: Page) => palette(page).getByRole("combobox")
const result = (page: Page, label: string) =>
  palette(page).getByRole("option").filter({ hasText: label })

/** What a page check reads back after the search closes. */
type Probe = { focusAfterClose?: Promise<string> }

test.describe("search", () => {
  test("Ctrl+K and the rail's Search open the one search, Escape leaves no focus in it, and picking a note of another group opens it in that group with focus on its title", async ({ browser, request }) => {
    const user = "e2e_search_online@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user, password)
      const roadmap = await groupWithNote(
        page,
        "Product team",
        "Quarterly roadmap",
        "Kickoff with the design team",
      )
      const garden = await groupWithNote(
        page,
        "Side project",
        "Garden notes",
        "Tomatoes by the fence",
      )
      await openNotes(page, roadmap.groupId, "Quarterly roadmap")

      // Closed with Escape, it leaves no focus in the closed dialog: with nothing focused before,
      // focus is on the page's body once the close is handled, and otherwise it goes back where
      // it was. Focus is read in the task after the dialog's close event, where the palette moves
      // it; until then Chromium still reports the hidden field, or its own guess.
      const openThenEscape = async (): Promise<string> => {
        await page.keyboard.press("Control+k")
        await expect(field(page)).toBeFocused()
        await page.evaluate(() => {
          ;(window as Probe).focusAfterClose = new Promise((resolve) =>
            document.addEventListener(
              "close",
              () =>
                setTimeout(() => {
                  const focused = document.activeElement
                  resolve(focused?.getAttribute("data-e2e") ?? focused?.tagName ?? "none")
                }),
              { capture: true, once: true },
            )
          )
        })
        await page.keyboard.press("Escape")
        await expect(palette(page)).toBeHidden()
        return await page.evaluate(() => (window as Probe).focusAfterClose!)
      }
      await expect(page.locator("body")).toBeFocused()
      expect(await openThenEscape()).toBe("BODY")
      await page.locator("[data-e2e=group-picker]").focus()
      expect(await openThenEscape()).toBe("group-picker")

      // The rail's cell opens it, and closing gives focus back to the cell.
      const railSearch = page.locator("[data-e2e=shell-search-rail] button")
      await railSearch.click()
      await expect(field(page)).toBeFocused()
      await expect(page.locator("dialog[open]")).toHaveCount(1)
      await page.keyboard.press("Escape")
      await expect(palette(page)).toBeHidden()
      await expect(railSearch).toBeFocused()

      await page.keyboard.press("Control+k")
      await expect(page.locator("dialog[open]")).toHaveCount(1)
      await expect(field(page)).toBeFocused()
      await field(page).fill("tomato")
      await expect(result(page, "Garden notes")).toContainText("Side project")
      await expect(palette(page).getByRole("group").first()).toContainText("Notes")
      await page.keyboard.press("Enter")

      await expect(page).toHaveURL(new RegExp(`/notes/${garden.noteId}$`))
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Garden notes")
      // Focus lands on the note's heading, not on the page body or back where the search began.
      await expect(page.getByRole("heading", { level: 1, name: "Garden notes" })).toBeFocused()
      await expect(page.locator("[data-e2e=group-picker]")).toHaveAccessibleName(/Side project/)
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })

  test("on a phone, Search in the Account sheet and Ctrl+K open the search, focus goes back to Account, and a found note opens with focus on its title", async ({ browser, request }) => {
    const user = "e2e_search_phone@example.com"
    await cleanup(request, user)
    const context = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      viewport: { width: 390, height: 844 },
    })
    try {
      await signUp(request, user)
      const page = await context.newPage()
      await signIn(page, user, password)
      const garden = await groupWithNote(
        page,
        "Side project",
        "Garden notes",
        "Tomatoes by the fence",
      )
      await openNotes(page, garden.groupId, "Garden notes")
      const account = page.locator("[data-e2e=rail-shell-more]")
      const sheet = page.locator("dialog[data-e2e=rail-shell-dialog]")
      const phonePalette = page.locator("dialog[data-e2e=search]")
      const phoneField = phonePalette.getByRole("combobox")
      const chooseSearch = async () => {
        await account.click()
        await sheet.locator("[data-e2e=shell-search-sheet] button").click()
        await expect(sheet).toBeHidden()
        await expect(phoneField).toBeFocused()
      }

      await chooseSearch()
      await page.keyboard.press("Escape")
      await expect(phonePalette).toBeHidden()
      await expect(account).toBeFocused()

      // A phone with a keyboard, or a narrow window, has the hotkey too: one dialog opens.
      await page.keyboard.press("Control+k")
      await expect(phoneField).toBeFocused()
      await expect(page.locator("dialog[open]")).toHaveCount(1)
      await page.keyboard.press("Escape")
      await expect(phonePalette).toBeHidden()

      await chooseSearch()
      await phoneField.fill("tomato")
      await phonePalette.getByRole("option").filter({ hasText: "Garden notes" }).click()
      await expect(page).toHaveURL(new RegExp(`/notes/${garden.noteId}$`))
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Garden notes")
      await expect(page.getByRole("heading", { level: 1, name: "Garden notes" })).toBeFocused()
    } finally {
      await context.close()
      await cleanup(request, user)
    }
  })
})
