import type { APIRequestContext, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp } from "./fixtures/app.ts"
import { currentStep, enrolTotp, totpCode } from "./fixtures/totp.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

const apiBase = "http://app.localhost"
const headers = { origin: apiBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"

async function cleanup(request: APIRequestContext, email: string, soft = false): Promise<void> {
  const response = await request.post(`${apiBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  ;(soft ? expect.soft : expect)(response.status(), await response.text()).toBe(200)
}

/** Signs `email` up through `api` and writes one note into its group; returns the note's id. */
async function accountWithNote(api: APIRequestContext, email: string): Promise<string> {
  const signUp = await signUpWithCode(api, `${apiBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(signUp.ok(), await signUp.text()).toBe(true)
  const { groupId } = await (await api.get(`${apiBase}/api/groups/selected`)).json()
  const noteId = uuidV7()
  const note = await api.post(`${apiBase}/api/groups/${groupId}/notes`, {
    headers,
    data: { id: noteId, title: "Shared link", body: "" },
  })
  expect(note.status(), await note.text()).toBe(201)
  return noteId
}

/**
 * Opens the note while signed out, which lands on sign-in with the note as `next`, and submits the
 * password there.
 */
async function openSignedOut(page: Page, noteId: string, email: string): Promise<void> {
  await gotoApp(page, `/notes/${noteId}`, page.locator("[data-e2e=auth-form-login]"))
  await expect(page).toHaveURL(`/sign-in?next=%2Fnotes%2F${noteId}`)
  await page.locator("[data-e2e=auth-form-login]").fill(email)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
}

/** Submits the auth form, after which the app loads `path` itself, and waits for `ready`. */
async function submitTo(page: Page, path: string, ready: string): Promise<void> {
  await gotoApp(page, path, page.locator(ready), async () => {
    await page.locator("[data-e2e=auth-form-submit]").click()
    await page.waitForURL((url) => `${url.pathname}${url.search}` === path)
  })
}

test.describe("returning to the requested page after sign-in", () => {
  test("a signed-out person who opens a note signs in and lands on that note", async ({ page, request }) => {
    const email = `e2e-next-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      const noteId = await accountWithNote(request, email)

      await openSignedOut(page, noteId, email)
      await submitTo(page, `/notes/${noteId}`, "[data-e2e=note-title]")
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Shared link")
    } finally {
      await cleanup(request, email, true)
    }
  })

  // Each page with what proves it loaded for the signed-in person: the tags name their group, and
  // a new account's inbox says it is empty.
  for (
    const [path, title, loaded] of [
      ["/tags", "Tags", "[data-e2e=tags-group]"],
      ["/notifications", "Notifications", "text=You are all caught up."],
    ]
  ) {
    test(`a signed-out person who opens ${path} signs in and lands there`, async ({ page, request }) => {
      const email = `e2e-next-page-${uuidV7().slice(-8)}@example.com`
      await cleanup(request, email)
      try {
        await accountWithNote(request, email)

        await gotoApp(page, path, page.locator("[data-e2e=auth-form-login]"))
        await expect(page).toHaveURL(`/sign-in?next=${encodeURIComponent(path)}`)
        await page.locator("[data-e2e=auth-form-login]").fill(email)
        await page.locator("[data-e2e=auth-form-password]").fill(password)
        await submitTo(page, path, "h1")
        await expect(page.locator("h1")).toHaveText(title)
        await expect(page.locator(loaded)).toBeVisible()
      } finally {
        await cleanup(request, email, true)
      }
    })
  }

  test("a signed-out person with a one-time code lands on the note after the code", async ({ page, request }) => {
    const email = `e2e-next-2fa-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      const noteId = await accountWithNote(request, email)
      const { secret, enrolStep } = await enrolTotp(request, apiBase, password)

      await openSignedOut(page, noteId, email)
      await submitTo(page, `/totp?next=%2Fnotes%2F${noteId}`, "[data-e2e=auth-form-code]")
      // A code for the step the enrolment used is refused as a replay, so use a later step.
      const step = Math.max(currentStep(), enrolStep + 1)
      await page.locator("[data-e2e=auth-form-code]").fill(await totpCode(secret, step))
      await submitTo(page, `/notes/${noteId}`, "[data-e2e=note-title]")
      await expect(page.locator("[data-e2e=note-title]")).toHaveValue("Shared link")
    } finally {
      await cleanup(request, email, true)
    }
  })

  test("a link that names another site lands on the notes after sign-in", async ({ page, request }) => {
    const email = `e2e-next-evil-${uuidV7().slice(-8)}@example.com`
    await cleanup(request, email)
    try {
      await accountWithNote(request, email)

      await gotoApp(
        page,
        "/sign-in?next=%2F%2Fevil.example",
        page.locator("[data-e2e=auth-form-login]"),
      )
      await page.locator("[data-e2e=auth-form-login]").fill(email)
      await page.locator("[data-e2e=auth-form-password]").fill(password)
      await submitTo(page, "/notes", "[data-e2e=note-new]")
    } finally {
      await cleanup(request, email, true)
    }
  })
})
