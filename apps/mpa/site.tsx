import type { ComponentChildren, JSX } from "preact"
import { Head } from "fresh/runtime"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { Button } from "@spy4x/preact-ui/button"
import { Input } from "@spy4x/preact-ui/input"
import { Page } from "@spy4x/preact-ui/layout"
import { Notice } from "@spy4x/preact-ui/notice"
import { SEOHead } from "@spy4x/preact-system/seo-head"
import { SiteHeader } from "@spy4x/preact-system/site-header"
import { FORM_ACTIONS, SCREEN_PATHS } from "@ui/progressive.tsx"
import type { State } from "./utils.ts"

/** The product this website promotes, as every page names it. */
export const SITE_NAME = "Template"

/** Where the source lives: the "View on GitHub" link and the footer point here. */
export const REPOSITORY_URL = "https://github.com/spy4x/template"

/** The pages the website lists in `sitemap.xml`, in the order a visitor meets them. */
export const SITE_PAGES = ["/", "/pricing", "/subscribe", "/privacy", "/terms"] as const

/** The SPA's sign-in and sign-up pages: the website has no session, the product signs people in. */
export function spaLinks(spaOrigin: string): { signIn: string; signUp: string } {
  return {
    signIn: `${spaOrigin}${SCREEN_PATHS.signIn}`,
    signUp: `${spaOrigin}${SCREEN_PATHS.signUp}`,
  }
}

/** The title and description of one page, for its `<head>` and its social previews. */
export interface SitePageHead {
  title: string
  description: string
  /** Keeps the page out of search results, as for a page reached only through a mailed link. */
  noindex?: boolean
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
  children: ComponentChildren
}

const NAV_LINKS = [
  { label: "Features", href: "/#features" },
  { label: "Pricing", href: "/pricing" },
  { label: "GitHub", href: REPOSITORY_URL },
] as const

/**
 * The frame of every page of the public website: its head tags, the header with the way into the
 * demo, the content and the footer with the legal pages and, while the API takes subscriptions,
 * the newsletter form. Every link and form works with JavaScript turned off.
 */
export function SiteFrame({ state, path, head, children }: SiteFrameProps): JSX.Element {
  const spa = spaLinks(state.spaOrigin)
  return (
    <>
      <Head>
        <SEOHead
          title={path === "/" ? head.title : `${head.title} · ${SITE_NAME}`}
          description={head.description}
          canonical={`${state.webAppOrigin}${path}`}
          siteName={SITE_NAME}
          noindex={head.noindex}
        />
      </Head>
      <SiteHeader
        currentPath={path}
        brand={<a href="/" class="text-lg font-semibold" data-e2e="site-brand">{SITE_NAME}</a>}
        links={NAV_LINKS}
        actions={
          <>
            <Button href={spa.signIn} variant="ghost" size="sm">
              Sign in
            </Button>
            <Button href={spa.signUp} size="sm" data-e2e="site-try-demo">Try the demo</Button>
          </>
        }
      />
      <Page as="main" class="py-8 sm:py-16">{children}</Page>
      <SiteFooter signIn={spa.signIn} signUp={spa.signUp} newsletter={state.newsletter} />
    </>
  )
}

/** What a legal page hands {@link LegalPage}: its frame's props, with its title and summary. */
export interface LegalPageProps extends Omit<SiteFrameProps, "head"> {
  title: string
  description: string
}

/**
 * A legal page of the demo: its title, a notice that it is a template a product must adapt, and
 * its text. Headings, lists and links inside `children` get the page's prose styles.
 */
export function LegalPage(
  { state, path, title, description, children }: LegalPageProps,
): JSX.Element {
  return (
    <SiteFrame state={state} path={path} head={{ title, description }}>
      <article class="mx-auto flex w-full max-w-3xl flex-col gap-4 [&_a]:underline [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
        <h1 class="text-3xl font-bold">{title}</h1>
        <Notice title="A starting point, not legal advice">
          This page covers the live demo of Template. A product built on Template must adapt it to
          what it really stores and does, and have it checked.
        </Notice>
        {children}
      </article>
    </SiteFrame>
  )
}

function FooterLinks(
  { title, links }: { title: string; links: { label: string; href: string }[] },
): JSX.Element {
  return (
    <nav aria-label={title}>
      <h2 class="text-sm font-semibold">{title}</h2>
      <ul class="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            <a href={link.href} class="text-muted hover:underline">{link.label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function SiteFooter(
  { signIn, signUp, newsletter }: { signIn: string; signUp: string; newsletter: boolean },
): JSX.Element {
  return (
    <footer class="border-t border-subtle bg-surface dark:bg-canvas">
      <div class="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <FooterLinks
          title="Product"
          links={[
            { label: "Features", href: "/#features" },
            { label: "Pricing", href: "/pricing" },
            { label: "Try the demo", href: signUp },
            { label: "Sign in", href: signIn },
          ]}
        />
        <FooterLinks
          title="Open source"
          links={[
            { label: "Source on GitHub", href: REPOSITORY_URL },
            { label: "Report an issue", href: `${REPOSITORY_URL}/issues` },
            { label: "Quick start", href: "/#quick-start" },
          ]}
        />
        <FooterLinks
          title="Legal"
          links={[
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
          ]}
        />
        {newsletter && (
          <section aria-labelledby="footer-news">
            <h2 id="footer-news" class="text-sm font-semibold">News by e-mail</h2>
            <p class="mt-3 text-sm text-muted">
              What I build next, when it ships. Confirm by link, unsubscribe in one click.
            </p>
            <form method="post" action={FORM_ACTIONS.subscribe} class="mt-3 flex gap-2">
              <input type="hidden" name="list" value={DEFAULT_SUBSCRIBER_LIST} />
              <label for="footer-email" class="sr-only">E-mail</label>
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
        )}
      </div>
      <p class="mx-auto max-w-7xl px-4 pb-12 text-sm text-muted sm:px-6 lg:px-8">
        Built in public by{" "}
        <a href="https://antonshubin.com" class="underline">Anton Shubin</a>. MIT licence.
      </p>
    </footer>
  )
}
