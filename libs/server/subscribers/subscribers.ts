import { decodeBase64Url } from "@std/encoding"
import { createSubscriptionCrypto, type SubscriptionCrypto } from "@spy4x/server/subscribers"
import { deriveSecret, MIN_SECRET_LENGTH } from "@spy4x/platform/tokens"
import type { SubscriberList } from "@domain/subscribers"

/**
 * Signs the subscriber links of a development stack that sets no `SUBSCRIBERS_SECRET`. Public on
 * purpose and accepted only with `ENV=dev`: a development stack also serves every mail it sends at
 * `/api/test/last-mail`, so nothing a token protects is secret there. Production without the
 * variable turns the feature off instead.
 */
export const DEV_SUBSCRIBERS_SECRET = `dev-only-subscribers-secret-never-used-in-production`

/** The secrets every subscriber token is signed and checked with. */
export interface SubscribersSetup {
  /** Signs every new token, at least {@link MIN_SECRET_LENGTH} printable characters. */
  secret: string
  /** Verify-only secrets from before a rotation, oldest last. */
  previousSecrets: string[]
  /**
   * The public website's address, such as `https://www.example.com`, when it is deployed
   * (`MPA_DOMAIN`). Its confirm and unsubscribe pages work without JavaScript, so the mailed links
   * open them. Unset → the links open the same pages of the app.
   */
  siteUrl?: string
}

/**
 * The public website's address, such as `https://www.example.com`, from `MPA_DOMAIN`, or `null`
 * while the website is not deployed. Plain HTTP only in development, as for the app's own
 * address. A value with a scheme throws, so the process stops at start-up.
 */
export function readSiteUrl(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): string | null {
  const site = env.get(`MPA_DOMAIN`)?.trim() ?? ``
  if (site.includes(`://`)) {
    throw new Error(`MPA_DOMAIN must be a host such as www.example.com, without a scheme`)
  }
  return site === `` ? null : new URL(`http${mode === `dev` ? `` : `s`}://${site}`).origin
}

/**
 * Reads `SUBSCRIBERS_SECRET` and the comma-separated `SUBSCRIBERS_PREVIOUS_SECRETS`. Unset in
 * development → {@link DEV_SUBSCRIBERS_SECRET}; unset in production → `null`, the feature is off.
 * Also reads `MPA_DOMAIN`, the public website's host, as {@link SubscribersSetup.siteUrl}: plain
 * HTTP only in development, as for the app's own address.
 * A secret that is set but unusable (shorter than 32 characters, not printable ASCII, equal to the
 * cookie secret, or the public development secret outside development) throws, so the process
 * stops at start-up. No error names a value.
 */
export function readSubscribersSetup(
  env: { get(name: string): string | undefined },
  mode: `dev` | `prod`,
): SubscribersSetup | null {
  const secret = env.get(`SUBSCRIBERS_SECRET`)?.trim() ?? ``
  const previousSecrets = (env.get(`SUBSCRIBERS_PREVIOUS_SECRETS`) ?? ``)
    .split(`,`)
    .map((value) => value.trim())
    .filter((value) => value !== ``)
  const siteUrl = readSiteUrl(env, mode)
  const pages = siteUrl === null ? {} : { siteUrl }
  if (secret === ``) {
    return mode === `dev` ? { secret: DEV_SUBSCRIBERS_SECRET, previousSecrets: [], ...pages } : null
  }
  const cookieSecret = env.get(`AUTH_COOKIE_SECRET`)?.trim()
  if ([secret, ...previousSecrets].some((value) => value === cookieSecret)) {
    throw new Error(`subscriber secrets must differ from AUTH_COOKIE_SECRET`)
  }
  if (mode !== `dev` && [secret, ...previousSecrets].includes(DEV_SUBSCRIBERS_SECRET)) {
    throw new Error(`subscriber secrets must not be the public development secret outside dev`)
  }
  for (
    const [name, value] of [
      [`SUBSCRIBERS_SECRET`, secret],
      ...previousSecrets.map((value) => [`SUBSCRIBERS_PREVIOUS_SECRETS`, value]),
    ]
  ) {
    try {
      createSubscriptionCrypto({ secret: value })
    } catch {
      throw new Error(
        `${name} must be at least ${MIN_SECRET_LENGTH} printable characters (openssl rand -base64 48)`,
      )
    }
  }
  return { secret, previousSecrets, ...pages }
}

/** Says what a process without subscriber secrets does, or `null` when it has them. */
export function subscribersOffWarning(setup: SubscribersSetup | null): string | null {
  return setup ? null : `⚠️ SUBSCRIBERS_SECRET is not set: mail subscriptions are off`
}

/**
 * The tokens and keyed hashes of one list. Each list signs with its own key, derived from the
 * configured secret with the list's name, because the library's tokens name no list: without it, a
 * confirm link for one list would also join another.
 */
export async function createListCrypto(
  setup: SubscribersSetup,
  list: SubscriberList,
): Promise<SubscriptionCrypto> {
  const label = `subscribers:list:${list}`
  return createSubscriptionCrypto({
    secret: await deriveSecret(setup.secret, label),
    previousSecrets: await Promise.all(
      setup.previousSecrets.map((previous) => deriveSecret(previous, label)),
    ),
  })
}

/** The version of every token the template signs. */
const CURRENT_TOKEN_VERSION = 2

/**
 * Whether `token` claims the token format the template signs, read without verifying it. The
 * library still accepts antonshubin.com's unsigned-lookup version 1 unsubscribe tokens, and checks
 * one of those against every subscriber row: the routes refuse anything else before the library
 * sees it, so a forged token costs one lookup at most.
 */
export function isCurrentSubscriberToken(token: string): boolean {
  try {
    const envelope = JSON.parse(new TextDecoder().decode(decodeBase64Url(token.split(`.`)[0])))
    return envelope?.version === CURRENT_TOKEN_VERSION
  } catch {
    return false
  }
}

/**
 * The key of an address in the per-address confirm mail budget: an HMAC under a key derived from
 * the secret, so whoever reads Valkey cannot match a key to an address by hashing a guess.
 */
export async function createRecipientLimitKey(
  setup: SubscribersSetup,
): Promise<(email: string) => Promise<string>> {
  const crypto = createSubscriptionCrypto({
    secret: await deriveSecret(setup.secret, `subscribers:recipient-limit`),
  })
  return (email) => crypto.subscriberKey(email)
}

/**
 * Where the confirm and unsubscribe pages are: the public website when it is deployed, else the
 * app at `webAppUrl`. The first argument of {@link subscriberConfirmLink}, and where the API sends
 * a person who opens an unsubscribe link.
 */
export function subscriberPagesUrl(setup: SubscribersSetup, webAppUrl: string): string {
  return setup.siteUrl ?? webAppUrl
}

/**
 * The page a confirm link opens, at `pagesUrl` ({@link subscriberPagesUrl}). The token rides in
 * the query; the page posts it back.
 */
export function subscriberConfirmLink(pagesUrl: string, list: string, token: string): string {
  return `${pagesUrl}/subscribe/confirm?${new URLSearchParams({ list, token })}`
}

/**
 * The unsubscribe link a mail carries, in its body and in `List-Unsubscribe`. It points at the
 * API, which is served at the app's address whether or not the website is deployed: a mail
 * client's one-click POST (RFC 8058) lands there directly, and a person's GET is redirected to the
 * unsubscribe page at {@link subscriberPagesUrl}.
 */
export function subscriberUnsubscribeLink(webAppUrl: string, list: string, token: string): string {
  return `${webAppUrl}/api/subscribers/unsubscribe?${new URLSearchParams({ list, token })}`
}
