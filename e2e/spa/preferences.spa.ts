import { expect, type Page, test } from "@playwright/test"
import { gotoApp, openProfile, signIn } from "../fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "../fixtures/sign-up.ts"

/**
 * Picks a choice of a chip group by its radio's hook. The radio is visually hidden inside its
 * label, so the click goes to the label, as a person's does.
 */
async function pick(page: Page, hook: string): Promise<void> {
  await page.locator("label", { has: page.locator(`[data-e2e=${hook}]`) }).click()
  await expect(page.locator(`[data-e2e=${hook}]`)).toBeChecked()
}

/**
 * A region format and a clock saved on the profile write the dates of the built SPA. The bundle must
 * hold one copy of the date format's context: with two, the app's provider fills one and the
 * screens read the other, so dates keep the device's format (spy4x/preact-components#785). The dev
 * server loads modules in another order and can hide it, so this runs against the production build.
 */
test("a region format and clock saved on the profile write the dates of the built app", async ({ page, request, baseURL }) => {
  const email = `e2e-spa-format-${uuidV7().slice(-8)}@example.com`
  const password = "Passw0rd!"
  const headers = { origin: new URL(baseURL!).origin, "sec-fetch-site": "same-origin" }
  const cleanup = async ({ soft = false } = {}) => {
    const response = await request.post("/api/test/cleanup-user", { data: { login: email } })
    ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
  }
  await cleanup()
  try {
    const signUp = await signUpWithCode(request, "/api/auth/password/sign-up", {
      headers,
      data: { email, password },
    })
    expect(signUp.ok(), await signUp.text()).toBe(true)

    await signIn(page, email, password)
    const selected = await page.request.get("/api/groups/selected")
    const { groupId } = await selected.json()
    const noteId = uuidV7()
    const note = await page.request.post(`/api/groups/${groupId}/notes`, {
      headers,
      data: { id: noteId, title: "Trip", body: "passport" },
    })
    expect(note.status(), await note.text()).toBe(201)

    await openProfile(page, "region")
    const example = page.locator("[data-e2e=preferences-example]")
    await page.getByRole("combobox", { name: "Formats" }).fill("German (Germany)")
    await page.getByRole("option", { name: /German \(Germany\)/ }).click()
    await pick(page, "preferences-clock-h12")
    // The screen shows a change before the server has it, and the clock is sent only once the
    // format's save is answered: leave the page only when the server holds both.
    const { id: userId } = await (await page.request.get("/api/auth/me")).json()
    await expect.poll(async () => {
      const stored = await page.request.post("/api/call/preferences.get", {
        headers: { ...headers, "content-type": "application/json", "x-realtime-user": `${userId}` },
        data: "null",
      })
      return (await stored.json()).result?.value
    }).toMatchObject({ locale: "de-DE", hourCycle: "h12" })

    // The example on the profile and every exact time of a note's row on another screen (when it
    // changed and when it was made) are German with a 12-hour clock.
    await expect(example).toContainText(GERMAN_12_HOUR_FULL)
    await gotoApp(page, "/notes", page.locator("[data-e2e=note-new]"))
    const times = page.locator(`[data-e2e=note-${noteId}] time`)
    await expect(times.first()).toBeAttached()
    const all = await times.all()
    expect(all.length).toBeGreaterThan(1)
    for (const time of all) await expect(time).toHaveAttribute("title", GERMAN_12_HOUR_EXACT)
  } finally {
    await cleanup({ soft: true })
  }
})

/** A full date and time in German with a 12-hour clock: `Samstag, 17. Oktober 2026 um 05:28 AM`. */
const GERMAN_12_HOUR_FULL =
  /(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), \d{1,2}\. \S+ \d{4} um \d{1,2}:\d{2}\s(AM|PM)/

/** An exact moment in German with a 12-hour clock: `17.10.2026, 05:28:00 AM MESZ`. */
const GERMAN_12_HOUR_EXACT = /^\d{2}\.\d{2}\.\d{4}, \d{1,2}:\d{2}:\d{2}\s(AM|PM)/
