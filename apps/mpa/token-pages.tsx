import type { JSX } from "preact"
import type { Context } from "@spy4x/preact-server"
import type { SubscriptionConfirmState, UnsubscribeState } from "@domain/subscribers"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import {
  type LocalizePath,
  SubscriptionConfirmScreen,
  UnsubscribeScreen,
} from "@ui/subscribe-screen.tsx"
import { isRecord } from "@spy4x/platform/universal/is-record"
import { readFormBody } from "@spy4x/server/http/bounded-body"
import type { ApiAnswer } from "./api.ts"
import { API_BODIES, FORM_LIMITS } from "./forms.ts"
import { define, type State } from "./utils.ts"

/**
 * The newsletter's token pages, the ones a mailed link opens (`/subscribe/confirm`,
 * `/unsubscribe`), as handler factories. The token flow lives here once; a website passes a
 * {@link TokenPageFrame} that draws it. Seed's own site passes its frame in `subscribers.tsx`; a
 * product that replaces the site's frame passes its own, so it takes every later fix to the flow.
 *
 * @module
 */

/**
 * The pages carry a signed token in their address: no `Referer` leaves them. Seed's
 * `pageMiddleware` already gives every newsletter answer `Cache-Control: no-store`.
 */
export const NO_REFERRER = { "referrer-policy": `no-referrer` }

/** The query a finished step redirects to: the page again, with no token in it. */
const DONE_QUERY = `?state=done`

/** Which token page a frame is asked to draw, and its address before `localize`. */
export interface TokenPageAddress {
  kind: `confirm` | `unsubscribe`
  path: typeof FORM_ACTIONS.subscribeConfirm | typeof FORM_ACTIONS.unsubscribe
}

/** One token page for the frame to draw: the ready screen, and the state it shows. */
export interface TokenPage extends TokenPageAddress {
  /** The screen's state, so a frame can add something to a finished step (`done`). */
  state: SubscriptionConfirmState | UnsubscribeState
  /** Seed's confirm or unsubscribe screen, with the frame's {@link TokenScreenProps}. */
  screen: JSX.Element
}

/** The answer's status and headers; a frame passes them to `ctx.render` as they are. */
export interface TokenPageInit {
  status: number
  headers: Record<string, string>
}

/** What a website changes on the screens. Each one left out keeps the screen's default. */
export interface TokenScreenProps {
  /**
   * Maps the newsletter's own addresses to the website's: the forms' actions, the "ask again" link
   * and the address a finished step redirects to.
   */
  localize?: LocalizePath
  /** The confirm page's link once the address is confirmed, such as back to a catalog. */
  onward?: { href: string; label: string }
  /** The language the confirm form posts, for the subscriber's mails; left out, none is posted. */
  language?: string
}

/**
 * How a website draws its token pages. The factories own everything else: the newsletter-off
 * check, reading the link, the API calls, the statuses, `Retry-After`, `Referrer-Policy` and the
 * redirect after a finished step.
 */
export interface TokenPageFrame {
  /** The screen's props for this request, such as its language's `localize`. */
  screen(ctx: Context<State>): TokenScreenProps
  /** Draws `page.screen` inside the website's frame, with its title and its words. */
  render(ctx: Context<State>, page: TokenPage, init: TokenPageInit): Response | Promise<Response>
  /** Draws the page shown while the API takes no subscriptions (`State.newsletter` is false). */
  off(
    ctx: Context<State>,
    page: TokenPageAddress,
    init: TokenPageInit,
  ): Response | Promise<Response>
}

const CONFIRM: TokenPageAddress = { kind: `confirm`, path: FORM_ACTIONS.subscribeConfirm }
const UNSUBSCRIBE: TokenPageAddress = { kind: `unsubscribe`, path: FORM_ACTIONS.unsubscribe }
const CONFIRM_STATES = [`confirm`, `done`, `expired`, `invalid`] as const
const UNSUBSCRIBE_STATES = [`confirm`, `done`, `not-recognised`] as const

/** What every token page answers while the API takes no subscriptions: 503, as the API's own. */
const OFF_INIT: TokenPageInit = { status: 503, headers: NO_REFERRER }

/** What a page shows, besides its screen props. */
interface Step<S> {
  state: S
  email?: string
  list: string
  token: string
  status: number
  retryAfter?: string
}

function initOf(step: { status: number; retryAfter?: string }): TokenPageInit {
  const headers = step.retryAfter ? { ...NO_REFERRER, "retry-after": step.retryAfter } : NO_REFERRER
  return { status: step.status, headers }
}

function linkOf(url: URL): { list: string; token: string } {
  return { list: url.searchParams.get(`list`) ?? ``, token: url.searchParams.get(`token`) ?? `` }
}

function isDone(url: URL): boolean {
  return url.searchParams.get(`state`) === `done`
}

/** Where a finished step redirects: the page again, at the website's address, with no token. */
function doneAddress(frame: TokenPageFrame, ctx: Context<State>, page: TokenPageAddress): string {
  const localize = frame.screen(ctx).localize ?? ((path: string) => path)
  return `${localize(page.path)}${DONE_QUERY}`
}

/**
 * The state a token route answered with, and the address while it asks for the click. The API
 * answers a refused token with a 4xx status and its state in the body; anything else, an API that
 * cannot be reached included, reads as `error`.
 */
function stepOf<S extends string>(
  answer: ApiAnswer,
  known: readonly S[],
): { state: S | `error`; email?: string } {
  const body = answer.body
  if (!isRecord(body)) return { state: `error` }
  // A refused link answers an error whose reason names the state (docs/api-errors.md).
  const said = isRecord(body.error) ? body.error.reason : body.state
  const state = known.find((candidate) => candidate === said)
  if (!state) return { state: `error` }
  return typeof body.email === `string` ? { state, email: body.email } : { state }
}

/**
 * The confirm page's handlers, drawn by `frame`. `GET` shows what the confirm link holds, asking
 * for a click, so a mail scanner that follows it subscribes no one; `POST` confirms it, with the
 * language the form posts for the subscriber's mails, and 303s to this page without the token, so
 * a reload or the history holds no live link.
 */
export function createSubscriptionConfirmHandlers(frame: TokenPageFrame) {
  function render(ctx: Context<State>, step: Step<SubscriptionConfirmState>) {
    const { localize, onward, language } = frame.screen(ctx)
    const screen = (
      <SubscriptionConfirmScreen
        state={step.state}
        email={step.email}
        list={step.list}
        token={step.token}
        error={null}
        pending={false}
        localize={localize}
        onward={onward}
        language={language}
      />
    )
    return frame.render(ctx, { ...CONFIRM, state: step.state, screen }, initOf(step))
  }
  return define.handlers({
    async GET(ctx) {
      if (!ctx.state.newsletter) return frame.off(ctx, CONFIRM, OFF_INIT)
      if (isDone(ctx.url)) return render(ctx, { state: `done`, list: ``, token: ``, status: 200 })
      const { list, token } = linkOf(ctx.url)
      if (!list || !token) return render(ctx, { state: `invalid`, list, token, status: 400 })
      const answer = await ctx.state.api.call(
        `GET`,
        `/api/subscribers/confirm?${new URLSearchParams({ list, token })}`,
      )
      return render(ctx, { ...stepOf(answer, CONFIRM_STATES), list, token, status: answer.status })
    },
    async POST(ctx) {
      if (!ctx.state.newsletter) return frame.off(ctx, CONFIRM, OFF_INIT)
      const body = API_BODIES.subscriptionConfirm(await readFormBody(ctx.req, FORM_LIMITS))
      const answer = await ctx.state.api.call(`POST`, `/api/subscribers/confirm`, body)
      const step = stepOf(answer, CONFIRM_STATES)
      if (step.state === `done`) return ctx.redirect(doneAddress(frame, ctx, CONFIRM), 303)
      return render(ctx, {
        ...step,
        list: body.list,
        token: body.token,
        status: answer.status,
        retryAfter: answer.retryAfter,
      })
    },
  })
}

/**
 * The unsubscribe page's handlers, drawn by `frame`. `GET` shows the address an unsubscribe link
 * removes, asking for a click; `POST` removes it and 303s to this page without the token. A mail
 * client's one-click unsubscribe posts to the API directly and never reaches this page.
 */
export function createUnsubscribeHandlers(frame: TokenPageFrame) {
  function render(ctx: Context<State>, step: Step<UnsubscribeState>) {
    const screen = (
      <UnsubscribeScreen
        state={step.state}
        email={step.email}
        list={step.list}
        token={step.token}
        error={null}
        pending={false}
        localize={frame.screen(ctx).localize}
      />
    )
    return frame.render(ctx, { ...UNSUBSCRIBE, state: step.state, screen }, initOf(step))
  }
  return define.handlers({
    async GET(ctx) {
      if (!ctx.state.newsletter) return frame.off(ctx, UNSUBSCRIBE, OFF_INIT)
      if (isDone(ctx.url)) return render(ctx, { state: `done`, list: ``, token: ``, status: 200 })
      const { list, token } = linkOf(ctx.url)
      if (!list || !token) return render(ctx, { state: `not-recognised`, list, token, status: 404 })
      const answer = await ctx.state.api.call(
        `GET`,
        `/api/subscribers/unsubscribe/preview?${new URLSearchParams({ list, token })}`,
      )
      return render(ctx, {
        ...stepOf(answer, UNSUBSCRIBE_STATES),
        list,
        token,
        status: answer.status,
        retryAfter: answer.retryAfter,
      })
    },
    async POST(ctx) {
      if (!ctx.state.newsletter) return frame.off(ctx, UNSUBSCRIBE, OFF_INIT)
      const body = API_BODIES.subscriptionToken(await readFormBody(ctx.req, FORM_LIMITS))
      // The API's unsubscribe reads the token from the query or a form body, never from JSON: it is
      // the RFC 8058 one-click target too.
      const answer = await ctx.state.api.call(
        `POST`,
        `/api/subscribers/unsubscribe?${new URLSearchParams(body)}`,
      )
      const step = stepOf(answer, UNSUBSCRIBE_STATES)
      if (step.state === `done`) return ctx.redirect(doneAddress(frame, ctx, UNSUBSCRIBE), 303)
      return render(ctx, { ...step, ...body, status: answer.status, retryAfter: answer.retryAfter })
    },
  })
}
