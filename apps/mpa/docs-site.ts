import type { DocsNavGroup } from "@spy4x/preact-ui/docs-nav"
import { type MarkdownHeading, renderMarkdown } from "@spy4x/platform/universal/markdown"
import { readingMinutes } from "@spy4x/platform/universal/text"
import { API_DOCS_PATH } from "./api-docs.ts"
import { REPOSITORY_URL } from "./brand.ts"
import { CHANGELOG } from "./changelog.ts"
import adminModules from "../../docs/admin-modules.md" with { type: "text" }
import aggregateExtras from "../../docs/aggregate-extras.md" with { type: "text" }
import aggregateLifecycle from "../../docs/aggregate-lifecycle.md" with { type: "text" }
import aggregateOffline from "../../docs/aggregate-offline.md" with { type: "text" }
import aggregateRelations from "../../docs/aggregate-relations.md" with { type: "text" }
import aggregates from "../../docs/aggregates.md" with { type: "text" }
import aiAgents from "../../docs/ai-agents.md" with { type: "text" }
import apiErrors from "../../docs/api-errors.md" with { type: "text" }
import apps from "../../docs/apps.md" with { type: "text" }
import attachmentsAndPictures from "../../docs/attachments-and-pictures.md" with { type: "text" }
import backups from "../../docs/backups.md" with { type: "text" }
import billing from "../../docs/billing.md" with { type: "text" }
import billingLifecycle from "../../docs/billing-lifecycle.md" with { type: "text" }
import billingOperator from "../../docs/billing-operator.md" with { type: "text" }
import billingPlans from "../../docs/billing-plans.md" with { type: "text" }
import browserTests from "../../docs/browser-tests.md" with { type: "text" }
import capacity from "../../docs/capacity.md" with { type: "text" }
import catalog from "../../docs/catalog.md" with { type: "text" }
import certificates from "../../docs/certificates.md" with { type: "text" }
import dataExport from "../../docs/data-export.md" with { type: "text" }
import deploy from "../../docs/deploy.md" with { type: "text" }
import deployUpdates from "../../docs/deploy-updates.md" with { type: "text" }
import development from "../../docs/development.md" with { type: "text" }
import fileUploads from "../../docs/file-uploads.md" with { type: "text" }
import files from "../../docs/files.md" with { type: "text" }
import firstFeature from "../../docs/first-feature.md" with { type: "text" }
import getStarted from "../../docs/get-started.md" with { type: "text" }
import guests from "../../docs/guests.md" with { type: "text" }
import ids from "../../docs/ids.md" with { type: "text" }
import largeGroup from "../../docs/large-group.md" with { type: "text" }
import loadTests from "../../docs/load-tests.md" with { type: "text" }
import localStack from "../../docs/local-stack.md" with { type: "text" }
import offline from "../../docs/offline.md" with { type: "text" }
import offlineAppShell from "../../docs/offline-app-shell.md" with { type: "text" }
import offlineData from "../../docs/offline-data.md" with { type: "text" }
import offlineSignOut from "../../docs/offline-sign-out.md" with { type: "text" }
import offlineWrites from "../../docs/offline-writes.md" with { type: "text" }
import operatorAccess from "../../docs/operator-access.md" with { type: "text" }
import products from "../../docs/products.md" with { type: "text" }
import releases from "../../docs/releases.md" with { type: "text" }
import restore from "../../docs/restore.md" with { type: "text" }
import securityHeaders from "../../docs/security-headers.md" with { type: "text" }
import settings from "../../docs/settings.md" with { type: "text" }
import severalProjects from "../../docs/several-projects.md" with { type: "text" }
import signInProviders from "../../docs/sign-in-providers.md" with { type: "text" }
import startAProduct from "../../docs/start-a-product.md" with { type: "text" }
import telegram from "../../docs/telegram.md" with { type: "text" }

/** The docs' index. */
export const DOCS_PATH = `/docs`

/** The address of the website the docs' own pointer lines name (`docs/*.md`, the README). */
export const DOCS_SITE_ORIGIN = `https://seedsaas.com`

/** One published guide: its file under `docs/` without `.md`, and its line on the index. */
export interface PublishedDoc {
  slug: string
  summary: string
}

/**
 * The guides the website publishes at `/docs/<slug>`, in the groups and order of `docs/README.md`.
 * Every other file under `docs/` stays in the repository only: the handoff, the design and product
 * documents, the decisions, the once-per-server upgrade, the CI setup and the runtime policy. A file
 * listed here needs its import below, its line in `.dockerignore` and `infra/deploy/include.txt`,
 * and the pointer line at its top (`docs-site.test.ts` checks all four).
 */
export const PUBLISHED_DOCS: readonly { title: string; docs: readonly PublishedDoc[] }[] = [
  {
    title: `Get started`,
    docs: [
      { slug: `get-started`, summary: `Run Seed on your machine in four commands.` },
      {
        slug: `products`,
        summary: `Start a product, take Seed's later changes, give back to Seed.`,
      },
      { slug: `start-a-product`, summary: `What a new product deletes, replaces or sets.` },
      { slug: `local-stack`, summary: `Run Seed on your machine with demo data, and reset it.` },
      { slug: `first-feature`, summary: `A new kind of record, from the database to the screen.` },
      {
        slug: `ai-agents`,
        summary: `Have an AI agent create a product from Seed, add features and check its work.`,
      },
    ],
  },
  {
    title: `Guides`,
    docs: [
      { slug: `deploy`, summary: `From a fresh server to a healthy deployment with HTTPS.` },
      { slug: `deploy-updates`, summary: `Every deploy after the first, and rolling back.` },
      { slug: `certificates`, summary: `How each host gets its certificate, and retrying one.` },
      {
        slug: `operator-access`,
        summary: `The first administrator, roles, and opening Grafana.`,
      },
      { slug: `several-projects`, summary: `Products that share one server and one Traefik.` },
      { slug: `releases`, summary: `A version tag publishes the images to Docker Hub.` },
      { slug: `backups`, summary: `Turn on the daily backup, and rehearse it.` },
      { slug: `restore`, summary: `Bring back the database, the files and the push keys.` },
      { slug: `sign-in-providers`, summary: `Registering the providers and what a person gets.` },
      {
        slug: `guests`,
        summary:
          `"Try it now" without signing up, keeping the account, the limits and the clean-up.`,
      },
      { slug: `billing`, summary: `Paid plans through Stripe, test mode first, then live.` },
      { slug: `billing-plans`, summary: `Change a plan, add one, or add a limit a plan sells.` },
      {
        slug: `billing-operator`,
        summary: `The admin panel's Billing pages, transfers, and Stripe's dashboard.`,
      },
      { slug: `files`, summary: `Garage or another S3 store, its settings and the upload budget.` },
      {
        slug: `file-uploads`,
        summary: `Upload and download files from a feature, and have photos made safe and small.`,
      },
      { slug: `data-export`, summary: `Download my data, what the ZIP holds and how it expires.` },
      {
        slug: `catalog`,
        summary: `A shop's items with photos, colours and sizes, edited in the admin panel.`,
      },
      {
        slug: `telegram`,
        summary: `BotFather, the webhook, linking a chat, and adding a product's commands.`,
      },
      {
        slug: `offline`,
        summary: `Turn the offline layer or the WebSocket module off, or remove them.`,
      },
      { slug: `aggregates`, summary: `Every file of the notes aggregate, in order.` },
      { slug: `aggregate-offline`, summary: `Read, and write, an aggregate with no network.` },
      {
        slug: `aggregate-relations`,
        summary: `One aggregate naming another, with tags and notes as the example.`,
      },
      {
        slug: `aggregate-lifecycle`,
        summary: `Restore after delete, a move to another group, and the data export.`,
      },
      {
        slug: `aggregate-extras`,
        summary: `Group settings, the overview, the inbox and the rest of the app.`,
      },
      {
        slug: `admin-modules`,
        summary: `The operator area as a list of modules, and how to add one.`,
      },
      { slug: `load-tests`, summary: `Run the k6 scenarios and build a large test group.` },
      {
        slug: `browser-tests`,
        summary: `The Playwright specs in e2e/, and which of them CI runs.`,
      },
    ],
  },
  {
    title: `Concepts`,
    docs: [
      {
        slug: `apps`,
        summary: `The SPA, the admin app and the public website, and how to deploy each.`,
      },
      { slug: `ids`, summary: `Every id is a UUID version 7.` },
      { slug: `capacity`, summary: `How many users one server carries.` },
      {
        slug: `billing-lifecycle`,
        summary: `A group's plan from checkout to cancellation, and its mails.`,
      },
      {
        slug: `offline-data`,
        summary: `What the SPA keeps on the device and how it reads offline.`,
      },
      {
        slug: `offline-writes`,
        summary: `How a change made offline reaches the server, or is refused.`,
      },
      {
        slug: `offline-sign-out`,
        summary: `What the SPA deletes, and keeps, when a person signs out.`,
      },
      {
        slug: `offline-app-shell`,
        summary: `How the service worker starts the app with no network.`,
      },
      {
        slug: `attachments-and-pictures`,
        summary: `Files kept on a note, and a person's picture in place of their initials.`,
      },
      { slug: `large-group`, summary: `How one group behaves from a thousand notes to a million.` },
    ],
  },
  {
    title: `Reference`,
    docs: [
      { slug: `development`, summary: `Every deno task, what it does and where it is explained.` },
      { slug: `settings`, summary: `Every variable of the env file.` },
      { slug: `api-errors`, summary: `The one error body every failed API answer has.` },
      {
        slug: `security-headers`,
        summary: `The headers every answer of the API, SPA and MPA sends.`,
      },
    ],
  },
]

/** Each published guide's Markdown, by slug. */
const SOURCES: Readonly<Record<string, string>> = {
  "admin-modules": adminModules,
  "aggregate-extras": aggregateExtras,
  "aggregate-lifecycle": aggregateLifecycle,
  "aggregate-offline": aggregateOffline,
  "aggregate-relations": aggregateRelations,
  aggregates,
  "ai-agents": aiAgents,
  "api-errors": apiErrors,
  apps,
  "attachments-and-pictures": attachmentsAndPictures,
  backups,
  billing,
  "billing-lifecycle": billingLifecycle,
  "billing-operator": billingOperator,
  "billing-plans": billingPlans,
  "browser-tests": browserTests,
  capacity,
  catalog,
  certificates,
  "data-export": dataExport,
  deploy,
  "deploy-updates": deployUpdates,
  development,
  "file-uploads": fileUploads,
  files,
  "first-feature": firstFeature,
  "get-started": getStarted,
  guests,
  ids,
  "large-group": largeGroup,
  "load-tests": loadTests,
  "local-stack": localStack,
  offline,
  "offline-app-shell": offlineAppShell,
  "offline-data": offlineData,
  "offline-sign-out": offlineSignOut,
  "offline-writes": offlineWrites,
  "operator-access": operatorAccess,
  products,
  releases,
  restore,
  "security-headers": securityHeaders,
  settings,
  "several-projects": severalProjects,
  "sign-in-providers": signInProviders,
  "start-a-product": startAProduct,
  telegram,
}

/** One published guide, ready to draw. */
export interface SiteDoc {
  slug: string
  /** The file's `#` heading. */
  title: string
  /** The group it is listed under: `Get started`, `Guides`, `Concepts` or `Reference`. */
  group: string
  /** Its line on the index. */
  summary: string
  /** Its first sentence, at most 155 characters, for the meta description. */
  description: string
  /** The body as HTML, its links rewritten for the website (`rewriteDocLinks`). */
  html: string
  headings: MarkdownHeading[]
  minutes: number
  /** The file, from the repository's root. */
  source: string
  /** The file's last commit, ISO 8601, from `deno task changelog`; `undefined` without it. */
  updated?: string
}

/** A guide's pointer to its copy on the website, the line under its heading. */
export function pointerLine(slug: string): string {
  const url = `${DOCS_SITE_ORIGIN}${DOCS_PATH}/${slug}`
  return `> Also on the website: [${url.replace(`https://`, ``)}](${url}).`
}

/** Every published slug, in reading order. */
export const DOC_SLUGS: readonly string[] = PUBLISHED_DOCS.flatMap((group) =>
  group.docs.map(({ slug }) => slug)
)

const PUBLISHED = new Set(DOC_SLUGS)

/** Whether `slug` names a published guide. */
export function isPublishedDoc(slug: string): boolean {
  return PUBLISHED.has(slug)
}

/** An address that leaves this repository's files: another site, a mail, a protocol-relative one. */
const ELSEWHERE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** The external-link mark after a link to GitHub, as `SiteHeader` draws one: an arrow, hidden from readers. */
const EXTERNAL_MARK =
  `<span aria-hidden="true" data-doc-external=""> ↗</span><span class="sr-only"> (on GitHub)</span>`

/**
 * `html` with each link of the guide `docs/<slug>.md` pointed at its place on the website: a
 * published guide at `localize("/docs/<slug>")`, the API reference at its page, an anchor in the
 * page as it is, and any other file of the repository at that file on GitHub at `main`, marked as
 * leaving the site. Links to other sites are left alone.
 */
export function rewriteDocLinks(
  html: string,
  localize: (path: string) => string,
  self?: string,
): string {
  return html.replace(
    /<a href="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g,
    (link, href: string, rest, text) => {
      if (href.startsWith(`#`)) {
        return self === undefined ? link : `<a href="${siteAnchor(self, href)}"${rest}>${text}</a>`
      }
      if (ELSEWHERE.test(href)) return link
      const target = new URL(href.replaceAll(`&amp;`, `&`), `https://repo.invalid/docs/`)
      const path = decodeURIComponent(target.pathname)
      const doc = /^\/docs\/([^/]+)\.md$/.exec(path)?.[1]
      if (doc !== undefined && isPublishedDoc(doc)) {
        const hash = siteAnchor(doc, target.hash)
        return `<a href="${localize(`${DOCS_PATH}/${doc}`)}${hash}"${rest}>${text}</a>`
      }
      if (path === `/docs/token-api.md`) {
        return `<a href="${localize(API_DOCS_PATH)}${target.hash}"${rest}>${text}</a>`
      }
      const kind = path.endsWith(`/`) ? `tree` : `blob`
      const url = `${REPOSITORY_URL}/${kind}/main${target.pathname}${target.hash}`
      return `<a href="${url}" rel="noopener noreferrer"${rest}>${text}${EXTERNAL_MARK}</a>`
    },
  )
}

/** A heading's anchor as GitHub writes it: lower case, punctuation dropped, spaces as hyphens. */
function githubAnchor(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, ``).replace(/\s/g, `-`)
}

/** A guide's Markdown without its `#` heading and its pointer line, which the page draws itself. */
function docBody(source: string): string {
  return source.replace(/^# .*\n/m, ``).replace(/^> Also on the website: .*\n/m, ``)
}

const HEADINGS = new Map<string, MarkdownHeading[]>()

/**
 * `hash` (`#…` or empty) pointed at its heading in the published guide `slug`. The guides are
 * written for GitHub, whose anchors drop a `/` that the website's ids turn into a hyphen, so an
 * anchor that names no id here but matches a heading the GitHub way becomes that heading's id.
 */
function siteAnchor(slug: string, hash: string): string {
  const anchor = decodeURIComponent(hash.slice(1))
  if (anchor === ``) return hash
  let headings = HEADINGS.get(slug)
  if (!headings) HEADINGS.set(slug, headings = renderMarkdown(docBody(SOURCES[slug])).headings)
  if (headings.some(({ id }) => id === anchor)) return hash
  const heading = headings.find(({ text }) => githubAnchor(text) === anchor)
  return heading ? `#${heading.id}` : hash
}

/** The first sentence of `markdown`'s first paragraph, as plain text of at most 155 characters. */
export function firstSentence(markdown: string): string | undefined {
  const paragraph = markdown.split(/\n\s*\n/).map((block) => block.trim())
    .find((block) => block !== `` && !/^(?:#|>|\||[-*+] |\d+\. |```|<)/.test(block))
  if (paragraph === undefined) return undefined
  const text = paragraph.replace(/\s+/g, ` `)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, `$1`)
    .replace(/[`*_]/g, ``)
  const sentence = /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text
  if (sentence.length <= 155) return sentence
  return `${sentence.slice(0, 154).replace(/\s+\S*$/, ``)}…`
}

const CACHE = new Map<string, SiteDoc>()

/**
 * The published guide `slug`, rendered for the page in the language `localize` writes addresses
 * in, or `undefined` for any other name: an internal doc answers 404 like an unknown one.
 */
export function readDoc(slug: string, localize: (path: string) => string): SiteDoc | undefined {
  if (!isPublishedDoc(slug)) return undefined
  const key = `${localize(``)}:${slug}`
  const cached = CACHE.get(key)
  if (cached) return cached
  const source = SOURCES[slug]
  const group = PUBLISHED_DOCS.find((entry) => entry.docs.some((doc) => doc.slug === slug))!
  const title = /^# (.+)$/m.exec(source)?.[1].trim() ?? slug
  const body = docBody(source)
  const { html, headings } = renderMarkdown(body)
  const path = `docs/${slug}.md`
  const doc: SiteDoc = {
    slug,
    title,
    group: group.title,
    summary: group.docs.find((entry) => entry.slug === slug)!.summary,
    description: firstSentence(body) ?? `${title}: how it works in Seed, and how to set it up.`,
    html: rewriteDocLinks(html, localize, slug),
    headings,
    minutes: readingMinutes(body),
    source: path,
    updated: CHANGELOG.docs[path],
  }
  CACHE.set(key, doc)
  return doc
}

/** The docs' side list, every published guide under its group, in `localize`'s language. */
export function docsNavGroups(localize: (path: string) => string): DocsNavGroup[] {
  return PUBLISHED_DOCS.map((group) => ({
    title: group.title,
    items: group.docs.map(({ slug }) => ({
      href: localize(`${DOCS_PATH}/${slug}`),
      title: readDoc(slug, localize)!.title,
    })),
  }))
}

/** The guides before and after `slug` in reading order, across the groups. */
export function docNeighbours(slug: string): { previous?: string; next?: string } {
  const index = DOC_SLUGS.indexOf(slug)
  return {
    previous: index > 0 ? DOC_SLUGS[index - 1] : undefined,
    next: index >= 0 && index < DOC_SLUGS.length - 1 ? DOC_SLUGS[index + 1] : undefined,
  }
}
