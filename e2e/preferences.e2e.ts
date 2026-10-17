import type { APIRequestContext, BrowserContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { openProfile, signIn } from "./fixtures/app.ts"
import { openNotes } from "./fixtures/groups.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * Display preferences follow the person to every device (#163): a theme picked on the laptop paints
 * the phone dark, and a time zone saved on the laptop shows on the phone without a reload. The
 * laptop, now in another zone than the one picked, offers to switch back. A region format and a
 * clock saved on the profile write the dates on other screens and in the admin app.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const OPERATOR = 2

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/** Signs the person in on a device of its own and opens the profile page. */
async function openOnDevice(device: BrowserContext, email: string): Promise<Page> {
  const page = await device.newPage()
  await signIn(page, email, password)
  await openProfile(page)
  await expect(page.locator("[data-e2e=preferences]")).toBeVisible()
  return page
}

test.describe("preferences across devices", () => {
  test("a theme and a time zone picked on one device show on the other", async ({ browser, request }) => {
    // Two devices, a sign-up by code and four dialogs: longer than the default 30 seconds.
    test.setTimeout(120_000)
    const email = `e2e-preferences-${uuidV7().slice(-8)}@example.com`
    let laptop: BrowserContext | null = null
    let phone: BrowserContext | null = null
    try {
      const signUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok(), await signUp.text()).toBe(true)

      laptop = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "en-GB" })
      phone = await browser.newContext({ timezoneId: "Asia/Tokyo", locale: "en-GB" })
      const onLaptop = await openOnDevice(laptop, email)
      const onPhone = await openOnDevice(phone, email)
      await expect(onPhone.locator("[data-e2e=preferences-time-zone]")).toContainText(
        "Automatic: same as this device — Tokyo, Asia",
      )

      // The theme changes at once from its row's menu, here and on the other device.
      await onLaptop.getByRole("button", { name: "Change theme" }).click()
      await onLaptop.locator("[data-e2e=preferences-theme-dark]").click()
      await expect(onLaptop.locator("html")).toHaveClass(/\bdark\b/)
      await expect(onPhone.locator("html")).toHaveClass(/\bdark\b/)
      await expect(onPhone.locator("[data-e2e=preferences-theme]")).toContainText("Dark")

      // A zone saved in the dialog on the laptop shows on the phone without a reload.
      await onLaptop.locator("[data-e2e=preferences-change-timeZone]").click()
      const zone = onLaptop.getByRole("combobox", { name: "Time zone" })
      await expect(zone).toBeFocused()
      // Escape closes an open list, not the dialog around it.
      await zone.fill("Tok")
      await expect(onLaptop.getByRole("option", { name: /^Tokyo, Asia/ })).toBeVisible()
      await zone.press("Escape")
      await expect(onLaptop.getByRole("option", { name: /^Tokyo, Asia/ })).toBeHidden()
      await expect(onLaptop.locator("[data-e2e=preferences-dialog]")).toBeVisible()
      await zone.fill("Tokyo")
      await onLaptop.getByRole("option", { name: /^Tokyo, Asia/ }).click()
      await onLaptop.locator("[data-e2e=preferences-save]").click()
      await expect(onLaptop.locator("[data-e2e=preferences-dialog]")).toBeHidden()
      await expect(onPhone.locator("[data-e2e=preferences-time-zone]")).toContainText(
        "Tokyo, Asia · GMT+9",
      )
      await expect(onPhone.locator("[data-e2e=preferences-time-zone]")).not.toContainText(
        "Automatic",
      )

      // The laptop is in Berlin, not Tokyo: it offers to switch, and keeping Tokyo hides the offer.
      const other = onLaptop.locator("[data-e2e=preferences-other-zone]")
      await expect(other).toContainText("This device is on Berlin time")
      await onLaptop.locator("[data-e2e=preferences-keep-zone]").click()
      await expect(other).toBeHidden()
      await expect(onLaptop.locator("[data-e2e=preferences-change-timeZone]")).toBeFocused()

      // Two devices edit different fields at once: the second save is refused with a notice, and
      // the first device's change is not overwritten.
      await onLaptop.locator("[data-e2e=preferences-change-clock]").click()
      await onLaptop.locator("[data-e2e=preferences-clock-select]").selectOption("h12")
      await onPhone.locator("[data-e2e=preferences-change-formats]").click()
      await onPhone.getByRole("combobox", { name: "Formats" }).fill("Italian")
      await onPhone.getByRole("option", { name: /Italian \(Italy\)/ }).click()
      await onPhone.locator("[data-e2e=preferences-save]").click()
      await expect(onPhone.locator("[data-e2e=preferences-dialog]")).toBeHidden()
      await expect(onLaptop.locator("[data-e2e=preferences-formats]")).toContainText("Italian")
      await onLaptop.locator("[data-e2e=preferences-save]").click()
      await expect(onLaptop.locator("[data-e2e=preferences-conflict]")).toBeVisible()
      await expect(onPhone.locator("[data-e2e=preferences-formats]")).toContainText("Italian")
      await expect(onPhone.locator("[data-e2e=preferences-clock]")).not.toContainText("12-hour")

      // A theme picked on another device while the dialog is open does not refuse its save.
      await onLaptop.locator("[data-e2e=preferences-clock-select]").selectOption("h12")
      await onPhone.getByRole("button", { name: "Change theme" }).click()
      await onPhone.locator("[data-e2e=preferences-theme-light]").click()
      await expect(onLaptop.locator("html")).not.toHaveClass(/\bdark\b/)
      await onLaptop.locator("[data-e2e=preferences-save]").click()
      await expect(onLaptop.locator("[data-e2e=preferences-dialog]")).toBeHidden()
      await expect(onPhone.locator("[data-e2e=preferences-clock]")).toContainText("12-hour")
    } finally {
      await laptop?.close()
      await phone?.close()
      await cleanup(request, email)
    }
  })

  test("a region format and clock saved on the profile write the dates on other screens and in the admin app", async ({ browser, request }) => {
    test.setTimeout(90_000)
    const email = `e2e-preferences-format-${uuidV7().slice(-8)}@example.com`
    let device: BrowserContext | null = null
    let admin: BrowserContext | null = null
    try {
      const signUp = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
        headers,
        data: { email, password },
      })
      expect(signUp.ok(), await signUp.text()).toBe(true)
      // An operator too, so the admin app shows their dates in their own format.
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: email, role: OPERATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)

      // The device's own format is English with a 24-hour clock.
      device = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "en-GB" })
      const page = await openOnDevice(device, email)
      const groupId = uuidV7()
      const group = await page.request.post(`${appBase}/api/groups`, {
        headers,
        data: { id: groupId, name: "Format team" },
      })
      expect(group.status(), await group.text()).toBe(201)
      const noteId = uuidV7()
      const note = await page.request.post(`${appBase}/api/groups/${groupId}/notes`, {
        headers,
        data: { id: noteId, title: "Trip", body: "passport" },
      })
      expect(note.status(), await note.text()).toBe(201)
      const example = page.locator("[data-e2e=preferences-example]")
      await expect(example).toContainText(ENGLISH_FULL)

      await page.locator("[data-e2e=preferences-change-formats]").click()
      await page.getByRole("combobox", { name: "Formats" }).fill("German (Germany)")
      await page.getByRole("option", { name: /German \(Germany\)/ }).click()
      await page.locator("[data-e2e=preferences-clock-select]").selectOption("h12")
      await page.locator("[data-e2e=preferences-save]").click()
      await expect(page.locator("[data-e2e=preferences-dialog]")).toBeHidden()

      // Outside the dialog the dates are German with a 12-hour clock: the example under "Language
      // and region", a note's exact time on another screen, and both again after a reload.
      await expect(example).toContainText(GERMAN_12_HOUR_FULL)
      await openNotes(page, "Format team")
      const changed = page.locator(`[data-e2e=note-${noteId}] time`)
      await expect(changed).toHaveAttribute("title", GERMAN_12_HOUR_EXACT)
      await page.reload()
      await expect(changed).toHaveAttribute("title", GERMAN_12_HOUR_EXACT)
      await openProfile(page)
      await expect(example).toContainText(GERMAN_12_HOUR_FULL)

      // The admin app, on a device of the same region, writes the operator's own row that way too.
      admin = await browser.newContext({ timezoneId: "Europe/Berlin", locale: "en-GB" })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(email)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops).toHaveURL(`${adminBase}/`)
      await ops.goto(`${adminBase}/users?q=${encodeURIComponent(email)}`)
      const row = ops.locator("[data-e2e=admin-users-list] tbody tr")
      await expect(row).toHaveCount(1)
      await expect(row.locator("time").last()).toHaveAttribute("title", GERMAN_12_HOUR_EXACT)
    } finally {
      await device?.close()
      await admin?.close()
      await cleanup(request, email)
    }
  })
})

/** A full date and time in British English with a 24-hour clock: `Saturday, 17 October 2026 at 05:28`. */
const ENGLISH_FULL = /(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, \d{1,2} \S+ \d{4} at \d{2}:\d{2}\./

/** The same in German with a 12-hour clock: `Samstag, 17. Oktober 2026 um 05:28 AM`. */
const GERMAN_12_HOUR_FULL =
  /(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), \d{1,2}\. \S+ \d{4} um \d{1,2}:\d{2}\s(AM|PM)/

/** An exact moment in German with a 12-hour clock: `17.10.2026, 05:28:00 AM MESZ`. */
const GERMAN_12_HOUR_EXACT = /^\d{2}\.\d{2}\.\d{4}, \d{1,2}:\d{2}:\d{2}\s(AM|PM)/
