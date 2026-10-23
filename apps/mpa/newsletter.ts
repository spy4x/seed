import { isRecord } from "@spy4x/platform/universal/is-record"
import { type ApiFlag, type ApiFlagOptions, createApiFlag } from "./api-flag.ts"

/** What the website knows about the newsletter; see {@link ApiFlag}. */
export type NewsletterStatus = ApiFlag

/**
 * Whether the API takes newsletter subscriptions (`GET /api/subscribers`), so that no page offers
 * a form the API would refuse. The API is asked at most once per `ttlMs`.
 *
 * When the API cannot be reached, or answers something else, the last answer stands. Before any
 * answer the newsletter counts as on: the form then shows the API's own refusal.
 */
export function createNewsletterStatus(
  options: Omit<ApiFlagOptions, "path" | "initial" | "read">,
): NewsletterStatus {
  return createApiFlag({
    ...options,
    path: `/api/subscribers`,
    initial: true,
    read: (body) => isRecord(body) && typeof body.enabled === "boolean" ? body.enabled : undefined,
  })
}
