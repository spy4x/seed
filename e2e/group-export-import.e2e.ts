import { type APIRequestContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { openGroups, openNotes } from "./fixtures/groups.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, { soft = false } = {}) {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

test.describe("exporting and importing a group", () => {
  test("the owner exports a group to a file and imports it as a new group with the same notes", async ({ page, request }) => {
    const email = `e2e-group-file-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      await signIn(page, email, password)

      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Family" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const titles = ["Groceries", "Holiday plan", "School run"]
      for (const title of titles) {
        const note = await page.request.post(`${apiBase}/api/groups/${groupId}/notes`, {
          headers,
          data: { id: uuidV7(), title, body: "" },
        })
        expect(note.status(), await note.text()).toBe(201)
      }

      await gotoApp(page, `/groups/${groupId}`, page.locator("[data-e2e=group-general-name]"))
      await page.locator("[data-e2e=group-menu]").click()
      const downloading = page.waitForEvent("download")
      await page.getByRole("menuitem", { name: "Export group…" }).click()
      const download = await downloading
      expect(download.suggestedFilename()).toMatch(/^family-\d{4}-\d{2}-\d{2}\.json$/)
      const file = test.info().outputPath("family.json")
      await download.saveAs(file)

      await openGroups(page)
      await page.locator("[data-e2e=groups-menu]").click()
      await page.getByRole("menuitem", { name: "Import a group…" }).click()
      await expect(page).toHaveURL("/groups/import")
      await page.locator("input[type=file]").setInputFiles(file)
      await expect(page.locator("[data-e2e=group-import-heading]")).toHaveText(
        "Contains: 3 notes, 0 tags, settings.",
      )
      await expect(page.locator("[data-e2e=group-import-name]")).toHaveValue("Family")
      await page.locator("[data-e2e=group-import-name]").fill("Family copy")
      await page.locator("[data-e2e=group-import-submit]").click()

      await expect(page.locator("[data-e2e=group-imported]")).toContainText(
        `Imported 3 notes and 0 tags into "Family copy".`,
      )
      await expect(page).toHaveURL(/\/groups\/[0-9a-f-]{36}$/)
      await expect(page.locator("[data-e2e=group-general-name]")).toHaveText("Family copy")

      await openNotes(page, "Family copy")
      await expect(page.locator("[data-e2e=note-item-title]")).toHaveCount(3, { timeout: 5_000 })
      expect((await page.locator("[data-e2e=note-item-title]").allTextContents()).sort())
        .toEqual(titles)
      // The original is still there, with its notes.
      await openNotes(page, "Family")
      await expect(page.locator("[data-e2e=note-item-title]")).toHaveCount(3)
    } finally {
      await cleanup(request, email, { soft: true })
    }
  })
})
