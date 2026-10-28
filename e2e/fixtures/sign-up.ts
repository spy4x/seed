import {
  type APIRequestContext,
  type APIResponse,
  expect,
  type Locator,
  type Page,
} from "@playwright/test"
import { gotoApp } from "./app.ts"

/**
 * The subject of the mail that carries a code to prove an address, in each language the page can
 * ask for it in (#277): `EmailCodeMail.subject` of `i18n/mail/<language>.json`.
 */
export const CODE_SUBJECTS: Record<string, string> = {
  en: `Your code to confirm your e-mail address`,
  ru: `Код для подтверждения адреса электронной почты`,
  es: `Tu código para confirmar tu correo electrónico`,
  de: `Dein Code zur Bestätigung deiner E-Mail-Adresse`,
  "pt-BR": `Seu código para confirmar seu e-mail`,
  ar: `رمزك لتأكيد بريدك الإلكتروني`,
}

/** The options `APIRequestContext.post` takes, as the specs pass them to the sign-up route. */
type PostOptions = NonNullable<Parameters<APIRequestContext["post"]>[1]>

export interface Mail {
  subject: string
  text: string
}

/**
 * The newest mail the dev worker sent to `email`, or `null`. `lastMailUrl` is the development route
 * `/api/test/last-mail`. Read it before an action that mails a code, for {@link nextCode}.
 */
export async function lastMail(
  api: APIRequestContext,
  lastMailUrl: string,
  email: string,
): Promise<Mail | null> {
  const response = await api.post(lastMailUrl, { data: { email } })
  return response.ok() ? (await response.json()) as Mail : null
}

/**
 * Waits for a code mail to `email` newer than `before`, and answers its code. `lastMailUrl` is the
 * development route `/api/test/last-mail` on the origin the spec talks to.
 */
export async function nextCode(
  api: APIRequestContext,
  lastMailUrl: string,
  email: string,
  before: Mail | null,
): Promise<string> {
  let code = ``
  await expect.poll(async () => {
    const mail = await lastMail(api, lastMailUrl, email)
    if (!mail || !Object.values(CODE_SUBJECTS).includes(mail.subject)) return false
    if (mail.text === before?.text) return false
    code = mail.text.split(`\n\n`)[1].trim()
    return true
  }, { timeout: 20_000, message: `the worker mails the sign-up code to ${email}` }).toBe(true)
  return code
}

/**
 * Signs up through the API the way a person does since #142: posts the address and password to
 * `signUpUrl` (`…/api/auth/password/sign-up`, absolute or relative to `api`'s base URL), reads the
 * code the worker mails from the development route, and enters it at `…/verify` with the same
 * headers. Answers the verify response, which signs the new account in as the old one-step sign-up
 * did, or the sign-up's own response when that one was refused.
 */
export async function signUpWithCode(
  api: APIRequestContext,
  signUpUrl: string,
  options: PostOptions,
): Promise<APIResponse> {
  const email = String((options.data as { email: string }).email)
  const lastMailUrl = signUpUrl.replace(`/api/auth/password/sign-up`, `/api/test/last-mail`)
  const before = await lastMail(api, lastMailUrl, email)
  const requested = await api.post(signUpUrl, options)
  if (!requested.ok()) return requested
  const code = await nextCode(api, lastMailUrl, email, before)
  return await api.post(`${signUpUrl}/verify`, { headers: options.headers, data: { code } })
}

/**
 * Signs up through the form, as a new person does since #142: the address and the password, then
 * the code the worker mails, read from the development route. The app then loads its home page
 * itself; waits for `ready` there.
 */
export async function signUpInPage(
  page: Page,
  email: string,
  password: string,
  ready: Locator,
): Promise<void> {
  await gotoApp(page, `/sign-up`, page.locator(`[data-e2e=auth-form-login]`))
  await page.locator(`[data-e2e=auth-form-login]`).fill(email)
  await page.locator(`[data-e2e=auth-form-password]`).fill(password)
  const lastMailUrl = new URL(`/api/test/last-mail`, page.url()).href
  const before = await lastMail(page.request, lastMailUrl, email)
  await page.locator(`[data-e2e=auth-form-submit]`).click()
  const field = page.locator(`[data-e2e=sign-up-code-input]`)
  await expect(field).toBeFocused()
  await field.fill(await nextCode(page.request, lastMailUrl, email, before))
  await gotoApp(page, `/notes`, ready, async () => {
    await page.locator(`[data-e2e=sign-up-code-submit]`).click()
    await page.waitForURL(`/notes`)
  })
}
