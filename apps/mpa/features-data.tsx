// Seed's own site: see docs/start-a-product.md
/**
 * Every feature the website describes, in one place: `/features` draws all of them, and each
 * feature page (`/features/<slug>`) draws one, with the facts and "Not built yet" items from the
 * same object. Every word of both is a key of the `site` catalog (`i18n/site/`), so each page
 * exists in every language the site serves: `/de/features/<slug>` is the German one. A product
 * built on Seed rewrites this file and those keys to describe its own features.
 *
 * @module
 */
import { WindowFrame } from "@spy4x/preact-ui/window-frame"
import { appAddress } from "./brand.ts"
import type { FeatureSectionProps, FeatureTierProps } from "./components/features-section.tsx"
import { AggregateFiles, DeployVisual, OutboxDiagram } from "./components/features-visuals.tsx"
import { FeatureLoop } from "./components/feature-loop.tsx"
import { AdminVideoStill } from "./components/admin-video.tsx"
import { ADMIN_TOUR_MODULES } from "./admin-modules.ts"
import { ADMIN_VIDEO } from "./admin-video.ts"
import { Shot } from "./components/shot.tsx"
import type { Translator } from "@spy4x/platform/universal/i18n"
import type { Language } from "@domain/identity"
import { DEFAULT_LANGUAGE, languageList, localePath } from "./languages.ts"
import { BROWSER_SUITE_COUNT } from "./repo-facts.ts"
import { REPOSITORY_URL } from "./site.tsx"
import type { Site } from "./use-site.tsx"

/**
 * The Quality section's lead, with the browser test suites counted when the site was built
 * (`repo-facts.ts`). Without a build nothing was counted, and the lead names no number.
 */
function qualityLead(t: Site["t"]): string {
  return BROWSER_SUITE_COUNT === undefined
    ? t.t(`FeatureQuality.leadUncounted`)
    : t.t(`FeatureQuality.lead`, { count: BROWSER_SUITE_COUNT })
}

/** A file or folder of the repository on GitHub, for the "where in the code" links. */
export function source(path: string): string {
  const kind = path.endsWith(`/`) ? `tree` : `blob`
  return `${REPOSITORY_URL}/${kind}/main/${path.replace(/\/$/, ``)}`
}

/** A feature as the page lists it, without the side its picture goes on: the tier decides that. */
export type Feature = Omit<FeatureSectionProps, "flip"> & {
  nav: string
  /** Its visual holds a product screenshot (`picture img`), which the lightbox opens. */
  shots?: true
}

/** One group of features with its heading, status line and features, in page order. */
export interface Tier extends Omit<FeatureTierProps, "children"> {
  features: readonly Feature[]
}

/**
 * Every claim below was checked against the code on 2026-10-16; the "where in the code" link of each
 * section points at it. Issue numbers are the open issues that track what is missing.
 */
export function tiers({ t, href, rich, language }: Site): readonly Tier[] {
  return [
    {
      id: `settled`,
      eyebrow: t.t(`FeatureTierSettled.eyebrow`),
      title: t.t(`FeatureTierSettled.title`),
      lead: t.t(`FeatureTierSettled.lead`),
      status: t.t(`FeatureTierSettled.status`),
      features: [
        {
          id: `sign-in`,
          nav: t.t(`FeatureSignIn.nav`),
          title: t.t(`FeatureSignIn.title`),
          lead: t.t(`FeatureSignIn.lead`),
          facts: [
            t.t(`FeatureSignIn.fact1`),
            t.t(`FeatureSignIn.fact2`),
            t.t(`FeatureSignIn.fact3`),
            t.t(`FeatureSignIn.fact4`),
            t.t(`FeatureSignIn.fact5`),
            t.t(`FeatureSignIn.fact6`),
            t.t(`FeatureSignIn.fact7`),
          ],
          code: { label: t.t(`FeatureSignIn.code`), href: source(`apps/api/services/sign-in.ts`) },
          shots: true,
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/profile/security`)}>
              <Shot
                name="profile-security"
                alt={t.t(`HomeFeatures.signInAlt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `teams`,
          nav: t.t(`FeatureTeams.nav`),
          title: t.t(`FeatureTeams.title`),
          lead: t.t(`FeatureTeams.lead`),
          facts: [
            t.t(`FeatureTeams.fact1`),
            t.t(`FeatureTeams.fact2`),
            t.t(`FeatureTeams.fact3`),
            t.t(`FeatureTeams.fact4`),
          ],
          code: { label: t.t(`FeatureTeams.code`), href: source(`libs/domain/groups/`) },
          shots: true,
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/groups/…/activity`)}>
              <Shot
                name="activity"
                alt={t.t(`FeatureTeams.alt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `overview`,
          nav: t.t(`FeatureOverview.nav`),
          title: t.t(`FeatureOverview.title`),
          lead: t.t(`FeatureOverview.lead`),
          facts: [
            t.t(`FeatureOverview.fact1`),
            t.t(`FeatureOverview.fact2`),
            t.t(`FeatureOverview.fact3`),
            t.t(`FeatureOverview.fact4`),
          ],
          code: {
            label: t.t(`FeatureOverview.code`),
            href: source(`libs/domain/notes/overview.ts`),
          },
        },
        {
          id: `billing`,
          nav: t.t(`FeatureBilling.nav`),
          title: t.t(`FeatureBilling.title`),
          lead: t.t(`FeatureBilling.lead`),
          facts: [
            t.t(`FeatureBilling.fact1`),
            t.t(`FeatureBilling.fact2`),
            t.t(`FeatureBilling.fact3`),
            t.t(`FeatureBilling.fact4`),
            <span key="catalog">
              {rich(`FeatureBilling.catalog`, {
                pricing: (text) => (
                  <a href={href(`/pricing`)} class="text-primary underline">{text}</a>
                ),
              })}
            </span>,
          ],
          notYet: [{ label: t.t(`FeatureBilling.notYet1`) }],
          code: { label: t.t(`FeatureBilling.code`), href: source(`docs/billing.md`) },
          shots: true,
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/groups`)}>
              <Shot
                name="billing"
                alt={t.t(`FeatureBilling.alt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `privacy`,
          nav: t.t(`FeaturePrivacy.nav`),
          title: t.t(`FeaturePrivacy.title`),
          lead: t.t(`FeaturePrivacy.lead`),
          facts: [
            t.t(`FeaturePrivacy.fact1`),
            t.t(`FeaturePrivacy.fact2`),
            t.t(`FeaturePrivacy.fact3`),
          ],
          code: {
            label: t.t(`FeaturePrivacy.code`),
            href: source(`libs/server/auth/account-deletion.ts`),
          },
        },
        {
          id: `export`,
          nav: t.t(`FeatureExport.nav`),
          title: t.t(`FeatureExport.title`),
          lead: t.t(`FeatureExport.lead`),
          facts: [
            t.t(`FeatureExport.fact1`),
            t.t(`FeatureExport.fact2`),
            t.t(`FeatureExport.fact3`),
            t.t(`FeatureExport.fact4`),
          ],
          code: {
            label: t.t(`FeatureExport.code`),
            href: source(`libs/server/groups/portable.ts`),
          },
        },
        {
          id: `languages`,
          nav: t.t(`FeatureLanguages.nav`),
          title: t.t(`FeatureLanguages.title`),
          lead: t.t(`FeatureLanguages.lead`, { languages: languageList(language) }),
          facts: [
            t.t(`FeatureLanguages.fact1`),
            t.t(`FeatureLanguages.fact2`),
            t.t(`FeatureLanguages.fact3`),
            t.t(`FeatureLanguages.fact4`),
            t.t(`FeatureLanguages.fact5`),
          ],
          code: { label: t.t(`FeatureLanguages.code`), href: source(`i18n/TRANSLATING.md`) },
        },
      ],
    },
    {
      id: `ready`,
      eyebrow: t.t(`FeatureTierReady.eyebrow`),
      title: t.t(`FeatureTierReady.title`),
      lead: t.t(`FeatureTierReady.lead`),
      status: t.t(`FeatureTierReady.status`),
      features: [
        {
          id: `realtime`,
          nav: t.t(`FeatureRealtime.nav`),
          title: t.t(`FeatureRealtime.title`),
          lead: t.t(`FeatureRealtime.lead`),
          facts: [
            t.t(`FeatureRealtime.fact1`),
            t.t(`FeatureRealtime.fact2`),
            t.t(`FeatureRealtime.fact3`),
          ],
          code: {
            label: t.t(`FeatureRealtime.code`),
            href: source(`docs/decisions/002-realtime-transport-and-sync.md`),
          },
          visual: <FeatureLoop loop="realtime" />,
        },
        {
          id: `offline`,
          nav: t.t(`FeatureOffline.nav`),
          title: t.t(`FeatureOffline.title`),
          lead: t.t(`FeatureOffline.lead`),
          facts: [
            t.t(`FeatureOffline.fact1`),
            t.t(`FeatureOffline.fact2`),
            t.t(`FeatureOffline.fact3`),
          ],
          code: { label: t.t(`FeatureOffline.code`), href: source(`docs/offline.md`) },
          visual: <FeatureLoop loop="offline" />,
        },
        {
          id: `shortcuts`,
          nav: t.t(`FeatureShortcuts.nav`),
          title: t.t(`FeatureShortcuts.title`),
          lead: t.t(`FeatureShortcuts.lead`),
          facts: [
            t.t(`FeatureShortcuts.fact1`),
            t.t(`FeatureShortcuts.fact2`),
            t.t(`FeatureShortcuts.fact3`),
            t.t(`FeatureShortcuts.fact4`),
          ],
          code: { label: t.t(`FeatureShortcuts.code`), href: source(`libs/ui/shortcuts.tsx`) },
          visual: <FeatureLoop loop="shortcuts" />,
        },
        {
          id: `push`,
          nav: t.t(`FeaturePush.nav`),
          title: t.t(`FeaturePush.title`),
          lead: t.t(`FeaturePush.lead`),
          facts: [
            t.t(`FeaturePush.fact1`),
            t.t(`FeaturePush.fact2`),
            t.t(`FeaturePush.fact3`),
            t.t(`FeaturePush.fact4`),
          ],
          code: {
            label: t.t(`FeaturePush.code`),
            href: source(`apps/api/services/web-push-service.ts`),
          },
          shots: true,
          visual: (
            <WindowFrame variant="browser" title={appAddress(`/notifications`)}>
              <Shot
                name="notifications"
                alt={t.t(`FeaturePush.alt`)}
                sizes="(min-width: 1280px) 440px, (min-width: 768px) 672px, 100vw"
              />
            </WindowFrame>
          ),
        },
        {
          id: `worker`,
          nav: t.t(`FeatureWorker.nav`),
          title: t.t(`FeatureWorker.title`),
          lead: t.t(`FeatureWorker.lead`),
          facts: [
            t.t(`FeatureWorker.fact1`),
            t.t(`FeatureWorker.fact2`),
            t.t(`FeatureWorker.fact3`),
            t.t(`FeatureWorker.fact4`),
          ],
          code: { label: t.t(`FeatureWorker.code`), href: source(`docs/jobs.md`) },
          visual: <OutboxDiagram />,
        },
        {
          id: `your-feature`,
          nav: t.t(`FeatureYourFeature.nav`),
          title: t.t(`FeatureYourFeature.title`),
          lead: t.t(`FeatureYourFeature.lead`),
          facts: [
            t.t(`FeatureYourFeature.fact1`),
            t.t(`FeatureYourFeature.fact2`),
            t.t(`FeatureYourFeature.fact3`),
          ],
          code: { label: t.t(`FeatureYourFeature.code`), href: source(`docs/aggregates.md`) },
          visual: <AggregateFiles />,
        },
      ],
    },
    {
      id: `operations`,
      eyebrow: t.t(`FeatureTierOperations.eyebrow`),
      title: t.t(`FeatureTierOperations.title`),
      lead: t.t(`FeatureTierOperations.lead`),
      status: t.t(`FeatureTierOperations.status`),
      features: [
        {
          id: `admin`,
          nav: t.t(`FeatureAdmin.nav`),
          title: t.t(`FeatureAdmin.title`),
          lead: (
            <>
              {t.t(`FeatureAdmin.lead`)}{" "}
              <a
                href={href(`/admin`)}
                class="font-medium text-primary underline"
                data-e2e="features-admin-watch"
                data-umami-event="features-admin-video"
                data-umami-event-from="lead"
              >
                {t.t(`FeatureAdmin.watch`, { seconds: ADMIN_VIDEO.seconds })}
              </a>.
            </>
          ),
          facts: [
            t.t(`FeatureAdmin.fact1`),
            t.t(`FeatureAdmin.fact2`, { count: ADMIN_TOUR_MODULES.length }),
            t.t(`FeatureAdmin.fact3`),
          ],
          notYet: [
            { label: t.t(`FeatureAdmin.notYet1`) },
          ],
          code: { label: t.t(`FeatureAdmin.code`), href: source(`apps/admin/`) },
          visual: <AdminVideoStill />,
        },
        {
          id: `deploy`,
          nav: t.t(`FeatureDeploy.nav`),
          title: t.t(`FeatureDeploy.title`),
          lead: t.t(`FeatureDeploy.lead`),
          facts: [
            t.t(`FeatureDeploy.fact1`),
            t.t(`FeatureDeploy.fact2`),
            t.t(`FeatureDeploy.fact3`),
            t.t(`FeatureDeploy.fact4`),
            t.t(`FeatureDeploy.fact5`),
            t.t(`FeatureDeploy.fact6`),
          ],
          code: { label: t.t(`FeatureDeploy.code`), href: source(`infra/compose/`) },
          visual: <DeployVisual />,
        },
        {
          id: `website`,
          nav: t.t(`FeatureWebsite.nav`),
          title: t.t(`FeatureWebsite.title`),
          lead: t.t(`FeatureWebsite.lead`),
          facts: [
            t.t(`FeatureWebsite.fact1`),
            t.t(`FeatureWebsite.fact2`),
            t.t(`FeatureWebsite.fact3`),
            t.t(`FeatureWebsite.fact4`),
            t.t(`FeatureWebsite.fact5`),
            t.t(`FeatureWebsite.fact6`),
            t.t(`FeatureWebsite.fact7`),
            t.t(`FeatureWebsite.fact8`),
            t.t(`FeatureWebsite.fact9`),
          ],
          code: { label: t.t(`FeatureWebsite.code`), href: source(`apps/mpa/`) },
        },
        {
          id: `quality`,
          nav: t.t(`FeatureQuality.nav`),
          title: t.t(`FeatureQuality.title`),
          lead: qualityLead(t),
          facts: [
            t.t(`FeatureQuality.fact1`),
            t.t(`FeatureQuality.fact2`),
            t.t(`FeatureQuality.fact3`),
          ],
          code: { label: t.t(`FeatureQuality.code`), href: source(`e2e/`) },
        },
      ],
    },
  ]
}

/** A question on a feature page, its answer starting with "Yes.", "No." or "Not yet.". */
export interface FeatureQuestion {
  /** The answer's anchor in the FAQ list. */
  id: string
  question: string
  answer: string
}

/**
 * One feature page. Its facts, "Not built yet" items, picture and code link come from the feature
 * of the same id in {@link tiers}, so `/features` and the page never disagree. In
 * {@link FEATURE_PAGES} every text field (`name` to `how`, and each question and answer) is a key
 * of the `site` catalog; {@link featurePageIn} turns them into the words of one language.
 */
export interface FeaturePage {
  /** The page's address: `/features/<slug>`. Never renamed. */
  slug: string
  /** The feature's id in {@link tiers}, when it is not the slug. */
  feature?: string
  /** The page's last crumb and its card's title under "Other features". */
  name: string
  /** The `<title>`, under 60 characters: "{Feature} for your SaaS, without {the usual cost}". */
  title: string
  /** The meta description, under 155 characters, ending "Free and MIT-licensed." */
  description: string
  /** The searcher's phrase, as a statement. */
  h1: string
  /** Two or three sentences: yes and how, then what it takes to adopt. */
  answer: string
  /** One sentence for this page's card on the other feature pages. */
  summary: string
  /** "How it works", one or two short paragraphs. Empty, the section is not drawn. */
  how: readonly string[]
  /** The written guide on GitHub, until the site has the docs (#268). */
  guide?: string
  /** The code "Read the code" opens, when the feature's own code link is a guide. */
  code?: string
  /** 3 to 5 questions people type. Empty, the section is not drawn. */
  questions: readonly FeatureQuestion[]
  /** The app's screen the demo opens on, as `/try`'s `next`. Left out, the demo's start page. */
  demo?: string
  /** The day this page's words last changed: its "Last updated" line and the sitemap's `lastmod`. */
  updated: string
}

/** The runtime question, the same on every page that asks it. */
const RUNTIME_QUESTION: Omit<FeatureQuestion, "id"> = {
  question: `FeaturePage.runtimeQuestion`,
  answer: `FeaturePage.runtimeAnswer`,
}

/**
 * The feature pages, in the order "Other features" lists them, with their words as catalog keys.
 * Every claim was checked against the code and docs on `main` on 2026-11-01, the realtime and
 * shortcuts pages on 2026-11-02.
 */
export const FEATURE_PAGES: readonly FeaturePage[] = [
  {
    slug: `sign-in`,
    name: `FeaturePageSignIn.name`,
    title: `FeaturePageSignIn.title`,
    description: `FeaturePageSignIn.description`,
    h1: `FeaturePageSignIn.h1`,
    answer: `FeaturePageSignIn.answer`,
    summary: `FeaturePageSignIn.summary`,
    how: [`FeaturePageSignIn.how1`, `FeaturePageSignIn.how2`],
    guide: source(`docs/sign-in-providers.md`),
    questions: [
      {
        id: `faq-auth-service`,
        question: `FeaturePageSignIn.authServiceQuestion`,
        answer: `FeaturePageSignIn.authServiceAnswer`,
      },
      {
        id: `faq-passkeys`,
        question: `FeaturePageSignIn.passkeysQuestion`,
        answer: `FeaturePageSignIn.passkeysAnswer`,
      },
      {
        id: `faq-two-factor`,
        question: `FeaturePageSignIn.twoFactorQuestion`,
        answer: `FeaturePageSignIn.twoFactorAnswer`,
      },
      {
        id: `faq-providers-off`,
        question: `FeaturePageSignIn.providersOffQuestion`,
        answer: `FeaturePageSignIn.providersOffAnswer`,
      },
      { id: `faq-runtime`, ...RUNTIME_QUESTION },
    ],
    demo: `/profile/security`,
    updated: `2026-11-02`,
  },
  {
    slug: `groups`,
    feature: `teams`,
    name: `FeaturePageGroups.name`,
    title: `FeaturePageGroups.title`,
    description: `FeaturePageGroups.description`,
    h1: `FeaturePageGroups.h1`,
    answer: `FeaturePageGroups.answer`,
    summary: `FeaturePageGroups.summary`,
    how: [`FeaturePageGroups.how1`, `FeaturePageGroups.how2`],
    guide: source(`docs/aggregates.md`),
    questions: [
      {
        id: `faq-personal-group`,
        question: `FeaturePageGroups.personalGroupQuestion`,
        answer: `FeaturePageGroups.personalGroupAnswer`,
      },
      {
        id: `faq-viewer`,
        question: `FeaturePageGroups.viewerQuestion`,
        answer: `FeaturePageGroups.viewerAnswer`,
      },
      {
        id: `faq-restore`,
        question: `FeaturePageGroups.restoreQuestion`,
        answer: `FeaturePageGroups.restoreAnswer`,
      },
      {
        id: `faq-second-model`,
        question: `FeaturePageGroups.secondModelQuestion`,
        answer: `FeaturePageGroups.secondModelAnswer`,
      },
    ],
    demo: `/groups`,
    updated: `2026-11-01`,
  },
  {
    slug: `billing`,
    name: `FeaturePageBilling.name`,
    title: `FeaturePageBilling.title`,
    description: `FeaturePageBilling.description`,
    h1: `FeaturePageBilling.h1`,
    answer: `FeaturePageBilling.answer`,
    summary: `FeaturePageBilling.summary`,
    how: [`FeaturePageBilling.how1`, `FeaturePageBilling.how2`],
    guide: source(`docs/billing.md`),
    code: source(`apps/api/features/billing/`),
    questions: [
      {
        id: `faq-without-stripe`,
        question: `FeaturePageBilling.withoutStripeQuestion`,
        answer: `FeaturePageBilling.withoutStripeAnswer`,
      },
      {
        id: `faq-trial`,
        question: `FeaturePageBilling.trialQuestion`,
        answer: `FeaturePageBilling.trialAnswer`,
      },
      {
        id: `faq-failed-payment`,
        question: `FeaturePageBilling.failedPaymentQuestion`,
        answer: `FeaturePageBilling.failedPaymentAnswer`,
      },
      {
        id: `faq-cut`,
        question: `FeaturePageBilling.cutQuestion`,
        answer: `FeaturePageBilling.cutAnswer`,
      },
    ],
    demo: `/groups`,
    updated: `2026-11-01`,
  },
  {
    slug: `realtime`,
    name: `FeaturePageRealtime.name`,
    title: `FeaturePageRealtime.title`,
    description: `FeaturePageRealtime.description`,
    h1: `FeaturePageRealtime.h1`,
    answer: `FeaturePageRealtime.answer`,
    summary: `FeaturePageRealtime.summary`,
    how: [`FeaturePageRealtime.how1`, `FeaturePageRealtime.how2`],
    guide: source(`docs/decisions/002-realtime-transport-and-sync.md`),
    code: source(`apps/spa/src/realtime/`),
    questions: [
      {
        id: `faq-realtime`,
        question: `FeaturePageRealtime.realtimeQuestion`,
        answer: `FeaturePageRealtime.realtimeAnswer`,
      },
      {
        id: `faq-realtime-service`,
        question: `FeaturePageRealtime.realtimeServiceQuestion`,
        answer: `FeaturePageRealtime.realtimeServiceAnswer`,
      },
      {
        id: `faq-realtime-sleep`,
        question: `FeaturePageRealtime.realtimeSleepQuestion`,
        answer: `FeaturePageRealtime.realtimeSleepAnswer`,
      },
      {
        id: `faq-realtime-off`,
        question: `FeaturePageRealtime.realtimeOffQuestion`,
        answer: `FeaturePageRealtime.realtimeOffAnswer`,
      },
    ],
    demo: `/notes`,
    updated: `2026-11-02`,
  },
  {
    slug: `offline`,
    name: `FeaturePageOffline.name`,
    title: `FeaturePageOffline.title`,
    description: `FeaturePageOffline.description`,
    h1: `FeaturePageOffline.h1`,
    answer: `FeaturePageOffline.answer`,
    summary: `FeaturePageOffline.summary`,
    how: [`FeaturePageOffline.how1`, `FeaturePageOffline.how2`],
    guide: source(`docs/offline.md`),
    code: source(`apps/spa/src/offline/`),
    questions: [
      {
        id: `faq-offline`,
        question: `FeaturePageOffline.offlineQuestion`,
        answer: `FeaturePageOffline.offlineAnswer`,
      },
      {
        id: `faq-offline-edits`,
        question: `FeaturePageOffline.offlineEditsQuestion`,
        answer: `FeaturePageOffline.offlineEditsAnswer`,
      },
      {
        id: `faq-conflict`,
        question: `FeaturePageOffline.conflictQuestion`,
        answer: `FeaturePageOffline.conflictAnswer`,
      },
      {
        id: `faq-remove-offline`,
        question: `FeaturePageOffline.removeOfflineQuestion`,
        answer: `FeaturePageOffline.removeOfflineAnswer`,
      },
    ],
    demo: `/notes`,
    updated: `2026-11-01`,
  },
  {
    slug: `shortcuts`,
    name: `FeaturePageShortcuts.name`,
    title: `FeaturePageShortcuts.title`,
    description: `FeaturePageShortcuts.description`,
    h1: `FeaturePageShortcuts.h1`,
    answer: `FeaturePageShortcuts.answer`,
    summary: `FeaturePageShortcuts.summary`,
    how: [`FeaturePageShortcuts.how1`, `FeaturePageShortcuts.how2`],
    questions: [
      {
        id: `faq-shortcuts`,
        question: `FeaturePageShortcuts.shortcutsQuestion`,
        answer: `FeaturePageShortcuts.shortcutsAnswer`,
      },
      {
        id: `faq-palette`,
        question: `FeaturePageShortcuts.paletteQuestion`,
        answer: `FeaturePageShortcuts.paletteAnswer`,
      },
      {
        id: `faq-shortcuts-typing`,
        question: `FeaturePageShortcuts.shortcutsTypingQuestion`,
        answer: `FeaturePageShortcuts.shortcutsTypingAnswer`,
      },
    ],
    demo: `/notes`,
    updated: `2026-11-02`,
  },
  {
    slug: `deploy`,
    name: `FeaturePageDeploy.name`,
    title: `FeaturePageDeploy.title`,
    description: `FeaturePageDeploy.description`,
    h1: `FeaturePageDeploy.h1`,
    answer: `FeaturePageDeploy.answer`,
    summary: `FeaturePageDeploy.summary`,
    how: [`FeaturePageDeploy.how1`, `FeaturePageDeploy.how2`],
    guide: source(`docs/deploy.md`),
    questions: [
      {
        id: `faq-kubernetes`,
        question: `FeaturePageDeploy.kubernetesQuestion`,
        answer: `FeaturePageDeploy.kubernetesAnswer`,
      },
      {
        id: `faq-several`,
        question: `FeaturePageDeploy.severalQuestion`,
        answer: `FeaturePageDeploy.severalAnswer`,
      },
      {
        id: `faq-backup`,
        question: `FeaturePageDeploy.backupQuestion`,
        answer: `FeaturePageDeploy.backupAnswer`,
      },
      { id: `faq-runtime`, ...RUNTIME_QUESTION },
    ],
    updated: `2026-11-02`,
  },
]

/** One of {@link FEATURE_PAGES} in the language of `t`: every key replaced by its words. */
export function featurePageIn(t: Translator<string>, page: FeaturePage): FeaturePage {
  return {
    ...page,
    name: t.t(page.name),
    title: t.t(page.title),
    description: t.t(page.description),
    h1: t.t(page.h1),
    answer: t.t(page.answer),
    summary: t.t(page.summary),
    how: page.how.map((key) => t.t(key)),
    questions: page.questions.map(({ id, question, answer }) => ({
      id,
      question: t.t(question),
      answer: t.t(answer),
    })),
  }
}

/** The address of the feature page `slug` in `language`: `/features/<slug>`, `/de/features/<slug>`. */
export function featurePath(slug: string, language: Language = DEFAULT_LANGUAGE): string {
  return localePath(language, `/features/${slug}`)
}

/** The page about the feature with this id in {@link tiers}, or `undefined` when it has none. */
export function pageOfFeature(id: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((page) => (page.feature ?? page.slug) === id)
}

/** The feature page at `/features/<slug>`, or `undefined` for an address that has none. */
export function featurePage(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((page) => page.slug === slug)
}

/** A section of a feature page, in its fixed order. */
export interface FeaturePageSection {
  id: `what` | `how` | `limits` | `questions`
  label: string
}

/**
 * The sections a feature page draws, in order, labelled in the language of `t`: a section with
 * nothing to say is left out, and so is its "On this page" entry, because both read this list.
 */
export function featurePageSections(
  t: Translator<string>,
  page: FeaturePage,
  feature: Feature,
): FeaturePageSection[] {
  const sections: (FeaturePageSection | false)[] = [
    feature.facts.length > 0 && { id: `what`, label: t.t(`FeaturePage.what`) },
    (page.how.length > 0 || Boolean(feature.visual)) &&
    { id: `how`, label: t.t(`FeaturePage.how`) },
    (feature.notYet?.length ?? 0) > 0 && { id: `limits`, label: t.t(`FeaturePage.limits`) },
    page.questions.length > 0 && { id: `questions`, label: t.t(`FeaturePage.questions`) },
  ]
  return sections.filter((section): section is FeaturePageSection => section !== false)
}
