import { Hono } from "hono"
import type { Context } from "hono"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { ErrorCode } from "@domain/errors"
import { validate } from "@spy4x/validation"
import { parseBareAddress } from "@spy4x/email/address"
import { readJsonBody } from "@spy4x/server/http/bounded-body"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import {
  confirmSubscription,
  type FlowDeps,
  previewConfirmation,
  previewUnsubscribe,
  type SubscriberLog,
  type SubscriberStore,
  TOKEN_PAGE_HEADERS,
  unsubscribe,
  UNSUBSCRIBE_FORM_MAX_BYTES,
  unsubscribeTokenFrom,
} from "@spy4x/server/subscribers"
import {
  isSubscriberList,
  SUBSCRIBER_TOKEN_MAX_LENGTH,
  type SubscriberList,
  type SubscriberTokenRefusal,
  subscribeSchema,
  subscriptionConfirmSchema,
} from "@domain/subscribers"
import type { Language } from "@domain/identity"
import {
  createListCrypto,
  isCurrentSubscriberToken,
  subscriberConfirmLink,
  subscriberPagesUrl,
  type SubscribersSetup,
  subscriberUnsubscribeLink,
} from "@server/subscribers/subscribers.ts"
import type { APIContext } from "../_types.ts"
import type { SubscriberRateLimits } from "../middlewares/subscriber-rate-limits.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"

/** A subscribe body is an address and a list name: 4 KiB holds any real one. */
export const SUBSCRIBE_MAX_BYTES = 4 * 1024

export const SUBSCRIBE_INVALID_ADDRESS = `Enter a valid e-mail address`
export const SUBSCRIBE_UNKNOWN_LIST = `There is no such mailing list`
export const SUBSCRIBERS_OFF = `Mail subscriptions are off`

export interface SubscribersRouteDependencies {
  /**
   * `null` when `SUBSCRIBERS_SECRET` is not set in production: every route but `GET /` answers
   * 503.
   */
  setup: SubscribersSetup | null
  /** The store of one list. */
  store: (list: SubscriberList) => SubscriberStore
  /** The app's own address, as `config.webAppUrl`. */
  webAppUrl: string
  rateLimits: SubscriberRateLimits
  /**
   * Queues the confirm mail in `language`, the asking page's (`null`: the product's main one); the
   * worker signs and sends it. The same writes for any address.
   */
  requestConfirmMail: (
    list: SubscriberList,
    email: string,
    language: Language | null,
  ) => Promise<void>
  /** Queues the welcome mail after a confirm, in `language`; the worker sends it. */
  requestWelcomeMail: (
    list: SubscriberList,
    email: string,
    language: Language | null,
  ) => Promise<void>
  /** Keeps `language`, the page's the address confirmed on, as the subscriber's (#527). */
  rememberLanguage: (list: SubscriberList, email: string, language: Language) => Promise<void>
  /** Where the library's flows write; they redact every address first. */
  log: SubscriberLog
}

/**
 * Mail subscriptions for visitors, at `/api/subscribers`:
 *
 * - `GET /` says whether subscriptions are on, as `{ enabled }`: the public website asks before it
 *   offers its form. It is the one route that answers when they are off.
 * - `POST /` takes `{ email, list, language? }` and answers 202 for any valid address, listed, new or over its
 *   own limit, with the same writes, so the answer tells nothing about the list.
 * - `GET /confirm` previews a confirm link; `POST /confirm` adds the address, and keeps the
 *   language of the page it was confirmed on (`{ list, token, language? }`) for its mails.
 * - `GET /unsubscribe` is the link in every mail: it redirects a person to the unsubscribe page,
 *   on the public website when that is deployed (`setup.siteUrl`), else in the app.
 * - `GET /unsubscribe/preview` says whom an unsubscribe link names, for that page.
 * - `POST /unsubscribe` removes the address: the target of a mail client's one-click POST (RFC
 *   8058), which carries no browser header, and of the page's form.
 *
 * Every response to a token carries `Cache-Control: no-store`.
 */
export function createSubscribersRoute(deps: SubscribersRouteDependencies): Hono<APIContext> {
  const expectedOrigin = new URL(deps.webAppUrl).origin
  const sameOrigin = createSameOriginMutationGuard<APIContext>({
    expectedOrigin,
    requireSessionCookie: false,
  })
  // Only for the one-click route: its token is the proof, and a mail provider's POST carries
  // neither Origin nor Sec-Fetch-Site. A browser's cross-site POST carries Origin and is refused.
  const oneClick = createSameOriginMutationGuard<APIContext>({
    expectedOrigin,
    requireSessionCookie: false,
    allowHeaderless: true,
  })
  const flows = new Map<SubscriberList, Promise<Omit<FlowDeps, `sendMail`>>>()
  /** The flows of `list`; a welcome mail they send is written in `language`. */
  const flowsFor = async (
    setup: SubscribersSetup,
    list: SubscriberList,
    language: Language | null = null,
  ): Promise<FlowDeps> => {
    let found = flows.get(list)
    if (!found) {
      found = createListCrypto(setup, list).then((crypto) => ({
        crypto,
        store: deps.store(list),
        links: {
          confirm: (token) =>
            subscriberConfirmLink(subscriberPagesUrl(setup, deps.webAppUrl), list, token),
          unsubscribe: (token) => subscriberUnsubscribeLink(deps.webAppUrl, list, token),
        },
        log: deps.log,
      }))
      flows.set(list, found)
    }
    return {
      ...await found,
      sendMail: async (mail) => {
        if (mail.kind === `welcome`) await deps.requestWelcomeMail(list, mail.email, language)
      },
    }
  }
  /** The list and token of a link's query, or `null` when either is missing or not ours. */
  const linkQuery = (c: Context<APIContext>) => {
    const list = c.req.query(`list`)
    const token = c.req.query(`token`)
    if (!isSubscriberList(list) || !token || token.length > SUBSCRIBER_TOKEN_MAX_LENGTH) return null
    return { list, token }
  }
  // Only the cache rule of TOKEN_PAGE_HEADERS: the app's own `Referrer-Policy: no-referrer` is
  // stricter than its `strict-origin`, and stays.
  const noStore = (c: Context<APIContext>) => {
    c.header(`Cache-Control`, TOKEN_PAGE_HEADERS[`Cache-Control`])
  }

  return new Hono<APIContext>()
    .get(`/`, (c) => c.json({ enabled: deps.setup !== null }))
    .use(`*`, async (c, next) => {
      if (!deps.setup) {
        return errorResponse(c, `internal`, { message: SUBSCRIBERS_OFF, status: 503 })
      }
      await next()
    })
    .post(`/`, sameOrigin, deps.rateLimits.subscribeByIp, async (c) => {
      const body = await readJsonBody(c, { maxBytes: SUBSCRIBE_MAX_BYTES })
      const checked = validate(subscribeSchema, body)
      if (checked.error) return validationResponse(c, checked.error.details)
      const { list, language = null } = checked.data
      if (!isSubscriberList(list)) {
        return errorResponse(c, `bad_request`, { message: SUBSCRIBE_UNKNOWN_LIST })
      }
      const email = parseBareAddress(checked.data.email.trim())
      if (email === null) {
        return errorResponse(c, `bad_request`, { message: SUBSCRIBE_INVALID_ADDRESS })
      }
      // Spent for every address, listed or not. Over it, the answer is the same and nothing is
      // written, so an inbox gets at most a few confirm mails an hour, whoever asks.
      const decision = await deps.rateLimits.mailByRecipient(email)
      if (decision.allowed) await deps.requestConfirmMail(list, email, language)
      return c.json({}, 202)
    })
    .get(`/confirm`, deps.rateLimits.tokenByIp, async (c) => {
      noStore(c)
      const link = linkQuery(c)
      if (!link) return tokenRefusal(c, `invalid`)
      const preview = await previewConfirmation(link.token, await flowsFor(deps.setup!, link.list))
      // A preview that failed on our side keeps the 400 it always had.
      return preview.state === `confirm` ? c.json(preview) : tokenRefusal(c, preview.state, 400)
    })
    .post(`/confirm`, sameOrigin, deps.rateLimits.tokenByIp, async (c) => {
      noStore(c)
      const checked = validate(
        subscriptionConfirmSchema,
        await readJsonBody(c, { maxBytes: SUBSCRIBE_MAX_BYTES }),
      )
      if (checked.error || !isSubscriberList(checked.data.list)) {
        return tokenRefusal(c, `invalid`)
      }
      const { list, token, language = null } = checked.data
      const outcome = await confirmSubscription(token, await flowsFor(deps.setup!, list, language))
      if (outcome.state === `confirmed`) {
        if (language !== null) await deps.rememberLanguage(list, outcome.email, language)
        await outcome.mails
        return c.json({ state: `done` })
      }
      return tokenRefusal(c, outcome.state)
    })
    .get(`/unsubscribe`, (c) => {
      noStore(c)
      const link = linkQuery(c)
      const query = link ? `?${new URLSearchParams(link)}` : ``
      return c.redirect(
        `${subscriberPagesUrl(deps.setup!, deps.webAppUrl)}/unsubscribe${query}`,
        303,
      )
    })
    .get(`/unsubscribe/preview`, deps.rateLimits.tokenByIp, async (c) => {
      noStore(c)
      const link = linkQuery(c)
      if (!link || !isCurrentSubscriberToken(link.token)) {
        return tokenRefusal(c, `not-recognised`)
      }
      const preview = await previewUnsubscribe(link.token, await flowsFor(deps.setup!, link.list))
      return unsubscribeAnswer(c, preview)
    })
    .post(`/unsubscribe`, oneClick, deps.rateLimits.tokenByIp, async (c) => {
      noStore(c)
      const list = c.req.query(`list`)
      const token = await unsubscribeTokenFrom(c.req.raw, { maxBytes: UNSUBSCRIBE_FORM_MAX_BYTES })
      if (
        !isSubscriberList(list) || !token || token.length > SUBSCRIBER_TOKEN_MAX_LENGTH ||
        !isCurrentSubscriberToken(token)
      ) {
        return tokenRefusal(c, `not-recognised`)
      }
      return unsubscribeAnswer(c, await unsubscribe(token, await flowsFor(deps.setup!, list)))
    })
}

/** The status of each unsubscribe state; a preview's address goes back to the page that asked. */
function unsubscribeAnswer(
  c: Context<APIContext>,
  outcome:
    | { state: `confirm`; email: string }
    | { state: `done` | `not-recognised` | `error` }
    | { state: `limited`; retryAfterMs: number },
) {
  switch (outcome.state) {
    case `confirm`:
    case `done`:
      return c.json(outcome)
    case `limited`:
      c.header(`Retry-After`, String(Math.ceil(outcome.retryAfterMs / 1000)))
      return tokenRefusal(c, outcome.state)
    default:
      return tokenRefusal(c, outcome.state)
  }
}

/** How a token route answers each refused state: its code, status and English sentence. */
const TOKEN_REFUSALS: Record<
  SubscriberTokenRefusal | `error`,
  { code: ErrorCode; status: ContentfulStatusCode; message: string }
> = {
  invalid: { code: `bad_request`, status: 400, message: `This link is not valid.` },
  expired: { code: `bad_request`, status: 400, message: `This link has expired.` },
  "not-recognised": { code: `not_found`, status: 404, message: `This link is not recognised.` },
  limited: { code: `rate_limited`, status: 429, message: `Too many tries. Try again later.` },
  error: { code: `internal`, status: 500, message: `Request failed` },
}

/**
 * A token route's refusal: the error body with the state as its `reason`, which the confirm and
 * unsubscribe pages read. A failure on our side carries no reason.
 */
function tokenRefusal(
  c: Context<APIContext>,
  state: SubscriberTokenRefusal | `error`,
  status = TOKEN_REFUSALS[state].status,
): Response {
  const { code, message } = TOKEN_REFUSALS[state]
  return errorResponse(c, code, {
    message,
    status,
    ...(state === `error` ? {} : { reason: state }),
  })
}
