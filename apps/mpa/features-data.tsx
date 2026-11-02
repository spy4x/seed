// Seed's own site: see docs/start-a-product.md
/**
 * Every feature the website describes, in one place: `/features` draws all of them, and each
 * feature page (`/features/<slug>`) draws one, with the facts and "Not built yet" items from the
 * same object. The feature pages' own words are English only: `/de/features/<slug>` and the other
 * languages' addresses redirect to the English page. A product built on Seed rewrites this file
 * to describe its own features.
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
import { languageList } from "./languages.ts"
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
          eyebrow: t.t(`FeatureSignIn.eyebrow`),
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
          eyebrow: t.t(`FeatureTeams.eyebrow`),
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
          eyebrow: t.t(`FeatureOverview.eyebrow`),
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
          eyebrow: t.t(`FeatureBilling.eyebrow`),
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
          eyebrow: t.t(`FeaturePrivacy.eyebrow`),
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
          eyebrow: t.t(`FeatureExport.eyebrow`),
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
          eyebrow: t.t(`FeatureLanguages.eyebrow`),
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
          eyebrow: t.t(`FeatureRealtime.eyebrow`),
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
          eyebrow: t.t(`FeatureOffline.eyebrow`),
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
          eyebrow: t.t(`FeatureShortcuts.eyebrow`),
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
          eyebrow: t.t(`FeaturePush.eyebrow`),
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
          eyebrow: t.t(`FeatureWorker.eyebrow`),
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
          eyebrow: t.t(`FeatureYourFeature.eyebrow`),
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
          eyebrow: t.t(`FeatureAdmin.eyebrow`),
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
          eyebrow: t.t(`FeatureDeploy.eyebrow`),
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
          eyebrow: t.t(`FeatureWebsite.eyebrow`),
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
          eyebrow: t.t(`FeatureQuality.eyebrow`),
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
 * The words of one feature page, in English. Its facts, "Not built yet" items, picture and code
 * link come from the feature of the same id in {@link tiers}, so `/features` and the page never
 * disagree.
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
  question: `Does Seed run on Node or Bun?`,
  answer: `Not yet. Seed runs on Deno today, and the move to run on Deno, Node and Bun is in ` +
    `progress (#623). See the runtime plan on the features page.`,
}

/**
 * The feature pages, in the order "Other features" lists them. Every claim was checked against the
 * code and docs on `main` on 2026-11-01, the realtime and shortcuts pages on 2026-11-02.
 */
export const FEATURE_PAGES: readonly FeaturePage[] = [
  {
    slug: `sign-in`,
    name: `Sign-in`,
    title: `Sign-in for your SaaS, without an auth service`,
    description:
      `Passkeys, sign-in links by email, Google, GitHub and two-factor, checked by your ` +
      `own API with no auth service or fee per user. Free and MIT-licensed.`,
    h1: `Passkeys and sign-in for your SaaS, without an auth service`,
    answer: `Seed signs people in with passkeys, sign-in links by email, Google and GitHub, ` +
      `checked by its own API on your server, with no third-party auth service. Passwords, ` +
      `passkeys and sign-in links work as soon as you deploy, with no fee per user; Google and ` +
      `GitHub each need two keys in the env file.`,
    summary:
      `Passkeys, sign-in links by email, Google, GitHub and two-factor, with no auth service.`,
    how: [
      `The API checks every sign-in itself and answers with a signed session cookie. A passkey ` +
      `uses the browser's own WebAuthn: the server keeps only its public key, and each sign-in ` +
      `challenge works once. A sign-in link signs in or signs up, works once, for 15 minutes, ` +
      `and is stored only as a hash.`,
      `An authenticator app adds two-factor sign-in. The profile lists every way into the ` +
      `account and every signed-in device, and changing a way in asks ` +
      `for proof and sends an email. A visitor can also start in a guest account and add a way ` +
      `to sign in later.`,
    ],
    guide: source(`docs/sign-in-providers.md`),
    questions: [
      {
        id: `faq-auth-service`,
        question: `Do I need an auth service?`,
        answer: `No. Seed's own API checks passwords, passkeys, sign-in links and the answers ` +
          `from Google and GitHub, on your server, so nothing is billed per user.`,
      },
      {
        id: `faq-passkeys`,
        question: `Does Seed support passkeys?`,
        answer: `Yes. People add a passkey on their profile and sign in with it; the server ` +
          `stores only its public key, and each sign-in challenge works once.`,
      },
      {
        id: `faq-two-factor`,
        question: `Does Seed have two-factor authentication?`,
        answer: `Yes. An authenticator app adds a one-time code at sign-in, also after a sign-in ` +
          `with Google or GitHub.`,
      },
      {
        id: `faq-providers-off`,
        question: `Can I leave Google or GitHub sign-in out?`,
        answer: `Yes. Each one is off until both of its variables are set in the env file, so ` +
          `leaving them out turns it off.`,
      },
      { id: `faq-runtime`, ...RUNTIME_QUESTION },
    ],
    demo: `/profile/security`,
    updated: `2026-11-02`,
  },
  {
    slug: `groups`,
    feature: `teams`,
    name: `Groups and roles`,
    title: `Groups and roles for your SaaS, without the plumbing`,
    description: `Groups with roles from viewer to owner, invitations, ownership transfer and an ` +
      `activity log, with one tenancy check for all data. Free and MIT-licensed.`,
    h1: `Groups and roles for your SaaS, without building multi-tenancy`,
    answer: `Seed gives every account a personal group at sign-up, and ` +
      `people make shared groups, invite others and give them roles from viewer to owner. The ` +
      `group is the one tenancy boundary, so a feature you add passes the same check as soon as ` +
      `it copies the notes aggregate.`,
    summary: `Groups with roles from viewer to owner, invitations and an activity log.`,
    how: [
      `Every row of shared data belongs to a group, and the API checks the person's role in that ` +
      `group before it reads or writes. A viewer reads, an editor also changes the group's data, ` +
      `and an admin and the owner also manage members and read the activity log.`,
      `The owner hands ownership over in one step, and a deleted group can be restored within ` +
      `30 days. Only an account whose email address is confirmed can invite.`,
    ],
    guide: source(`docs/aggregates.md`),
    questions: [
      {
        id: `faq-personal-group`,
        question: `Does every account get a group?`,
        answer: `Yes. Each account gets a personal group at sign-up; a personal group and a ` +
          `shared one pass the same check.`,
      },
      {
        id: `faq-viewer`,
        question: `Can a viewer change a group's data?`,
        answer:
          `No. A viewer reads the group's data; an editor, an admin or the owner can change ` +
          `it.`,
      },
      {
        id: `faq-restore`,
        question: `Can a deleted group come back?`,
        answer: `Yes. Its owner can restore it within 30 days; after that the worker removes it ` +
          `for good.`,
      },
      {
        id: `faq-second-model`,
        question: `Do I need a second permission system for my own features?`,
        answer: `No. A new aggregate copies the notes aggregate and its group check, so there is ` +
          `one permission model to keep.`,
      },
    ],
    demo: `/groups`,
    updated: `2026-11-01`,
  },
  {
    slug: `billing`,
    name: `Billing`,
    title: `Stripe billing for your SaaS, without webhook work`,
    description: `Per-member Stripe billing with a free plan, a 14-day trial, a grace period and ` +
      `server-side limits, kept in sync by webhooks. Free and MIT-licensed.`,
    h1: `Per-member Stripe billing for your SaaS, without writing it yourself`,
    answer: `Seed bills each group per member through Stripe Checkout and the customer portal, ` +
      `with a free plan, a 14-day trial and a grace period after a failed payment. You add three ` +
      `Stripe keys to the env file and set the billing provider to Stripe.`,
    summary: `Per-member Stripe billing with a free plan, a trial and a grace period.`,
    how: [
      `Stripe owns the money and the subscription. The app keeps only what Stripe's webhooks ` +
      `report and never decides a plan on its own; the quantity follows the member count, and ` +
      `plan limits are checked on the server.`,
      `Every member reads the plan on the group's Billing tab, and only the owner gets the ` +
      `checkout and portal buttons. A failed payment keeps the plan for 7 days by default, then ` +
      `the group goes back to Free.`,
    ],
    guide: source(`docs/billing.md`),
    code: source(`apps/api/features/billing/`),
    questions: [
      {
        id: `faq-without-stripe`,
        question: `Does billing work without Stripe?`,
        answer: `No. Stripe is the only provider today; without it billing stays off, and every ` +
          `group is on Free with no limits.`,
      },
      {
        id: `faq-trial`,
        question: `Is there a free trial?`,
        answer: `Yes. The paid plan starts with a 14-day trial.`,
      },
      {
        id: `faq-failed-payment`,
        question: `Does a group keep its plan when a card fails?`,
        answer:
          `Yes. It keeps the plan for a grace period, 7 days by default, and the owner sees ` +
          `a notice with the date; then the group goes back to Free.`,
      },
      {
        id: `faq-cut`,
        question: `Does Seed take a cut of payments?`,
        answer: `No. Seed is MIT-licensed; you pay only Stripe's own fees.`,
      },
    ],
    demo: `/groups`,
    updated: `2026-11-01`,
  },
  {
    slug: `realtime`,
    name: `Realtime sync`,
    title: `Realtime sync for your SaaS, without a hosted service`,
    description: `A change saved in one tab shows in every other open tab of the group within a ` +
      `second, over a WebSocket from your own API. Free and MIT-licensed.`,
    h1: `Realtime updates for your SaaS, without a hosted realtime service`,
    answer: `Seed sends each saved change to every open tab of the group over a WebSocket from ` +
      `its own API, so a note saved in one window shows in the others within a second, with no ` +
      `reload. It runs on your server with no realtime service to pay for; a feature you add ` +
      `gets it by copying the notes example.`,
    summary: `A change saved in one tab shows in every other open tab, with no reload.`,
    how: [
      `Each write is committed with the group's next sequence number, and the API pushes it to ` +
      `every member's open socket. A tab applies a change only when its number follows the last ` +
      `one it has; on a gap it asks the server for everything after its cursor, so a dropped ` +
      `message costs one extra request and never a wrong list.`,
      `A laptop that wakes from sleep reconnects and pulls what it missed. With the socket ` +
      `switched off, the app reads and writes over HTTP and checks for changes every 30 seconds.`,
    ],
    guide: source(`docs/decisions/002-realtime-transport-and-sync.md`),
    code: source(`apps/spa/src/realtime/`),
    questions: [
      {
        id: `faq-realtime`,
        question: `Does Seed update in realtime?`,
        answer: `Yes. A saved change shows in every open tab of the group within a second, with ` +
          `no reload.`,
      },
      {
        id: `faq-realtime-service`,
        question: `Do I need Pusher, Ably or another realtime service?`,
        answer: `No. The WebSocket is served by Seed's own API on your server.`,
      },
      {
        id: `faq-realtime-sleep`,
        question: `Does a tab catch up after the laptop sleeps?`,
        answer: `Yes. It reconnects and pulls every change after the last one it had.`,
      },
      {
        id: `faq-realtime-off`,
        question: `Can I turn realtime off?`,
        answer: `Yes. Set SPA_REALTIME=false: the app then checks for changes every 30 seconds ` +
          `and works the same.`,
      },
    ],
    demo: `/notes`,
    updated: `2026-11-02`,
  },
  {
    slug: `offline`,
    name: `Offline app`,
    title: `Offline app for your SaaS, without building sync`,
    description: `An installable app that opens with no network, keeps every list on the device ` +
      `and queues edits until the connection returns. Free and MIT-licensed.`,
    h1: `An offline-first app for your SaaS, without a sync engine to build`,
    answer: `Seed's app installs like a native one, opens with no network, shows every list it ` +
      `last saw and lets people add, edit and delete notes and tags offline. Your own feature ` +
      `picks one of three levels, online only, readable offline or writable offline, and follows ` +
      `the written recipe for it.`,
    summary: `An installable app that opens with no network and syncs when it returns.`,
    how: [
      `The device keeps an IndexedDB copy of each list, and writes wait in a queue with ` +
      `idempotency keys, so a change sent twice is applied once. A change the server cannot take ` +
      `shows as a conflict with "Keep mine" or "Use the server's"; nothing is overwritten on its ` +
      `own.`,
      `A service worker keeps the app's page, scripts and styles, so it opens with no network. ` +
      `Sign-in, deleted items and two-factor set-up need the network.`,
    ],
    guide: source(`docs/offline.md`),
    code: source(`apps/spa/src/offline/`),
    questions: [
      {
        id: `faq-offline`,
        question: `Does Seed work offline?`,
        answer: `Yes. The app opens with no network and shows every list it last saw.`,
      },
      {
        id: `faq-offline-edits`,
        question: `Can people edit while offline?`,
        answer:
          `Yes. Notes and tags work offline; other changes need the network, and the screen says so.`,
      },
      {
        id: `faq-conflict`,
        question: `Does Seed catch two people changing the same note?`,
        answer: `Yes. The later change shows as a conflict, and its author picks "Keep mine" or ` +
          `"Use the server's".`,
      },
      {
        id: `faq-remove-offline`,
        question: `Can I remove offline support?`,
        answer: `Yes. Turn it off with one switch, or delete one folder and follow the written ` +
          `checklist; a test fails when a step is missed.`,
      },
    ],
    demo: `/notes`,
    updated: `2026-11-01`,
  },
  {
    slug: `shortcuts`,
    name: `Keyboard shortcuts`,
    title: `Keyboard shortcuts for your SaaS, without a library`,
    description:
      `Ctrl+K search that forgives typos, Cyrillic and the wrong keyboard layout, and a ` +
      `key for each section of the app. Free and MIT-licensed.`,
    h1: `A command palette and keyboard shortcuts for your SaaS, built in`,
    answer: `Seed's app and admin area open a search with Ctrl+K (⌘K on a Mac) that finds pages ` +
      `and actions even with a typo, in Cyrillic or in the wrong keyboard layout. Press ? for ` +
      `every shortcut; a feature you add lists its own keys in the same list and gets them in ` +
      `that dialog.`,
    summary: `Ctrl+K search that forgives typos and the wrong layout, and a key for each section.`,
    how: [
      `One list per app binds the keys and fills the ? dialog, so the dialog never shows a key ` +
      `that does nothing. G then a letter opens a section, N adds a note from any page, and the ` +
      `single-key shortcuts stay quiet while you type in a field.`,
      `The search matches every word in any order, by prefix, with one typo in a longer word, and ` +
      `reads a query typed in the other keyboard layout or the other alphabet, so "зкщашду" finds ` +
      `"Open profile".`,
    ],
    questions: [
      {
        id: `faq-shortcuts`,
        question: `Does Seed have keyboard shortcuts?`,
        answer: `Yes. Press ? in the app or the admin area to see them all.`,
      },
      {
        id: `faq-palette`,
        question: `Is there a command palette?`,
        answer: `Yes. Ctrl+K (⌘K on a Mac) or / opens search over pages and actions.`,
      },
      {
        id: `faq-shortcuts-typing`,
        question: `Do shortcuts fire while I type?`,
        answer: `No. Single-key shortcuts stay quiet in a field, and each device can turn them ` +
          `off; Ctrl+K and Escape keep working.`,
      },
    ],
    demo: `/notes`,
    updated: `2026-11-02`,
  },
  {
    slug: `deploy`,
    name: `Deploy`,
    title: `Deploy your SaaS, without a cloud platform bill`,
    description:
      `Docker Compose on one Linux server you rent: Traefik, Postgres, Valkey, S3 files, ` +
      `monitoring and backups, deployed in one command. Free and MIT-licensed.`,
    h1: `Self-host your SaaS on one server, without a cloud platform bill`,
    answer: `Seed runs on a Linux server you rent, with Docker Compose in development and ` +
      `production alike, and one command ships it. You prepare the server once with the written ` +
      `steps, then every later deploy is that command alone.`,
    summary: `One Linux server, Docker Compose and one command to deploy.`,
    how: [
      `The deploy copies the project to the server over SSH and starts it with Compose; on every ` +
      `deploy a one-shot service applies the database migrations. Traefik sits in front and asks ` +
      `Let's Encrypt for each host's certificate.`,
      `Postgres, Valkey, an S3 file store, metrics, logs and dashboards with alerts run beside ` +
      `the apps, and several products can share one server behind the same proxy.`,
    ],
    guide: source(`docs/deploy.md`),
    questions: [
      {
        id: `faq-kubernetes`,
        question: `Do I need Kubernetes?`,
        answer: `No. Docker Compose on one server runs the whole product, in development and in ` +
          `production.`,
      },
      {
        id: `faq-several`,
        question: `Can several products share one server?`,
        answer: `Yes. They share one proxy, and each keeps its own directory, database and ` +
          `data; share a server only between products you trust alike.`,
      },
      {
        id: `faq-backup`,
        question: `Is there a backup?`,
        answer: `Yes. An opt-in daily encrypted restic backup of the database, with a written ` +
          `restore.`,
      },
      { id: `faq-runtime`, ...RUNTIME_QUESTION },
    ],
    updated: `2026-11-02`,
  },
]

/** The English address of the feature page `slug`: `/features/<slug>`, at every language's address. */
export function featurePath(slug: string): string {
  return `/features/${slug}`
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
 * The sections a feature page draws, in order: a section with nothing to say is left out, and so
 * is its "On this page" entry, because both read this list.
 */
export function featurePageSections(
  page: FeaturePage,
  feature: Feature,
): FeaturePageSection[] {
  const sections: (FeaturePageSection | false)[] = [
    feature.facts.length > 0 && { id: `what`, label: `What you get` },
    (page.how.length > 0 || Boolean(feature.visual)) && { id: `how`, label: `How it works` },
    (feature.notYet?.length ?? 0) > 0 && { id: `limits`, label: `Limits` },
    page.questions.length > 0 && { id: `questions`, label: `Questions` },
  ]
  return sections.filter((section): section is FeaturePageSection => section !== false)
}
