// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { IconArrowRight, IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { Band } from "../components/band.tsx"
import { CtaBand } from "../components/cta-band.tsx"
import {
  FeatureSection,
  type FeatureSectionProps,
  FeatureTier,
  type FeatureTierProps,
} from "../components/features-section.tsx"
import {
  AggregateFiles,
  DeployVisual,
  OfflinePair,
  OutboxDiagram,
  RealtimePair,
} from "../components/features-visuals.tsx"
import { AdminVideoStill } from "../components/admin-video.tsx"
import { ADMIN_VIDEO } from "../admin-video.ts"
import { OnThisPage } from "../components/on-this-page.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import { Shot } from "../components/shot.tsx"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_AUTHOR,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareJsonLd,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../site.tsx"
import { define } from "../utils.ts"

/**
 * The day this page's feature list or wording last changed: the hero's "Updated" line and the
 * sitemap's `lastmod`. Change it with them.
 */
export const FEATURES_UPDATED = `2026-10-21`

/** The page's title and description, as search results and social previews show them. */
export const FEATURES_HEAD = {
  title: `Seed features: auth, groups, billing, offline, admin`,
  description: `What Seed ships: 2FA and social sign-in, groups with roles, per-member Stripe ` +
    `billing, realtime, an offline app, an admin area, monitoring and backups.`,
} as const

/** A file or folder of the repository on GitHub, for the "where in the code" links. */
function source(path: string): string {
  const kind = path.endsWith(`/`) ? `tree` : `blob`
  return `${REPOSITORY_URL}/${kind}/main/${path.replace(/\/$/, ``)}`
}

/** An open issue of the repository, by number. */
function issue(number: number): string {
  return `${REPOSITORY_URL}/issues/${number}`
}

/** A feature as the page lists it, without the side its picture goes on: the tier decides that. */
type Feature = Omit<FeatureSectionProps, "flip"> & { nav: string }

/** One group of features with its heading, status line and features, in page order. */
interface Tier extends Omit<FeatureTierProps, "children"> {
  features: readonly Feature[]
}

/**
 * Every claim below was checked against the code on 2026-10-16; the "where in the code" link of each
 * section points at it. Issue numbers are the open issues that track what is missing.
 */
const TIERS: readonly Tier[] = [
  {
    id: `settled`,
    eyebrow: `Settled for you`,
    title: `A SaaS starter with groups and billing already wired`,
    lead: `Accounts, groups and money: the parts every product needs before its first feature, ` +
      `and the ones that are easiest to get wrong.`,
    status: `Tested in CI. Google and GitHub sign-in and Stripe need your own keys, so they are ` +
      `off in the demo.`,
    features: [
      {
        id: `sign-in`,
        nav: `Accounts and sign-in`,
        eyebrow: `Accounts`,
        title: `Sign-in that is done`,
        lead:
          `People sign up with an email address and a password, prove the address with a code ` +
          `sent by email, reset a forgotten password, continue with Google or GitHub, get a ` +
          `sign-in link by email that also signs them up, or sign in ` +
          `with a passkey, or try the app first in a guest account and add a sign-in method later. ` +
          `An authenticator app adds two-factor authentication (2FA). They see every device they are signed in on ` +
          `and can sign the others out. Changing a sign-in method asks for proof and sends a mail.`,
        facts: [
          `Passwords hashed with PBKDF2-SHA-256 through Web Crypto, 600,000 rounds by default`,
          `Signed session cookies, and an audit trail of every sign-in event`,
          `Personal API tokens, stored only as keyed hashes`,
          `Passkeys: only the public key is stored, and each sign-in challenge works once`,
          `Magic links: one link signs in or signs up, works once, for 15 minutes, and is stored ` +
          `only as a hash`,
          `Guest accounts (anonymous sign-in): a visitor starts with one click and no sign-in ` +
          `method, then adds an email and password, Google, GitHub or a passkey to the same account`,
          `Wrong passwords counted per sign-in name, with a short lock, from any network address`,
        ],
        code: { label: `Read the sign-in code`, href: source(`apps/api/services/sign-in.ts`) },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/profile/security">
            <Shot
              name="profile-security"
              alt="The security page of a profile: the sign-in methods, two-factor authentication (2FA) and the open sessions."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
      },
      {
        id: `teams`,
        nav: `Groups and roles`,
        eyebrow: `Groups`,
        title: `Groups with roles, from the first minute`,
        lead: `Every account gets a personal group at sign-up. People make shared groups, invite ` +
          `others, give them roles from viewer to owner and hand ownership over in one step. A ` +
          `deleted group can be brought back for 30 days, and each group keeps an activity log.`,
        facts: [
          `The group is the one tenancy boundary: personal and shared data pass the same check`,
          `The app, its code and this site all call it a group`,
          `No second permission model to keep in sync with the first`,
          `Invitations, role changes and ownership transfer, each with its own tests`,
        ],
        code: { label: `Read the groups domain`, href: source(`libs/domain/groups/`) },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/groups">
            <Shot
              name="activity"
              alt="A group's activity log: who added which note or tag, and when, with a link to open each note."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
      },
      {
        id: `overview`,
        nav: `Group overview`,
        eyebrow: `Overview`,
        title: `Overview for each group`,
        lead: `Key numbers and a chart for any date range. Each person hides and reorders the ` +
          `widgets, and the layout follows them to their other devices.`,
        facts: [
          `Each number is compared with the period before, without a colour verdict`,
          `Counts only: no note's text and no ranking of people`,
          `Each widget loads, fails and retries on its own`,
          `A new aggregate adds its own widgets, and the admin area shows them too`,
        ],
        code: { label: `Read the overview widgets`, href: source(`libs/domain/notes/overview.ts`) },
      },
      {
        id: `billing`,
        nav: `Per-member billing`,
        eyebrow: `Money`,
        title: `Per-member billing, through Stripe`,
        lead:
          `People see a pricing table, a free plan with limits and a 14-day trial of the paid ` +
          `plan. The owner sees what one more member costs before inviting them, and a clear ` +
          `notice with a date when a card fails.`,
        facts: [
          `Stripe Checkout and the customer portal; the webhook is the only source of the plan`,
          `Quantities that follow the member count`,
          `A grace period after a failed payment, 7 days by default`,
          `Plan limits checked on the server, not only in the app`,
          <span key="catalog">
            Plans live in one catalog file;{" "}
            <a href="/pricing" class="text-primary underline">the pricing page</a> reads it
          </span>,
        ],
        notYet: [{ label: `Payment providers other than Stripe` }],
        code: { label: `Read docs/billing.md`, href: source(`docs/billing.md`) },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/groups">
            <Shot
              name="billing"
              alt="A sample group's plan and billing tab, at the demo's example prices: Pro plan with its renewal date, €36.00 a month, for 4 members at €9.00 each, the owner included, with buttons to change the card, view invoices and cancel the plan."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
      },
      {
        id: `privacy`,
        nav: `Privacy`,
        eyebrow: `Privacy`,
        title: `Accounts people can leave`,
        lead:
          `People download a copy of their data and delete their account from the profile, with ` +
          `7 days to change their mind. Read notifications are deleted after 90 days.`,
        facts: [
          `Download my data: a ZIP of JSON and CSV files, prepared in the background, kept 7 days`,
          `Deletion waits 7 days; signing in again cancels it`,
          `Nightly clean-up of read notifications, dead invitations and old audit events`,
        ],
        notYet: [
          { label: `Translations: the app is English only`, issue: issue(216) },
        ],
        code: {
          label: `Read the account deletion code`,
          href: source(`libs/server/auth/account-deletion.ts`),
        },
      },
      {
        id: `export`,
        nav: `Export and import`,
        eyebrow: `Export`,
        title: `Your data leaves with you`,
        lead: `Export any group to an open JSON file, and import it later as a new group. The ` +
          `original group is never overwritten.`,
        facts: [
          `The owner exports; anyone who may create a group imports`,
          `The whole file is checked before anything is written, then imported in one step`,
          `Every note and tag gets a new id, so an import never collides with what is there`,
          `Each aggregate registers its own part of the file`,
        ],
        code: { label: `Read the export code`, href: source(`libs/server/groups/portable.ts`) },
      },
    ],
  },
  {
    id: `ready`,
    eyebrow: `Ready when you need it`,
    title: `Realtime, offline and background work`,
    lead: `The parts most starters leave out, because they are hard: live updates, an app that ` +
      `works with no network, and work that must not get lost.`,
    status: `Offline writing covers notes and tags; every other list opens offline with what it ` +
      `last showed.`,
    features: [
      {
        id: `realtime`,
        nav: `Realtime`,
        eyebrow: `Realtime`,
        title: `Changes show up without a reload`,
        lead: `A member's change appears in every open tab of the group, and a laptop that wakes ` +
          `from sleep catches up on what it missed.`,
        facts: [
          `A standard WebSocket, with a sequence on every change`,
          `A tab shown again after sleep reconnects and pulls what it missed`,
          `Realtime can be switched off: the app then polls on a timer and works the same`,
        ],
        code: {
          label: `Read the realtime design`,
          href: source(`docs/decisions/002-realtime-transport-and-sync.md`),
        },
        visual: <RealtimePair />,
      },
      {
        id: `offline`,
        nav: `Offline app`,
        eyebrow: `Offline`,
        title: `An app that opens with no network`,
        lead:
          `The app installs like a native one, opens with no network and sends queued changes ` +
          `when the network returns. A stale change shows as a conflict to settle, never as a ` +
          `silent overwrite.`,
        facts: [
          `An IndexedDB copy of each list and a write queue with idempotency keys`,
          `“Keep mine” or “Use the server's” for each conflict`,
          `Turned off with one setting, or removed by deleting one folder and following a written list`,
        ],
        code: { label: `Read docs/offline.md`, href: source(`docs/offline.md`) },
        visual: <OfflinePair />,
      },
      {
        id: `shortcuts`,
        nav: `Keyboard shortcuts`,
        eyebrow: `Keyboard`,
        title: `Keyboard shortcuts in the app and the admin area`,
        lead:
          `Press ? to see every shortcut. N adds a note from any page without leaving it, and ` +
          `G then a letter opens a section. Shortcuts stay out of the way while you type in a ` +
          `field.`,
        facts: [
          `Ctrl K (⌘K on a Mac) or / opens search`,
          `One list per app binds the keys and fills the ? dialog, so it never shows a key that does nothing`,
          `Single-key shortcuts can be turned off on a device; Ctrl K and Escape keep working`,
          `In the admin area, G then a letter opens each module`,
        ],
        code: { label: `Read the shortcuts code`, href: source(`libs/ui/shortcuts.tsx`) },
      },
      {
        id: `push`,
        nav: `Notifications`,
        eyebrow: `Notifications`,
        title: `Notifications in the app, on the phone, the desktop and Telegram`,
        lead: `People get a notice when they are invited, given a new role or handed a group, in ` +
          `the app, as a web push on their phone or desktop, and in Telegram once they link it.`,
        facts: [
          `Web push with your own keys, made by one task: deno task vapid-key:create`,
          `An unread count in the app, and "Mark all as read"`,
          `Each device's push subscription listed on the profile`,
          `A Telegram bot, off until you set its token: linked with a one-time code, and your ` +
          `product's own commands added in one file`,
        ],
        code: {
          label: `Read the web push service`,
          href: source(`apps/api/services/web-push-service.ts`),
        },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/notifications">
            <Shot
              name="notifications"
              alt="The notifications page: three unread notices about a new group owner, a role change and an invitation, each row opening what it is about."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
      },
      {
        id: `worker`,
        nav: `Background work`,
        eyebrow: `Background work`,
        title: `Work that survives a crash`,
        lead: `Mail and notifications go out even when the server restarts halfway, because the ` +
          `work is saved before it is done. Your own jobs run now, later or on a schedule.`,
        facts: [
          `Each command writes its event in the same database transaction as the change`,
          `A worker drains that outbox and sends mail, push and live updates`,
          `A job is one definition: a name, a handler and, if it repeats, its schedule`,
          `A failed attempt is retried with growing waits; operators see every run in the admin`,
        ],
        code: { label: `Read docs/jobs.md`, href: source(`docs/jobs.md`) },
        visual: <OutboxDiagram />,
      },
      {
        id: `your-feature`,
        nav: `Your own features`,
        eyebrow: `Your product`,
        title: `Add a feature by copying one`,
        lead: `Notes is a complete feature in every layer: database, API, screen, offline and ` +
          `tests. A new feature copies it, file by file, from a list that names each file in order.`,
        facts: [
          `One shape for every feature, so the code stays easy to find`,
          `Each layer has its own tests to copy with it`,
          `Every id is a time-ordered UUID (version 7)`,
        ],
        code: { label: `Read docs/aggregates.md`, href: source(`docs/aggregates.md`) },
        visual: <AggregateFiles />,
      },
    ],
  },
  {
    id: `operations`,
    eyebrow: `Operations`,
    title: `Run it, watch it, support the people on it`,
    lead: `One server you rent, the tools to see what it does, and an area where your operators ` +
      `help the people who use your product.`,
    status: `Every module below ships today. What is not built yet is listed under each.`,
    features: [
      {
        id: `admin`,
        nav: `Admin area`,
        eyebrow: `Support`,
        title: `An admin area for your operators`,
        lead: (
          <>
            Your operators find a person by name or address and see their sign-in methods, sessions,
            groups and history. From the same place they manage groups, refund a payment, look after
            the newsletter's subscribers, see every background job, run a failed one again and check
            the system's health.{" "}
            <a
              href="/admin"
              class="font-medium text-primary underline"
              data-e2e="features-admin-watch"
              data-umami-event="features-admin-video"
              data-umami-event-from="lead"
            >
              Watch it in {ADMIN_VIDEO.seconds} seconds
            </a>.
          </>
        ),
        facts: [
          `A separate app on its own host, with its own session cookie`,
          `Nine modules, from the dashboard to API tokens`,
          `Risky actions ask first, and every action is written to the audit log`,
        ],
        notYet: [
          { label: `Translations: the admin app is English only`, issue: issue(275) },
          { label: `Signing in as a person to see what they see` },
        ],
        code: { label: `Read the admin app`, href: source(`apps/admin/`) },
        visual: <AdminVideoStill />,
      },
      {
        id: `deploy`,
        nav: `Deploy and monitoring`,
        eyebrow: `Deploy`,
        title: `One server, one command`,
        lead: `Seed runs on any Linux server you rent, with Docker Compose for development and ` +
          `production alike. Several products can share one server.`,
        facts: [
          `Traefik in front, with automatic certificates`,
          `Postgres and Valkey beside the apps`,
          `Garage, an S3 file store: notes keep images and PDFs in it, and people their profile pictures, uploaded on signed links and checked by their bytes`,
          `VictoriaMetrics, VictoriaLogs and Grafana, with alerts`,
          `An opt-in daily encrypted restic backup of the database, and a written restore`,
          `Release images published from CI when you push a version tag`,
        ],
        code: { label: `Read the Compose files`, href: source(`infra/compose/`) },
        visual: <DeployVisual />,
      },
      {
        id: `website`,
        nav: `Public website`,
        eyebrow: `Website`,
        title: `A public website to adapt`,
        lead: `This site: fast, server-rendered and usable with JavaScript turned off, with ` +
          `pricing, legal pages, a blog and a newsletter.`,
        facts: [
          `Fresh on the server; every action a real link or form`,
          `Pricing read from the app's plan catalog`,
          `A newsletter with double opt-in and one-click unsubscribe`,
          `A blog written in the admin panel, with topics, an RSS feed and article structured data`,
          `sitemap.xml, robots.txt, canonical links and Open Graph images`,
          `Optional cookieless analytics in your own Umami, with an event on every call to action`,
        ],
        code: { label: `Read the website's code`, href: source(`apps/mpa/`) },
      },
      {
        id: `quality`,
        nav: `Tests`,
        eyebrow: `Quality`,
        title: `Tested where it matters`,
        lead: `Counted on 16 October 2026: 34 browser test suites for the app, plus unit and ` +
          `screen tests, all run in CI. Every change goes through a pull request and a review before it merges.`,
        facts: [
          `Browser tests with Playwright, against the real API and database`,
          `Unit and screen tests next to the code they test`,
          `Integration tests against Postgres`,
        ],
        code: { label: `Read the browser tests`, href: source(`e2e/`) },
      },
    ],
  },
]

/**
 * What a visitor asks that the sections above do not answer, with each answer as plain text for the
 * FAQ's structured data. Each answer's first sentence stands alone, in 40 words or fewer.
 */
const FAQ = [
  {
    id: `faq-serverless`,
    question: `Can Seed run on Vercel or serverless functions?`,
    answerText: `No. Seed runs as long-lived containers with Docker Compose on one Linux server ` +
      `you rent, because the API keeps WebSocket connections open and a worker drains a queue.`,
  },
  {
    id: `faq-runtime`,
    question: `Can Seed run on Node.js or Bun?`,
    answerText: `Not today. Seed's servers run on Deno 2 in Docker, and its tasks and tests use ` +
      `Deno. The code is built on web standards such as fetch, Request and Web Crypto.`,
  },
  {
    id: `faq-database`,
    question: `Can Seed use a database other than Postgres?`,
    answerText: `No. Seed is built on Postgres: its migrations, queries and integration tests ` +
      `assume it.`,
  },
  {
    id: `faq-native`,
    question: `Can Seed ship as a mobile or desktop app?`,
    answerText: `Not as a store app yet. Today the web app installs from the browser on phones ` +
      `and desktops and opens with no network; Android and desktop apps are planned.`,
  },
] as const

/** The page's structured data: the software, its questions, and the page's place. */
function featuresJsonLd(origin: string): unknown[] {
  return [
    softwareJsonLd(origin, {
      featureList: TIERS.flatMap((tier) => tier.features.map((feature) => feature.nav)),
    }),
    PERSON_JSON_LD,
    faqPageJsonLd(FAQ),
    siteBreadcrumbsJsonLd(origin, `/features`, `Features`),
  ]
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  return (
    <PageHero
      class="site-glow"
      eyebrow="Features"
      title="Everything Seed ships, and what it does not yet"
      lead="Seed is a free, MIT-licensed SaaS starter with email, Google and GitHub sign-in, passkeys, magic links, guest accounts, 2FA, groups with roles, per-member Stripe billing, realtime updates, an offline app, an admin area, monitoring and optional daily encrypted backups. Each section below links to its code."
      author={SITE_AUTHOR}
      updated={FEATURES_UPDATED}
      note='Seed is a work in progress, built in public. What is not built yet is marked "Not built yet" next to the claim it limits, with its issue when one is open.'
    >
      <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
        <Button
          href={demoHref}
          rel={TRY_REL}
          size="lg"
          data-e2e="features-try-demo"
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
          <IconGitHub class="size-5" aria-hidden="true" /> View on GitHub
        </Button>
      </div>
    </PageHero>
  )
}

/**
 * `/features`: every capability, grouped by what it is for, each with what people notice, what a
 * developer gets, what is not built yet and a link to the code. One ask: try the demo.
 */
export default define.page(function Features({ state }) {
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...FEATURES_HEAD,
    og: `features`,
    jsonLd: featuresJsonLd(state.webAppOrigin),
  }
  const nav = [
    ...TIERS.flatMap((tier) =>
      tier.features.map((feature) => ({ label: feature.nav, href: `#${feature.id}` }))
    ),
    { label: `Questions`, href: `#faq` },
  ]
  return (
    <SiteFrame state={state} path="/features" head={head}>
      <Hero demoHref={spa.try} />
      <div class="mx-auto grid w-full max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-16">
        <div class="lg:col-span-3 xl:col-span-2">
          <OnThisPage links={nav} />
        </div>
        <div class="flex min-w-0 flex-col gap-16 lg:col-span-9 xl:col-span-10">
          {TIERS.map(({ features, ...tier }) => (
            <FeatureTier key={tier.id} {...tier}>
              {features.map(({ nav: _nav, ...feature }, index) => (
                <FeatureSection key={feature.id} {...feature} flip={index % 2 === 1} />
              ))}
            </FeatureTier>
          ))}
          {/* Seed's own site: see docs/start-a-product.md */}
          <a
            href="/compare"
            class="inline-flex items-center gap-1 self-start py-2 text-lg font-medium text-primary hover:underline"
            data-e2e="features-compare"
          >
            How Seed compares <IconArrowRight class="size-5" aria-hidden="true" />
          </a>
        </div>
      </div>
      <Band tone="alt" id="faq" labelledBy="faq-title" width="3xl">
        <div class="flex flex-col gap-8">
          <SectionIntro id="faq-title" eyebrow="Questions" title="Can Seed do that?" />
          <FaqList
            items={FAQ.map((item) => ({
              id: item.id,
              question: item.question,
              answer: <p>{item.answerText}</p>,
            }))}
          />
        </div>
      </Band>
      <CtaBand demoHref={spa.try} />
    </SiteFrame>
  )
})
