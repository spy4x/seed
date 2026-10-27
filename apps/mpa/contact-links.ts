import { type } from "arktype"
import {
  CONTACT_KIND_NAMES,
  contactHref,
  contactJsonLd,
  contactKind,
  contactValueProblem,
} from "@spy4x/platform/universal/contact"
import type { PublicContactLink } from "@domain/contact-links"
import { createApiValue } from "./api-flag.ts"
import type { MpaConfig } from "./config.ts"
import { SITE_NAME } from "./brand.ts"
import { define } from "./utils.ts"

const linksAnswer = type({
  links: type({ kind: contactKind, value: `string`, label: `string | null` }).array(),
})

/**
 * The links of the API's answer, or `undefined` when the body is not one. A link whose value its
 * kind refuses is left out, so one bad row never breaks a page.
 */
export function readContactLinks(body: unknown): PublicContactLink[] | undefined {
  const answer = linksAnswer(body)
  if (answer instanceof type.errors) return undefined
  return answer.links.filter((link) => contactValueProblem(link.kind, link.value) === null)
}

/** The words a link shows: its label, else its channel and value, such as `Telegram: my_shop`. */
export function contactLinkText(link: PublicContactLink): string {
  if (link.label) return link.label
  if (link.kind === `phone` || link.kind === `email`) return link.value
  if (link.kind === `url`) return new URL(link.value).host
  return `${CONTACT_KIND_NAMES[link.kind]}: ${link.value}`
}

/** One footer link of each contact link, in order; a web link opens as an outside page. */
export function contactFooterLinks(
  links: readonly PublicContactLink[],
): { label: string; href: string; external?: boolean }[] {
  return links.map((link) => {
    const href = contactHref(link.kind, link.value)
    return {
      label: contactLinkText(link),
      href,
      ...(href.startsWith(`https:`) && { external: true }),
    }
  })
}

/** The id of the organization behind the website, in its structured data. */
export function organizationId(origin: string): string {
  return `${origin}/#organization`
}

/**
 * The organization behind the website, with its contact links: profiles in `sameAs`, numbers and
 * addresses in `contactPoint`. `null` while there are no links, so the page draws no empty node.
 */
export function organizationJsonLd(
  origin: string,
  links: readonly PublicContactLink[],
): unknown | null {
  if (links.length === 0) return null
  return {
    "@type": `Organization`,
    "@id": organizationId(origin),
    name: SITE_NAME,
    url: `${origin}/`,
    ...contactJsonLd(links),
  }
}

/**
 * Hands every page the contact links (`State.contactLinks`), for the footer and the home page's
 * structured data. The API is asked once before the first page, then at most once a minute in the
 * background, so a change in the admin app shows within a minute without a deploy. Until it has
 * answered, and while it cannot be reached before its first answer, there are none.
 */
export async function contactLinksMiddleware(
  config: Pick<MpaConfig, "apiUrl">,
  fetch: typeof globalThis.fetch = globalThis.fetch,
) {
  const links = createApiValue<PublicContactLink[]>({
    apiUrl: config.apiUrl,
    path: `/api/contact-links`,
    initial: [],
    read: readContactLinks,
    fetch,
  })
  await links.refresh()
  return define.middleware((ctx) => {
    ctx.state.contactLinks = links.current()
    return ctx.next()
  })
}
