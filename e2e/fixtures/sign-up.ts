import {
  type APIRequestContext,
  type APIResponse,
  expect,
  type Locator,
  type Page,
} from "@playwright/test"
import { gotoApp, signedInHome } from "./app.ts"
import { BILLING_WEBHOOK_PATH, stripeSignature, subscriptionEvent } from "./billing.ts"

/**
 * The subject of the mail that carries a code to prove an address, in each language the page can
 * ask for it in: `EmailCodeMail.subject` of `i18n/mail/<language>.ts`.
 */
export const CODE_SUBJECTS: Record<string, string> = {
  en: `Your code to confirm your email`,
  ru: `Код для подтверждения почты`,
  es: `Tu código para confirmar tu correo electrónico`,
  de: `Dein Code zum Bestätigen deiner E-Mail-Adresse`,
  "pt-BR": `Seu código para confirmar o e-mail`,
  ar: `رمز تأكيد بريدك الإلكتروني`,
  fr: `Votre code pour confirmer votre adresse e-mail`,
  ja: `メールアドレス確認用のコード`,
  "zh-CN": `你的邮箱验证码`,
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
 * Waits for a mail to `email` whose subject starts with `subject` (a subject can end in the host,
 * whose port differs between stacks), and answers the code in it: the
 * second paragraph, as with the sign-up code. Earlier mails, such as the sign-up code, are passed
 * over until it arrives.
 */
export async function mailedCode(
  api: APIRequestContext,
  lastMailUrl: string,
  email: string,
  subject: string,
): Promise<string> {
  let code = ``
  await expect.poll(async () => {
    const mail = await lastMail(api, lastMailUrl, email)
    if (!mail?.subject.startsWith(subject)) return false
    code = mail.text.split(`\n\n`)[1].trim()
    return true
  }, { timeout: 20_000, message: `the worker mails "${subject}" to ${email}` }).toBe(true)
  return code
}

/**
 * Signs up through the API the way a person does: posts the address and password to
 * `signUpUrl` (`…/api/auth/password/sign-up`, absolute or relative to `api`'s base URL), reads the
 * code the worker mails from the development route, and enters it at `…/verify` with the same
 * headers. Answers the verify response, which signs the new account in as the old one-step sign-up
 * did, or the sign-up's own response when that one was refused. When the stack's free plan allows
 * nothing, the new group is then put on the paid plan, unless `plan.keepFree` (see
 * {@link NewGroupPlan}).
 */
export async function signUpWithCode(
  api: APIRequestContext,
  signUpUrl: string,
  options: PostOptions,
  plan: NewGroupPlan = {},
): Promise<APIResponse> {
  const email = String((options.data as { email: string }).email)
  const origin = signUpUrl.replace(`/api/auth/password/sign-up`, ``)
  const lastMailUrl = `${origin}/api/test/last-mail`
  const before = await lastMail(api, lastMailUrl, email)
  const requested = await api.post(signUpUrl, options)
  if (!requested.ok()) return requested
  const code = await nextCode(api, lastMailUrl, email, before)
  const verified = await api.post(`${signUpUrl}/verify`, {
    headers: options.headers,
    data: { code },
  })
  if (verified.ok() && !plan.keepFree && await freePlanAllowsNothing(api, origin)) {
    await payForSelectedGroup(api, origin, email)
  }
  return verified
}

/**
 * Signs up through the form, as a new person does: the address and the password, then
 * the code the worker mails, read from the development route. The app then loads its home page
 * itself; waits for `ready` there. When the stack's free plan allows nothing, the app lands on the
 * group's Billing tab instead: the group is put on the paid plan and the home page opened.
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
  const origin = new URL(page.url()).origin
  const lastMailUrl = `${origin}/api/test/last-mail`
  const before = await lastMail(page.request, lastMailUrl, email)
  await page.locator(`[data-e2e=auth-form-submit]`).click()
  const field = page.locator(`[data-e2e=mailed-code-step-code]`)
  await expect(field).toBeFocused()
  await field.pressSequentially(await nextCode(page.request, lastMailUrl, email, before))
  if (await freePlanAllowsNothing(page.request, origin)) {
    // The app sends the owner of a group that never paid to its Billing tab; pay, then go on.
    await gotoApp(page, signedInHome(), page.locator(`[data-e2e=shell-ws-status]`), async () => {
      await field.press(`Enter`)
      await page.waitForURL(BILLING_LANDING)
    })
    await payForSelectedGroup(page.request, origin, email)
    await gotoApp(page, signedInHome(), ready)
    return
  }
  await gotoApp(page, signedInHome(), ready, async () => {
    await field.press(`Enter`)
    await page.waitForURL(signedInHome())
  })
}

/** Where a new owner lands when the free plan allows nothing: the group's Billing tab. */
export const BILLING_LANDING = /\/groups\/[0-9a-f-]{36}\/billing$/

/** What a sign-up, or a fixture that creates a group, does about the new group's plan. */
export interface NewGroupPlan {
  /**
   * Keep the new group on the free plan. Leave it out and, when the stack's free plan allows
   * nothing, the group is put on the paid plan, so a spec about anything else can add notes and
   * members on any product's catalog. Only a spec about the free plan itself sets it.
   */
  keepFree?: boolean
}

/** One answer per stack: the catalog does not change while it runs. */
const freePlanAnswers = new Map<string, Promise<boolean>>()

/**
 * Whether the stack at `origin` (`http://app.localhost`, or `` for `api`'s base URL) takes
 * payments and its free plan allows nothing, from the development route `/api/test/free-plan`.
 * Throws when the route does not answer, so a spec never quietly runs on the wrong plan.
 */
export function freePlanAllowsNothing(api: APIRequestContext, origin: string): Promise<boolean> {
  const url = `${origin}/api/test/free-plan`
  let answer = freePlanAnswers.get(url)
  if (!answer) {
    answer = (async () => {
      const response = await api.get(url)
      if (!response.ok()) {
        throw new Error(`${url} answered ${response.status()}: ${await response.text()}`)
      }
      return (await response.json() as { allowsNothing: boolean }).allowsNothing
    })()
    // A failed read is not kept: the next spec asks again and reports its own failure.
    answer.catch(() => freePlanAnswers.delete(url))
    freePlanAnswers.set(url, answer)
  }
  return answer
}

/**
 * Puts the group the signed-in person of `api` has selected (the one sign-up made) on the paid
 * plan, as {@link payForGroup} does. It waits for the worker to finish `email`'s starter data
 * first: on the free plan that allows nothing the welcome note is refused, so every run gets none,
 * whichever of the job and the payment would have come first.
 */
async function payForSelectedGroup(
  api: APIRequestContext,
  origin: string,
  email: string,
): Promise<void> {
  await expect.poll(async () => {
    const response = await api.post(`${origin}/api/test/starter-data`, { data: { login: email } })
    if (!response.ok()) throw new Error(`starter data of ${email}: ${response.status()}`)
    return (await response.json() as { done: boolean }).done
  }, { timeout: 20_000, message: `the worker handles the starter data of ${email}` }).toBe(true)
  const selected = await api.get(`${origin}/api/groups/selected`)
  const { groupId } = await selected.json() as { groupId: string | null }
  if (!groupId) throw new Error(`sign-up found no selected group: ${selected.status()}`)
  await pay(api, origin, groupId)
}

/**
 * Puts a group a spec created on the paid plan when the stack's free plan allows nothing, so the
 * spec can add notes, files and members to it on any product's catalog; on a free plan that allows
 * something it does nothing. It pays through the development provider's webhook, as a customer's
 * checkout would. A spec about the free plan itself does not call it.
 */
export async function payForGroup(
  api: APIRequestContext,
  origin: string,
  groupId: string,
): Promise<void> {
  if (await freePlanAllowsNothing(api, origin)) await pay(api, origin, groupId)
}

/**
 * Cancels the subscription {@link payForGroup} gave `groupId`, so the spec can delete the group: a
 * group someone still pays for cannot be deleted. It does nothing when nothing was paid.
 */
export async function stopPaying(
  api: APIRequestContext,
  origin: string,
  groupId: string,
): Promise<void> {
  if (await freePlanAllowsNothing(api, origin)) await pay(api, origin, groupId, `canceled`)
}

/**
 * Sends the development provider's signed webhook for `groupId`'s subscription. The subscription
 * and customer ids come from the group's, so specs that pay side by side never share one, and the
 * cancellation finds the subscription the payment made; it is a second later, so it is not older.
 */
async function pay(
  api: APIRequestContext,
  origin: string,
  groupId: string,
  status: `active` | `canceled` = `active`,
): Promise<void> {
  const id = groupId.replaceAll(`-`, ``)
  const data = subscriptionEvent({
    type: status === `active` ? `customer.subscription.created` : `customer.subscription.deleted`,
    reference: groupId,
    subscriptionId: `sub_${id}`,
    customerId: `cus_${id}`,
    status,
    createdAt: status === `active` ? 1679609768 : 1679609769,
  })
  const headers = {
    "content-type": `application/json`,
    "stripe-signature": await stripeSignature(data),
  }
  const sent = await api.post(`${origin}${BILLING_WEBHOOK_PATH}`, { headers, data })
  if (!sent.ok()) throw new Error(`the ${status} webhook for ${groupId} failed: ${sent.status()}`)
}
