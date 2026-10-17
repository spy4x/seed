import type { ComponentChildren, JSX } from "preact"
import { Head } from "fresh/runtime"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { IconGitHub, IconSprout } from "@spy4x/preact-icons"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { Input } from "@spy4x/preact-ui/input"
import { Notice } from "@spy4x/preact-ui/notice"
import { SEOHead } from "@spy4x/preact-system/seo-head"
import { SiteFooter, type SiteFooterGroup } from "@spy4x/preact-system/site-footer"
import { SiteHeader } from "@spy4x/preact-system/site-header"
import { FORM_ACTIONS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { AUTHOR_URL, REPOSITORY_URL, SITE_NAME } from "./brand.ts"
import { OnThisPage } from "./components/on-this-page.tsx"
import type { State } from "./utils.ts"

export { AUTHOR_URL, REPOSITORY_URL, SITE_NAME }

/** The pages the website lists in `sitemap.xml`, in the order a visitor meets them. */
export const SITE_PAGES = [
  `/`,
  `/features`,
  `/compare`,
  `/pricing`,
  `/mvp`,
  `/subscribe`,
  `/privacy`,
  `/terms`,
] as const

/** The pages that have an Open Graph image of their own, at `/og/<key>.png`. */
export type OgImageKey = `home` | `features` | `compare` | `pricing` | `mvp` | `subscribe`

/**
 * What each Open Graph image says: its big headline and the small line under it. The image's alt
 * text is made from both, so the card and its description cannot drift apart.
 */
export const OG_IMAGES: Record<OgImageKey, { headline: string; line: string }> = {
  home: {
    headline: `The groundwork of your SaaS, already built.`,
    line: `Seed · open source · MIT · one server you own`,
  },
  features: {
    headline: `Auth, teams, billing, offline, admin.`,
    line: `Everything Seed ships, and what it does not yet`,
  },
  compare: {
    headline: `Seed vs ShipFast, Supastarter, Makerkit, Open SaaS`,
    line: `Honest, sourced, checked 16 Oct 2026`,
  },
  pricing: { headline: `Seed is free.`, line: `MIT licence · you pay for one server` },
  mvp: {
    headline: `Your MVP, live and taking payments.`,
    line: `From $8,000 · from 3 weeks · you own everything`,
  },
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

/** The SPA's sign-in and sign-up pages: the website has no session, the product signs people in. */
export function spaLinks(spaOrigin: string): { signIn: string; signUp: string } {
  return {
    signIn: `${spaOrigin}${SCREEN_PATHS.signIn}`,
    signUp: `${spaOrigin}${SCREEN_PATHS.signUp}`,
  }
}

/** The author as a JSON-LD entity, with the id other entities point at. */
export const PERSON_JSON_LD = {
  "@type": `Person`,
  "@id": `${AUTHOR_URL}/#person`,
  name: `Anton Shubin`,
  url: AUTHOR_URL,
  jobTitle: `Senior full-stack engineer`,
} as const

/** The title and description of one page, for its `<head>` and its social previews. */
export interface SitePageHead {
  title: string
  description: string
  /** Keeps the page out of search results, as for a page reached only through a mailed link. */
  noindex?: boolean
  /** Which Open Graph image the page shares with. Defaults to the home page's. */
  og?: OgImageKey
  /** Structured data about the page, such as a FAQ or the software, for its JSON-LD graph. */
  jsonLd?: readonly unknown[]
}

/** What every page hands {@link SiteFrame}. */
export interface SiteFrameProps {
  /**
   * The request's state: the website's own origin for canonical links, the SPA's for actions, and
   * whether the footer offers the newsletter.
   */
  state: Pick<State, "webAppOrigin" | "spaOrigin" | "newsletter">
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

/** The header's links, in display order. */
export const NAV_LINKS = [
  { label: `Features`, href: `/features` },
  { label: `Compare`, href: `/compare` },
  { label: `Pricing`, href: `/pricing` },
  { label: `Hire me`, href: `/mvp` },
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
  return (
    <>
      <Head>
        <SEOHead
          title={path === `/` ? head.title : `${head.title} · ${SITE_NAME}`}
          description={head.description}
          canonical={`${state.webAppOrigin}${path}`}
          ogImage={`${state.webAppOrigin}/og/${og}.png`}
          imageAlt={ogImageAlt(og)}
          imageWidth={OG_IMAGE_SIZE.width}
          imageHeight={OG_IMAGE_SIZE.height}
          siteName={SITE_NAME}
          locale="en_US"
          noindex={head.noindex}
          jsonLd={head.jsonLd}
        />
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
        links={NAV_LINKS}
        actions={<Button href={spa.signUp} size="sm" data-e2e="site-try-demo">Try the demo</Button>}
      />
      <main id="main" tabIndex={-1} class="outline-none">{children}</main>
      <SiteFooter
        brand={
          <div class="flex max-w-sm flex-col gap-3">
            <BrandMark Icon={IconSprout} name="Seed" />
            <p class="text-sm text-muted">
              The groundwork of your SaaS, open source under the MIT licence.
            </p>
          </div>
        }
        groups={footerGroups(spa)}
        aside={state.newsletter && footerNewsletter ? <FooterNewsletter /> : undefined}
        bottom={
          <p>
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
}

/**
 * A legal page of the demo: its title, a notice that it is a template a product must adapt, and
 * its text in one reading column. Headings, lists and links inside `children` get the page's prose
 * styles.
 */
export function LegalPage(
  { state, path, title, headTitle, description, updated, sections, children }: LegalPageProps,
): JSX.Element {
  return (
    <SiteFrame state={state} path={path} head={{ title: headTitle ?? title, description }}>
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <header class="flex max-w-3xl flex-col gap-4">
          <h1 class="text-3xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
          <p class="font-mono text-sm text-muted">Last changed {updated}</p>
          <Notice title="A starting point, not legal advice">
            This page covers the live demo of {SITE_NAME}. A product built on {SITE_NAME}{" "}
            must adapt it to what it really stores and does, and have it checked.
          </Notice>
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

/** The footer's link columns: the product, the source, and the person and rules behind it. */
function footerGroups(spa: { signIn: string; signUp: string }): SiteFooterGroup[] {
  return [
    {
      title: `Product`,
      links: [
        { label: `Features`, href: `/features` },
        { label: `Compare`, href: `/compare` },
        { label: `Pricing`, href: `/pricing` },
        { label: `Try the demo`, href: spa.signUp },
        { label: `Sign in`, href: spa.signIn },
      ],
    },
    {
      title: `Open source`,
      links: [
        { label: `Source on GitHub`, href: REPOSITORY_URL, external: true },
        { label: `Report an issue`, href: `${REPOSITORY_URL}/issues`, external: true },
        { label: `Quick start`, href: `/#quick-start` },
        { label: `What works today`, href: `/#status` },
      ],
    },
    {
      title: `Company`,
      links: [
        { label: `Hire me`, href: `/mvp` },
        { label: `About Anton`, href: AUTHOR_URL, external: true },
        { label: `Privacy`, href: `/privacy` },
        { label: `Terms`, href: `/terms` },
      ],
    },
  ]
}

/** The footer's newsletter form: a real `<form method="post">`, so it works without JavaScript. */
function FooterNewsletter(): JSX.Element {
  return (
    <section aria-labelledby="footer-news" class="flex flex-col gap-3">
      <h2 id="footer-news" class="text-sm font-semibold">Newsletter</h2>
      <p class="text-sm text-muted">
        A short email when {SITE_NAME} changes. You confirm by email first; one click unsubscribes.
      </p>
      <form method="post" action={FORM_ACTIONS.subscribe} class="flex gap-2">
        <input type="hidden" name="list" value={DEFAULT_SUBSCRIBER_LIST} />
        <label for="footer-email" class="sr-only">Email address</label>
        <Input
          id="footer-email"
          name="email"
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          required
          data-e2e="footer-subscribe-email"
        />
        <Button type="submit" variant="secondary" data-e2e="footer-subscribe-submit">
          Subscribe
        </Button>
      </form>
    </section>
  )
}
