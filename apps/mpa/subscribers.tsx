import type { FreshContext } from "fresh"
import {
  DEFAULT_SUBSCRIBER_LIST,
  type SubscriptionConfirmState,
  type UnsubscribeState,
} from "@domain/subscribers"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import {
  SUBSCRIBE_FAILURES,
  SubscribeForm,
  SubscriptionConfirmScreen,
  UnsubscribeScreen,
} from "@ui/subscribe-screen.tsx"
import { isRecord } from "@spy4x/platform/universal/is-record"
import { Notice } from "@spy4x/preact-ui/notice"
import { type ApiAnswer, errorMessage } from "./api.ts"
import { readFormBody } from "@spy4x/server/http/bounded-body"
import { API_BODIES, FORM_LIMITS } from "./forms.ts"
import { SiteFrame, type SitePageHead } from "./site.tsx"
import { define, type State } from "./utils.ts"

/**
 * The confirm and unsubscribe pages carry a signed token in their address: no `Referer` leaves
 * them. Every page already answers `Cache-Control: no-store` (`pageMiddleware`).
 */
const NO_REFERRER = { "referrer-policy": "no-referrer" }

/** The pages a mailed link opens: no search engine lists them. */
const TOKEN_PAGE_HEAD = {
  title: "Newsletter",
  description: "Confirm or end your subscription to the Template newsletter.",
  noindex: true,
}

/** The query a finished step redirects to: the page again, with no token in it. */
const DONE_QUERY = "?state=done"

/** The query a taken subscribe request redirects to, so a reload does not send it again. */
const SENT_QUERY = "?state=sent"

const SUBSCRIBE_HEAD = {
  title: "News by e-mail",
  description: "Get a short e-mail when something new ships in Template. Double opt-in, " +
    "one-click unsubscribe.",
}

/**
 * `GET` shows the subscribe form; `POST` asks the API for a confirm link and 303s to this page,
 * which then says the link is sent. A refusal is shown with the API's status and message, and the
 * address stays in the form. While subscriptions are off, neither shows a form.
 */
export const subscribeHandlers = define.handlers({
  GET(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.subscribe, SUBSCRIBE_HEAD)
    const sent = ctx.url.searchParams.get("state") === "sent"
    return renderSubscribe(ctx, { email: "", sent, error: null, status: 200 })
  },
  async POST(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.subscribe, SUBSCRIBE_HEAD)
    const body = API_BODIES.subscribe(await readFormBody(ctx.req, FORM_LIMITS))
    const answer = await ctx.state.api.call("POST", "/api/subscribers", body)
    if (answer.status === 202) return ctx.redirect(`${FORM_ACTIONS.subscribe}${SENT_QUERY}`, 303)
    return renderSubscribe(ctx, {
      email: body.email,
      sent: false,
      error: errorMessage(answer, SUBSCRIBE_FAILURES.subscribe),
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})

/**
 * `GET` shows what the confirm link holds, asking for a click; `POST` confirms it and 303s to this
 * page without the token, so a reload or the history holds no live link.
 */
export const subscriptionConfirmHandlers = define.handlers({
  async GET(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.subscribeConfirm, TOKEN_PAGE_HEAD)
    const { list, token } = linkOf(ctx.url)
    if (ctx.url.searchParams.get("state") === "done") {
      return renderConfirm(ctx, { state: "done", list: "", token: "", status: 200 })
    }
    if (!list || !token) {
      return renderConfirm(ctx, { state: "invalid", list, token, status: 400 })
    }
    const answer = await ctx.state.api.call(
      "GET",
      `/api/subscribers/confirm?${new URLSearchParams({ list, token })}`,
    )
    return renderConfirm(ctx, {
      ...stepOf(answer, CONFIRM_STATES),
      list,
      token,
      status: answer.status,
    })
  },
  async POST(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.subscribeConfirm, TOKEN_PAGE_HEAD)
    const body = API_BODIES.subscriptionToken(await readFormBody(ctx.req, FORM_LIMITS))
    const answer = await ctx.state.api.call("POST", "/api/subscribers/confirm", body)
    const step = stepOf(answer, CONFIRM_STATES)
    if (step.state === "done") {
      return ctx.redirect(`${FORM_ACTIONS.subscribeConfirm}${DONE_QUERY}`, 303)
    }
    return renderConfirm(ctx, {
      ...step,
      ...body,
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})

/**
 * `GET` shows the address an unsubscribe link removes, asking for a click; `POST` removes it and
 * 303s to this page without the token. A mail client's one-click unsubscribe posts to the API
 * directly and never reaches this page.
 */
export const unsubscribeHandlers = define.handlers({
  async GET(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.unsubscribe, TOKEN_PAGE_HEAD)
    const { list, token } = linkOf(ctx.url)
    if (ctx.url.searchParams.get("state") === "done") {
      return renderUnsubscribe(ctx, { state: "done", list: "", token: "", status: 200 })
    }
    if (!list || !token) {
      return renderUnsubscribe(ctx, { state: "not-recognised", list, token, status: 404 })
    }
    const answer = await ctx.state.api.call(
      "GET",
      `/api/subscribers/unsubscribe/preview?${new URLSearchParams({ list, token })}`,
    )
    return renderUnsubscribe(ctx, {
      ...stepOf(answer, UNSUBSCRIBE_STATES),
      list,
      token,
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
  async POST(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.unsubscribe, TOKEN_PAGE_HEAD)
    const body = API_BODIES.subscriptionToken(await readFormBody(ctx.req, FORM_LIMITS))
    // The API's unsubscribe reads the token from the query or a form body, never from JSON: it is
    // the RFC 8058 one-click target too.
    const answer = await ctx.state.api.call(
      "POST",
      `/api/subscribers/unsubscribe?${new URLSearchParams(body)}`,
    )
    const step = stepOf(answer, UNSUBSCRIBE_STATES)
    if (step.state === "done") return ctx.redirect(`${FORM_ACTIONS.unsubscribe}${DONE_QUERY}`, 303)
    return renderUnsubscribe(ctx, {
      ...step,
      ...body,
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})

const CONFIRM_STATES = ["confirm", "done", "expired", "invalid"] as const
const UNSUBSCRIBE_STATES = ["confirm", "done", "not-recognised"] as const

function linkOf(url: URL): { list: string; token: string } {
  return { list: url.searchParams.get("list") ?? "", token: url.searchParams.get("token") ?? "" }
}

/**
 * The state a token route answered with, and the address while it asks for the click. The API
 * answers a refused token with a 4xx status and its state in the body; anything else, an API that
 * cannot be reached included, reads as `error`.
 */
function stepOf<S extends string>(
  answer: ApiAnswer,
  known: readonly S[],
): { state: S | "error"; email?: string } {
  const body = answer.body
  if (!isRecord(body)) return { state: "error" }
  const state = known.find((candidate) => candidate === body.state)
  if (!state) return { state: "error" }
  return typeof body.email === "string" ? { state, email: body.email } : { state }
}

interface PageStatus {
  status: number
  retryAfter?: string
}

function headersOf(page: PageStatus, extra: Record<string, string> = {}) {
  return page.retryAfter ? { ...extra, "retry-after": page.retryAfter } : extra
}

function renderSubscribe(
  ctx: FreshContext<State>,
  page: PageStatus & { email: string; sent: boolean; error: string | null },
): Response | Promise<Response> {
  return ctx.render(
    <SiteFrame
      state={ctx.state}
      path={FORM_ACTIONS.subscribe}
      head={SUBSCRIBE_HEAD}
    >
      <div class="grid items-start gap-8 lg:grid-cols-2">
        <section class="flex flex-col gap-4" aria-label="About the newsletter">
          <p class="text-lg">
            I build Template in public. Subscribe and I write when something new ships: a feature, a
            release, or what I learned on the way.
          </p>
          <ul class="list-disc space-y-2 pl-6 text-muted">
            <li>You confirm by a link first, so nobody can sign you up.</li>
            <li>Every mail has a link that unsubscribes you in one click.</li>
            <li>Your address is used for this newsletter and nothing else.</li>
          </ul>
        </section>
        <SubscribeForm
          email={page.email}
          onEmailChange={() => {}}
          list={DEFAULT_SUBSCRIBER_LIST}
          sent={page.sent}
          error={page.error}
          pending={false}
        />
      </div>
    </SiteFrame>,
    { status: page.status, headers: headersOf(page) },
  )
}

/**
 * What every newsletter page answers while the API takes no subscriptions (`State.newsletter`):
 * status 503 as the API's own, and no form.
 */
function renderOff(
  ctx: FreshContext<State>,
  path: string,
  head: SitePageHead,
): Response | Promise<Response> {
  return ctx.render(
    <SiteFrame state={ctx.state} path={path} head={{ ...head, noindex: true }}>
      <div class="mx-auto w-full max-w-md" data-e2e="newsletter-off">
        <Notice title="The newsletter is off">
          This site is not taking newsletter subscriptions right now, and it sends no newsletter
          while they are off. A confirm or unsubscribe link works again once they are back on.
        </Notice>
      </div>
    </SiteFrame>,
    { status: 503, headers: NO_REFERRER },
  )
}

function renderConfirm(
  ctx: FreshContext<State>,
  page: PageStatus & {
    state: SubscriptionConfirmState
    email?: string
    list: string
    token: string
  },
): Response | Promise<Response> {
  return ctx.render(
    <SiteFrame state={ctx.state} path={FORM_ACTIONS.subscribeConfirm} head={TOKEN_PAGE_HEAD}>
      <SubscriptionConfirmScreen
        state={page.state}
        email={page.email}
        list={page.list}
        token={page.token}
        error={null}
        pending={false}
      />
    </SiteFrame>,
    { status: page.status, headers: headersOf(page, NO_REFERRER) },
  )
}

function renderUnsubscribe(
  ctx: FreshContext<State>,
  page: PageStatus & { state: UnsubscribeState; email?: string; list: string; token: string },
): Response | Promise<Response> {
  return ctx.render(
    <SiteFrame state={ctx.state} path={FORM_ACTIONS.unsubscribe} head={TOKEN_PAGE_HEAD}>
      <UnsubscribeScreen
        state={page.state}
        email={page.email}
        list={page.list}
        token={page.token}
        error={null}
        pending={false}
      />
    </SiteFrame>,
    { status: page.status, headers: headersOf(page, NO_REFERRER) },
  )
}
