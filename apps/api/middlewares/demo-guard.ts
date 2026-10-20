import type { Context, MiddlewareHandler } from "hono"
import {
  BodyReadTimeoutError,
  PayloadTooLargeError,
  readBoundedBody,
} from "@spy4x/net/bounded-body"
import { JSON_BODY_TIMEOUT, JSON_BODY_TOO_LARGE } from "@spy4x/server/http/bounded-body"
import type { APIContext } from "../_types.ts"
import { MAX_JSON_BODY_BYTES } from "../services/json-body.ts"

/** Why a shared demo account may not do what it asked. */
export const DEMO_ACCOUNT_REFUSAL =
  `This is the shared demo account, so it cannot change its password, e-mail, sign-in methods or sessions, or be deleted. Create your own account to try this.`

/** Why a shared demo account may not mail an invitation. */
export const DEMO_INVITATION_MAIL_REFUSAL =
  `The shared demo account cannot mail invitations. Create the invitation without mail and copy its link instead.`

/**
 * What the shared account may not do to itself, by method and path: anything that would lock the
 * next visitor out or sign them out (password, address, second factor, sign-in providers,
 * sessions, deletion).
 */
const OWN_ACCOUNT_ROUTES: readonly [string, RegExp][] = [
  [`POST`, /^\/api\/auth\/password\/(change|set)$/],
  [`POST`, /^\/api\/auth\/email\/(send|verify|change)$/],
  [`POST`, /^\/api\/auth\/totp\/connect\/(start|finish)$/],
  [`POST`, /^\/api\/auth\/totp\/disconnect$/],
  [`DELETE`, /^\/api\/auth\/sessions\/[^/]+$/],
  [`POST`, /^\/api\/auth\/account\/delete$/],
  [`POST`, /^\/api\/auth\/methods\/[^/]+\/link$/],
  [`DELETE`, /^\/api\/auth\/methods\/[^/]+$/],
]

/** A new invitation of a group. */
const INVITATION_CREATE = /^\/api\/groups\/[^/]+\/invitations$/

/** Answers which of `userIds` are the shared demo account (`demoAccountIds`). */
export type DemoAccountLookup = (userIds: readonly number[]) => Promise<Set<number>>

/**
 * Guards the public demo's shared account (docs/demo.md), mounted only while `DEMO_MODE` is on.
 * Every visitor signs in to the same account, so one visitor must not be able to lock the others
 * out, sign them out or mail strangers from it:
 *
 * - the shared account may not change its password, address, second factor or sign-in providers,
 *   end sessions or delete itself;
 * - the shared account may not mail an invitation (a link without mail still works).
 *
 * A refusal is a 403 with a message the screens show. Everything else, including every other
 * request of the shared account, passes; the nightly wipe undoes it.
 */
export function createDemoGuard(isDemo: DemoAccountLookup): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const method = c.req.method
    const path = c.req.path
    const actorId = c.get(`auth`)?.user.id ?? null
    if (actorId === null) return await next()

    if (OWN_ACCOUNT_ROUTES.some(([m, pattern]) => m === method && pattern.test(path))) {
      if ((await isDemo([actorId])).size > 0) return c.json({ error: DEMO_ACCOUNT_REFUSAL }, 403)
    } else if (method === `POST` && INVITATION_CREATE.test(path)) {
      const body = await readAndKeepBody(c)
      if (body instanceof Response) return body
      const mails = body?.sendEmail === true
      if (mails && (await isDemo([actorId])).size > 0) {
        return c.json({ error: DEMO_INVITATION_MAIL_REFUSAL }, 403)
      }
    }
    await next()
  }
}

/**
 * Reads the JSON body under the routes' own cap ({@link MAX_JSON_BODY_BYTES}), so a huge body is
 * never buffered here, and puts the bytes back on the request for the route to read. A body over
 * the cap or one that stalls is answered here, as the route would. Not JSON → `null`; the route
 * refuses it.
 */
async function readAndKeepBody(
  c: Context<APIContext>,
): Promise<Record<string, unknown> | null | Response> {
  let bytes: Uint8Array
  try {
    bytes = await readBoundedBody(c.req.raw, { maxBytes: MAX_JSON_BODY_BYTES })
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return c.json({ error: JSON_BODY_TOO_LARGE }, 413)
    if (error instanceof BodyReadTimeoutError) return c.json({ error: JSON_BODY_TIMEOUT }, 408)
    throw error
  }
  c.req.raw = new Request(c.req.raw, { body: bytes as Uint8Array<ArrayBuffer> })
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return typeof parsed === `object` ? parsed : null
  } catch {
    return null
  }
}
