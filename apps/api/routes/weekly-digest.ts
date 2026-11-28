import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { createSameOriginMutationGuard } from "@spy4x/server/http/same-origin"
import {
  TOKEN_PAGE_HEADERS,
  UNSUBSCRIBE_FORM_MAX_BYTES,
  unsubscribeTokenFrom,
} from "@spy4x/server/subscribers"
import { WEEKLY_DIGEST_TOKEN_MAX_LENGTH } from "@domain/notifications"
import {
  WEEKLY_DIGEST_UNSUBSCRIBE_PAGE,
  type WeeklyDigestTokens,
} from "@server/notifications/weekly-digest.ts"
import type { APIContext } from "../_types.ts"
import { errorResponse } from "../services/error-response.ts"

export const WEEKLY_DIGEST_LINKS_OFF = `Weekly digest links are off`
export const WEEKLY_DIGEST_LINK_NOT_RECOGNISED = `This link is not recognised.`

export interface WeeklyDigestRouteDependencies {
  /**
   * Checks unsubscribe tokens; `null` when `SUBSCRIBERS_SECRET` is not set in production, and no
   * digest is sent then: every route answers 503.
   */
  tokens: WeeklyDigestTokens | null
  /** The app's own address, as `config.webAppUrl`. */
  webAppUrl: string
  /** The per-IP budget of every link that carries a token, shared with the newsletter's links. */
  tokenByIp: MiddlewareHandler<APIContext>
  /** Turns `userId`'s digest off; doing so again, or for an account that is gone, is fine. */
  turnOff(userId: number): Promise<void>
}

/**
 * The weekly digest's signed unsubscribe link, at `/api/weekly-digest`, without a session:
 *
 * - `GET /unsubscribe?token=…` is the link in the mail: it redirects a person to the app's page
 *   {@link WEEKLY_DIGEST_UNSUBSCRIBE_PAGE}, which asks before it posts.
 * - `POST /unsubscribe` turns the digest off: the target of a mail client's one-click POST (RFC
 *   8058), which carries no browser header, and of that page. The token is read from the query or
 *   a form body. A valid token answers `{ state: "done" }` whether the digest was on, already off,
 *   or its account is gone, so the answer tells nothing about an account. Any other token is
 *   refused as not recognised and changes nothing.
 *
 * Every response carries `Cache-Control: no-store`.
 */
export function createWeeklyDigestRoute(deps: WeeklyDigestRouteDependencies): Hono<APIContext> {
  const oneClick = createSameOriginMutationGuard<APIContext>({
    expectedOrigin: new URL(deps.webAppUrl).origin,
    requireSessionCookie: false,
    allowHeaderless: true,
  })
  const noStore = (c: Context<APIContext>) => {
    c.header(`Cache-Control`, TOKEN_PAGE_HEADERS[`Cache-Control`])
  }
  return new Hono<APIContext>()
    .use(`*`, async (c, next) => {
      noStore(c)
      if (!deps.tokens) {
        return errorResponse(c, `internal`, { message: WEEKLY_DIGEST_LINKS_OFF, status: 503 })
      }
      await next()
    })
    .get(`/unsubscribe`, (c) => {
      const token = c.req.query(`token`)
      const query = token && token.length <= WEEKLY_DIGEST_TOKEN_MAX_LENGTH
        ? `?${new URLSearchParams({ token })}`
        : ``
      return c.redirect(`${deps.webAppUrl}${WEEKLY_DIGEST_UNSUBSCRIBE_PAGE}${query}`, 303)
    })
    .post(`/unsubscribe`, oneClick, deps.tokenByIp, async (c) => {
      const token = await unsubscribeTokenFrom(c.req.raw, { maxBytes: UNSUBSCRIBE_FORM_MAX_BYTES })
      const userId = token === null ? null : await deps.tokens!.verify(token)
      if (userId === null) {
        return errorResponse(c, `not_found`, {
          message: WEEKLY_DIGEST_LINK_NOT_RECOGNISED,
          status: 404,
          reason: `not-recognised`,
        })
      }
      await deps.turnOff(userId)
      return c.json({ state: `done` })
    })
}
