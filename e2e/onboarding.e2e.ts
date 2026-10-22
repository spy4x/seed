import { type APIRequestContext, type Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { signUpInPage } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

/**
 * Counts the answers to `onboarding.get` this page receives, over the socket or over HTTP. A spec
 * that expects the card to be absent waits for an answer first, so it does not pass on a page
 * that has not asked yet.
 */
function onboardingAnswers(page: Page): { count: number } {
  const answers = { count: 0 }
  page.on("websocket", (socket) => {
    socket.on("framereceived", (frame) => {
      if (String(frame.payload).includes(`"tourSeen"`)) answers.count++
    })
  })
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/api/call/onboarding.get") answers.count++
  })
  return answers
}

/** Signs up through the form, as a new person does, and lands on the notes list. */
async function signUpInBrowser(page: Page, email: string): Promise<void> {
  await signUpInPage(page, email, password, page.locator("[data-e2e=shell-ws-status]"))
  await expect(page.locator("[data-e2e=shell-ws-status]")).toHaveText("Online")
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Main navigation" })
const card = (page: Page) => page.locator("[data-e2e=onboarding]")
/** A step of the checklist, by its title; its text starts with "Done: " or "To do: ". */
const step = (page: Page, title: string) =>
  card(page).getByRole("listitem").filter({ hasText: title })

const notesHeading = (page: Page) =>
  page.getByRole("heading", { level: 1, name: "Notes", exact: true })

/**
 * Opens the notes list, where the card lives, through the navigation by way of another page, so
 * the card mounts again and reads the steps again.
 */
async function openHome(page: Page): Promise<void> {
  await nav(page).getByRole("link", { name: "Groups" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Groups", exact: true })).toBeVisible()
  await nav(page).getByRole("link", { name: "Notes" }).click()
  await expect(notesHeading(page)).toBeVisible()
}

/** Presses Tab until the control named `name` has focus, as a keyboard user reaches it. */
async function tabTo(page: Page, name: string): Promise<void> {
  for (let presses = 0; presses < 40; presses++) {
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
    if (focused === name) return
    await page.keyboard.press("Tab")
  }
  throw new Error(`Tab never reached "${name}"`)
}

test.describe("first steps", () => {
  test("a new account sees the checklist, and writing a first note ticks its step; the welcome note does not", async ({ page, request }) => {
    const email = "e2e_onboarding_note@example.com"
    await cleanup(request, email)
    try {
      // Before the page opens its socket: the listener only hears sockets opened after it.
      const answers = onboardingAnswers(page)
      await signUpInBrowser(page, email)

      await expect(card(page).getByRole("heading", { name: "Get started" })).toBeVisible()
      await expect(card(page).getByRole("listitem")).toHaveCount(5)
      await expect(step(page, "Write your first note")).toContainText("To do:")

      // The worker gives the new account a welcome note. It is not the person's own.
      const { groupId } = await (await page.request.get(`${apiBase}/api/groups/selected`)).json()
      await expect.poll(async () => {
        const listed = await page.request.get(`${apiBase}/api/groups/${groupId}/notes?limit=100`)
        return (await listed.json()).notes.map((note: { title: string }) => note.title)
      }, { message: "the worker makes the welcome note", timeout: 15_000 }).toEqual(["Welcome"])
      const before = answers.count
      await openHome(page)
      await expect.poll(() => answers.count).toBeGreaterThan(before)
      await expect(step(page, "Write your first note")).toContainText("To do:")

      // The person writes a note of their own. The card belongs to the notes list only.
      await page.locator("[data-e2e=note-new]").click()
      await page.locator("[data-e2e=note-title]").fill("My first note")
      await page.locator("[data-e2e=note-save]").click()
      await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}$/)
      await expect(card(page)).toHaveCount(0)

      await openHome(page)
      await expect(step(page, "Write your first note")).toContainText("Done:")
      await expect(step(page, "Invite someone to your group")).toContainText("To do:")
    } finally {
      await cleanup(request, email)
    }
  })

  test("a dismissed checklist stays away after a reload and on another device", async ({ page, browser, request }) => {
    const email = "e2e_onboarding_dismiss@example.com"
    await cleanup(request, email)
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL })
    try {
      await signUpInBrowser(page, email)
      await expect(card(page)).toBeVisible()

      await card(page).getByRole("button", { name: "Dismiss" }).click()
      await expect(card(page)).toHaveCount(0)
      await expect(notesHeading(page)).toBeFocused()

      // The same browser, loaded again.
      const answers = onboardingAnswers(page)
      await gotoApp(page, "/notes", page.locator("[data-e2e=shell-ws-status]"))
      await expect.poll(() => answers.count).toBeGreaterThan(0)
      await expect(notesHeading(page)).toBeVisible()
      await expect(card(page)).toHaveCount(0)

      // Another device of the same person.
      const second = await other.newPage()
      const secondAnswers = onboardingAnswers(second)
      await signIn(second, email, password)
      await expect.poll(() => secondAnswers.count).toBeGreaterThan(0)
      await expect(notesHeading(second)).toBeVisible()
      await expect(card(second)).toHaveCount(0)
    } finally {
      await other.close()
      await cleanup(request, email)
    }
  })

  test("the tour is taken to its end with the keyboard alone and is not offered again", async ({ page, request }) => {
    const email = "e2e_onboarding_tour@example.com"
    await cleanup(request, email)
    try {
      await signUpInBrowser(page, email)
      const offer = page.locator("[data-e2e=onboarding-tour-offer]")
      await expect(offer).toBeVisible()
      // Offered, never opened unasked.
      const tour = page.getByRole("dialog").filter({ hasText: "Step" })
      await expect(tour).toBeHidden()

      await tabTo(page, "Take the tour")
      await page.keyboard.press("Enter")
      await expect(tour).toBeVisible()
      await expect(tour).toContainText("Step 1 of 4")
      await expect(tour.getByRole("heading", { name: "Notes" })).toBeFocused()

      for (const [place, title] of [[2, "Groups"], [3, "Notifications"], [4, "Profile"]] as const) {
        await tabTo(page, "Next")
        await page.keyboard.press("Enter")
        await expect(tour).toContainText(`Step ${place} of 4`)
        await expect(tour.getByRole("heading", { name: title })).toBeFocused()
      }
      await tabTo(page, "Back")
      await page.keyboard.press("Enter")
      await expect(tour).toContainText("Step 3 of 4")
      await tabTo(page, "Next")
      await page.keyboard.press("Enter")
      await tabTo(page, "Done")
      await page.keyboard.press("Enter")

      await expect(tour).toBeHidden()
      await expect(offer).toHaveCount(0)
      await expect(card(page).getByRole("heading", { name: "Get started" })).toBeFocused()

      const answers = onboardingAnswers(page)
      await gotoApp(page, "/notes", card(page))
      await expect.poll(() => answers.count).toBeGreaterThan(0)
      await expect(offer).toHaveCount(0)
    } finally {
      await cleanup(request, email)
    }
  })

  test("Escape skips the tour, and it is not offered again", async ({ page, request }) => {
    const email = "e2e_onboarding_skip@example.com"
    await cleanup(request, email)
    try {
      await signUpInBrowser(page, email)
      const offer = page.locator("[data-e2e=onboarding-tour-offer]")
      const tour = page.getByRole("dialog").filter({ hasText: "Step" })
      await tabTo(page, "Take the tour")
      await page.keyboard.press("Enter")
      await expect(tour).toBeVisible()

      await page.keyboard.press("Escape")

      await expect(tour).toBeHidden()
      await expect(offer).toHaveCount(0)
      await expect(card(page).getByRole("heading", { name: "Get started" })).toBeFocused()
      const answers = onboardingAnswers(page)
      await gotoApp(page, "/notes", card(page))
      await expect.poll(() => answers.count).toBeGreaterThan(0)
      await expect(offer).toHaveCount(0)
    } finally {
      await cleanup(request, email)
    }
  })

  for (const way of ["Escape", "Done"] as const) {
    test(`on a phone, focus is on the card's heading after the tour ends by ${way}`, async ({ page, request }) => {
      const email = `e2e_onboarding_phone_${way.toLowerCase()}@example.com`
      await cleanup(request, email)
      try {
        await signUpInBrowser(page, email)
        // The side navigation, which the tour points at, is not drawn at this width.
        await page.setViewportSize({ width: 375, height: 800 })
        await expect(page.locator("[data-e2e=rail-shell-rail]")).toBeHidden()
        const tour = page.getByRole("dialog").filter({ hasText: "Step" })
        await tabTo(page, "Take the tour")
        await page.keyboard.press("Enter")
        await expect(tour).toBeVisible()

        if (way === "Done") {
          for (const place of [2, 3, 4]) {
            await tabTo(page, "Next")
            await page.keyboard.press("Enter")
            await expect(tour).toContainText(`Step ${place} of 4`)
          }
          await tabTo(page, "Done")
          await page.keyboard.press("Enter")
        } else await page.keyboard.press("Escape")

        await expect(tour).toBeHidden()
        const heading = card(page).getByRole("heading", { name: "Get started" })
        await expect(heading).toBeFocused()
        await expect(heading).toBeInViewport()
      } finally {
        await cleanup(request, email)
      }
    })
  }
})
