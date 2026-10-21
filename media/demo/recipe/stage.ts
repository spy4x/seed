/// <reference lib="deno.ns" />
/**
 * Off camera: signs in the two people the demo video follows on a fresh local stack whose
 * database holds the development seed (`deno task db:seed`), and returns their browser state.
 *
 * - A seeded person uses the product app. They get a random password through the product's own
 *   reset flow (the code is read back through the development-only `/api/test/last-mail`), sign
 *   in through the form, open the group the video shows, and put the first-steps card away.
 * - `admin@example.com`, the seed's administrator, signs in to the admin app with the seed's
 *   password.
 *
 * Neither password is ever on screen: both sign-ins happen in contexts that are not recorded.
 */
import type { Browser, BrowserContext, Page } from "playwright"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** A signed-in browser state, as `context.storageState()` gives it. */
export type State = Awaited<ReturnType<BrowserContext["storageState"]>>

/** The seeded person the app part follows, and the group the video opens. */
export interface Person {
  email: string
  groupId: string
}

export const ADMIN_EMAIL = "admin@example.com"

/** A POST to the product app's API as its own pages send it. */
async function post(app: string, path: string, body: unknown): Promise<Response> {
  return await fetch(`${app}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: app,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  })
}

/** Gives `email` a fresh random password through the reset flow and returns it. */
async function resetPassword(app: string, email: string): Promise<string> {
  const lastMail = async () => {
    const response = await post(app, "/test/last-mail", { email: email })
    return response.ok ? await response.json() as { subject: string; text: string } : null
  }
  const before = (await lastMail())?.text
  const forgot = await post(app, "/auth/password/forgot", { email: email })
  if (!forgot.ok) throw new Error(`the reset request answered ${forgot.status}`)
  await forgot.body?.cancel()
  let code: string | null = null
  for (const deadline = Date.now() + 60_000; !code && Date.now() < deadline;) {
    const mail = await lastMail()
    const fresh = mail?.subject === "Reset your password" && mail.text !== before
    const link = fresh ? mail.text.match(/https?:\/\/\S+/) : null
    code = link ? new URL(link[0]).searchParams.get("code") : null
    if (!code) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!code) throw new Error(`no reset mail reached ${email} within 60 s`)
  const password = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
  const reset = await post(app, "/auth/password/reset", {
    email: email,
    code,
    newPassword: password,
  })
  if (!reset.ok) throw new Error(`the reset answered ${reset.status}: ${await reset.text()}`)
  return password
}

/**
 * Signs in through the form at `base`. A fresh dev stack compiles each page on its first load, and
 * its Vite servers may restart meanwhile, so a page that shows no form is loaded again.
 */
async function signIn(page: Page, base: string, login: string, password: string): Promise<void> {
  const field = page.locator("[data-e2e=auth-form-login]")
  for (let attempt = 1;; attempt++) {
    try {
      await page.goto(`${base}/sign-in`, { waitUntil: "commit", timeout: 120_000 })
      await field.waitFor({ timeout: 120_000 })
      break
    } catch (error) {
      if (attempt === 4) throw error
    }
  }
  await field.fill(login)
  await page.locator("[data-e2e=auth-form-password]").fill(password)
  await page.locator("[data-e2e=auth-form-submit]").click()
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), { timeout: 120_000 })
}

/** Opens the group the video shows and puts the first-steps card and the tour offer away. */
async function settle(page: Page, app: string, groupId: string): Promise<void> {
  const headers = { origin: app, "sec-fetch-site": "same-origin" }
  const answers = [
    await page.request.put(`${app}/api/groups/selected`, {
      headers: { ...headers, "idempotency-key": uuidV7() },
      data: { groupId },
    }),
  ]
  // An operation call names the person it is for, as the app's own calls do.
  const me = await page.request.get(`${app}/api/users/me`)
  const profile = await me.json() as { id?: number; user?: { id: number } }
  const userId = profile.id ?? profile.user?.id
  if (typeof userId !== "number") throw new Error(`no user id in /api/users/me: ${me.status()}`)
  for (const op of ["onboarding.dismiss", "onboarding.tour-seen"]) {
    answers.push(
      await page.request.post(`${app}/api/call/${op}`, {
        headers: {
          ...headers,
          "content-type": "application/json",
          "x-realtime-user": String(userId),
          "idempotency-key": uuidV7(),
        },
        data: "null",
      }),
    )
  }
  for (const answer of answers) {
    if (!answer.ok()) throw new Error(`${answer.url()} answered ${answer.status()}: ${await answer.text()}`)
  }
}

/** The browser state of the chosen person in the app and of the administrator in the admin app. */
export async function stage(
  browser: Browser,
  hosts: { app: string; admin: string },
  seedPassword: string,
  userAgent: string,
  person: Person,
): Promise<{ app: State; admin: State }> {
  const password = await resetPassword(hosts.app, person.email)
  const states: Partial<Record<"app" | "admin", State>> = {}
  for (const [key, base, login, secret] of [
    ["app", hosts.app, person.email, password],
    ["admin", hosts.admin, ADMIN_EMAIL, seedPassword],
  ] as const) {
    const context = await browser.newContext({ userAgent })
    try {
      const page = await context.newPage()
      await signIn(page, base, login, secret)
      if (key === "app") await settle(page, base, person.groupId)
      states[key] = await context.storageState()
    } finally {
      await context.close()
    }
  }
  return { app: states.app!, admin: states.admin! }
}
