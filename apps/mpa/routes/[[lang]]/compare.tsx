// Seed's own site: see docs/start-a-product.md
import type { JSX } from "preact"
import { IconGitHub } from "@spy4x/preact-icons"
import { Button } from "@spy4x/preact-ui/button"
import { type ComparisonRow, ComparisonTable } from "@spy4x/preact-ui/comparison-table"
import { FaqList } from "@spy4x/preact-ui/faq-list"
import { faqPageJsonLd } from "@spy4x/platform/universal/seo"
import { useFormat } from "@spy4x/preact-ui/format"
import { PageHero } from "@spy4x/preact-ui/page-hero"
import { Band } from "../components/band.tsx"
import { type Alternative, CompareAlternatives } from "../components/compare-alternatives.tsx"
import { CtaBand } from "../components/cta-band.tsx"
import { SectionIntro } from "../components/section-intro.tsx"
import {
  PERSON_JSON_LD,
  REPOSITORY_URL,
  SITE_AUTHOR,
  SITE_NAME,
  siteBreadcrumbsJsonLd,
  SiteFrame,
  type SitePageHead,
  softwareId,
  spaLinks,
  TRY_ENTRY,
  TRY_REL,
} from "../site.tsx"
import { define } from "../utils.ts"

/**
 * The day every row was read off the products' own pages: the hero's "Checked" line, the JSON-LD
 * `dateModified` and the sitemap's `lastmod`. Re-check at least every three months.
 */
export const CHECKED_ON = `2026-10-16`

/** {@link CHECKED_ON} as the hero's "Checked" line shows it, so the page names the day one way. */
function useCheckedOn(): string {
  return useFormat().utc().date(CHECKED_ON)
}

/** The page's title and description, as search results and social previews show them. */
export const COMPARE_HEAD = {
  title: `Seed vs ShipFast, Supastarter, Makerkit and Open SaaS`,
  description: `An honest, dated comparison of SaaS starters and boilerplates: price, licence, ` +
    `hosting, 2FA, groups, per-member billing, admin, offline. Sources linked.`,
} as const

/** The columns of the table, Seed first: the table highlights the first one as ours. */
const PRODUCTS = [
  SITE_NAME,
  `ShipFast`,
  `Supastarter`,
  `Makerkit`,
  `Next.js SaaS Starter`,
  `Open SaaS`,
] as const

/**
 * One row per capability, one value per product in the order of {@link PRODUCTS}. "No" means the
 * product's own pages do not list it; every "Partial" is
 * explained in the row's note. Seed's values match the README and the code on the check date.
 */
const ROWS: readonly ComparisonRow[] = [
  {
    capability: `Free to use`,
    note: `Makerkit: the Lite kit only`,
    values: [`yes`, `no`, `no`, `partial`, `yes`, `yes`],
  },
  {
    capability: `Open source (MIT)`,
    note: `Makerkit: the Lite kit only`,
    values: [`yes`, `no`, `no`, `partial`, `yes`, `yes`],
  },
  {
    capability: `Password sign-in`,
    values: [`yes`, `no`, `yes`, `yes`, `yes`, `yes`],
  },
  {
    capability: `Magic links`,
    values: [`yes`, `yes`, `yes`, `yes`, `no`, `no`],
  },
  {
    capability: `Social sign-in`,
    note: `Seed: Google, GitHub`,
    values: [`yes`, `yes`, `yes`, `yes`, `no`, `yes`],
  },
  {
    capability: `App-based 2FA`,
    values: [`yes`, `no`, `yes`, `yes`, `no`, `no`],
  },
  {
    capability: `Passkeys`,
    values: [`yes`, `no`, `yes`, `yes`, `no`, `no`],
  },
  {
    capability: `Groups with roles`,
    note: `Next.js SaaS Starter: Owner and Member only`,
    values: [`yes`, `no`, `yes`, `yes`, `partial`, `no`],
  },
  {
    capability: `Per-member billing`,
    values: [`yes`, `no`, `yes`, `yes`, `no`, `no`],
  },
  {
    capability: `Non-Stripe payments`,
    values: [`no`, `yes`, `yes`, `yes`, `no`, `yes`],
  },
  {
    capability: `Admin area`,
    note: `Next.js SaaS Starter: a dashboard for each group`,
    values: [`yes`, `no`, `yes`, `yes`, `partial`, `yes`],
  },
  {
    capability: `Translations (i18n)`,
    values: [`no`, `no`, `yes`, `yes`, `no`, `no`],
  },
  {
    capability: `Background jobs`,
    values: [`yes`, `no`, `yes`, `no`, `no`, `yes`],
  },
  {
    capability: `File uploads`,
    note: `Seed: images and PDFs on notes, profile pictures. Makerkit: Supabase kit only`,
    values: [`yes`, `no`, `yes`, `partial`, `no`, `yes`],
  },
  {
    capability: `Blog`,
    values: [`yes`, `yes`, `yes`, `yes`, `no`, `yes`],
  },
  {
    capability: `Audit log`,
    values: [`yes`, `no`, `no`, `no`, `yes`, `no`],
  },
  {
    capability: `Realtime updates`,
    values: [`yes`, `no`, `no`, `no`, `no`, `no`],
  },
  {
    capability: `Offline app`,
    note: `Queues writes made offline`,
    values: [`yes`, `no`, `no`, `no`, `no`, `no`],
  },
  {
    capability: `Monitoring and backups`,
    note: `Supastarter, Makerkit: Sentry, no backups listed`,
    values: [`yes`, `no`, `partial`, `partial`, `no`, `no`],
  },
]

/** The facts that are not a yes or a no, and when each alternative is the better pick. */
const ALTERNATIVES: readonly Alternative[] = [
  {
    id: `shipfast`,
    name: `ShipFast`,
    price: `$199 or $249 one-time; $299 with CodeFast`,
    licence: `Paid; you may not redistribute the boilerplate`,
    stack: `Next.js; MongoDB or Supabase`,
    hosting: `Vercel named as the free option`,
    pickWhen: `you want a Next.js landing page with payments and a blog live this weekend, ` +
      `and you sell to single users rather than groups.`,
    sources: [
      { label: `Sales page`, href: `https://shipfa.st/` },
      { label: `Licence`, href: `https://shipfa.st/license` },
      { label: `Docs`, href: `https://shipfa.st/docs` },
    ],
  },
  {
    id: `supastarter`,
    name: `Supastarter`,
    price: `$349, $799 or $1,499 one-time`,
    licence: `Paid; no redistribution without the author's permission`,
    stack: `Next.js, Nuxt or TanStack Start; Prisma or Drizzle`,
    hosting: `Vercel and serverless, or Docker`,
    pickWhen: `you need translations or a payment provider other than Stripe ` +
      `now, and want paid support.`,
    sources: [
      { label: `Sales page`, href: `https://supastarter.dev/` },
      { label: `Licence`, href: `https://supastarter.dev/legal/license` },
    ],
  },
  {
    id: `makerkit`,
    name: `Makerkit`,
    price: `$299 or $599 one-time today (list price $349 and $649); free Lite kit`,
    licence: `Paid kits; each client of a freelancer needs a licence. Lite is MIT`,
    stack: `Next.js, React Router or TanStack Start; Supabase, Drizzle or Prisma`,
    hosting: `Not stated on the pages read`,
    pickWhen: `you want a multi-tenant kit on Supabase or Next.js with translations and a CMS, ` +
      `and you are happy with a paid licence.`,
    sources: [
      { label: `Pricing`, href: `https://makerkit.dev/pricing` },
      {
        label: `Docs`,
        href: `https://makerkit.dev/docs/next-supabase-turbo/introduction`,
      },
    ],
  },
  {
    id: `nextjs-saas-starter`,
    name: `Next.js SaaS Starter`,
    price: `Free`,
    licence: `MIT`,
    stack: `Next.js, Postgres, Drizzle`,
    hosting: `Vercel, in its production guide`,
    pickWhen: `you want a small, readable Next.js base with Stripe and groups, and plan to build ` +
      `the rest yourself.`,
    sources: [{ label: `README`, href: `https://github.com/nextjs/saas-starter` }],
  },
  {
    id: `open-saas`,
    name: `Open SaaS`,
    price: `Free`,
    licence: `MIT`,
    stack: `Wasp: React, Node.js, Prisma`,
    hosting: `Fly.io or Railway in one command, or by hand to any host`,
    pickWhen: `you like the Wasp framework and want file uploads, a docs site and several ` +
      `payment providers for single-user products.`,
    sources: [
      { label: `README`, href: `https://github.com/wasp-lang/open-saas` },
      { label: `Deploy guide`, href: `https://docs.opensaas.sh/guides/deploying/` },
    ],
  },
  {
    id: `build-it-yourself`,
    name: `Build it yourself`,
    price: `Free code, weeks of your time`,
    licence: `Yours`,
    stack: `Your choice`,
    hosting: `Your choice`,
    pickWhen: `your product needs an unusual sign-in, tenancy or billing model that no starter ` +
      `fits, or building the groundwork is the point.`,
    sources: [],
  },
]

/** The questions, with each answer as plain text for the FAQ's structured data. */
const FAQ = [
  {
    id: `faq-neutral`,
    question: `Is this comparison paid for or sponsored?`,
    answerText: `No. I build Seed, so I am not neutral, and no product in the table paid for or ` +
      `reviewed its row. That is why every row links to the page it came from.`,
  },
  {
    id: `faq-wrong-row`,
    question: `A row is wrong or out of date. What do I do?`,
    answerText: `Open an issue on GitHub with the page that shows it, and I will fix the row ` +
      `and the check date.`,
  },
  {
    id: `faq-paid-kits`,
    question: `Did you run the paid kits?`,
    answerText: `No. I did not buy them, so their rows say what their own pages publish, not ` +
      `what I ran. A feature they have but do not list shows as "No".`,
  },
] as const

/** The page's structured data: the page and its date, the trail to it, its author and the FAQ. */
function compareJsonLd(origin: string): unknown[] {
  const url = `${origin}/compare`
  return [
    {
      "@type": `WebPage`,
      "@id": `${url}#webpage`,
      url,
      name: COMPARE_HEAD.title,
      description: COMPARE_HEAD.description,
      dateModified: CHECKED_ON,
      author: { "@id": PERSON_JSON_LD["@id"] },
      about: { "@id": softwareId(origin) },
    },
    siteBreadcrumbsJsonLd(origin, `/compare`, `Compare`),
    PERSON_JSON_LD,
    faqPageJsonLd(FAQ),
  ]
}

function Hero({ demoHref }: { demoHref: string }): JSX.Element {
  return (
    <PageHero
      class="site-glow"
      eyebrow="Compare"
      title="How Seed compares to other SaaS starters"
      lead="Seed is a free, MIT-licensed SaaS starter for products used by groups of people, and it runs on one server you rent. Here it is side by side with five other SaaS starters and boilerplates."
      author={SITE_AUTHOR}
      updated={CHECKED_ON}
      labels={{ updated: `Checked` }}
      note={
        <>
          I build Seed, so I am not neutral. Every claim about another product links to its source,
          and the table shows where Seed is weaker. A row out of date?{" "}
          <a href={`${REPOSITORY_URL}/issues`} class="text-primary underline">Open an issue</a>.
        </>
      }
    >
      <div class="mt-2 flex w-full flex-col gap-4 sm:w-auto sm:flex-row">
        <Button
          href={demoHref}
          rel={TRY_REL}
          size="lg"
          data-e2e="compare-try-demo"
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

function Table(): JSX.Element {
  const checkedOn = useCheckedOn()
  return (
    <Band id="table" labelledBy="table-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="table-title"
          eyebrow="Side by side"
          title="What each starter includes"
          lead="Rows are capabilities, as each product's own pages describe them. Seed's column is highlighted; its gaps are listed like everyone else's."
        />
        <ComparisonTable
          caption={`Capabilities of Seed and five other SaaS starters, checked on ${checkedOn}`}
          products={PRODUCTS}
          rows={ROWS}
          checkedOn={new Date(`${CHECKED_ON}T00:00:00Z`)}
          locale="en-GB"
          labels={{
            // The table formats its own date in long form; the page's one form replaces it.
            checkedOn: () => `Checked on ${checkedOn}.`,
            yesMeaning: `the product's own pages say it is included`,
            partialMeaning: `included with the limit named under the row`,
            noMeaning: `its own pages do not list it; it may exist undocumented or arrive later`,
          }}
          method={
            <>
              I read each product's sales page, pricing page, licence and public docs or README.
              Seed's column follows its README and code. I did not buy the paid kits, so their rows
              say what they publish, not what I ran. Every page read is linked under "When another
              starter fits better".
            </>
          }
          fit={
            <>
              Seed is not for you if you want to deploy to Vercel or serverless functions, if you
              work in Next.js and React and want to stay there, or if you need translations or a
              payment provider other than Stripe this month. It is also a young project with one
              maintainer and no community forum yet, while the Next.js SaaS Starter and Open SaaS
              each have more than 16,000 GitHub stars. Seed is for you if you build a product for
              groups of people, want sign-in, roles, per-member billing and operations settled
              before your first feature, and want to control the server and own the code outright.
            </>
          }
        />
        <ul class="flex max-w-3xl list-disc flex-col gap-2 pl-6 text-sm text-muted">
          <li>
            Seed's gap (translations) is not built yet; do not choose Seed for it today. The{" "}
            <a href="/#status" class="text-primary underline">status list</a> says what works.
          </li>
          <li>
            ShipFast's prices are the ones its{" "}
            <a href="https://shipfa.st/" class="text-primary underline">sales page</a> showed on
            {" "}
            {checkedOn}.
          </li>
          <li>
            For Seed's features in detail, see{" "}
            <a href="/features" class="text-primary underline">the features page</a>; for what
            running it costs, see <a href="/pricing" class="text-primary underline">pricing</a>.
          </li>
        </ul>
      </div>
    </Band>
  )
}

function Alternatives(): JSX.Element {
  const checkedOn = useCheckedOn()
  return (
    <Band tone="alt" id="alternatives" labelledBy="alternatives-title">
      <div class="flex flex-col gap-12">
        <SectionIntro
          id="alternatives-title"
          eyebrow="Fit"
          title="When another starter fits better"
          lead="If one of these fits you better, use it. Each card names its price, licence, stack and hosting, and links the pages they come from."
        />
        <CompareAlternatives items={ALTERNATIVES} checkedOn={checkedOn} />
      </div>
    </Band>
  )
}

function Questions(): JSX.Element {
  return (
    <Band id="faq" labelledBy="faq-title" width="3xl">
      <div class="flex flex-col gap-8">
        <SectionIntro id="faq-title" eyebrow="Questions" title="About this comparison" />
        <FaqList
          items={FAQ.map((item) => ({
            id: item.id,
            question: item.question,
            answer: item.id === `faq-wrong-row`
              ? (
                <p>
                  <a href={`${REPOSITORY_URL}/issues`} class="text-primary underline">
                    Open an issue on GitHub
                  </a>{" "}
                  with the page that shows it, and I will fix the row and the check date.
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
 * The comparison with other SaaS starters: the check date and why to trust it first, then the
 * table with its method and fit, when another starter is the better pick, the questions and the
 * way into the demo. Server-rendered; it needs no JavaScript.
 */
export default define.page(function Compare({ state }) {
  const spa = spaLinks(state.spaOrigin)
  const head: SitePageHead = {
    ...COMPARE_HEAD,
    og: `compare`,
    jsonLd: compareJsonLd(state.webAppOrigin),
  }
  return (
    <SiteFrame state={state} path="/compare" head={head}>
      <Hero demoHref={spa.try} />
      <Table />
      <Alternatives />
      <Questions />
      <CtaBand
        demoHref={spa.try}
        title="See what Seed does in a minute"
        lead="The demo is the app you get on day one. Check the table against it yourself."
      />
    </SiteFrame>
  )
})
