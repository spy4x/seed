// Seed's own site: see docs/start-a-product.md
import type { ComponentType, JSX } from "preact"
import {
  IconArrowDown,
  IconArrowRight,
  IconChatBubble,
  IconCheck,
  IconClock,
  IconCreditCard,
  IconFolder,
  IconHome,
  IconKey,
  IconMail,
  IconPackage,
  IconServer,
  IconShieldCheck,
  IconTrendingUp,
  IconUsers,
} from "@spy4x/preact-icons"
import type { IconProps } from "@spy4x/preact-icons"
import { FeatureCard } from "@spy4x/preact-ui/feature-card"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { ADMIN_VIDEO, ADMIN_VIDEO_DURATION } from "../../admin-video.ts"
import { AdminVideoPlayer } from "../../components/admin-video.tsx"
import { Band } from "../../components/band.tsx"
import { CtaBand } from "../../components/cta-band.tsx"
import { NotYetList } from "../../components/features-section.tsx"
import { SectionIntro } from "../../components/section-intro.tsx"
import {
  REPOSITORY_URL,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareId,
} from "../../site.tsx"
import { define } from "../../utils.ts"
import { DEFAULT_LANGUAGE, siteTranslator } from "../../languages.ts"
import { useSite } from "../../use-site.tsx"
import { siteEnglishText } from "@ui/site-text.ts"
import type { Language } from "@domain/identity"
import type { Translator } from "@spy4x/platform/universal/i18n"

/** The page's title and description, as search results and social previews show them. */
export function adminHead(t: Translator<string>): { title: string; description: string } {
  return { title: t.t(`AdminTour.title`), description: t.t(`AdminTour.description`) }
}

/** The page's head in English, for `sitemap.xml` and `llms.txt`. */
export const ADMIN_HEAD = adminHead(siteEnglishText())

/** The visible heading and lead, which the video's JSON-LD and sitemap entry repeat. */
export function adminHero(t: Translator<string>): { title: string; lead: string } {
  return { title: t.t(`AdminTour.heroTitle`), lead: t.t(`AdminTour.heroLead`) }
}

/** The hero in English, for the video sitemap, which lists the English page only. */
export const ADMIN_HERO = adminHero(siteEnglishText())

/** The day this page last changed, for the sitemap's `lastmod`. */
export const ADMIN_UPDATED = `2026-10-28`

/** The admin app's code on GitHub. */
const ADMIN_CODE = {
  label: `AdminTour.code`,
  href: `${REPOSITORY_URL}/tree/main/apps/admin`,
}

/**
 * The admin app's modules in its rail's order, each with the rail's own icon
 * (`apps/admin/src/modules/registry.ts`) and its page subtitle, reworded for a visitor.
 */
const MODULES: readonly {
  id: string
  name: string
  Icon: ComponentType<IconProps>
  text: string
}[] = [
  { id: `dashboard`, name: `AdminTour.dashboard`, Icon: IconHome, text: `AdminTour.dashboardText` },
  { id: `stats`, name: `AdminTour.stats`, Icon: IconTrendingUp, text: `AdminTour.statsText` },
  { id: `users`, name: `AdminTour.users`, Icon: IconUsers, text: `AdminTour.usersText` },
  { id: `groups`, name: `AdminTour.groups`, Icon: IconFolder, text: `AdminTour.groupsText` },
  { id: `billing`, name: `AdminTour.billing`, Icon: IconCreditCard, text: `AdminTour.billingText` },
  {
    id: `newsletter`,
    name: `AdminTour.newsletter`,
    Icon: IconMail,
    text: `AdminTour.newsletterText`,
  },
  {
    id: `contact-links`,
    name: `AdminTour.contactLinks`,
    Icon: IconChatBubble,
    text: `AdminTour.contactLinksText`,
  },
  { id: `catalog`, name: `AdminTour.catalog`, Icon: IconPackage, text: `AdminTour.catalogText` },
  { id: `audit-log`, name: `AdminTour.audit`, Icon: IconShieldCheck, text: `AdminTour.auditText` },
  { id: `jobs`, name: `AdminTour.jobs`, Icon: IconClock, text: `AdminTour.jobsText` },
  { id: `system`, name: `AdminTour.system`, Icon: IconServer, text: `AdminTour.systemText` },
  { id: `api-tokens`, name: `AdminTour.tokens`, Icon: IconKey, text: `AdminTour.tokensText` },
]

/** The operator roles, lowest first, and what each adds. */
const ROLES: readonly { name: string; text: string }[] = [
  { name: `AdminTour.operator`, text: `AdminTour.operatorText` },
  { name: `AdminTour.supervisor`, text: `AdminTour.supervisorText` },
  { name: `AdminTour.administrator`, text: `AdminTour.administratorText` },
]

const GUARANTEES = [
  `AdminTour.guarantee2fa`,
  `AdminTour.guaranteeHidden`,
  `AdminTour.guaranteeLogged`,
  `AdminTour.guaranteePrivate`,
] as const

const NOT_YET = [`AdminTour.notYetImpersonate`] as const

/** The page's structured data: the video, its transcript, and the page's place under the home. */
function adminJsonLd(t: Translator<string>, origin: string, language: Language): unknown[] {
  const url = `${origin}/admin`
  const hero = adminHero(t)
  return [
    {
      "@type": `VideoObject`,
      "@id": `${url}#video`,
      name: hero.title,
      description: hero.lead,
      inLanguage: language,
      thumbnailUrl: `${origin}${ADMIN_VIDEO.poster}`,
      contentUrl: `${origin}${ADMIN_VIDEO.mp4}`,
      uploadDate: ADMIN_VIDEO.uploadDate,
      duration: ADMIN_VIDEO_DURATION,
      width: ADMIN_VIDEO.width,
      height: ADMIN_VIDEO.height,
      transcript: ADMIN_VIDEO.transcript.join(` `),
      about: { "@id": softwareId(origin) },
    },
    siteBreadcrumbsJsonLd(origin, `/admin`, t.t(`AdminTour.crumb`), language),
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
  const { t } = useSite()
  const hero = adminHero(t)
  return (
    <PageHero
      class="site-glow"
      eyebrow={t.t(`AdminTour.crumb`)}
      title={hero.title}
      lead={hero.lead}
    >
      <div class="mt-4 flex w-full max-w-5xl flex-col gap-2">
        <AdminVideoPlayer />
        <div class="flex flex-col gap-x-6 sm:flex-row sm:items-center sm:justify-between">
          <p class="pt-2 text-sm text-muted text-pretty sm:pt-0" data-e2e="admin-video-meta">
            {t.t(`AdminTour.meta`, {
              seconds: ADMIN_VIDEO.seconds,
              sound: t.t(`AdminVideo.soundLine`),
            })}
          </p>
          <TextLink
            href="#transcript"
            down
            e2e="admin-transcript-jump"
            event="admin-transcript-jump"
          >
            {t.t(`AdminTour.transcriptJump`)}
          </TextLink>
        </div>
      </div>
    </PageHero>
  )
}

function Modules(): JSX.Element {
  const { t, rich } = useSite()
  return (
    <Band labelledBy="modules-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="modules-title"
          eyebrow={t.t(`AdminTour.modulesEyebrow`)}
          title={t.t(`AdminTour.modulesTitle`)}
          lead={rich(`AdminTour.modulesLead`, {
            doc: (text) => (
              <a
                href={`${REPOSITORY_URL}/blob/main/docs/admin-modules.md`}
                class="font-mono text-[0.9em] text-primary underline"
                data-umami-event="read-code"
                data-umami-event-from="modules"
              >
                {text}
              </a>
            ),
          })}
        />
        <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-e2e="admin-modules">
          {MODULES.map(({ id, name, Icon, text }) => (
            <FeatureCard key={id} id={`module-${id}`} title={t.t(name)} Icon={Icon}>
              {t.t(text)}
            </FeatureCard>
          ))}
        </div>
      </div>
    </Band>
  )
}

function Roles(): JSX.Element {
  const { t } = useSite()
  return (
    <Band tone="alt" labelledBy="roles-title">
      <div class="grid gap-12 lg:grid-cols-2">
        <div class="flex flex-col gap-8">
          <SectionIntro
            id="roles-title"
            eyebrow={t.t(`AdminTour.rolesEyebrow`)}
            title={t.t(`AdminTour.rolesTitle`)}
            lead={t.t(`AdminTour.rolesLead`)}
          />
          <dl class="flex flex-col gap-4" data-e2e="admin-roles">
            {ROLES.map(({ name, text }) => (
              <div key={name} class="flex flex-col gap-1">
                <dt class="font-semibold">{t.t(name)}</dt>
                <dd class="text-muted text-pretty">{t.t(text)}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div class="flex flex-col gap-6 lg:pt-12">
          <ul class="flex flex-col gap-3">
            {GUARANTEES.map((line) => (
              <li key={line} class="flex items-start gap-2">
                <IconCheck class="mt-1 size-4 shrink-0 text-primary" aria-hidden="true" />
                <span class="text-pretty">{t.t(line)}</span>
              </li>
            ))}
          </ul>
          <NotYetList items={NOT_YET.map((label) => ({ label: t.t(label) }))} />
          <TextLink href={ADMIN_CODE.href} e2e="admin-roles-code" event="read-code" from="roles">
            {t.t(ADMIN_CODE.label)}
          </TextLink>
        </div>
      </div>
    </Band>
  )
}

/**
 * The video's transcript. The video and its captions are English, so its lines stay English on
 * every language's page, marked `lang="en"`; the words around them are translated.
 */
function Transcript(): JSX.Element {
  const { t, language } = useSite()
  return (
    <Band id="transcript" labelledBy="transcript-title" width="3xl">
      <div class="flex flex-col gap-6" data-e2e="admin-transcript">
        <SectionIntro
          id="transcript-title"
          title={t.t(`AdminTour.transcriptTitle`)}
          lead={t.t(`AdminVideo.soundTranscript`)}
        />
        {language === DEFAULT_LANGUAGE
          ? null
          : <p class="text-muted">{t.t(`AdminTour.transcriptEnglish`)}</p>}
        <ol lang="en" dir="ltr" class="flex list-decimal flex-col gap-3 ps-6">
          {ADMIN_VIDEO.transcript.map((line) => <li key={line} class="text-pretty">{line}</li>)}
        </ol>
        <p class="text-muted">{t.t(`AdminTour.sampleData`)}</p>
        <TextLink
          href={ADMIN_VIDEO.mp4}
          e2e="admin-video-download"
          event="admin-video-download"
          from="transcript"
        >
          {t.t(`AdminTour.download`, { size: ADMIN_VIDEO.mp4Size })}
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
  const t = siteTranslator(state.language)
  const head: SitePageHead = {
    ...adminHead(t),
    og: `admin`,
    jsonLd: adminJsonLd(t, state.webAppOrigin, state.language),
  }
  return (
    <SiteFrame state={state} path="/admin" head={head}>
      <Hero />
      <Modules />
      <Roles />
      <Transcript />
      <CtaBand
        ask="code"
        title={t.t(`AdminTour.ctaTitle`)}
        lead={t.t(`AdminTour.ctaLead`)}
        code={{ ...ADMIN_CODE, label: t.t(ADMIN_CODE.label) }}
      />
    </SiteFrame>
  )
})
