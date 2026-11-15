import { Buffer } from "node:buffer"
import { type APIRequestContext, type BrowserContext } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { openNotes } from "./fixtures/groups.ts"
import { payForGroup, signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * Importing notes from a CSV: an editor uploads a file with one bad row, matches a column, sees the
 * problem by its spreadsheet line, imports the rest as one batch and undoes it. An operator then
 * finds the import in the admin app by its status and counts, without the file's content.
 */

const apiBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

// Two apps, a read job and a commit job: past the config's 60 s on a busy dev server.
test.describe.configure({ timeout: 120_000 })

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Line 1 names the columns; line 3 has no title. "Details" is no body name, so it is mapped by hand. */
const CSV = `Title,Details\nGroceries,milk and eggs\n,an orphan body\nHoliday plan,beach\n`

test.describe("importing notes from a file", () => {
  test("an editor imports a CSV with one bad row as one batch, undoes it, and an operator sees only its counts", async ({ page, browser, request }) => {
    const email = `e2e-import-${uuidV7().slice(-8)}@example.com`
    const groupName = `Import ${uuidV7().slice(-6)}`
    let admin: BrowserContext | null = null
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
        data: { id: groupId, name: groupName },
      })
      expect(created.status(), await created.text()).toBe(201)
      await payForGroup(page.request, apiBase, groupId)

      // The notes menu leads to the picker of the notes kind.
      await openNotes(page, groupName)
      await page.locator("[data-e2e=notes-menu]").click()
      await page.locator("[data-e2e=notes-import]").click()
      await expect(page).toHaveURL("/imports/new?kind=notes")
      await expect(page.getByRole("heading", { level: 1, name: "Import notes" })).toBeVisible()

      await page.locator("input[type=file]").setInputFiles({
        name: "plan.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(CSV),
      })
      await expect(page).toHaveURL(/\/imports\/[0-9a-f-]{36}$/)
      const importId = page.url().split("/").at(-1)!
      await expect(page.locator("[data-e2e=import-step]")).toHaveAttribute("data-status", "ready")

      // Matching the body column checks every row again, with no button to press.
      await expect(page.locator("#import-mapper-title")).toHaveValue("0")
      await page.locator("#import-mapper-body").selectOption("1")
      await expect(page.locator("[data-e2e=import-check]")).toHaveText(
        "2 of 3 rows can be imported.",
      )
      // Counted as a spreadsheet counts: the header is line 1, so the bad row is line 3.
      await expect(page.getByRole("button", { name: /Line 3/ })).toBeVisible()

      await page.locator("[data-e2e=import-submit]").click()
      await expect(page.locator("[data-e2e=import-step]")).toHaveAttribute(
        "data-status",
        "committed",
      )
      await expect(page.locator("[data-e2e=import-heading]")).toHaveText("2 notes imported")
      await expect(page.locator("[data-e2e=import-left-out]")).toBeVisible()

      await page.locator("[data-e2e=import-go]").click()
      const titles = page.locator("[data-e2e=note-item-title]")
      // Saved in one transaction, so their order in the list is not the test's to fix.
      await expect(titles).toHaveCount(2)
      expect((await titles.allInnerTexts()).toSorted()).toEqual(["Groceries", "Holiday plan"])

      // Undo, behind a confirmation; focus lands on the new heading once the dialog closes.
      await page.goBack()
      await page.locator("[data-e2e=import-undo]").click()
      const dialog = page.locator("[data-e2e=import-undo-dialog]")
      await dialog.getByRole("button", { name: "Delete 2 notes", exact: true }).click()
      const heading = page.locator("[data-e2e=import-heading]")
      await expect(heading).toHaveText("Import undone")
      await expect(heading).toBeFocused()

      // The batch left the live list for the deleted notes.
      await page.locator("[data-e2e=import-show-removed]").click()
      await expect(page.locator("[data-e2e=notes-deleted-banner]")).toBeVisible()
      await expect(titles).toHaveCount(2)
      await page.locator("[data-e2e=notes-show-live]").click()
      await expect(titles).toHaveCount(0)

      // The operator's list: the import's status and counts, never its file or cells.
      const promoted = await request.post(`${apiBase}/api/test/set-role`, {
        data: { login: email, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)
      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(email)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops.locator("[data-e2e=admin-dashboard-title]")).toBeVisible()
      await ops.getByRole("link", { name: "Imports" }).first().click()
      await expect(ops).toHaveURL(`${adminBase}/imports`)
      // A choice chip hides its radio, so the chip's label takes the click.
      await ops.locator("label", { has: ops.locator("[data-e2e=admin-imports-chip-undone]") })
        .click()
      await expect(ops).toHaveURL(`${adminBase}/imports?status=undone`)
      const row = ops.locator("tr", { has: ops.locator(`[data-e2e=admin-import-${importId}]`) })
      await expect(row.locator("[data-e2e=admin-import-group]")).toHaveText(groupName)
      // A wide window shows the status and counts in their columns, after the phone line's copy.
      await expect(row.locator("[data-e2e=admin-import-status]").last()).toHaveAttribute(
        "data-status",
        "undone",
      )
      await expect(row.locator("[data-e2e=admin-import-counts]").last()).toHaveText(
        "3 rows · 2 saved · 1 left out",
      )
      const shown = await ops.locator("main").innerText()
      for (const secret of ["plan.csv", "Groceries", "milk and eggs", "an orphan body"]) {
        expect(shown).not.toContain(secret)
      }
    } finally {
      await admin?.close()
      await cleanup(request, email)
    }
  })
})
