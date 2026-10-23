// Seed's own site: see docs/start-a-product.md
import type { ComponentType, JSX } from "preact"
import {
  IconArrowDown,
  IconArrowRight,
  IconCheck,
  IconClock,
  IconCreditCard,
  IconFolder,
  IconHome,
  IconKey,
  IconMail,
  IconServer,
  IconShieldCheck,
  IconUsers,
} from "@spy4x/preact-icons"
import type { IconProps } from "@spy4x/preact-icons"
import { FeatureCard } from "@spy4x/preact-ui/feature-card"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { ADMIN_VIDEO, ADMIN_VIDEO_DURATION } from "../admin-video.ts"
import { AdminVideoPlayer } from "../components/admin-video.tsx"
import { Band } from "../components/band.tsx"
import { CtaBand } from "../components/cta-band.tsx"
import { NotYetList } from "../components/features-section.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import {
  REPOSITORY_URL,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareId,
} from "../site.tsx"
import { define } from "../utils.ts"

/** The page's title and description, as search results and social previews show them. */
export const ADMIN_HEAD = {
  title: `Admin panel for your SaaS: users, billing, audit log`,
  description: `Seed's admin panel: find a person, end their sessions, refund a payment, ` +
    `run a failed job again. Risky actions ask first; all are logged. Free, MIT.`,
} as const

/** The visible heading and lead, which the video's JSON-LD and sitemap entry repeat. */
export const ADMIN_HERO = {
  title: `An admin panel for the people who run your product`,
  lead: `Seed ships an operator area on its own host. Your operators find a person, see their ` +
    `sign-in methods, sessions and groups, and help them: ends a session, sends a ` +
    `password-reset link, refunds a payment. Risky actions ask first, and every action lands ` +
    `in the audit log.`,
} as const

/** The day this page last changed, for the sitemap's `lastmod`. */
export const ADMIN_UPDATED = `2026-10-21`

/** The admin app's code on GitHub. */
const ADMIN_CODE = {
  label: `Read the admin app's code`,
  href: `${REPOSITORY_URL}/tree/main/apps/admin`,
}

/**
 * The admin app's modules in its rail's order, each with the rail's own icon
 * (`apps/admin/src/modules/registry.ts`) and its page subtitle, reworded for a visitor.
 */
const MODULES: readonly { name: string; Icon: ComponentType<IconProps>; text: string }[] = [
  {
    name: `Dashboard`,
    Icon: IconHome,
    text: `The product at a glance over the last 30 days: people, sign-ups, who is active, ` +
      `groups and notes.`,
  },
  {
    name: `Users`,
    Icon: IconUsers,
    text: `Everyone with an account. Open a person to block them, end a session, send a ` +
      `password-reset link or see the copies of their data they asked for.`,
  },
  {
    name: `Groups`,
    Icon: IconFolder,
    text: `Every group, its owner and its members. Manage members and ` +
      `invitations, or hand a group to another member.`,
  },
  {
    name: `Billing`,
    Icon: IconCreditCard,
    text: `Who pays, what they pay and what you earn. Refund a payment, give time at no charge ` +
      `or cancel a subscription.`,
  },
  {
    name: `Newsletter`,
    Icon: IconMail,
    text: `Who gets the newsletter and what it sent. Export the list as CSV.`,
  },
  {
    name: `Audit log`,
    Icon: IconShieldCheck,
    text: `Every sign-in, account change, group change and operator action, newest first. ` +
      `Export it as CSV.`,
  },
  {
    name: `Jobs`,
    Icon: IconClock,
    text: `Every background job and how each run went. Run a failed job again, run one now or ` +
      `cancel it.`,
  },
  {
    name: `System`,
    Icon: IconServer,
    text: `The health of the database, the cache, the job queue and the backup.`,
  },
  {
    name: `API tokens`,
    Icon: IconKey,
    text: `Every API token, whose it is and when it was last used.`,
  },
]

/** The operator roles, lowest first, and what each adds. */
const ROLES: readonly { name: string; text: string }[] = [
  {
    name: `Operator`,
    text: `Day-to-day support: find people, end sessions, send password-reset links, manage ` +
      `groups.`,
  },
  {
    name: `Supervisor`,
    text: `Also refunds payments, cancels a subscription at once and hands a group to another ` +
      `member.`,
  },
  { name: `Administrator`, text: `Also gives roles, any role below their own.` },
]

const GUARANTEES = [
  `Signing in to the admin asks for a 2FA code from every operator who has turned 2FA on.`,
  `Anyone below operator gets "page not found", as if the admin did not exist.`,
  `Risky actions ask first, and every action is written to the audit log.`,
  `The admin reads counts and account facts, never the content of a person's notes.`,
] as const

const NOT_YET = [
  {
    label: `Translations: the admin app is English only`,
    issue: `${REPOSITORY_URL}/issues/275`,
  },
  { label: `Signing in as a person to see what they see` },
] as const

/** The page's structured data: the video, its transcript, and the page's place under the home. */
function adminJsonLd(origin: string): unknown[] {
  const url = `${origin}/admin`
  return [
    {
      "@type": `VideoObject`,
      "@id": `${url}#video`,
      name: ADMIN_HERO.title,
      description: ADMIN_HERO.lead,
      thumbnailUrl: `${origin}${ADMIN_VIDEO.poster}`,
      contentUrl: `${origin}${ADMIN_VIDEO.mp4}`,
      uploadDate: ADMIN_VIDEO.uploadDate,
      duration: ADMIN_VIDEO_DURATION,
      width: ADMIN_VIDEO.width,
      height: ADMIN_VIDEO.height,
      transcript: ADMIN_VIDEO.transcript.join(` `),
      about: { "@id": softwareId(origin) },
    },
    siteBreadcrumbsJsonLd(origin, `/admin`, `Admin panel`),
  ]
}

/**
 * A text link with an arrow, at least 44 px tall so a finger hits it. `event` and `from` name the
 * Umami event a click sends (`docs/analytics.md`).
 */
function TextLink(
  { href, children, down = false, e2e, event, from }: {
    href: string
    children: string
    down?: boolean
    e2e: string
    event: string
    from?: string
  },
): JSX.Element {
  const Arrow = down ? IconArrowDown : IconArrowRight
  return (
    <a
      href={href}
      class="inline-flex min-h-11 items-center gap-1 self-start font-medium text-primary hover:underline"
      data-e2e={e2e}
      data-umami-event={event}
      data-umami-event-from={from}
    >
      {children} <Arrow class="size-4" aria-hidden="true" />
    </a>
  )
}

function Hero(): JSX.Element {
  return (
    <PageHero
      class="site-glow"
      eyebrow="Admin panel"
      title={ADMIN_HERO.title}
      lead={ADMIN_HERO.lead}
    >
      <div class="mt-4 flex w-full max-w-5xl flex-col gap-2">
        <AdminVideoPlayer />
        <div class="flex flex-col gap-x-6 sm:flex-row sm:items-center sm:justify-between">
          <p class="pt-2 text-sm text-muted text-pretty sm:pt-0" data-e2e="admin-video-meta">
            {ADMIN_VIDEO.seconds} seconds · {ADMIN_VIDEO.sound.line} · Sample data
          </p>
          <TextLink
            href="#transcript"
            down
            e2e="admin-transcript-jump"
            event="admin-transcript-jump"
          >
            Read what the video shows
          </TextLink>
        </div>
      </div>
    </PageHero>
  )
}

function Modules(): JSX.Element {
  return (
    <Band labelledBy="modules-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="modules-title"
          eyebrow="Modules"
          title="Nine modules, one per job"
          lead={
            <>
              Each module is one entry in the admin's icon rail. Add your own by copying one: the
              steps are in{" "}
              <a
                href={`${REPOSITORY_URL}/blob/main/docs/admin-modules.md`}
                class="font-mono text-[0.9em] text-primary underline"
                data-umami-event="read-code"
                data-umami-event-from="modules"
              >
                docs/admin-modules.md
              </a>.
            </>
          }
        />
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-e2e="admin-modules">
          {MODULES.map(({ name, Icon, text }) => (
            <FeatureCard
              key={name}
              id={`module-${name.toLowerCase().replace(/ /g, `-`)}`}
              title={name}
              Icon={Icon}
            >
              {text}
            </FeatureCard>
          ))}
        </div>
      </div>
    </Band>
  )
}

function Roles(): JSX.Element {
  return (
    <Band tone="alt" labelledBy="roles-title">
      <div class="grid gap-12 lg:grid-cols-2">
        <div class="flex flex-col gap-8">
          <SectionIntro
            id="roles-title"
            eyebrow="Roles"
            title="Nobody acts on an equal or higher role"
            lead="Operators work in tiers. A higher role can do everything a lower one can, and no one can act on a person whose role is equal to or higher than their own."
          />
          <dl class="flex flex-col gap-4" data-e2e="admin-roles">
            {ROLES.map(({ name, text }) => (
              <div key={name} class="flex flex-col gap-1">
                <dt class="font-semibold">{name}</dt>
                <dd class="text-muted text-pretty">{text}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div class="flex flex-col gap-6 lg:pt-12">
          <ul class="flex flex-col gap-3">
            {GUARANTEES.map((line) => (
              <li key={line} class="flex items-start gap-2">
                <IconCheck class="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span class="text-pretty">{line}</span>
              </li>
            ))}
          </ul>
          <NotYetList items={NOT_YET} />
          <TextLink href={ADMIN_CODE.href} e2e="admin-roles-code" event="read-code" from="roles">
            {ADMIN_CODE.label}
          </TextLink>
        </div>
      </div>
    </Band>
  )
}

function Transcript(): JSX.Element {
  return (
    <Band id="transcript" labelledBy="transcript-title" width="3xl">
      <div class="flex flex-col gap-6" data-e2e="admin-transcript">
        <SectionIntro
          id="transcript-title"
          title="What the video shows"
          lead={ADMIN_VIDEO.sound.transcript}
        />
        <ol class="flex list-decimal flex-col gap-3 pl-6">
          {ADMIN_VIDEO.transcript.map((line) => <li key={line} class="text-pretty">{line}</li>)}
        </ol>
        <p class="text-muted">The people and groups in the video are made-up sample data.</p>
        <TextLink
          href={ADMIN_VIDEO.mp4}
          e2e="admin-video-download"
          event="admin-video-download"
          from="transcript"
        >
          {`Download the video (MP4, ${ADMIN_VIDEO.mp4Size})`}
        </TextLink>
      </div>
    </Band>
  )
}

/**
 * `/admin`: the admin panel video as the page's main content, then its modules, the roles rule
 * and the video's transcript. One ask: the code on GitHub, since the public demo has no admin.
 */
export default define.page(function Admin({ state }) {
  const head: SitePageHead = {
    ...ADMIN_HEAD,
    og: `admin`,
    jsonLd: adminJsonLd(state.webAppOrigin),
  }
  return (
    <SiteFrame state={state} path="/admin" head={head}>
      <Hero />
      <Modules />
      <Roles />
      <Transcript />
      <CtaBand
        ask="code"
        title="Read the code, then make it yours"
        lead="The admin app lives in the same repository as the product, runs on its own host, and is free under the MIT licence. It is not part of the public demo, because operators there would see real sign-ups."
        code={ADMIN_CODE}
      />
    </SiteFrame>
  )
})
