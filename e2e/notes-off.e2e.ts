import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { apiNotesOff, gotoApp, spaNotesOff } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpInPage } from "./fixtures/sign-up.ts"

/**
 * The product with the notes example off (`NOTES=false`, `SPA_NOTES=false`, docs/start-a-product.md):
 * no Notes in the rail, the page or the palette, and `/notes` is an unknown address, signed in or
 * out. It runs only on a stack started that way; on any other it skips with the command that runs
 * it, since the notes are on there.
 */

const appBase = "http://app.localhost"
const password = "Passw0rd!"

/** A link to the notes or the tags, anywhere on the page. */
const NOTES_LINK = `a[href^="/notes"], a[href^="/tags"], a[href*="/notes/"]`
/** The palette's rows of the notes example: found notes, the Go to entries and the Create commands. */
const NOTES_ROW = /^(Notes|Tags|New note|New tag)\b/

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** The palette's options and the headings of its groups (`role="presentation"`), as listed. */
async function paletteRows(page: Page): Promise<string[]> {
  const list = page.locator(`[data-e2e=search] [role=listbox]`)
  const rows = list.locator(`[role=option], [role=group] [role=presentation]`)
  return (await rows.allInnerTexts()).map((text) => text.trim())
}

test.describe("the notes switched off", () => {
  test.skip(
    !apiNotesOff() || !spaNotesOff(),
    `runs on a notes-off stack only: NOTES=false SPA_NOTES=false deno task e2e:local e2e/notes-off.e2e.ts`,
  )

  test("a signed-out visit to /notes shows the not-found page, not sign-in", async ({ page }) => {
    const card = page.locator(`[data-e2e=not-found]`)
    await gotoApp(page, `${appBase}/notes`, card)
    await expect(card.getByRole(`heading`, { level: 1 })).toHaveText(`Page not found`)
    await expect(page).toHaveURL(`${appBase}/notes`)
    await expect(page.locator(`[data-e2e=auth-form-login]`)).toHaveCount(0)
  })

  test("a new person lands on the overview, and neither the rail, /, /notes nor the palette offers notes", async ({ page, request }) => {
    test.setTimeout(120_000)
    const email = `e2e-notes-off-${uuidV7().slice(-8)}@example.com`
    try {
      const shell = page.locator(`[data-e2e=shell-ws-status]`)
      await signUpInPage(page, email, password, shell)
      await expect(page).toHaveURL(/\/overview(\/[0-9a-f-]{36})?$/)

      const rail = page.locator(`[data-e2e=rail-shell-rail]`)
      await expect(rail.locator(`a[href^="/overview"]`)).toBeVisible()
      await expect(rail.locator(`a[href="/groups"]`)).toBeVisible()
      await expect(rail.locator(NOTES_LINK)).toHaveCount(0)

      // The API mounts no note route, so the stack really runs with NOTES=false.
      const selected = await page.request.get(`${appBase}/api/groups/selected`)
      const { groupId } = await selected.json()
      const notes = await page.request.get(`${appBase}/api/groups/${groupId}/notes`)
      expect(notes.status()).toBe(404)

      await gotoApp(page, `${appBase}/`, shell)
      await expect(page).toHaveURL(/\/overview(\/[0-9a-f-]{36})?$/)
      await expect(page.getByRole(`heading`, { level: 1, name: `Overview` })).toBeVisible()
      await expect(page.locator(NOTES_LINK)).toHaveCount(0)
      await expect(page.locator(`[data-e2e=new-note-dialog]`)).toHaveCount(0)
      await expect(page.locator(`[data-e2e=overview-new-note]`)).toHaveCount(0)
      await expect(page.locator(`[data-e2e^="overview-widget-notes."]`)).toHaveCount(0)

      const card = page.locator(`[data-e2e=not-found]`)
      await gotoApp(page, `${appBase}/notes`, card)
      await expect(card.getByRole(`heading`, { level: 1 })).toHaveText(`Page not found`)
      await expect(page).toHaveURL(`${appBase}/notes`)

      await gotoApp(page, `${appBase}/groups`, shell)
      const field = page.locator(`[data-e2e=search]`).getByRole(`combobox`)
      await page.keyboard.press(`Control+k`)
      await expect(field).toBeFocused()
      // Theme matches neither query, so its row going away shows the list followed the query.
      const theme = page.locator(`[data-e2e=search]`).getByRole(`option`, {
        name: `Theme`,
        exact: true,
      })
      await expect(theme).toBeVisible()
      const listed = await paletteRows(page)
      for (const query of [`note`, `tag`]) {
        await field.fill(``)
        await expect(theme).toBeVisible()
        await field.fill(query)
        await expect(theme).toHaveCount(0)
        listed.push(...await paletteRows(page))
      }
      expect(listed.filter((row) => NOTES_ROW.test(row))).toEqual([])
    } finally {
      await cleanup(request, email)
    }
  })
})
