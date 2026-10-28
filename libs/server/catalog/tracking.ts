import { checkUmami, createUmamiLink, umamiLinkUrl } from "@spy4x/integrations/umami"
import { randomBase64Url } from "@spy4x/platform/tokens"
import { catalogTaggedItemUrl } from "@domain/catalog"
import type { TrackingTarget } from "./public-catalog.ts"

/** The website's item address when `CATALOG_ITEM_PATH` is unset: `/<category>/<item>`. */
export const DEFAULT_ITEM_PATH = `/{category}/{slug}`

/** How long Umami's answer to a heartbeat is trusted before it is asked again. */
export const UMAMI_CHECK_TTL_MS = 60_000

/** How long a visitor's redirect waits for Umami's heartbeat before going straight to the item. */
export const UMAMI_CHECK_TIMEOUT_MS = 1_500

/** Where the self-hosted Umami is, and the token that creates links. The token is never logged. */
export interface UmamiSetup {
  url: string
  token: string
}

/** How tracking links are made (#483, docs/catalog.md). */
export interface TrackingSetup {
  /** The website's origin, from `MPA_DOMAIN`: `/s/<code>` and the item pages are on it. */
  siteUrl: string
  /** The website's item address, with `{category}` and `{slug}` in it (`CATALOG_ITEM_PATH`). */
  itemPath: string
  /** `null` while `UMAMI_API_URL` and `UMAMI_API_TOKEN` are unset: links go straight to the item. */
  umami: UmamiSetup | null
}

/**
 * Reads how tracking links are made: `CATALOG_ITEM_PATH` (default {@link DEFAULT_ITEM_PATH}),
 * and the pair `UMAMI_API_URL` and `UMAMI_API_TOKEN`. Answers `null` while the website has no
 * address (`siteUrl`, from `MPA_DOMAIN`): a link needs one. Throws, so the API stops at start, on a
 * path that does not start with `/` or lacks `{slug}`, an Umami address that is no `http`/`https`
 * URL, or one of the Umami pair without the other. No error names the token.
 */
export function readTrackingSetup(
  env: { get(name: string): string | undefined },
  siteUrl: string | null,
): TrackingSetup | null {
  const itemPath = env.get(`CATALOG_ITEM_PATH`)?.trim() || DEFAULT_ITEM_PATH
  if (!itemPath.startsWith(`/`) || itemPath.startsWith(`//`) || !itemPath.includes(`{slug}`)) {
    throw new Error(
      `CATALOG_ITEM_PATH must start with / and hold {slug}, such as /{category}/{slug}`,
    )
  }
  const url = env.get(`UMAMI_API_URL`)?.trim() ?? ``
  const token = env.get(`UMAMI_API_TOKEN`)?.trim() ?? ``
  if ((url === ``) !== (token === ``)) {
    throw new Error(`Set both UMAMI_API_URL and UMAMI_API_TOKEN, or neither`)
  }
  if (url !== ``) {
    let parsed: URL | null = null
    try {
      parsed = new URL(url)
    } catch {
      // Named below.
    }
    if (!parsed || (parsed.protocol !== `https:` && parsed.protocol !== `http:`)) {
      throw new Error(
        `UMAMI_API_URL must be an http or https address, such as https://stats.example.com`,
      )
    }
  }
  if (siteUrl === null) return null
  return { siteUrl, itemPath, umami: url === `` ? null : { url, token } }
}

/** A new link's code: 11 random URL-safe characters, public, so no secret. */
export function newLinkCode(): string {
  return randomBase64Url(8)
}

/** What the catalog asks of Umami. */
export interface UmamiLinks {
  /**
   * Makes Umami's link `id` with `slug`, which counts a visit and sends it to `url`. Idempotent for
   * one id. Answers whether Umami holds it; a failure is logged without the token.
   */
  create(link: { id: string; name: string; url: string; slug: string }): Promise<boolean>
  /** The address that counts a visit: `<umami>/q/<slug>`. */
  address(slug: string): string
  /** Whether Umami answered its heartbeat lately; asked at most once a minute. */
  isUp(): Promise<boolean>
}

/** {@link UmamiLinks} over the self-hosted Umami of `setup`. */
export function createUmamiLinks(
  setup: UmamiSetup,
  {
    fetch = globalThis.fetch,
    now = Date.now,
    log = console.error,
  }: { fetch?: typeof globalThis.fetch; now?: () => number; log?: (line: string) => void } = {},
): UmamiLinks {
  let checked: { at: number; up: Promise<boolean> } | null = null
  return {
    async create(link) {
      const result = await createUmamiLink({
        baseUrl: setup.url,
        token: setup.token,
        fetch,
        ...link,
      })
      if (!result.success) log(`Umami link ${link.id} not created: ${result.error}`)
      return result.success
    },
    address: (slug) => umamiLinkUrl(setup.url, slug),
    isUp() {
      if (checked === null || now() - checked.at >= UMAMI_CHECK_TTL_MS) {
        // Every redirect in the minute shares this one answer, a pending one included.
        checked = {
          at: now(),
          up: checkUmami({ baseUrl: setup.url, fetch, requestTimeoutMs: UMAMI_CHECK_TIMEOUT_MS })
            .then((result) => result.success),
        }
      }
      return checked.up
    },
  }
}

/** A link's short address on the website: `https://<site>/s/<code>`. */
export function trackingLinkUrl(siteUrl: string, code: string): string {
  return new URL(`/s/${encodeURIComponent(code)}`, siteUrl).href
}

/**
 * Where Umami sends a visit after counting it: back to the short address, marked `counted=1`, so
 * the website then goes straight to the item. Umami's link never names the item, so renaming the
 * item, its category or the source never leaves an Umami link pointing at an old address.
 */
export function umamiTargetUrl(siteUrl: string, code: string): string {
  return `${trackingLinkUrl(siteUrl, code)}?counted=1`
}

/** Umami's limit for a link's name, counted as JavaScript counts. */
const UMAMI_NAME_MAX = 100

/** The link's name in Umami's list: `<item> · <source>`, cut to Umami's 100 characters. */
export function umamiLinkName(itemName: string, sourceName: string): string {
  let name = `${itemName} · ${sourceName}`
  while (name.length > UMAMI_NAME_MAX) name = Array.from(name).slice(0, -1).join(``)
  return name
}

/**
 * Where `/s/<code>` sends a visitor: through Umami, which counts the click, when Umami holds the
 * link and answers; else, or once Umami has `counted` the visit, straight to the item's page tagged
 * with the source. The address is built here from the item's own slug, never from the request, and
 * is always on the website (`null` otherwise).
 */
export async function trackingLocation(
  target: TrackingTarget,
  setup: TrackingSetup,
  umami: UmamiLinks | null,
  counted: boolean,
): Promise<string | null> {
  const direct = catalogTaggedItemUrl(setup.siteUrl, setup.itemPath, {
    itemSlug: target.itemSlug,
    categorySlug: target.categorySlug,
    sourceSlug: target.sourceSlug,
  })
  if (direct === null) return null
  if (!counted && umami !== null && target.umamiLinkId !== null && await umami.isUp()) {
    return umami.address(target.code)
  }
  return direct
}
