import { type APIRequestContext, type Page } from "@playwright/test"
import { AxeBuilder } from "@axe-core/playwright"
import { expect, test } from "./fixtures/stack.ts"
import { signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The keyboard shortcuts of the SPA (spy4x/seed#220): `n` adds a note from any page without
 * leaving it, `g` then a letter goes to a section, and `?` lists them all. Both dialogs pass
 * axe-core in the light and the dark theme.
 */

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** The WCAG A and AA rules axe-core checks a dialog against. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

function address(name: string): string {
  return `e2e-shortcuts-${name}-${uuidV7().slice(-8)}@example.com`
}

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
  const signedOut = await request.post(`${apiBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
}

/** Every axe-core violation inside the open modal dialog, as `rule: target` lines. */
async function violationsInDialog(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).include("dialog[open]")
    .withTags(WCAG_TAGS).analyze()
  return violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(" ")}`)
  )
}

/** Presses a key on the page itself, with nothing focused, as a person who clicked the page. */
async function press(page: Page, keys: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  for (const key of keys.split(" ")) await page.keyboard.press(key)
}

test.describe("keyboard shortcuts", () => {
  test("n on the Tags page adds a note to the selected group, and the person stays on Tags", async ({ page, request }) => {
    const email = address("quick-add")
    try {
      await signUp(request, email)
      await signIn(page, email, password)

      // `g` then `t` goes to Tags. The first page may still be settling (its group loads and the
      // address can be replaced once), so the sequence is pressed again until it lands.
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
      await expect(async () => {
        await press(page, "g t")
        await expect(page).toHaveURL(/\/tags$/, { timeout: 1500 })
      }).toPass({ timeout: 15_000 })
      await expect(page.getByRole("heading", { level: 1, name: "Tags" })).toBeVisible()

      await press(page, "n")
      const dialog = page.locator("[data-e2e=new-note-dialog]")
      await expect(dialog).toBeVisible()
      const title = dialog.locator("[data-e2e=new-note-title]")
      await expect(title).toBeFocused()

      await title.fill("Buy milk")
      await title.press("Enter")
      await expect(dialog.locator("[data-e2e=new-note-added]")).toContainText(
        "Added “Buy milk” to",
      )
      await expect(dialog.locator("[data-e2e=new-note-added]")).not.toContainText(
        "Saved on this device",
      )
      // The field is empty and keeps focus, for the next note; the page is still Tags.
      await expect(title).toHaveValue("")
      await expect(title).toBeFocused()
      await expect(page).toHaveURL(/\/tags$/)

      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      await press(page, "g n")
      await expect(page).toHaveURL(/\/notes$/)
      await expect(page.getByText("Buy milk", { exact: true })).toBeVisible()
    } finally {
      await cleanup(request, email)
    }
  })

  test("the single-key switch stays under the pointer, and off it unbinds n and the g sequences but not Ctrl K", async ({ page, request }) => {
    const email = address("switch")
    try {
      await signUp(request, email)
      await signIn(page, email, password)
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await press(page, "?")
        const list = page.getByRole("dialog", { name: "Keyboard shortcuts" })
        const toggle = list.getByRole("switch", { name: "Single-key shortcuts" })
        await expect(toggle).toBeVisible()
        // The dialog slides in; measure once its opening animation has finished.
        await list.evaluate((dialog) =>
          Promise.all(
            dialog.getAnimations({ subtree: true }).map((animation) => animation.finished),
          )
        )
        const before = await toggle.boundingBox()
        await toggle.click()
        await expect(toggle).toHaveAttribute("aria-checked", "false")
        const off = await toggle.boundingBox()
        await toggle.click()
        await expect(toggle).toHaveAttribute("aria-checked", "true")
        const on = await toggle.boundingBox()
        expect([off?.y, on?.y], `width ${width}`).toEqual([before?.y, before?.y])
        await page.keyboard.press("Escape")
        await expect(list).toBeHidden()
      }

      // Off, `n` and the `g` sequences do nothing; Ctrl K still opens search.
      await press(page, "?")
      const list = page.getByRole("dialog", { name: "Keyboard shortcuts" })
      await list.getByRole("switch", { name: "Single-key shortcuts" }).click()
      await page.keyboard.press("Escape")
      await expect(list).toBeHidden()
      const url = page.url()
      await press(page, "n")
      await press(page, "g t")
      await expect(page.locator("[data-e2e=new-note-dialog]")).toBeHidden()
      expect(page.url()).toBe(url)
      await press(page, "Control+k")
      await expect(page.locator("dialog[data-e2e=search]")).toBeVisible()
    } finally {
      await cleanup(request, email)
    }
  })

  test("the shortcuts dialog and the New note dialog, with an error and after an add, pass axe-core in light and dark", async ({ page, request }) => {
    const email = address("axe")
    try {
      await signUp(request, email)
      await signIn(page, email, password)
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme })

        await press(page, "?")
        const list = page.getByRole("dialog", { name: "Keyboard shortcuts" })
        await expect(list).toBeVisible()
        await expect(list.getByRole("switch", { name: "Single-key shortcuts" })).toBeVisible()
        expect(await violationsInDialog(page), colorScheme).toEqual([])
        await page.keyboard.press("Escape")
        await expect(list).toBeHidden()

        await press(page, "n")
        const dialog = page.locator("[data-e2e=new-note-dialog]")
        await expect(dialog).toBeVisible()
        await dialog.locator("[data-e2e=new-note-submit]").click()
        await expect(dialog.getByText("Enter a title.")).toBeVisible()
        expect(await violationsInDialog(page), colorScheme).toEqual([])
        await dialog.locator("[data-e2e=new-note-title]").fill(`Checked in ${colorScheme}`)
        await dialog.locator("[data-e2e=new-note-title]").press("Enter")
        await expect(dialog.locator("[data-e2e=new-note-open]")).toBeVisible()
        expect(await violationsInDialog(page), colorScheme).toEqual([])
        await page.keyboard.press("Escape")
        await expect(dialog).toBeHidden()
      }
    } finally {
      await cleanup(request, email)
    }
  })
})
