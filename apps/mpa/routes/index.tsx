import type { JSX } from "preact"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import {
  IconArrowRight,
  IconCheck,
  IconCreditCard,
  IconGitHub,
  IconGlobe,
  IconMinus,
  IconServer,
  IconShieldCheck,
  IconUsers,
  IconZap,
} from "@spy4x/preact-icons"
import { Badge } from "@spy4x/preact-ui/badge"
import { Button } from "@spy4x/preact-ui/button"
import { Card } from "@spy4x/preact-ui/card"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { FeatureCard } from "@spy4x/preact-ui/feature-card"
import { Input } from "@spy4x/preact-ui/input"
import { StatusMark } from "@spy4x/preact-ui/status-mark"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { FORM_ACTIONS } from "@ui/progressive.tsx"
import { ArchitectureDiagram } from "../components/architecture-diagram.tsx"
import { Band } from "../components/band.tsx"
import { CtaBand } from "../components/cta-band.tsx"
import { FoundersHandoff } from "../components/founders-handoff.tsx"
import { ProofStrip } from "../components/proof-strip.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import { PairShot } from "../components/features-visuals.tsx"
import { Shot } from "../components/shot.tsx"
import { HIRE_PAGE_URL } from "../hire.ts"
import {
  AUTHOR_URL,
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_NAME,
  SiteFrame,
  type SitePageHead,
  softwareId,
  softwareJsonLd,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../site.tsx"
import { define } from "../utils.ts"

// Seed's own site: see docs/start-a-product.md (also the llms.txt summary)
/** The home page's title and description, as search results and social previews show them. */
export const HOME_HEAD = {
  title: `Seed: free open-source SaaS starter and boilerplate`,
  description: `Free, MIT-licensed SaaS starter: sign-in with 2FA, groups with roles, per-member ` +
    `Stripe billing, realtime, offline. Deno, Postgres, Docker Compose.`,
} as const

/**
 * Facts a visitor can check in the repository. Counted on 2026-10-16: `ls e2e/*.e2e.ts`,
 * `git ls-files '*.test.ts*'` and the merged pull requests on GitHub.
 */
const PROOF = [
  { value: `34 · 232`, label: `browser test suites and test files run in CI` },
  { value: `208`, label: `pull requests merged since January 2026, each through review` },
  { value: `MIT`, label: `licence: no account, no paywall` },
] as const

/**
 * The quick start, one command per line, as the README runs it. No line carries a `#` comment:
 * interactive zsh, the macOS default, passes a comment's words to the command.
 */
export const QUICK_START = [
  `gh repo create my-product --template spy4x/seed --private --clone`,
  `cd my-product`,
  `deno task init`,
  `deno task dev`,
] as const

/** What a reader can paste into an AI agent instead of typing the quick start. */
export const AI_PROMPT =
  `Create my new product "Acme" from https://github.com/spy4x/seed and run it locally`

const WORKS_TODAY = [
  `Sign-up, sign-in, email verification, password reset, Google and GitHub sign-in, passkeys, magic links, 2FA with an authenticator app`,
  `Guest accounts: try the app with one click, keep the account by adding a sign-in method`,
  `Groups with members, roles, invitations and ownership transfer`,
  `Exporting a group to a file, and importing one as a new group`,
  `Images and PDFs attached to notes, within each plan's room`,
  `Per-member billing with trials, through Stripe`,
  `A profile picture, the list of signed-in devices, a download of your own data, and account deletion with a 7‑day undo`,
  `Personal API tokens`,
  `Realtime, the offline app and web push`,
  `A Telegram bot: notifications in a chat, and your own commands in one file`,
  `The admin area`,
  `The outbox worker, the newsletter and this website`,
] as const

const NOT_BUILT = [
  `Translations: the app is English only`,
] as const

/** The questions, with each answer as plain text for the FAQ's structured data. */
const FAQ = [
  {
    id: `faq-try`,
    question: `Can I try it without an account?`,
    answerText: `Yes. Try the live demo opens the app in a guest account with sample data, ` +
      `without an email or a password. Add a sign-in method to keep it; the demo is wiped every ` +
      `night either way. Seed itself needs no account at all: clone it from GitHub.`,
  },
  {
    id: `faq-free`,
    question: `Is Seed really free?`,
    answerText: `Yes. It is MIT-licensed: use it for any number of products, commercial or not, ` +
      `publish your fork, no account needed. You pay only for one server you rent and for ` +
      `services you turn on, such as Stripe or an email provider.`,
  },
  {
    id: `faq-stack`,
    question: `Why Deno and Preact instead of Next.js?`,
    answerText: `They run on web standards (fetch, Request, Web Crypto, ES modules), start fast ` +
      `and need few dependencies, so there is less to update and less that breaks. If you work ` +
      `in the Next.js ecosystem, a Next.js starter will suit you better; the comparison ` +
      `names good ones.`,
  },
  {
    id: `faq-client-work`,
    question: `Can I use it for client work?`,
    answerText: `Yes. MIT allows it, and that is how I use it. Your client needs no licence of ` +
      `their own.`,
  },
  {
    id: `faq-production`,
    question: `Is it production-ready?`,
    answerText: `The parts listed under "Works today" have tests in CI: every pull request ` +
      `runs the sign-in, profile, notes and groups tests, and the full suite runs after each ` +
      `merge. Seed as a whole is still a work in progress; read the status list before you ` +
      `rely on a part.`,
  },
] as const

/** The page's structured data: the site, the software and its author, and the questions. */
function homeJsonLd(origin: string): unknown[] {
  return [
    {
      "@type": `WebSite`,
      "@id": `${origin}/#website`,
      name: SITE_NAME,
      url: `${origin}/`,
      publisher: { "@id": PERSON_JSON_LD["@id"] },
      about: { "@id": softwareId(origin) },
    },
    softwareJsonLd(origin),
    PERSON_JSON_LD,
    faqPageJsonLd(FAQ),
  ]
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  return (
    <section aria-labelledby="hero-title" class="relative overflow-hidden">
      <div aria-hidden="true" class="site-grid pointer-events-none absolute inset-0" />
      <div class="site-glow relative">
        <div class="mx-auto flex w-full max-w-6xl flex-col gap-12 px-4 pb-12 pt-12 sm:px-6 lg:px-8 lg:pb-16 lg:pt-16">
          <div class="mx-auto flex max-w-3xl flex-col items-start gap-6 sm:items-center sm:text-center">
            <Badge
              href={REPOSITORY_URL}
              text="Open source · MIT · Deno 2 + Postgres"
              type="outline"
            />
            <h1
              id="hero-title"
              class="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl"
            >
              The groundwork of your SaaS, already built.
            </h1>
            <p class="text-lg text-muted text-pretty">
              Seed is a free, MIT-licensed SaaS starter with sign-in and two-factor authentication
              (2FA), groups with roles, per-member Stripe billing, realtime, an offline app and an
              admin area. You deploy it to one Linux server you rent with Docker Compose.
            </p>
            <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
              <Button
                href={demoHref}
                rel={TRY_REL}
                size="lg"
                data-e2e="home-try-demo"
                data-umami-event="try-demo"
                data-umami-event-from="hero"
              >
                {TRY_ENTRY.label}
              </Button>
              <Button
                href={REPOSITORY_URL}
                variant="outline"
                size="lg"
                data-umami-event="github"
                data-umami-event-from="hero"
              >
                <IconGitHub class="size-5" /> View on GitHub
              </Button>
            </div>
            <p class="text-sm text-muted">
              {TRY_ENTRY.line} Seed is a work in progress, built in public:{" "}
              <a href="#status" class="text-primary underline">see what works today</a>.
            </p>
          </div>
          {/* Reading order is text, then code, then picture; from `lg` the code overlaps the picture. */}
          <div class="relative flex flex-col gap-6 lg:block lg:pb-12">
            <WindowFrame
              variant="terminal"
              title="Quick start"
              class="lg:absolute lg:bottom-0 lg:left-0 lg:z-10 lg:w-2xl"
              caption={
                <span>
                  <code class="font-mono">init</code> writes{" "}
                  <code class="font-mono">infra/envs/.env</code>{" "}
                  with every secret filled in. Or ask your AI agent: <AiPrompt />.
                </span>
              }
            >
              {QUICK_START.map((line) => `$ ${line}`).join(`\n`)}
            </WindowFrame>
            <WindowFrame
              variant="browser"
              title="app.seedsaas.com/notes"
              class="lg:ml-auto lg:w-5/6"
            >
              <Shot
                name="notes"
                alt="The notes screen of the Seed web app: a search box, filters by tag and author, a Created by me filter and a sort menu above a list of a group's notes, each with its author, its tags, when it was updated and when it was created, and a New note button."
                sizes="(min-width: 1024px) 960px, 100vw"
                priority
              />
            </WindowFrame>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * The plan alone, captured on a phone from the empty canvas above its "Plan and billing" heading to
 * the canvas below the "Pro plan" card: at most 390 px wide, so the card shows it whole at about its
 * real size. It sits in the middle of the card's picture area on the same canvas colour.
 */
function BillingCrop(): JSX.Element {
  return (
    <div class="flex h-94 items-center overflow-hidden bg-canvas">
      <div class="w-full max-w-[390px]">
        <Shot
          name="billing-plan"
          kind="mobile"
          height={416}
          alt="A sample group's plan in the demo app, at the demo's example prices: Pro plan with its renewal date, €36.00 a month, for 4 members at €9.00 each, the owner included."
          sizes="390px"
        />
      </div>
    </div>
  )
}

function Features(): JSX.Element {
  return (
    <Band id="features" labelledBy="features-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="features-title"
          eyebrow="What you get"
          title="Everything before your first feature"
          lead="Each part below works today and is tested in CI. Google and GitHub sign-in and Stripe billing need your own keys, so they are off in the demo."
        />
        <div class="grid gap-6 lg:grid-cols-3">
          <FeatureCard
            id="feature-sign-in"
            title="Sign-in that is done"
            Icon={IconShieldCheck}
            href="/features#sign-in"
            linkLabel="How sign-in works"
            wide
            media={
              <Shot
                name="profile-security"
                alt="The security page of a profile: the sign-in methods, two-factor authentication (2FA) and the open sessions."
                sizes="(min-width: 1024px) 640px, 100vw"
              />
            }
          >
            Email and password with verification codes, password reset, Google and GitHub sign-in,
            passkeys, sign-in links by email, guest accounts, and 2FA with an authenticator app.
            Sessions you can see and end.
          </FeatureCard>
          <FeatureCard
            id="feature-billing"
            title="Per-member billing"
            Icon={IconCreditCard}
            href="/features#billing"
            linkLabel="How billing works"
            media={<BillingCrop />}
          >
            Stripe subscriptions per group: a free plan with limits, a paid plan per member, trials,
            a grace period when a card fails. The owner confirms the price before each invite.
          </FeatureCard>
          <FeatureCard
            id="feature-realtime"
            title="Realtime and offline"
            Icon={IconZap}
            href="/features#realtime"
            linkLabel="How realtime and offline work"
            media={
              <div class="h-94 overflow-hidden">
                {/* As wide as the card up to 416 px, so the Save button is never cut. */}
                <div class="w-full max-w-104">
                  <PairShot
                    name="realtime-a"
                    alt="The note editor of the Seed app, with the title being changed; every other open window shows the new title after Save."
                    sizes="416px"
                  />
                </div>
              </div>
            }
          >
            Changes reach every open tab over a WebSocket. The app installs, opens without a
            network, queues writes and shows a conflict instead of overwriting someone's work.
          </FeatureCard>
          <FeatureCard
            id="feature-teams"
            title="Groups from day one"
            Icon={IconUsers}
            href="/features#teams"
            linkLabel="How groups work"
            wide
            media={
              <div class="aspect-[1280/470] overflow-hidden lg:flex lg:aspect-auto lg:h-94 lg:justify-center lg:bg-canvas">
                {/* Members only, no plan; from lg on, as tall as the realtime card beside it. */}
                <div class="lg:w-[640px] lg:shrink-0 lg:overflow-hidden">
                  <div class="lg:w-[1024px] lg:-translate-x-[221.6px]">
                    <Shot
                      name="group-members"
                      alt="The members of a group, each with their role, a button to invite people, and one member's menu open: Make Viewer, Make Admin, Remove from group."
                      sizes="(min-width: 1024px) 1024px, 100vw"
                    />
                  </div>
                </div>
              </div>
            }
          >
            Every account gets a group at sign-up. Invite people, give them roles from viewer to
            owner, hand ownership over, restore a deleted group for 30 days. Each group has an
            overview of its key numbers.
          </FeatureCard>
          {/* The card draws its own link; Umami counts a click on anything inside this wrapper. */}
          <div class="contents" data-umami-event="home-admin-card">
            <FeatureCard
              id="feature-admin"
              title="An admin area"
              Icon={IconServer}
              href="/admin"
              linkLabel="Tour the admin panel"
            >
              Operators find a person, manage groups, refund a payment and check the system's
              health. On its own host, with every action confirmed and logged.
            </FeatureCard>
          </div>
          <FeatureCard
            id="feature-website"
            title="A public website"
            Icon={IconGlobe}
            href="/features#website"
            linkLabel="What the website includes"
          >
            This site: server-rendered, works with JavaScript turned off, with pricing from your
            plan catalog, legal pages and a double opt-in newsletter.
          </FeatureCard>
          <a
            href="/features"
            class="site-lift flex items-center justify-between gap-4 rounded-card border border-dashed border-strong p-6 text-lg font-semibold hover:border-primary"
            data-e2e="home-all-features"
          >
            All features, with screenshots and status
            <IconArrowRight class="size-5 text-primary" />
          </a>
        </div>
      </div>
    </Band>
  )
}

function OneServer(): JSX.Element {
  return (
    <Band tone="alt" id="one-server" labelledBy="one-server-title">
      <div class="grid items-center gap-12 lg:grid-cols-2">
        <div class="flex flex-col gap-6">
          <SectionIntro
            id="one-server-title"
            eyebrow="Runs on one server you rent"
            title={
              <>
                One server, one <code class="font-mono">docker compose</code>, no surprise bills.
              </>
            }
          />
          <p class="text-muted text-pretty">
            Seed runs on any Linux server you rent. Compose starts the API, the worker, the web app,
            Postgres, Valkey and Traefik with automatic certificates. Metrics and logs go to
            VictoriaMetrics and VictoriaLogs with Grafana on top, and a backup container saves an
            encrypted copy of the database every day. Several products can share one server. Nothing
            bills you per request, so a traffic spike costs you nothing extra.
          </p>
          <p class="text-sm text-muted">
            Skip Seed if you want serverless functions or Vercel: it is built for a server you
            control.
          </p>
        </div>
        <ArchitectureDiagram />
      </div>
    </Band>
  )
}

function QuickStart(): JSX.Element {
  return (
    <Band id="quick-start" labelledBy="quick-start-title">
      <div class="grid gap-8 lg:grid-cols-12 lg:items-start">
        <div class="flex flex-col gap-4 lg:col-span-5">
          <SectionIntro
            id="quick-start-title"
            eyebrow="Quick start"
            title="Running locally in four commands"
          />
          <p class="text-muted">You need Deno 2 and Docker; the GitHub CLI is optional.</p>
          <p class="text-muted text-pretty">
            <code class="font-mono text-foreground">init</code>{" "}
            copies the env file and generates every secret and the web push keys;{" "}
            <code class="font-mono text-foreground">dev</code>{" "}
            starts Traefik and everything else. Then open{" "}
            <code class="font-mono text-foreground">http://app.localhost</code>. The{" "}
            <a href={`${REPOSITORY_URL}#readme`} class="text-primary underline">README</a>{" "}
            lists every setting and how to deploy.
          </p>
          <p class="text-muted text-pretty">
            Or ask your AI agent: <AiPrompt />.
          </p>
        </div>
        <WindowFrame variant="terminal" title="Terminal" class="min-w-0 lg:col-span-7">
          {QUICK_START.map((line) => `$ ${line}`).join(`\n`)}
        </WindowFrame>
      </div>
    </Band>
  )
}

/** The AI prompt as one block of code that a single click selects whole. */
function AiPrompt(): JSX.Element {
  return <code class="font-mono text-foreground select-all">{AI_PROMPT}</code>
}

function Status(): JSX.Element {
  return (
    <Band tone="alt" id="status" labelledBy="status-title">
      <div class="flex flex-col gap-8">
        <SectionIntro
          id="status-title"
          eyebrow="Honest status"
          title="Where it stands today"
          lead="Seed is a work in progress. Here is exactly what works and what does not."
        />
        <div class="grid gap-6 md:grid-cols-2">
          <Card role="region" aria-labelledby="works-title" class="rounded-card bg-canvas p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 id="works-title" class="text-lg font-semibold">Works today</h3>
              <StatusMark status="ready" />
            </div>
            <ul class="mt-4 flex flex-col gap-3">
              {WORKS_TODAY.map((item) => (
                <li key={item} class="flex items-start gap-2">
                  <IconCheck class="mt-1 size-4 shrink-0 text-primary" />
                  <span class="text-pretty">{item}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card role="region" aria-labelledby="not-built-title" class="rounded-card bg-canvas p-6">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 id="not-built-title" class="text-lg font-semibold">Not built yet</h3>
              <StatusMark status="wip" />
            </div>
            <ul class="mt-4 flex flex-col gap-3">
              {NOT_BUILT.map((item) => (
                <li key={item} class="flex items-start gap-2">
                  <IconMinus class="mt-1 size-4 shrink-0 text-muted" />
                  <span class="text-pretty">{item}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <a
          href={`${REPOSITORY_URL}/issues`}
          class="inline-flex items-center gap-1 self-start font-medium text-primary hover:underline"
        >
          Follow progress on GitHub <IconArrowRight class="size-4" />
        </a>
      </div>
    </Band>
  )
}

// Seed's own site: see docs/start-a-product.md
function WhoBuilds(): JSX.Element {
  return (
    <Band id="who" labelledBy="who-title" width="3xl">
      <div class="flex flex-col gap-6">
        <SectionIntro
          id="who-title"
          eyebrow="Who builds Seed"
          title="Built by one engineer, for real client work"
        />
        <p class="text-lg text-muted text-pretty">
          I'm Anton Shubin, a senior full-stack engineer and tech lead, freelancing since 2013. Seed
          is the groundwork I kept rebuilding for clients, pulled into one repository. I use it for
          paid MVPs, so it gets fixed when it breaks. If something is missing for your product, open
          an issue or write to me.
        </p>
        <ul class="flex flex-wrap gap-x-6 gap-y-2 font-medium">
          <li>
            <a
              href={HIRE_PAGE_URL}
              class="text-primary underline"
              data-e2e="home-hire-page"
              data-umami-event="hire-me"
              data-umami-event-from="who"
            >
              My MVP offer on antonshubin.com
            </a>
          </li>
          <li>
            <a href={`${AUTHOR_URL}/about`} class="text-primary underline">About me</a>
          </li>
          <li>
            <a
              href="https://www.upwork.com/freelancers/ashubin"
              class="text-primary underline"
            >
              Upwork profile
            </a>
          </li>
          <li>
            <a href={`${REPOSITORY_URL}/issues`} class="text-primary underline">GitHub issues</a>
          </li>
        </ul>
      </div>
    </Band>
  )
}

function Newsletter(): JSX.Element {
  return (
    <Band tone="alt" id="newsletter" labelledBy="newsletter-title" width="3xl">
      <div class="flex flex-col gap-6">
        <SectionIntro
          id="newsletter-title"
          title="Get a short email when Seed changes"
          lead="What shipped, what broke, what I learned building it. No other mail, and one click unsubscribes."
        />
        <form
          method="post"
          action={FORM_ACTIONS.subscribe}
          class="flex flex-col gap-2"
          data-e2e="home-subscribe"
          data-analytics-submit="newsletter-subscribe"
        >
          <input type="hidden" name="list" value={DEFAULT_SUBSCRIBER_LIST} />
          <label for="home-email" class="text-sm font-medium">Email address</label>
          <div class="flex flex-col gap-2 sm:flex-row">
            <Input
              id="home-email"
              name="email"
              type="email"
              autocomplete="email"
              placeholder="you@example.com"
              required
              aria-describedby="home-email-hint"
              data-e2e="home-subscribe-email"
            />
            <Button type="submit" data-e2e="home-subscribe-submit">Subscribe</Button>
          </div>
          <p id="home-email-hint" class="text-sm text-muted">You confirm by email first.</p>
        </form>
      </div>
    </Band>
  )
}

function Questions(): JSX.Element {
  return (
    <Band id="faq" labelledBy="faq-title" width="3xl">
      <div class="flex flex-col gap-8">
        <SectionIntro id="faq-title" eyebrow="Questions" title="Before you start" />
        <FaqList
          items={FAQ.map((item) => ({
            id: item.id,
            question: item.question,
            answer: item.id === `faq-stack`
              ? (
                <p>
                  They run on web standards (<code>fetch</code>,{" "}
                  <code>Request</code>, Web Crypto, ES modules), start fast and need few
                  dependencies, so there is less to update and less that breaks. If you work in the
                  Next.js ecosystem, a Next.js starter will suit you better;{" "}
                  {/* Seed's own site: see docs/start-a-product.md */}
                  <a href="/compare" class="text-primary underline">the comparison</a>{" "}
                  names good ones.
                </p>
              )
              : <p>{item.answerText}</p>,
          }))}
        />
      </div>
    </Band>
  )
}

/**
 * The home page: what Seed is and the way into the demo first, then proof, the features, how it
 * runs, the quick start, what works today, the way in for founders, who builds it, the newsletter
 * and the questions. One ask throughout: try the demo.
 */
export default define.page(function Home({ state }) {
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...HOME_HEAD,
    og: `home`,
    jsonLd: homeJsonLd(state.webAppOrigin),
  }
  return (
    <SiteFrame state={state} path="/" head={head} footerNewsletter={false}>
      <Hero demoHref={spa.try} />
      <ProofStrip facts={PROOF} />
      <Features />
      <OneServer />
      <QuickStart />
      <Status />
      {/* Seed's own site: see docs/start-a-product.md */}
      <FoundersHandoff />
      <WhoBuilds />
      {state.newsletter && <Newsletter />}
      <Questions />
      <CtaBand demoHref={spa.try} />
    </SiteFrame>
  )
})
