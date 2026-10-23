import { Buffer } from "node:buffer"
import type { APIRequestContext, BrowserContext, Locator, Page } from "@playwright/test"
import { expect, test } from "./fixtures/stack.ts"
import { gotoApp, signIn } from "./fixtures/app.ts"
import { uuidV7 } from "@jsr/spy4x__platform/universal/uuid"
import { signUpWithCode } from "./fixtures/sign-up.ts"

/**
 * The profile picture (#228): a person uploads one, replaces it and removes it in Profile →
 * Account, and every replaced or removed object leaves the file store. A file that is not the
 * image it claims, or not an image the row takes, is refused. An operator removes a person's
 * picture from the admin app.
 */

const appBase = "http://app.localhost"
const adminBase = "http://admin.localhost"
const headers = { origin: appBase, "sec-fetch-site": "same-origin" }
const password = "Passw0rd!"
const ADMINISTRATOR = 4
/** The bucket `deno task e2e:local` gives the API (`infra/scripts/e2e-local.sh`). */
const BUCKET = "e2e-files"

/** Two 1x1 PNGs a browser draws: a red and a near-black pixel. */
const RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO4o6EBAAMQAS0ujiXaAAAAAElFTkSuQmCC",
  "base64",
)
const BLACK = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQEREBAAB8AD2SgCfbAAAAAElFTkSuQmCC",
  "base64",
)

function address(name: string): string {
  return `e2e-picture-${name}-${uuidV7().slice(-8)}@example.com`
}

async function cleanup(request: APIRequestContext, email: string) {
  const response = await request.post(`${appBase}/api/test/cleanup-user`, {
    data: { login: email },
  })
  expect.soft(response.status(), await response.text()).toBe(200)
}

async function signUp(request: APIRequestContext, email: string) {
  const response = await signUpWithCode(request, `${appBase}/api/auth/password/sign-up`, {
    headers,
    data: { email, password },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const signedOut = await request.post(`${appBase}/api/auth/sign-out`, { headers })
  expect(signedOut.ok(), await signedOut.text()).toBe(true)
}

/** Signs `email` in and opens Profile → Account at its picture row. */
async function openAccount(page: Page, email: string): Promise<Locator> {
  await signIn(page, email, password)
  await gotoApp(page, "/profile/account", page.locator("[data-e2e=profile-picture-row]"))
  return page.locator("[data-e2e=profile-picture-row]")
}

async function choose(row: Locator, name: string, mimeType: string, buffer: Buffer) {
  await row.locator("input[type=file]").setInputFiles({ name, mimeType, buffer })
}

/** The signed-in person as the server answers them. */
async function me(page: Page): Promise<{ id: number; pictureId?: string | null }> {
  const response = await page.request.get(`${appBase}/api/auth/me`)
  expect(response.ok(), await response.text()).toBe(true)
  return await response.json()
}

/** The person's picture id, as the server answers it. */
async function pictureId(page: Page): Promise<string | null> {
  return (await me(page)).pictureId ?? null
}

/** Whether the file store holds the picture's object. */
async function stored(request: APIRequestContext, id: string): Promise<boolean> {
  const response = await request.head(`${appBase}/${BUCKET}/pictures/${id}`)
  return response.status() === 200
}

/** Whether `image` has loaded and drawn its picture. */
function drawn(image: Locator): Promise<boolean> {
  return image.evaluate((element) => {
    const img = element as HTMLImageElement
    return img.complete && img.naturalWidth > 0
  })
}

test.describe("the profile picture", () => {
  test("is uploaded, replaced and removed, and each old object leaves the store", async ({ page, request }) => {
    const email = address("own")
    await cleanup(request, email)
    try {
      await signUp(request, email)
      const row = await openAccount(page, email)
      const status = page.locator("[data-e2e=profile-picture-status]")
      const chooser = row.locator("#profile-picture-choose")
      await expect(chooser).toHaveText("Upload profile picture")
      await expect(row.locator("[data-e2e=profile-picture-remove]")).toHaveCount(0)

      await choose(row, "red.png", "image/png", RED)
      await expect(status).toHaveText("Profile picture saved.")
      await expect(chooser).toHaveText("Change profile picture")
      const first = await pictureId(page)
      expect(first).not.toBeNull()
      expect(await stored(request, first!)).toBe(true)
      // The rail's account entry shows it too, through the redirect to the store.
      const rail = page.locator(`[data-e2e=account-menu-button] img`)
      await expect(rail).toHaveAttribute("src", `/api/pictures/${first}`)
      await expect.poll(() => drawn(rail)).toBe(true)

      await choose(row, "black.png", "image/png", BLACK)
      await expect.poll(() => pictureId(page)).not.toBe(first)
      const second = await pictureId(page)
      expect(second).not.toBeNull()
      expect(await stored(request, second!)).toBe(true)
      expect(await stored(request, first!)).toBe(false)

      await row.locator("[data-e2e=profile-picture-remove]").click()
      const dialog = page.locator("[data-e2e=profile-picture-remove-dialog]")
      await expect(dialog).toContainText("Remove your profile picture?")
      await dialog.locator("[data-e2e=confirm-dialog-confirm]").click()
      await expect(status).toHaveText("Profile picture removed.")
      await expect(chooser).toHaveText("Upload profile picture")
      await expect(chooser).toBeFocused()
      expect(await pictureId(page)).toBeNull()
      expect(await stored(request, second!)).toBe(false)
    } finally {
      await cleanup(request, email)
    }
  })

  test("refuses a file that is not the image it claims, and a type the row does not take", async ({ page, request }) => {
    const email = address("lie")
    await cleanup(request, email)
    try {
      await signUp(request, email)
      const row = await openAccount(page, email)
      const error = page.locator("[data-e2e=profile-picture-error]")

      // The browser says PNG; the bytes are text. The server reads them and refuses.
      await choose(row, "photo.png", "image/png", Buffer.from("not an image at all"))
      await expect(error).toContainText(
        "photo.png is not really an image, so it was not used. Choose another file.",
      )
      await expect(error).toBeFocused()
      expect(await pictureId(page)).toBeNull()

      await choose(row, "photo.gif", "image/gif", Buffer.from("GIF89a"))
      await expect(error).toContainText(
        "photo.gif is not a JPEG, PNG or WebP image. Choose one of those.",
      )

      // The API refuses a type the row would not offer, whatever the browser sends.
      const signed = await page.request.post(`${appBase}/api/call/picture.sign`, {
        headers: {
          ...headers,
          "idempotency-key": uuidV7(),
          "x-realtime-user": String((await me(page)).id),
        },
        data: { contentType: "image/svg+xml", size: 100 },
      })
      expect(signed.status()).toBe(400)
    } finally {
      await cleanup(request, email)
    }
  })

  test("an operator removes a person's picture from the admin app", async ({ browser, page, request }) => {
    const adminEmail = address("admin")
    const email = address("ada")
    let admin: BrowserContext | null = null
    try {
      await signUp(request, adminEmail)
      await signUp(request, email)
      const promoted = await request.post(`${appBase}/api/test/set-role`, {
        data: { login: adminEmail, role: ADMINISTRATOR },
      })
      expect(promoted.ok(), await promoted.text()).toBe(true)
      const row = await openAccount(page, email)
      await choose(row, "red.png", "image/png", RED)
      await expect(page.locator("[data-e2e=profile-picture-status]")).toHaveText(
        "Profile picture saved.",
      )
      const id = await pictureId(page)

      admin = await browser.newContext({ baseURL: adminBase })
      const ops = await admin.newPage()
      await ops.goto(`${adminBase}/sign-in`)
      await ops.locator("[data-e2e=auth-form-login]").fill(adminEmail)
      await ops.locator("[data-e2e=auth-form-password]").fill(password)
      await ops.locator("[data-e2e=auth-form-submit]").click()
      await expect(ops).toHaveURL(`${adminBase}/`)
      await ops.goto(`${adminBase}/users?q=${encodeURIComponent(email)}`)
      await ops.locator("[data-e2e=admin-users-list] tbody tr a").first().click()
      await expect(ops.locator("[data-e2e=admin-user-title]")).toHaveText(email)
      const shown = ops.locator("[data-e2e=admin-user-picture] img")
      await expect(shown).toHaveAttribute("src", `/api/admin/users/pictures/${id}`)
      await expect.poll(() => drawn(shown)).toBe(true)

      await ops.locator("[data-e2e=admin-user-menu]").click()
      await ops.locator("[data-e2e=admin-remove-picture-open]").click()
      await expect(ops.locator("[data-e2e=admin-action-dialog]")).toContainText(
        "Remove their profile picture?",
      )
      await ops.locator("[data-e2e=admin-action-submit]").click()
      await expect(ops.locator("[data-e2e=toasts]")).toContainText("profile picture")
      await expect(ops.locator("[data-e2e=admin-user-picture]")).toContainText("None")
      expect(await pictureId(page)).toBeNull()
      // The object leaves the store with the worker, which has no store in this stack: the queue
      // row is covered by tests/integration/profile-pictures.integration.test.ts.
    } finally {
      await admin?.close()
      await cleanup(request, adminEmail)
      await cleanup(request, email)
    }
  })
})
