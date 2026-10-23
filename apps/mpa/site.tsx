import type { ComponentChildren, JSX } from "preact"
import { Head } from "fresh/runtime"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { IconGitHub, IconSprout } from "@spy4x/preact-icons"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { FormatContext } from "@spy4x/preact-ui/format"
import { Input } from "@spy4x/preact-ui/input"
import { Notice } from "@spy4x/preact-ui/notice"
import { SEOHead } from "@spy4x/preact-system/seo-head"
import { SiteFooter, type SiteFooterGroup } from "@spy4x/preact-system/site-footer"
import { SiteHeader } from "@spy4x/preact-system/site-header"
import { breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
import { createFormatters } from "@spy4x/time/format"
import { FORM_ACTIONS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { BLOG_NAME, BLOG_PATH, RSS_PATH } from "./blog.ts"
import { AUTHOR_URL, REPOSITORY_URL, SITE_NAME, TRY_ENTRY } from "./brand.ts"
import { API_DOCS_PATH } from "./api-docs.ts"
import { OnThisPage } from "./components/on-this-page.tsx"
import { HIRE_PAGE_URL } from "./hire.ts"
import type { State } from "./utils.ts"

export { AUTHOR_URL, REPOSITORY_URL, SITE_NAME, TRY_ENTRY }

/** The pages that have an Open Graph image of their own, at `/og/<key>.png`. */
export type OgImageKey =
  | `home`
  | `features`
  | `admin`
  | `compare`
  | `pricing`
  | `subscribe`

/**
 * What each Open Graph image says: its big headline and the small line under it. The image's alt
 * text is made from both, so the card and its description cannot drift apart.
 */
export const OG_IMAGES: Record<OgImageKey, { headline: string; line: string }> = {
  home: {
    headline: `The groundwork of your SaaS, already built.`,
    line: `Seed · open source · MIT · one server you rent`,
  },
  features: {
    headline: `Auth, groups, billing, offline, admin.`,
    line: `Everything Seed ships, and what it does not yet`,
  },
  admin: {
    headline: `An admin panel for your SaaS.`,
    line: `Users · billing · audit log · roles`,
  },
  // Seed's own site: see docs/start-a-product.md
  compare: {
    headline: `Seed vs ShipFast, Supastarter, Makerkit, Open SaaS`,
    line: `Honest, sourced, checked 16 Oct 2026`,
  },
  pricing: { headline: `Seed is free.`, line: `MIT licence · you pay for one server` },
  subscribe: {
    headline: `What shipped in Seed, briefly.`,
    line: `A short email when it changes`,
  },
}

/** The alt text of a page's Open Graph image: the card's two lines, as a reader hears them. */
export function ogImageAlt(key: OgImageKey): string {
  const { headline, line } = OG_IMAGES[key]
  return `Seed card: ${headline} ${line}.`
}

/** The size of every Open Graph image, in pixels. */
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const

/**
 * The SPA's sign-in and sign-up pages, and `/try`, which starts a guest account (#224): the
 * website has no session, the product signs people in. A link to `try` carries `rel="nofollow"`
 * ({@link TRY_REL}), and the app's `robots.txt` keeps crawlers off it.
 */
export function spaLinks(spaOrigin: string): { signIn: string; signUp: string; try: string } {
  return {
    signIn: `${spaOrigin}${SCREEN_PATHS.signIn}`,
    signUp: `${spaOrigin}${SCREEN_PATHS.signUp}`,
    try: `${spaOrigin}/try`,
  }
}

/** The `rel` of every link to the app's `/try`: opening it makes an account, so no crawler should. */
export const TRY_REL = `nofollow`

// Seed's own site: see docs/start-a-product.md
/**
 * The author as a JSON-LD entity, with the id other entities point at. `sameAs` and the company
 * match the Person antonshubin.com publishes, so engines join the two into one person.
 */
export const PERSON_JSON_LD = {
  "@type": `Person`,
  "@id": `${AUTHOR_URL}/#person`,
  name: `Anton Shubin`,
  url: AUTHOR_URL,
  jobTitle: `Senior full-stack engineer`,
  sameAs: [
    `https://www.upwork.com/freelancers/ashubin`,
    `https://github.com/spy4x`,
    `https://www.linkedin.com/in/anton-shubin`,
    `https://www.youtube.com/@anton-shubin`,
    `https://www.youtube.com/@anton-shubin-live`,
    `https://x.com/spy4x`,
  ],
  worksFor: {
    "@type": `Organization`,
    "@id": `https://neatsoft.dev/#org`,
    name: `NeatSoft PTE LTD`,
    url: `https://neatsoft.dev`,
  },
} as const

/** The author a dated page names in its hero, linked to their own site. */
export const SITE_AUTHOR = { name: PERSON_JSON_LD.name, href: AUTHOR_URL } as const

/**
 * How the website writes a date, `16 Oct 2026`: British English like its prose, in UTC, so the
 * server's own locale and zone never change what a page says.
 */
const SITE_FORMAT = createFormatters({ locale: `en-GB`, timeZone: `UTC` })

/** What Seed is, in the words of the home page's lead, for the product's structured data. */
const SOFTWARE_DESCRIPTION = `Seed is a free, MIT-licensed SaaS starter with sign-in and ` +
  `two-factor authentication (2FA), groups with roles, per-member Stripe billing, realtime, an ` +
  `offline app and an admin area.`

/** The id of Seed's one product entity, which every page's structured data points at. */
export function softwareId(origin: string): string {
  return `${origin}/#software`
}

/**
 * Seed as one JSON-LD entity: free software and its source code under one id. Every page that
 * describes the product draws this node, so all copies agree; `extra` adds what only that page
 * shows, such as the feature list.
 */
export function softwareJsonLd(origin: string, extra: Record<string, unknown> = {}): unknown {
  return {
    "@type": [`SoftwareApplication`, `SoftwareSourceCode`],
    "@id": softwareId(origin),
    name: SITE_NAME,
    url: `${origin}/`,
    description: SOFTWARE_DESCRIPTION,
    applicationCategory: `DeveloperApplication`,
    operatingSystem: `Linux (Docker)`,
    license: `https://opensource.org/licenses/MIT`,
    codeRepository: REPOSITORY_URL,
    programmingLanguage: `TypeScript`,
    runtimePlatform: `Deno`,
    author: { "@id": PERSON_JSON_LD["@id"] },
    // Only Seed itself is offered. The demo's plans are an example and are not sold.
    offers: { "@type": `Offer`, price: 0, priceCurrency: `USD` },
    ...extra,
  }
}

/** A page's breadcrumb trail, always rooted at the home page's full address. */
export function siteBreadcrumbsJsonLd(origin: string, path: string, name: string): unknown {
  return breadcrumbListJsonLd(`${origin}${path}`, [
    { name: SITE_NAME, href: `${origin}/` },
    { name },
  ])
}

/** The title and description of one page, for its `<head>` and its social previews. */
export interface SitePageHead {
  title: string
  description: string
  /** Keeps the page out of search results, as for a page reached only through a mailed link. */
  noindex?: boolean
  /** Which Open Graph image the page shares with. Defaults to the home page's. */
  og?: OgImageKey
  /**
   * An image of the page's own, such as a blog post's cover, shared instead of {@link og}. Its size
   * is not known, so none is stated.
   */
  image?: { url: string; alt: string }
  /** The Open Graph type: `article` for a blog post. Defaults to `website`. */
  ogType?: `website` | `article`
  /** Structured data about the page, such as a FAQ or the software, for its JSON-LD graph. */
  jsonLd?: readonly unknown[]
}

/**
 * A page's `<title>`: its own title, then the site's name, unless the title names the site
 * already, so no title says "Seed" twice.
 */
export function pageTitle(title: string): string {
  return title.includes(SITE_NAME) ? title : `${title} · ${SITE_NAME}`
}

/** What every page hands {@link SiteFrame}. */
export interface SiteFrameProps {
  /**
   * The request's state: the website's own origin for canonical links, the SPA's for actions, and
   * whether the footer offers the newsletter.
   */
  state: Pick<State, "webAppOrigin" | "spaOrigin" | "newsletter" | "blog">
  /** The page's path on this website, such as `/pricing`, for its canonical address. */
  path: string
  head: SitePageHead
  /**
   * Leaves the newsletter out of the footer, for a page that already shows the form in its
   * content, so the page does not offer the same form twice.
   */
  footerNewsletter?: boolean
  children: ComponentChildren
}

// Seed's own site: see docs/start-a-product.md (the hire link)
/** The header's links, in display order. The Blog link joins them once a post is live. */
export const NAV_LINKS = [
  { label: `Features`, href: `/features` },
  { label: `Blog`, href: BLOG_PATH },
  { label: `Compare`, href: `/compare` }, // Seed's own site: see docs/start-a-product.md
  { label: `Pricing`, href: `/pricing` },
  {
    label: `Hire me`,
    href: HIRE_PAGE_URL,
    external: true,
    externalHint: `(opens antonshubin.com)`,
  },
  { label: `GitHub`, href: REPOSITORY_URL, Icon: IconGitHub },
] as const

/**
 * The frame of every page of the public website: its head tags, a link that skips to the content,
 * the header with the way into the demo, the content as full-width bands, and the footer with the
 * legal pages and, while the API takes subscriptions, the newsletter form. Every link and form
 * works with JavaScript turned off.
 */
export function SiteFrame(
  { state, path, head, footerNewsletter = true, children }: SiteFrameProps,
): JSX.Element {
  const spa = spaLinks(state.spaOrigin)
  const og = head.og ?? `home`
  const blog = state.blog === true
  return (
    <>
      <Head>
        <SEOHead
          title={pageTitle(head.title)}
          description={head.description}
          canonical={`${state.webAppOrigin}${path}`}
          ogType={head.ogType}
          ogImage={head.image?.url ?? `${state.webAppOrigin}/og/${og}.png`}
          imageAlt={head.image?.alt ?? ogImageAlt(og)}
          imageWidth={head.image ? undefined : OG_IMAGE_SIZE.width}
          imageHeight={head.image ? undefined : OG_IMAGE_SIZE.height}
          siteName={SITE_NAME}
          locale="en_US"
          noindex={head.noindex}
          jsonLd={head.jsonLd}
        />
        {blog && (
          <link
            rel="alternate"
            type="application/rss+xml"
            title={BLOG_NAME}
            href={`${state.webAppOrigin}${RSS_PATH}`}
          />
        )}
      </Head>
      <a
        href="#main"
        class="sr-only rounded-control bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        data-e2e="skip-link"
      >
        Skip to content
      </a>
      <SiteHeader
        class="lg:sticky lg:top-0 lg:z-20"
        currentPath={path}
        brand={
          <a href="/" class="rounded-control" data-e2e="site-brand">
            <BrandMark Icon={IconSprout} name="Seed" />
          </a>
        }
        links={blog ? NAV_LINKS : NAV_LINKS.filter(({ href }) => href !== BLOG_PATH)}
        actions={
          <Button
            href={spa.try}
            rel={TRY_REL}
            size="sm"
            data-e2e="site-try-demo"
            data-umami-event="try-demo"
            data-umami-event-from="header"
          >
            Try the demo
          </Button>
        }
      />
      <main id="main" tabIndex={-1} class="outline-none">
        <FormatContext.Provider value={SITE_FORMAT}>{children}</FormatContext.Provider>
      </main>
      <SiteFooter
        brand={
          <div class="flex max-w-sm flex-col gap-3">
            <BrandMark Icon={IconSprout} name="Seed" />
            <p class="text-sm text-muted">
              The groundwork of your SaaS, open source under the MIT licence.
            </p>
          </div>
        }
        groups={footerGroups(spa, blog)}
        aside={state.newsletter && footerNewsletter ? <FooterNewsletter /> : undefined}
        bottom={
          <p>
            {/* Seed's own site: see docs/start-a-product.md */}
            Built in public by{" "}
            <a href={AUTHOR_URL} class="underline hover:text-foreground">Anton Shubin</a>. MIT
            licence.
          </p>
        }
      />
    </>
  )
}

/** What a legal page hands {@link LegalPage}: its frame's props, with its title and summary. */
export interface LegalPageProps extends Omit<SiteFrameProps, "head"> {
  title: string
  /** The `<title>` and social title, when it says more than the `h1`. Defaults to `title`. */
  headTitle?: string
  description: string
  /** The date the text last changed, as people read it, such as `16 October 2026`. */
  updated: string
  /** The page's `h2` anchors, for its table of contents. */
  sections: readonly { label: string; href: string }[]
  /** Shown under the date in place of the legal notice, on a page that is not a legal one. */
  lead?: ComponentChildren
}

/**
 * A legal page's structured data: the page itself, part of the site the home page declares, and
 * its place under the home page.
 */
function legalPageJsonLd(
  origin: string,
  path: string,
  crumb: string,
  name: string,
  description: string,
): unknown[] {
  const url = `${origin}${path}`
  return [
    {
      "@type": `WebPage`,
      "@id": `${url}#webpage`,
      url,
      name,
      description,
      isPartOf: { "@id": `${origin}/#website` },
    },
    siteBreadcrumbsJsonLd(origin, path, crumb),
  ]
}

/**
 * A legal page of the demo: its title, a notice that it is a template a product must adapt (or
 * `lead` in its place), and its text in one reading column. Headings, lists and links inside
 * `children` get the page's prose styles.
 */
export function LegalPage(
  { state, path, title, headTitle, description, updated, sections, lead, children }: LegalPageProps,
): JSX.Element {
  return (
    <SiteFrame
      state={state}
      path={path}
      head={{
        title: headTitle ?? title,
        description,
        jsonLd: legalPageJsonLd(state.webAppOrigin, path, title, headTitle ?? title, description),
      }}
    >
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <header class="flex max-w-3xl flex-col gap-4">
          <h1 class="text-3xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
          <p class="font-mono text-sm text-muted">Last changed {updated}</p>
          {lead ?? (
            <Notice title="A starting point, not legal advice">
              This page covers the live demo of {SITE_NAME}. A product built on {SITE_NAME}{" "}
              must adapt it to what it really stores and does, and have it checked.
            </Notice>
          )}
        </header>
        <div class="grid gap-8 lg:grid-cols-4">
          <div class="lg:order-2">
            <OnThisPage links={sections} />
          </div>
          <article class="flex min-w-0 max-w-3xl flex-col gap-4 lg:order-1 lg:col-span-3 [&_a]:text-primary [&_a]:underline [&_h2]:mt-6 [&_h2]:scroll-mt-16 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:text-pretty [&_p]:text-pretty [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
            {children}
          </article>
        </div>
      </div>
    </SiteFrame>
  )
}

/**
 * The footer's link columns: the product, the source, and the person and rules behind it. The Blog
 * link is there once a post is live.
 */
function footerGroups(spa: { signIn: string; try: string }, blog: boolean): SiteFooterGroup[] {
  return [
    {
      title: `Product`,
      links: [
        { label: `Features`, href: `/features` },
        { label: `Admin panel`, href: `/admin` },
        ...(blog ? [{ label: `Blog`, href: BLOG_PATH }] : []),
        { label: `Compare`, href: `/compare` }, // Seed's own site: see docs/start-a-product.md
        { label: `Pricing`, href: `/pricing` },
        // The library's footer links take no `rel`; the app's robots.txt keeps crawlers off `/try`.
        { label: `Try the demo`, href: spa.try },
        { label: `Sign in`, href: spa.signIn },
      ],
    },
    {
      title: `Open source`,
      links: [
        { label: `Source on GitHub`, href: REPOSITORY_URL, external: true },
        { label: `Report an issue`, href: `${REPOSITORY_URL}/issues`, external: true },
        { label: `Quick start`, href: `/#quick-start` },
        { label: `API docs`, href: API_DOCS_PATH },
        { label: `What works today`, href: `/#status` },
      ],
    },
    {
      // Seed's own site: see docs/start-a-product.md
      title: `Company`,
      links: [
        { label: `Hire me for an MVP`, href: HIRE_PAGE_URL, external: true },
        { label: `About Anton`, href: AUTHOR_URL, external: true },
        { label: `Privacy`, href: `/privacy` },
        { label: `Terms`, href: `/terms` },
      ],
    },
  ]
}

/** The footer's newsletter: a heading, one line on what it sends, and {@link NewsletterForm}. */
function FooterNewsletter(): JSX.Element {
  return (
    <section aria-labelledby="footer-news" class="flex flex-col gap-3">
      <h2 id="footer-news" class="text-sm font-semibold">Newsletter</h2>
      <p class="text-sm text-muted">
        A short email when {SITE_NAME} changes. You confirm by email first; one click unsubscribes.
      </p>
      <NewsletterForm id="footer" />
    </section>
  )
}

/**
 * The newsletter's one-field form: a real `<form method="post">` to the subscribe page, so it
 * works without JavaScript. `id` names its field (`<id>-email`) and its `data-e2e` hooks, so two
 * forms never share an id; a page shows at most one besides the footer's, and hides the footer's
 * then (`SiteFrameProps.footerNewsletter`).
 */
export function NewsletterForm({ id }: { id: string }): JSX.Element {
  return (
    <form
      method="post"
      action={FORM_ACTIONS.subscribe}
      class="flex gap-2"
      data-analytics-submit="newsletter-subscribe"
    >
      <input type="hidden" name="list" value={DEFAULT_SUBSCRIBER_LIST} />
      <label for={`${id}-email`} class="sr-only">Email address</label>
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        required
        data-e2e={`${id}-subscribe-email`}
      />
      <Button type="submit" variant="secondary" data-e2e={`${id}-subscribe-submit`}>
        Subscribe
      </Button>
    </form>
  )
}
