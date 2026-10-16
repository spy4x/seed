import type { JSX } from "preact"
import { IconArrowRight, IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
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
import { OnThisPage } from "../components/on-this-page.tsx"
import { PageHero } from "../components/page-hero.tsx"
import { Shot } from "../components/shot.tsx"
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { REPOSITORY_URL, SITE_NAME, SiteFrame, type SitePageHead, spaLinks } from "../site.tsx"
import { define } from "../utils.ts"

/** The page's title and description, as search results and social previews show them. */
export const FEATURES_HEAD = {
  title: `Seed features: auth, teams, billing, offline, admin`,
  description: `What Seed ships: 2FA and social sign-in, teams with roles, per-seat Stripe ` +
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
    title: `A SaaS starter with teams and billing already wired`,
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
          `sent by email, reset a forgotten password, or continue with Google or GitHub. An ` +
          `authenticator app adds a second factor. They see every device they are signed in on ` +
          `and can sign the others out. Changing a sign-in method asks for proof and sends a mail.`,
        facts: [
          `Passwords hashed with PBKDF2-SHA-256 through Web Crypto, 600,000 rounds by default`,
          `Signed session cookies, and an audit trail of every sign-in event`,
          `Personal API tokens, stored only as keyed hashes`,
          `Wrong passwords counted per sign-in name, with a short lock, from any network address`,
        ],
        notYet: [{ label: `Passkeys`, issue: issue(162) }, { label: `Magic links` }],
        code: { label: `Read the sign-in code`, href: source(`apps/api/services/sign-in.ts`) },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/profile">
            <Shot
              name="profile-security"
              alt="The security page of a profile: the sign-in methods, the second factor and the open sessions."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
      },
      {
        id: `teams`,
        nav: `Teams and roles`,
        eyebrow: `Teams`,
        title: `Groups with roles, from the first minute`,
        lead: `Every account gets a personal group at sign-up. People make shared groups, invite ` +
          `others, give them roles from viewer to owner and hand ownership over in one step. A ` +
          `deleted group can be brought back for 30 days, and each group keeps an activity log.`,
        facts: [
          `The group is the one tenancy boundary: personal and shared data pass the same check`,
          `No second permission model to keep in sync with the first`,
          `Invitations, role changes and ownership transfer, each with its own tests`,
        ],
        code: { label: `Read the groups domain`, href: source(`libs/domain/groups/`) },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/groups">
            <Shot
              name="group-members"
              alt="The members page of a group: each member with their role, and a button to invite someone."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
      },
      {
        id: `billing`,
        nav: `Billing per member`,
        eyebrow: `Money`,
        title: `Billing per member, through Stripe`,
        lead:
          `People see a pricing table, a free plan with limits and a 14-day trial of the paid ` +
          `plan. The owner sees what one more member costs before inviting them, and a clear ` +
          `notice with a date when a card fails.`,
        facts: [
          `Stripe Checkout and the customer portal; the webhook is the only source of the plan`,
          `Per-seat quantities that follow the member count`,
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
              alt="A group's members and its plan: Pro, active, €36.00 a month for 4 members at €9.00 each, with a button to manage billing."
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
          `People delete their account from the profile and have 7 days to change their mind. ` +
          `Read notifications are deleted after 90 days.`,
        facts: [
          `Deletion waits 7 days; signing in again cancels it`,
          `Nightly clean-up of read notifications, dead invitations and old audit events`,
        ],
        notYet: [
          { label: `Downloading an account's data`, issue: issue(145) },
          { label: `Translations: the app is English only`, issue: issue(200) },
        ],
        code: {
          label: `Read the account deletion code`,
          href: source(`libs/server/auth/account-deletion.ts`),
        },
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
        lead:
          `A teammate's change appears in every open tab of the group, and a laptop that wakes ` +
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
        id: `push`,
        nav: `Notifications`,
        eyebrow: `Notifications`,
        title: `Notifications in the app, on the phone and the desktop`,
        lead: `People get a notice when they are invited, given a new role or handed a group, in ` +
          `the app and as a web push on their phone or desktop.`,
        facts: [
          `Web push with your own keys, made by one task: deno task vapid-key:create`,
          `An unread count in the app, and "Mark all as read"`,
          `Each device's push subscription listed on the profile`,
        ],
        code: {
          label: `Read the web push service`,
          href: source(`apps/api/services/web-push-service.ts`),
        },
        visual: (
          <WindowFrame variant="browser" title="app.seedsaas.com/notifications">
            <Shot
              name="notifications"
              alt="The notifications page: three unread notices about a new group owner, a role change and an invitation, each with a link to open it."
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
          `work is saved before it is done.`,
        facts: [
          `Each command writes its event in the same database transaction as the change`,
          `A worker drains that outbox and sends mail, push and live updates`,
          `A failed attempt is retried with growing waits and logged with its cause`,
        ],
        code: { label: `Read the worker`, href: source(`apps/worker/+main.ts`) },
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
    lead: `One server you own, the tools to see what it does, and an area where your team ` +
      `helps the people who use your product.`,
    status: `The admin area covers people today; groups, billing and newsletter screens for ` +
      `operators come next.`,
    features: [
      {
        id: `admin`,
        nav: `Admin area`,
        eyebrow: `Support`,
        title: `An admin area for your operators`,
        lead: `Your support team finds a person by address or name, filters by role or blocked ` +
          `state, opens their sign-in methods, sessions, groups and audit trail, blocks or ` +
          `unblocks them, and ends their sessions.`,
        facts: [
          `A separate app on its own host, with its own session cookie`,
          `Roles: operator, supervisor, administrator`,
          `Every action confirmed first and written to the audit trail`,
          `Nobody can act on a person of an equal or higher role`,
        ],
        notYet: [
          { label: `Groups for operators`, issue: issue(426) },
          { label: `Billing for operators`, issue: issue(196) },
          { label: `Newsletter for operators`, issue: issue(428) },
        ],
        code: { label: `Read the admin app`, href: source(`apps/admin/`) },
        visual: (
          <WindowFrame variant="browser" title="admin.seedsaas.com">
            <Shot
              name="admin-overview"
              alt="The admin area's people list: a search by name or address, filters by role and blocked state, and four people with when each was last seen."
              sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
            />
          </WindowFrame>
        ),
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
          `Postgres, Valkey and MinIO beside the apps`,
          `VictoriaMetrics, VictoriaLogs and Grafana, with alerts`,
          `An opt-in daily encrypted restic backup of the database, and a written restore`,
          `Release images published from CI when you push a version tag`,
        ],
        notYet: [{
          label: `File uploads: MinIO runs, nothing stores files in it yet`,
          issue: issue(157),
        }],
        code: { label: `Read the Compose files`, href: source(`infra/compose/`) },
        visual: <DeployVisual />,
      },
      {
        id: `website`,
        nav: `Public website`,
        eyebrow: `Website`,
        title: `A public website to adapt`,
        lead: `This site: fast, server-rendered and usable with JavaScript turned off, with ` +
          `pricing, legal pages and a newsletter.`,
        facts: [
          `Fresh on the server; every action a real link or form`,
          `Pricing read from the app's plan catalog`,
          `A newsletter with double opt-in and one-click unsubscribe`,
          `sitemap.xml, robots.txt, canonical links and Open Graph images`,
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

/** The page's structured data: the software, as a free developer tool, and the page's place. */
function featuresJsonLd(origin: string, demo: string): unknown[] {
  return [
    {
      "@type": `SoftwareApplication`,
      name: SITE_NAME,
      description: FEATURES_HEAD.description,
      applicationCategory: `DeveloperApplication`,
      operatingSystem: `Linux (Docker)`,
      offers: { "@type": `Offer`, price: 0, priceCurrency: `USD` },
      url: demo,
      featureList: TIERS.flatMap((tier) => tier.features.map((feature) => feature.nav)),
    },
    breadcrumbListJsonLd(`${origin}/features`, [
      { name: SITE_NAME, href: `${origin}/` },
      { name: `Features` },
    ]),
  ]
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  return (
    <PageHero
      eyebrow="Features"
      title="Everything Seed ships, and what it does not yet"
      lead="Seed is a free, open-source SaaS starter with teams and billing. Each section says what a person using your product notices, then what you get as a developer, and links to the code."
    >
      <div class="flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
        <Button href={demoHref} size="lg" data-e2e="features-try-demo">Try the live demo</Button>
        <Button href={REPOSITORY_URL} variant="outline" size="lg">
          <IconGitHub class="size-5" aria-hidden="true" /> View on GitHub
        </Button>
      </div>
      <p class="max-w-2xl text-sm text-muted text-pretty">
        Seed is a work in progress, built in public. What is not built yet is marked "Not built yet"
        next to the claim it limits, with its issue when one is open.
      </p>
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
    jsonLd: featuresJsonLd(state.webAppOrigin, spa.signUp),
  }
  const nav = TIERS.flatMap((tier) =>
    tier.features.map((feature) => ({ label: feature.nav, href: `#${feature.id}` }))
  )
  return (
    <SiteFrame state={state} path="/features" head={head}>
      <Hero demoHref={spa.signUp} />
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
          <a
            href="/compare"
            class="inline-flex items-center gap-1 self-start py-2 text-lg font-medium text-primary hover:underline"
            data-e2e="features-compare"
          >
            How Seed compares <IconArrowRight class="size-5" aria-hidden="true" />
          </a>
        </div>
      </div>
      <CtaBand demoHref={spa.signUp} />
    </SiteFrame>
  )
})
