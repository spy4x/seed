/**
 * The palette's commands in a real browser: the Theme submenu applies a theme with the palette
 * still open, the palette's look on a phone and a desktop in both palettes, photographed into
 * the test's output folder for the design review, a group page's own commands per role, the
 * risky account commands, which only open their confirmation, and the quick-create rows, which
 * make a note, tag or group from the typed text.
 */
import { type APIRequestContext, type BrowserContext, type Page } from "@playwright/test"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpWithCode } from "./fixtures/sign-up.ts"
import { enrolTotp } from "./fixtures/totp.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

/** The requests that would delete the account, turn two-factor off or sign other devices out. */
const ACTS = /\/api\/auth\/(account\/delete|totp\/disconnect|sessions\/others)/

/** Records every request `page` makes that acts on the account; the list must stay empty. */
function watchActs(page: Page): string[] {
  const acts: string[] = []
  page.on("request", (request) => {
    if (ACTS.test(request.url())) acts.push(`${request.method()} ${request.url()}`)
  })
  return acts
}

/**
 * Types `words` into the palette, checks the first option is `name`, and picks it with Enter. Then
 * checks the dialog `dialog` opened holding the focus, closes it with Escape, and checks the focus
 * went back to the button `opener` that opened it, not to the page.
 */
async function enterOpensOnly(
  page: Page,
  words: string,
  name: string,
  dialog: string,
  opener: string,
): Promise<void> {
  const palette = page.locator("[data-e2e=search]")
  await page.keyboard.press("Control+k")
  await palette.getByRole("combobox").fill(words)
  await expect(palette.getByRole("option").first()).toHaveAccessibleName(name)
  await page.keyboard.press("Enter")
  await expect(palette).toBeHidden()
  const confirm = page.locator(`[data-e2e=${dialog}]`)
  await expect(confirm).toBeVisible()
  await expect.poll(() => confirm.evaluate((box) => box.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press("Escape")
  await expect(confirm).toBeHidden()
  await expect(page.locator(`#${opener}`)).toBeFocused()
}

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

test.describe("the palette's commands", () => {
  test("Enter on Theme, then on Dark, turns the page dark and leaves the palette open on the submenu", async ({ page, request }) => {
    test.setTimeout(180_000)
    const user = "e2e_palette_commands@example.com"
    await cleanup(request, user)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
    try {
      const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email: user, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      await signIn(page, user, password)
      const palette = page.locator("[data-e2e=search]")
      const field = palette.getByRole("combobox")
      const html = page.locator("html")

      for (const width of [390, 1440]) {
        for (const scheme of ["light", "dark"] as const) {
          const view = `${width} px, ${scheme}`
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ colorScheme: scheme })
          await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
          await page.keyboard.press("Control+k")
          await expect(field, view).toBeFocused()
          await page.screenshot({ path: test.info().outputPath(`palette-${scheme}-${width}.png`) })
          await field.fill("тема")
          await expect(palette.getByRole("option").first(), view).toContainText("Theme")
          await page.screenshot({ path: test.info().outputPath(`theme-${scheme}-${width}.png`) })
          await page.keyboard.press("Escape")
          await expect(palette, view).toBeHidden()
        }
      }

      await page.emulateMedia({ colorScheme: "light" })
      await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
      await page.keyboard.press("Control+k")
      await expect(field).toBeFocused()
      await field.fill("dark")
      await page.keyboard.press("Enter")
      await expect(palette.getByRole("option", { name: /Dark/ })).toBeVisible()
      await expect(html).not.toHaveClass(/\bdark\b/)
      await field.fill("dark")
      await page.keyboard.press("Enter")

      await expect(html).toHaveClass(/\bdark\b/)
      await expect(palette).toBeVisible()
      await expect(palette.getByRole("option", { name: /Dark/ })).toContainText("Current")
      await page.screenshot({ path: test.info().outputPath(`dark-picked-1440.png`) })
      expect(errors).toEqual([])
    } finally {
      if (errors.length) console.log(errors.join(`\n---\n`))
      await cleanup(request, user)
    }
  })

  test("on a group's page, This page holds the menu's actions for the person's role, and Transfer, Leave and Delete only open their dialogs", async ({ page, browser, request }) => {
    test.setTimeout(120_000)
    const id = uuidV7().slice(-8)
    const owner = `e2e-palette-group-owner-${id}@example.com`
    const member = `e2e-palette-group-member-${id}@example.com`
    for (const email of [owner, member]) await cleanup(request, email)
    let memberContext: BrowserContext | null = null
    try {
      for (const email of [owner, member]) {
        const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
          headers,
          data: { email, password },
        })
        expect(signedUp.ok(), await signedUp.text()).toBe(true)
      }
      await signIn(page, owner, password)
      // A second group with no plan: neither the last group nor a live subscription disables any
      // of its menu's items.
      const groupId = uuidV7()
      const created = await page.request.post(`${apiBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Team" },
      })
      expect(created.status(), await created.text()).toBe(201)
      const added = await request.post(`${apiBase}/api/test/add-member`, {
        data: { login: member, groupId, role: 2 },
      })
      expect(added.status(), await added.text()).toBe(200)
      const rolesIn = async (on: Page) =>
        ((await (await on.request.get(`${apiBase}/api/groups`)).json()).groups as {
          id: string
          role: number
        }[]).filter((group) => group.id === groupId).map((group) => group.role)

      /** Opens the palette on `on` with `words` typed, and the options it names. */
      const search = async (on: Page, words: string) => {
        const palette = on.locator("[data-e2e=search]")
        await on.keyboard.press("Control+k")
        await palette.getByRole("combobox").fill(words)
        return {
          palette,
          option: (name: string) => palette.getByRole("option", { name, exact: true }),
        }
      }
      /** Picks `name` after typing `words`, and checks its dialog opens focused and closes. */
      const opensOnly = async (on: Page, words: string, name: string, dialog: string) => {
        const { palette, option } = await search(on, words)
        await option(name).click()
        await expect(palette).toBeHidden()
        const confirm = on.locator(`[data-e2e=${dialog}]`)
        await expect(confirm).toBeVisible()
        await expect.poll(() => confirm.evaluate((box) => box.contains(document.activeElement)))
          .toBe(true)
        await on.keyboard.press("Escape")
        await expect(confirm).toBeHidden()
        // Escape hands focus to the "More actions" button, as when the item is picked from it.
        await expect(on.locator("[data-e2e=group-menu]")).toBeFocused()
      }

      await gotoApp(page, `/groups/${groupId}`, page.locator("[data-e2e=group-general-name]"))
      await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Owner")
      const { palette, option } = await search(page, "this group")
      await expect(option("Transfer ownership of this group")).toBeVisible()
      await expect(option("Export this group")).toBeVisible()
      await expect(option("Delete this group")).toBeVisible()
      await expect(option("Leave this group")).toHaveCount(0)
      // Export runs at once, as the menu's does.
      const downloading = page.waitForEvent("download")
      await option("Export this group").click()
      expect((await downloading).suggestedFilename()).toMatch(/^team-\d{4}-\d{2}-\d{2}\.json$/)
      await expect(palette).toBeHidden()

      await opensOnly(page, "remove group", "Delete this group", "group-delete-dialog")
      await opensOnly(
        page,
        "new owner",
        "Transfer ownership of this group",
        "group-transfer-dialog",
      )
      await expect(page.locator("[data-e2e=group-general-role]")).toHaveText("Owner")
      expect(await rolesIn(page)).toEqual([4])

      memberContext = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      const memberPage = await memberContext.newPage()
      await signIn(memberPage, member, password)
      await gotoApp(
        memberPage,
        `/groups/${groupId}`,
        memberPage.locator("[data-e2e=group-general-name]"),
      )
      await expect(memberPage.locator("[data-e2e=group-general-role]")).toHaveText("Editor")
      const asMember = await search(memberPage, "this group")
      await expect(asMember.option("Leave this group")).toBeVisible()
      for (
        const name of ["Transfer ownership of this group", "Export this group", "Delete this group"]
      ) {
        await expect(asMember.option(name)).toHaveCount(0)
      }
      await memberPage.keyboard.press("Escape")
      await expect(asMember.palette).toBeHidden()
      await opensOnly(memberPage, "покинуть группу", "Leave this group", "group-leave-dialog")
      await expect(memberPage).toHaveURL(`/groups/${groupId}`)
      expect(await rolesIn(memberPage)).toEqual([2])
    } finally {
      await memberContext?.close()
      for (const email of [owner, member]) await cleanup(request, email)
    }
  })

  test("Delete my account and Sign out of all other devices open only their confirmation, and Escape changes nothing", async ({ page, browser, request }) => {
    test.setTimeout(120_000)
    const email = `e2e-palette-account-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    let phone: BrowserContext | null = null
    try {
      const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      // Sign-up signed the API request in: sign it out, so the devices are this page and the phone.
      const apiOut = await request.post(`${apiBase}/api/auth/sign-out`, { headers })
      expect(apiOut.ok(), await apiOut.text()).toBe(true)
      phone = await browser.newContext({ baseURL: test.info().project.use.baseURL })
      const onPhone = await phone.request.post(`${apiBase}/api/auth/password/check`, {
        headers,
        data: { login: email, password },
      })
      expect(onPhone.ok(), await onPhone.text()).toBe(true)
      await signIn(page, email, password)
      const acts = watchActs(page)

      await enterOpensOnly(
        page,
        "delete my account",
        "Delete my account",
        "account-delete-dialog",
        "account-delete-open",
      )
      await expect(page).toHaveURL("/profile/danger-zone")
      await enterOpensOnly(
        page,
        "end other sessions",
        "Sign out of all other devices",
        "sessions-end-others-confirm",
        "sessions-end-others",
      )
      await expect(page).toHaveURL("/profile/security")

      expect(acts).toEqual([])
      expect((await page.request.get(`${apiBase}/api/auth/me`)).status()).toBe(200)
      expect((await phone.request.get(`${apiBase}/api/auth/me`)).status()).toBe(200)
      await expect(page.locator("[data-e2e=sessions] dl > div")).toHaveCount(2)
    } finally {
      await phone?.close()
      await cleanup(request, email)
    }
  })

  test("Turn off two-factor sign-in is offered only while it is on, and opens only its confirmation", async ({ page, request }) => {
    test.setTimeout(120_000)
    const email = `e2e-palette-totp-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      await signIn(page, email, password)
      const palette = page.locator("[data-e2e=search]")
      await page.keyboard.press("Control+k")
      await palette.getByRole("combobox").fill("two-factor")
      await expect(palette.getByRole("option", { name: "Sign-in and security" })).toBeVisible()
      await expect(palette.getByRole("option", { name: "Turn off two-factor sign-in" }))
        .toHaveCount(0)
      await page.keyboard.press("Escape")

      await enrolTotp(page.request, apiBase, password)
      await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
      const acts = watchActs(page)
      await enterOpensOnly(
        page,
        "disable 2fa",
        "Turn off two-factor sign-in",
        "totp-disable-confirm",
        "totp-disable",
      )
      await expect(page).toHaveURL("/profile/security")

      expect(acts).toEqual([])
      const me = await (await page.request.get(`${apiBase}/api/auth/me`)).json()
      // 3: two-factor is still configured.
      expect(me.mfa, JSON.stringify(me)).toBe(3)
    } finally {
      await cleanup(request, email)
    }
  })

  test("typed text offers New note, New tag and New group named after it: Enter fills the form, Ctrl Enter creates and opens", async ({ page, request }) => {
    test.setTimeout(180_000)
    const email = `e2e-palette-quick-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message))
    try {
      const signedUp = await signUpWithCode(request, `${apiBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signedUp.ok(), await signedUp.text()).toBe(true)
      await signIn(page, email, password)
      await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
      const palette = page.locator("[data-e2e=search]")
      const field = palette.getByRole("combobox")
      // The typed text is isolated in the row's label, so its direction cannot reorder it.
      const row = (label: string, text: string) =>
        new RegExp(`^${label}: “\\u2068?${text}\\u2069?”`)
      const railSearch = page.locator("[data-e2e=shell-search-rail] button")
      /** Opens the palette with Ctrl K, or with a click on the rail's Search button, and types `text`. */
      const ask = async (text: string, from: "keys" | "rail" = "keys") => {
        // Ctrl K opens the palette only while no modal dialog is open: wait for one to finish closing.
        await expect.poll(() =>
          page.evaluate(() => document.querySelector("dialog[open]") === null)
        )
          .toBe(true)
        if (from === "rail") await railSearch.click()
        else await page.keyboard.press("Control+k")
        await expect(field).toBeFocused()
        await field.fill(text)
        await expect(palette.getByRole("option").first()).toHaveAccessibleName(
          row("New note", text),
        )
      }

      // A command cancelled first: the quick-create right after it still works.
      await page.keyboard.press("Control+k")
      await field.fill("dark")
      await page.keyboard.press("Escape")
      await expect(palette).toBeHidden()

      // From the rail's Search button: closing the New note dialog gives focus back to it.
      await ask("groceries", "rail")
      await expect(palette.getByRole("option").nth(1)).toHaveAccessibleName(
        row("New tag", "groceries"),
      )
      await expect(palette.getByRole("option").nth(2)).toHaveAccessibleName(
        row("New group", "groceries"),
      )
      await page.keyboard.press("Enter")
      const dialog = page.locator("[data-e2e=new-note-dialog]")
      const title = dialog.locator("[data-e2e=new-note-title]")
      await expect(dialog).toBeVisible()
      await expect(title).toHaveValue("groceries")
      await expect(title).toBeFocused()
      await page.keyboard.press("Escape")
      await expect(dialog).toBeHidden()
      await expect(railSearch).toBeFocused()

      await ask("Weekly groceries")
      await page.keyboard.press("Control+Enter")
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Weekly groceries")
      await expect(dialog).toBeHidden()

      await ask("Errands")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL("/tags/new")
      await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Errands")

      await ask("Chores")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Control+Enter")
      await expect(page).toHaveURL(/\/tags\/[0-9a-f-]{36}$/)
      await expect(page.locator("[data-e2e=tag-created]")).toBeVisible()
      await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Chores")

      await ask("Book club")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await expect(page).toHaveURL("/groups/new")
      await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Book club")

      // A long query on a phone: the row shows forty characters and never overflows.
      await page.setViewportSize({ width: 390, height: 900 })
      await gotoApp(page, "/groups", page.locator("[data-e2e=shell-ws-status]"))
      await page.keyboard.press("Control+k")
      await field.fill(`${"Shopping list for the long weekend trip ".repeat(3)}🛒 مرحبا`)
      const first = palette.getByRole("option").first()
      await expect(first).toHaveAccessibleName(/^New note: “.*…/)
      expect(await first.evaluate((option) => option.scrollWidth <= option.clientWidth)).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`quick-create-390.png`) })
      expect(errors).toEqual([])
    } finally {
      if (errors.length) console.log(errors.join(`\n---\n`))
      await cleanup(request, email)
    }
  })
})
