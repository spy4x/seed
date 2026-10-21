import { FORM_ACTIONS } from "@ui/progressive.tsx"

/** What the MPA needs to know about its surroundings. */
export interface MpaConfig {
  /** Where the MPA reaches the API from the server, such as `http://app-api:8000`. Never a browser URL. */
  apiUrl: string
  /**
   * The origin the browser sees the MPA at, such as `https://www.example.com`, from `MPA_DOMAIN`.
   * The MPA refuses a post from any other origin.
   */
  webAppOrigin: string
  /**
   * The origin the API accepts posts from, such as `https://app.example.com`: the value the API
   * derives from `ENV` and `DOMAIN`, where the SPA is served.
   */
  apiOrigin: string
  /** Where page views and events go, or `undefined` when the website runs without analytics. */
  analytics?: AnalyticsConfig
}

/**
 * A self-hosted Umami (`docs/analytics.md`): its origin, which serves `/script.js` and takes the
 * events, and the website's id there. The id is public: it is written into every page.
 */
export interface AnalyticsConfig {
  origin: string
  websiteId: string
}

/** Who `robots.txt` lets in, and where no crawler goes. */
export interface RobotsPolicy {
  /**
   * Crawlers named in a group of their own, each allowed everything but {@link disallow}. A
   * crawler obeys only the group that names it, so each group repeats the disallowed paths.
   */
  allowBots: readonly string[]
  /** Paths no crawler fetches, such as the one-time links a newsletter mails. */
  disallow: readonly string[]
}

/**
 * The website's crawler policy: every crawler is let in, and the AI search bots are named so the
 * choice is plain to read. `Google-Extended` is never blocked: it also decides whether Gemini may
 * use the site in its answers. A product built on Seed changes this to choose differently.
 */
// Seed's own site: see docs/start-a-product.md
export const ROBOTS_POLICY: RobotsPolicy = {
  allowBots: [`OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `Bingbot`],
  disallow: [FORM_ACTIONS.subscribeConfirm, FORM_ACTIONS.unsubscribe],
}

/**
 * Reads the configuration from the environment: `ENV`, `DOMAIN` (as the API reads them), `API_URL`
 * and `MPA_DOMAIN`, and the optional pair `MPA_UMAMI_ORIGIN` and `MPA_UMAMI_WEBSITE_ID`. Throws
 * when a required one is missing, when `MPA_DOMAIN` carries a scheme (it would become the host
 * `https`), or when only one of the Umami pair is set, so a misconfigured MPA refuses to start.
 */
export function readMpaConfig(env: { get(name: string): string | undefined }): MpaConfig {
  const required = (name: string): string => {
    const value = env.get(name)
    if (!value) throw new Error(`${name} is required: the MPA cannot start without it`)
    return value
  }
  const scheme = required("ENV") === "dev" ? "http" : "https"
  if (required("MPA_DOMAIN").includes("://")) {
    throw new Error("MPA_DOMAIN must be a host such as www.example.com, without a scheme")
  }
  const apiOrigin = new URL(`${scheme}://${required("DOMAIN")}`).origin
  return {
    apiUrl: new URL(required("API_URL")).origin,
    webAppOrigin: new URL(`${scheme}://${required("MPA_DOMAIN")}`).origin,
    apiOrigin,
    analytics: readAnalytics(env),
  }
}

/** Both Umami values, or neither: one alone is a mistake, not a choice to turn analytics off. */
function readAnalytics(
  env: { get(name: string): string | undefined },
): AnalyticsConfig | undefined {
  const origin = env.get("MPA_UMAMI_ORIGIN") ?? ""
  const websiteId = env.get("MPA_UMAMI_WEBSITE_ID") ?? ""
  if (!origin && !websiteId) return undefined
  if (!origin || !websiteId) {
    throw new Error("MPA_UMAMI_ORIGIN and MPA_UMAMI_WEBSITE_ID are set together or not at all")
  }
  const url = URL.parse(origin)
  if (url?.protocol !== "https:" && url?.protocol !== "http:") {
    throw new Error("MPA_UMAMI_ORIGIN must be an address such as https://stats.example.com")
  }
  return { origin: url.origin, websiteId }
}
