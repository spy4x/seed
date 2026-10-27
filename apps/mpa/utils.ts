import { createDefine } from "fresh"
import type { PublicContactLink } from "@domain/contact-links"
import type { Api } from "./api.ts"
import type { AnalyticsConfig } from "./config.ts"

/** What the middleware hands every route. */
export interface State {
  /** The API, called on behalf of this request. */
  api: Api
  /** The origin the browser sees this app at, as `MpaConfig.webAppOrigin`: links start with it. */
  webAppOrigin: string
  /** The origin of the SPA, the product itself, as `MpaConfig.apiOrigin`: links to the app use it. */
  spaOrigin: string
  /** Whether the API takes newsletter subscriptions; `false` hides every newsletter form. */
  newsletter: boolean
  /**
   * Whether the blog has a live post (`blogLinkMiddleware`); `false` hides the Blog link and the
   * RSS link from every page.
   */
  blog?: boolean
  /**
   * Where people reach the product (`contactLinksMiddleware`), in the operator's order; the footer
   * lists them and the home page's structured data names them. Missing or empty shows none.
   */
  contactLinks?: readonly PublicContactLink[]
  /** Where page views and events go; `undefined` leaves the tracker out of every page. */
  analytics?: AnalyticsConfig
}

export const define = createDefine<State>()
