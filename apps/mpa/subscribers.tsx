import type { ComponentChildren, JSX } from "preact"
import type { Context } from "@spy4x/preact-server"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { SUBSCRIBE_FAILURES, SubscribeForm } from "@ui/subscribe-screen.tsx"
import { IconCheck, IconGitHub } from "@spy4x/preact-icons"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { Notice } from "@spy4x/preact-ui/notice"
import { errorMessage } from "./api.ts"
import { readFormBody } from "@spy4x/server/http/bounded-body"
import { API_BODIES, FORM_LIMITS } from "./forms.ts"
import {
  REPOSITORY_URL,
  SITE_ICON,
  SITE_NAME,
  SiteFrame,
  type SitePageHead,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "./site.tsx"
import { localePath, siteTranslator } from "./languages.ts"
import { SiteLanguage } from "./use-site.tsx"
import {
  createSubscriptionConfirmHandlers,
  createUnsubscribeHandlers,
  NO_REFERRER,
  type TokenPageFrame,
} from "./token-pages.tsx"
import { define, type State } from "./utils.ts"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { siteEnglishText } from "@ui/site-text.ts"

/** The pages a mailed link opens: no search engine lists them. */
function tokenPageHead(t: Translator<string>): SitePageHead {
  return {
    title: t.t(`NewsletterPage.title`),
    description: t.t(`NewsletterPage.description`, { site: SITE_NAME }),
    noindex: true,
    og: `subscribe`,
  }
}

/** The query a taken subscribe request redirects to, so a reload does not send it again. */
const SENT_QUERY = "?state=sent"

/** The subscribe page's title and description in the language of `t`. */
export function subscribeHead(t: Translator<string>): SitePageHead {
  return {
    title: t.t(`NewsletterPage.subscribeTitle`, { site: SITE_NAME }),
    // Seed's own site: see docs/start-a-product.md
    description: t.t(`NewsletterPage.subscribeDescription`, { site: SITE_NAME }),
    og: `subscribe`,
  }
}

/** The subscribe page's head in English, for the page list (`pages.ts`). */
export const SUBSCRIBE_HEAD: SitePageHead = subscribeHead(siteEnglishText())

/** The day the subscribe page's content last changed: the sitemap's `lastmod`. Change it with it. */
export const SUBSCRIBE_UPDATED = `2026-10-30`

/** The translator and the addresses of the request's language. */
function speech(ctx: Context<State>) {
  const t = siteTranslator(ctx.state.language)
  return { t, href: (path: string) => localePath(ctx.state.language, path) }
}

/**
 * `GET` shows the subscribe form; `POST` asks the API for a confirm link, in the page's language,
 * and 303s to this page, which then says the link is sent. A refusal is shown with the API's status and message, and the
 * address stays in the form. While subscriptions are off, neither shows a form.
 */
export const subscribeHandlers = define.handlers({
  GET(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.subscribe, subscribeHead)
    const sent = ctx.url.searchParams.get("state") === "sent"
    return renderSubscribe(ctx, { email: "", sent, error: null, status: 200 })
  },
  async POST(ctx) {
    if (!ctx.state.newsletter) return renderOff(ctx, FORM_ACTIONS.subscribe, subscribeHead)
    const { t, href } = speech(ctx)
    const body = API_BODIES.subscribe(await readFormBody(ctx.req, FORM_LIMITS))
    const answer = await ctx.state.api.call("POST", "/api/subscribers", body)
    if (answer.status === 202) {
      return ctx.redirect(`${href(FORM_ACTIONS.subscribe)}${SENT_QUERY}`, 303)
    }
    return renderSubscribe(ctx, {
      email: body.email,
      sent: false,
      error: errorMessage(answer, t.t(SUBSCRIBE_FAILURES.subscribe)),
      status: answer.status,
      retryAfter: answer.retryAfter,
    })
  },
})

interface PageStatus {
  status: number
  retryAfter?: string
}

function headersOf(page: PageStatus): Record<string, string> {
  return page.retryAfter ? { "retry-after": page.retryAfter } : {}
}

/**
 * The band every newsletter page sits in: the hero's glow behind a centred column. `wide` gives the
 * subscribe page room for its introduction beside the form.
 */
function NewsletterBand(
  { wide = false, children }: { wide?: boolean; children: ComponentChildren },
): JSX.Element {
  return (
    <div class="site-glow">
      <div
        class={`mx-auto flex w-full flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16 ${
          wide ? "max-w-6xl" : "max-w-md"
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function renderSubscribe(
  ctx: Context<State>,
  page: PageStatus & { email: string; sent: boolean; error: string | null },
): Response | Promise<Response> {
  const { t, href } = speech(ctx)
  return ctx.render(
    <SiteLanguage language={ctx.state.language}>
      <SiteFrame
        state={ctx.state}
        path={FORM_ACTIONS.subscribe}
        head={subscribeHead(t)}
        footerNewsletter={false}
      >
        <NewsletterBand wide>
          <div class="grid items-start gap-8 lg:grid-cols-2 lg:gap-16">
            <section class="flex flex-col gap-4" aria-label={t.t(`NewsletterPage.about`)}>
              <BrandMark Icon={SITE_ICON} name={SITE_NAME} />
              <p class="text-2xl font-semibold tracking-tight text-balance">
                {t.t(`NewsletterPage.heading`, { site: SITE_NAME })}
              </p>
              {/* Seed's own site: see docs/start-a-product.md */}
              <p class="text-lg text-muted text-pretty">{t.t(`NewsletterPage.lead`)}</p>
              <ul class="flex flex-col gap-2">
                {NEWSLETTER_PROMISES.map((promise) => (
                  <li key={promise} class="flex items-start gap-2">
                    <IconCheck class="mt-1 size-4 shrink-0 text-primary" />
                    <span class="text-pretty">{t.t(promise)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <div data-analytics-submit="newsletter-subscribe">
              <SubscribeForm
                email={page.email}
                onEmailChange={() => {}}
                list={DEFAULT_SUBSCRIBER_LIST}
                sent={page.sent}
                error={page.error}
                pending={false}
                localize={href}
                language={ctx.state.language}
              />
            </div>
            {page.sent && <AnalyticsView name="newsletter-sent" />}
          </div>
        </NewsletterBand>
      </SiteFrame>
    </SiteLanguage>,
    { status: page.status, headers: headersOf(page) },
  )
}

/** What the newsletter promises, by catalog key. */
const NEWSLETTER_PROMISES = [
  `NewsletterPage.promiseConfirm`,
  `NewsletterPage.promiseUnsubscribe`,
  `NewsletterPage.promisePrivate`,
] as const

/**
 * What every newsletter page answers while the API takes no subscriptions (`State.newsletter`):
 * status 503 as the API's own, and no form, but the other ways to follow the project, so the page
 * does not end the visit.
 */
function renderOff(
  ctx: Context<State>,
  path: string,
  head: (t: Translator<string>) => SitePageHead,
  init: ResponseInit = { status: 503, headers: NO_REFERRER },
): Response | Promise<Response> {
  const spa = spaLinks(ctx.state)
  const { t } = speech(ctx)
  return ctx.render(
    <SiteLanguage language={ctx.state.language}>
      <SiteFrame state={ctx.state} path={path} head={{ ...head(t), noindex: true }}>
        <NewsletterBand>
          <div class="flex flex-col gap-6" data-e2e="newsletter-off">
            <h1 class="text-3xl font-semibold tracking-tight">
              {t.t(`NewsletterOff.title`, { site: SITE_NAME })}
            </h1>
            <Notice title={t.t(`NewsletterOff.noticeTitle`)}>{t.t(`NewsletterOff.notice`)}</Notice>
            {/* Seed's own site: see docs/start-a-product.md */}
            <p class="text-muted text-pretty">
              {t.t(`NewsletterOff.lead`, { site: SITE_NAME })}
            </p>
            <div class="flex flex-col gap-4 sm:flex-row">
              {/* Seed's own site: see docs/start-a-product.md */}
              <Button href={`${REPOSITORY_URL}/releases`} data-e2e="newsletter-off-releases">
                <IconGitHub class="size-5" /> {t.t(`NewsletterOff.releases`)}
              </Button>
              <Button href={spa.try} rel={TRY_REL} variant="outline">
                {t.t(TRY_ENTRY.label)}
              </Button>
            </div>
          </div>
        </NewsletterBand>
      </SiteFrame>
    </SiteLanguage>,
    init,
  )
}

/** Seed's own site draws the token pages in its frame, in the request's language. */
const SITE_TOKEN_FRAME: TokenPageFrame = {
  screen: (ctx) => ({ localize: speech(ctx).href, language: ctx.state.language }),
  render(ctx, page, init) {
    const { t } = speech(ctx)
    return ctx.render(
      <SiteLanguage language={ctx.state.language}>
        <SiteFrame state={ctx.state} path={page.path} head={tokenPageHead(t)}>
          <NewsletterBand>
            {page.screen}
            {page.state === "done" && <AnalyticsView name={DONE_VIEWS[page.kind]} />}
          </NewsletterBand>
        </SiteFrame>
      </SiteLanguage>,
      init,
    )
  },
  off: (ctx, page, init) => renderOff(ctx, page.path, tokenPageHead, init),
}

/** The Umami event a finished token step sends by being shown. */
const DONE_VIEWS = {
  confirm: "newsletter-confirmed",
  unsubscribe: "newsletter-unsubscribed",
} as const

/** The confirm page of Seed's own site: {@link createSubscriptionConfirmHandlers}. */
export const subscriptionConfirmHandlers = createSubscriptionConfirmHandlers(SITE_TOKEN_FRAME)

/** The unsubscribe page of Seed's own site: {@link createUnsubscribeHandlers}. */
export const unsubscribeHandlers = createUnsubscribeHandlers(SITE_TOKEN_FRAME)

/**
 * Marks a page that sends an Umami event by being shown (`/analytics.js`, `docs/analytics.md`):
 * a finished newsletter step, which no click on this website causes.
 */
function AnalyticsView({ name }: { name: string }): JSX.Element {
  return <span hidden data-analytics-view={name} />
}
