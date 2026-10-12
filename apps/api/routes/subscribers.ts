import { Hono } from "hono"
import type { Context } from "hono"
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
  subscribeSchema,
  subscriptionConfirmSchema,
} from "@domain/subscribers"
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
  /** Queues the confirm mail; the worker signs and sends it. The same writes for any address. */
  requestConfirmMail: (list: SubscriberList, email: string) => Promise<void>
  /** Queues the welcome mail after a confirm; the worker sends it. */
  requestWelcomeMail: (list: SubscriberList, email: string) => Promise<void>
  /** Where the library's flows write; they redact every address first. */
  log: SubscriberLog
}

/**
 * Mail subscriptions for visitors, at `/api/subscribers`:
 *
 * - `GET /` says whether subscriptions are on, as `{ enabled }`: the public website asks before it
 *   offers its form. It is the one route that answers when they are off.
 * - `POST /` takes `{ email, list }` and answers 202 for any valid address, listed, new or over its
 *   own limit, with the same writes, so the answer tells nothing about the list.
 * - `GET /confirm` previews a confirm link; `POST /confirm` adds the address.
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
  const flows = new Map<SubscriberList, Promise<FlowDeps>>()
  const flowsFor = (setup: SubscribersSetup, list: SubscriberList): Promise<FlowDeps> => {
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
        sendMail: async (mail) => {
          if (mail.kind === `welcome`) await deps.requestWelcomeMail(list, mail.email)
        },
        log: deps.log,
      }))
      flows.set(list, found)
    }
    return found
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
      if (!deps.setup) return c.json({ error: SUBSCRIBERS_OFF }, 503)
      await next()
    })
    .post(`/`, sameOrigin, deps.rateLimits.subscribeByIp, async (c) => {
      const body = await readJsonBody(c, { maxBytes: SUBSCRIBE_MAX_BYTES })
      const checked = validate(subscribeSchema, body)
      if (checked.error) return c.json({ error: checked.error.description }, 400)
      const { list } = checked.data
      if (!isSubscriberList(list)) return c.json({ error: SUBSCRIBE_UNKNOWN_LIST }, 400)
      const email = parseBareAddress(checked.data.email.trim())
      if (email === null) return c.json({ error: SUBSCRIBE_INVALID_ADDRESS }, 400)
      // Spent for every address, listed or not. Over it, the answer is the same and nothing is
      // written, so an inbox gets at most a few confirm mails an hour, whoever asks.
      const decision = await deps.rateLimits.mailByRecipient(email)
      if (decision.allowed) await deps.requestConfirmMail(list, email)
      return c.json({}, 202)
    })
    .get(`/confirm`, deps.rateLimits.tokenByIp, async (c) => {
      noStore(c)
      const link = linkQuery(c)
      if (!link) return c.json({ state: `invalid` }, 400)
      const preview = await previewConfirmation(link.token, await flowsFor(deps.setup!, link.list))
      return c.json(preview, preview.state === `confirm` ? 200 : 400)
    })
    .post(`/confirm`, sameOrigin, deps.rateLimits.tokenByIp, async (c) => {
      noStore(c)
      const checked = validate(
        subscriptionConfirmSchema,
        await readJsonBody(c, { maxBytes: SUBSCRIBE_MAX_BYTES }),
      )
      if (checked.error || !isSubscriberList(checked.data.list)) {
        return c.json({ state: `invalid` }, 400)
      }
      const { list, token } = checked.data
      const outcome = await confirmSubscription(token, await flowsFor(deps.setup!, list))
      if (outcome.state === `confirmed`) {
        await outcome.mails
        return c.json({ state: `done` })
      }
      return c.json({ state: outcome.state }, outcome.state === `error` ? 500 : 400)
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
        return c.json({ state: `not-recognised` }, 404)
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
        return c.json({ state: `not-recognised` }, 404)
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
    case `not-recognised`:
      return c.json({ state: outcome.state }, 404)
    case `limited`:
      c.header(`Retry-After`, String(Math.ceil(outcome.retryAfterMs / 1000)))
      return c.json({ state: outcome.state }, 429)
    case `error`:
      return c.json({ state: outcome.state }, 500)
  }
}
