import type { ComponentChildren, JSX } from "preact"
import { Head } from "fresh/runtime"
import type { PublicContactLink } from "@domain/contact-links"
import type { Language } from "@domain/identity"
import { DEFAULT_SUBSCRIBER_LIST } from "@domain/subscribers"
import { IconGitHub } from "@spy4x/preact-icons"
import { BrandMark } from "@spy4x/preact-ui/brand-mark"
import { Button } from "@spy4x/preact-ui/button"
import { FormatContext } from "@spy4x/preact-ui/format"
import { Rich } from "@spy4x/preact-ui/i18n"
import { LanguagePicker } from "@spy4x/preact-ui/language-picker"
import { Input } from "@spy4x/preact-ui/input"
import { Notice } from "@spy4x/preact-ui/notice"
import { SEOHead } from "@spy4x/preact-system/seo-head"
import { SiteFooter, type SiteFooterGroup } from "@spy4x/preact-system/site-footer"
import { SiteHeader } from "@spy4x/preact-system/site-header"
import { OnThisPage, type OnThisPageLink } from "@spy4x/preact-ui/on-this-page"
import type { Translator } from "@spy4x/platform/universal/i18n"
import { breadcrumbListJsonLd } from "@spy4x/platform/universal/seo"
import { createFormatters, type Formatters } from "@spy4x/time/format"
import { FORM_ACTIONS, SCREEN_PATHS } from "@ui/progressive.tsx"
import { siteEnglishText } from "@ui/site-text.ts"
import { BLOG_PATH, RSS_PATH } from "./blog.ts"
import { AUTHOR_URL, REPOSITORY_URL, SITE_ICON, SITE_NAME, TRY_ENTRY } from "./brand.ts"
import { API_DOCS_PATH } from "./api-docs.ts"
import { contactFooterLinks } from "./contact-links.ts"
import { HIRE_PAGE_URL } from "./hire.ts"
import {
  DEFAULT_LANGUAGE,
  isSiteLanguage,
  localePath,
  ogLocale,
  SITE_LANGUAGES,
} from "./languages.ts"
import { useSite } from "./use-site.tsx"
import type { State } from "./utils.ts"

export { AUTHOR_URL, REPOSITORY_URL, SITE_ICON, SITE_NAME, TRY_ENTRY }

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

/** A page's breadcrumb trail, always rooted at the home page's full address in the page's language. */
export function siteBreadcrumbsJsonLd(
  origin: string,
  path: string,
  name: string,
  language: Language = DEFAULT_LANGUAGE,
): unknown {
  return breadcrumbListJsonLd(`${origin}${localePath(language, path)}`, [
    { name: SITE_NAME, href: `${origin}${localePath(language, `/`)}` },
    { name },
  ])
}

/** The title and description of one page, for its `<head>` and its social previews. */
export interface SitePageHead {
  title: string
  description: string
  /** Keeps the page out of search results, as for a page reached only through a mailed link. */
  noindex?: boolean
  /**
   * The page's main content exists in the default language only, such as a legal page or a blog
   * post: every language's address shows it in the page's frame, its canonical address is the
   * default language's, and it names no other language version.
   */
  oneLanguage?: boolean
  /**
   * The page's language versions, itself included, when they are not every served language at
   * the same path, such as a blog post and its translations: each language with its path in the
   * default language's form (`/blog/hallo-welt`). A page with no other version names none.
   */
  alternates?: readonly { language: Language; path: string }[]
  /**
   * With {@link alternates}: where the language picker sends a language the page has no version
   * in, such as the blog's index. Without it, the page's own path in that language.
   */
  elsewhere?: string
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

/**
 * The language versions of the page at `path`, as `hreflang` alternates: every served language at
 * its own address, or the page's own {@link SitePageHead.alternates}, then `x-default`, the default
 * language's when there is one. Empty for a page that names none, and for a page whose only
 * version is itself.
 */
export function languageAlternates(
  origin: string,
  path: string,
  head: Pick<SitePageHead, "noindex" | "oneLanguage" | "alternates">,
): { hreflang: string; href: string }[] {
  if (head.noindex || head.oneLanguage) return []
  const versions = head.alternates ??
    SITE_LANGUAGES.map((language) => ({ language, path }))
  if (versions.length < 2) return []
  const fallback = versions.find(({ language }) => language === DEFAULT_LANGUAGE)
  return [
    ...versions.map((version) => ({
      hreflang: version.language,
      href: `${origin}${localePath(version.language, version.path)}`,
    })),
    ...(fallback
      ? [{ hreflang: `x-default`, href: `${origin}${localePath(DEFAULT_LANGUAGE, fallback.path)}` }]
      : []),
  ]
}

/** What every page hands {@link SiteFrame}. */
export interface SiteFrameProps {
  /**
   * The request's state: the website's own origin for canonical links, the SPA's for actions, and
   * whether the footer offers the newsletter.
   */
  state: Pick<State, "webAppOrigin" | "spaOrigin" | "newsletter" | "blog" | "contactLinks">
  /**
   * The page's path on this website in the default language, such as `/pricing`. The frame puts
   * the page's language in front of it for the canonical address and the links.
   */
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
/** The header's links, in display order, by catalog key. The Blog link joins them once a post is live. */
export const NAV_LINKS = [
  { label: `SiteNav.features`, href: `/features` },
  { label: `SiteNav.blog`, href: BLOG_PATH },
  { label: `SiteNav.compare`, href: `/compare` }, // Seed's own site: see docs/start-a-product.md
  { label: `SiteNav.pricing`, href: `/pricing` },
  {
    label: `SiteNav.hire`,
    href: HIRE_PAGE_URL,
    external: true,
    externalHint: `SiteNav.hireHint`,
  },
  { label: `SiteNav.github`, href: REPOSITORY_URL, Icon: IconGitHub },
] as const

/**
 * The frame of every page of the public website: its head tags, a link that skips to the content,
 * the header with the language menu and the way into the demo, the content as full-width bands,
 * and the footer with the legal pages, the language links and, while the API takes subscriptions,
 * the newsletter form.
 * Every link and form works with JavaScript turned off, and every link to another page of the site
 * keeps the page's language.
 */
export function SiteFrame(
  { state, path, head, footerNewsletter = true, children }: SiteFrameProps,
): JSX.Element {
  const { t, language, href } = useSite()
  const spa = spaLinks(state.spaOrigin)
  const og = head.og ?? `home`
  const blog = state.blog === true
  const origin = state.webAppOrigin
  const navLinks = blog ? NAV_LINKS : NAV_LINKS.filter((link) => link.href !== BLOG_PATH)
  // This page in another language: its translated version, or where the page says to go instead.
  const languageHref = (tag: string) => {
    const target = isSiteLanguage(tag) ? tag : DEFAULT_LANGUAGE
    const version = head.alternates?.find(({ language }) => language === target)
    return localePath(target, version?.path ?? (head.alternates && head.elsewhere) ?? path)
  }
  return (
    <>
      <Head>
        <SEOHead
          title={pageTitle(head.title)}
          description={head.description}
          canonical={`${origin}${localePath(head.oneLanguage ? DEFAULT_LANGUAGE : language, path)}`}
          ogType={head.ogType}
          ogImage={head.image?.url ?? `${origin}/og/${og}.png`}
          imageAlt={head.image?.alt ?? ogImageAlt(og)}
          imageWidth={head.image ? undefined : OG_IMAGE_SIZE.width}
          imageHeight={head.image ? undefined : OG_IMAGE_SIZE.height}
          siteName={SITE_NAME}
          locale={ogLocale(language)}
          noindex={head.noindex}
          jsonLd={head.jsonLd}
        />
        {languageAlternates(origin, path, head).map((alternate) => (
          <link rel="alternate" hreflang={alternate.hreflang} href={alternate.href} />
        ))}
        {blog && (
          <link
            rel="alternate"
            type="application/rss+xml"
            title={t.t(`Blog.name`, { site: SITE_NAME })}
            href={`${origin}${RSS_PATH}`}
          />
        )}
      </Head>
      <a
        href="#main"
        class="sr-only rounded-control bg-primary px-4 py-2 font-medium text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
        data-e2e="skip-link"
      >
        {t.t(`SiteFrame.skip`)}
      </a>
      <SiteHeader
        class="lg:sticky lg:top-0 lg:z-20"
        currentPath={href(path)}
        brand={
          <a href={href(`/`)} class="rounded-control" data-e2e="site-brand">
            <BrandMark Icon={SITE_ICON} name={SITE_NAME} />
          </a>
        }
        links={navLinks.map((link) => ({
          ...link,
          label: t.t(link.label),
          href: link.href.startsWith(`/`) ? href(link.href) : link.href,
          ...(`externalHint` in link ? { externalHint: t.t(link.externalHint) } : {}),
        }))}
        actions={
          <>
            <div data-e2e="site-header-languages">
              <LanguagePicker
                mode="menu"
                languages={SITE_LANGUAGES}
                current={language}
                href={languageHref}
              />
            </div>
            <Button
              href={spa.try}
              rel={TRY_REL}
              size="sm"
              data-e2e="site-try-demo"
              data-umami-event="try-demo"
              data-umami-event-from="header"
            >
              {t.t(`SiteFrame.tryDemo`)}
            </Button>
          </>
        }
      />
      <main id="main" tabIndex={-1} class="outline-none">
        <FormatContext.Provider value={siteFormat(language)}>{children}</FormatContext.Provider>
      </main>
      <SiteFooter
        brand={
          <div class="flex max-w-sm flex-col gap-3">
            <BrandMark Icon={SITE_ICON} name={SITE_NAME} />
            <p class="text-sm text-muted">{t.t(`SiteFooter.pitch`)}</p>
          </div>
        }
        groups={footerGroups(t, href, spa, blog, state.contactLinks ?? [])}
        aside={state.newsletter && footerNewsletter ? <FooterNewsletter /> : undefined}
        bottom={
          <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <p>
              {/* Seed's own site: see docs/start-a-product.md */}
              <Rich
                parts={t.parts(`SiteFooter.builtBy`, { name: SITE_AUTHOR.name })}
                tags={{
                  author: (text) => (
                    <a href={AUTHOR_URL} class="underline hover:text-foreground">{text}</a>
                  ),
                }}
              />
            </p>
            <div data-e2e="site-languages">
              <LanguagePicker
                mode="links"
                languages={SITE_LANGUAGES}
                current={language}
                href={languageHref}
              />
            </div>
          </div>
        }
      />
    </>
  )
}

/**
 * How the website writes a date and a number in `language`, in UTC, so the server's own locale and
 * zone never change what a page says. English is British English, like its prose: `16 Oct 2026`.
 */
function siteFormat(language: Language): Formatters {
  let format = SITE_FORMATS.get(language)
  if (!format) {
    format = createFormatters({ locale: language === `en` ? `en-GB` : language, timeZone: `UTC` })
    SITE_FORMATS.set(language, format)
  }
  return format
}

const SITE_FORMATS = new Map<Language, Formatters>()

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
      inLanguage: DEFAULT_LANGUAGE,
      isPartOf: { "@id": `${origin}/#website` },
    },
    siteBreadcrumbsJsonLd(origin, path, crumb),
  ]
}

/**
 * A page whose text exists in the default language only: a legal page of the demo, or the API
 * reference. Its title, a notice that it is a template a product must adapt (or `lead` in its
 * place), and its text in one reading column, marked as the default language's. At another
 * language's address the frame speaks that language, a line says the text is in English only, and
 * the canonical address is the default language's: a machine translation of a contract is a legal
 * risk. Headings, lists and links inside `children` get the page's prose styles.
 */
export function LegalPage(
  { state, path, title, headTitle, description, updated, sections, lead, children }: LegalPageProps,
): JSX.Element {
  const { t, language } = useSite()
  const en = siteEnglishText()
  return (
    <SiteFrame
      state={state}
      path={path}
      head={{
        title: headTitle ?? title,
        description,
        oneLanguage: true,
        jsonLd: legalPageJsonLd(state.webAppOrigin, path, title, headTitle ?? title, description),
      }}
    >
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        {language !== DEFAULT_LANGUAGE && (
          <p class="text-sm text-muted" data-e2e="english-only">{t.t(`LegalPage.englishOnly`)}</p>
        )}
        {/* A box, not `contents`: the column lays out left to right only if it is its own flex. */}
        <div lang={DEFAULT_LANGUAGE} dir="ltr" class="flex flex-col gap-8">
          <header class="flex max-w-3xl flex-col gap-4">
            <h1 class="text-3xl font-semibold tracking-tight lg:text-4xl">{title}</h1>
            <p class="font-mono text-sm text-muted">
              {en.t(`LegalPage.updated`, { date: updated })}
            </p>
            {lead ?? (
              <Notice title={en.t(`LegalPage.noticeTitle`)}>
                {en.t(`LegalPage.notice`, { site: SITE_NAME })}
              </Notice>
            )}
          </header>
          <div class="grid gap-8 lg:grid-cols-4">
            <div class="lg:order-2">
              <OnThisPage links={sectionLinks(sections)} label={en.t(`OnThisPage.title`)} />
            </div>
            <article class="flex min-w-0 max-w-3xl flex-col gap-4 lg:order-1 lg:col-span-3 [&_a]:text-primary [&_a]:underline [&_h2]:mt-6 [&_h2]:scroll-mt-16 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_li]:text-pretty [&_p]:text-pretty [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:ps-6">
              {children}
            </article>
          </div>
        </div>
      </div>
    </SiteFrame>
  )
}

/**
 * A page's sections as `OnThisPage` links, each counted in Umami as an `on-this-page` click with its
 * section's id, so every list on the site reports the same event.
 */
export function sectionLinks(
  sections: readonly { label: string; href: string }[],
): OnThisPageLink[] {
  return sections.map(({ label, href }) => ({
    label,
    href,
    "data-umami-event": `on-this-page`,
    "data-umami-event-section": href.slice(1),
  }))
}

/**
 * The footer's link columns: the product, the source, the person and rules behind it, and, once the
 * operator has added any, the contact links. The Blog link is there once a post is live.
 */
function footerGroups(
  t: Translator<string>,
  href: (path: string) => string,
  spa: { signIn: string; try: string },
  blog: boolean,
  contactLinks: readonly PublicContactLink[],
): SiteFooterGroup[] {
  const contact: SiteFooterGroup[] = contactLinks.length > 0
    ? [{ title: t.t(`SiteFooter.contact`), links: contactFooterLinks(contactLinks) }]
    : []
  return [
    {
      title: t.t(`SiteFooter.product`),
      links: [
        { label: t.t(`SiteNav.features`), href: href(`/features`) },
        { label: t.t(`SiteFooter.admin`), href: href(`/admin`) },
        ...(blog ? [{ label: t.t(`SiteNav.blog`), href: href(BLOG_PATH) }] : []),
        // Seed's own site: see docs/start-a-product.md
        { label: t.t(`SiteNav.compare`), href: href(`/compare`) },
        { label: t.t(`SiteNav.pricing`), href: href(`/pricing`) },
        // The library's footer links take no `rel`; the app's robots.txt keeps crawlers off `/try`.
        { label: t.t(`SiteFrame.tryDemo`), href: spa.try },
        { label: t.t(`SiteFooter.signIn`), href: spa.signIn },
      ],
    },
    {
      title: t.t(`SiteFooter.openSource`),
      links: [
        { label: t.t(`SiteFooter.source`), href: REPOSITORY_URL, external: true },
        { label: t.t(`SiteFooter.issue`), href: `${REPOSITORY_URL}/issues`, external: true },
        { label: t.t(`SiteFooter.quickStart`), href: href(`/#quick-start`) },
        { label: t.t(`SiteFooter.apiDocs`), href: href(API_DOCS_PATH) },
        { label: t.t(`SiteFooter.status`), href: href(`/#status`) },
      ],
    },
    {
      // Seed's own site: see docs/start-a-product.md
      title: t.t(`SiteFooter.company`),
      links: [
        {
          label: t.t(`SiteFooter.hire`),
          href: HIRE_PAGE_URL,
          external: true,
          externalHint: t.t(`SiteNav.hireHint`),
        },
        {
          label: t.t(`SiteFooter.about`),
          href: AUTHOR_URL,
          external: true,
          externalHint: t.t(`SiteNav.hireHint`),
        },
        { label: t.t(`SiteFooter.privacy`), href: href(`/privacy`) },
        { label: t.t(`SiteFooter.terms`), href: href(`/terms`) },
      ],
    },
    ...contact,
  ]
}

/** The footer's newsletter: a heading, one line on what it sends, and {@link NewsletterForm}. */
function FooterNewsletter(): JSX.Element {
  const { t } = useSite()
  return (
    <section aria-labelledby="footer-news" class="flex flex-col gap-3">
      <h2 id="footer-news" class="text-sm font-semibold">{t.t(`FooterNewsletter.title`)}</h2>
      <p class="text-sm text-muted">{t.t(`FooterNewsletter.lead`, { site: SITE_NAME })}</p>
      <NewsletterForm id="footer" />
    </section>
  )
}

/**
 * The newsletter's one-field form: a real `<form method="post">` to the subscribe page in the
 * page's language, so it works without JavaScript and answers in that language. `id` names its
 * field (`<id>-email`) and its `data-e2e` hooks, so two forms never share an id; a page shows at
 * most one besides the footer's, and hides the footer's then (`SiteFrameProps.footerNewsletter`).
 */
export function NewsletterForm({ id }: { id: string }): JSX.Element {
  const { t, href, language } = useSite()
  return (
    <form
      method="post"
      action={href(FORM_ACTIONS.subscribe)}
      class="flex gap-2"
      data-analytics-submit="newsletter-subscribe"
    >
      <input type="hidden" name="list" value={DEFAULT_SUBSCRIBER_LIST} />
      <input type="hidden" name="language" value={language} />
      <label for={`${id}-email`} class="sr-only">{t.t(`NewsletterForm.email`)}</label>
      <Input
        id={`${id}-email`}
        name="email"
        type="email"
        autocomplete="email"
        placeholder={t.t(`NewsletterForm.placeholder`)}
        required
        data-e2e={`${id}-subscribe-email`}
      />
      <Button type="submit" variant="secondary" data-e2e={`${id}-subscribe-submit`}>
        {t.t(`NewsletterForm.submit`)}
      </Button>
    </form>
  )
}
