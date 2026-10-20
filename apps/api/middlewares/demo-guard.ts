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

/** Why an operator may not act on a shared demo account. */
export const DEMO_TARGET_REFUSAL =
  `This is a shared demo account, so it cannot be blocked, signed out, sent a reset or given another role.`

/** Why a shared demo account may not mail an invitation. */
export const DEMO_INVITATION_MAIL_REFUSAL =
  `The shared demo account cannot mail invitations. Create the invitation without mail and copy its link instead.`

/** Why the demo operator may not act on a real person's account. */
export const DEMO_REAL_PERSON_REFUSAL =
  `In the public demo, real people's accounts are hidden from the operator, so they cannot be blocked, signed out, sent a reset or given another role. Try it on one of the example.com people.`

/** Why the demo operator may not mail or remove a real newsletter subscriber. */
export const DEMO_REAL_SUBSCRIBER_REFUSAL =
  `In the public demo, real subscribers are hidden from the operator, so they cannot be mailed or removed. Try it on one of the example.com subscribers.`

/**
 * What a shared account may not do to itself, by method and path: anything that would lock the
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

/** An operator's action on one person; the first group is the person's id. */
const ADMIN_USER_ACTION =
  /^\/api\/admin\/users\/(\d+)\/(role|block|unblock|password-reset|sessions\/end|sessions\/\d+\/end)$/

/** A new invitation of a group. */
const INVITATION_CREATE = /^\/api\/groups\/[^/]+\/invitations$/

/** An operator's action on one newsletter subscriber, whose body carries the `email`. */
const ADMIN_SUBSCRIBER_ACTION = /^\/api\/admin\/newsletter\/subscribers\/(resend|remove)$/

/** Answers which of `userIds` match: the shared accounts (`demoAccountIds`) or real people (`realPersonIds`). */
export type DemoAccountLookup = (userIds: readonly number[]) => Promise<Set<number>>

/** What the guard looks up. */
export interface DemoGuardLookups {
  isDemo: DemoAccountLookup
  isRealPerson: DemoAccountLookup
}

/**
 * Guards the public demo's shared accounts (docs/demo.md), mounted only while `DEMO_MODE` is on.
 * Every visitor signs in to the same two accounts, so one visitor must not be able to lock the
 * others out, sign them out or mail strangers from them:
 *
 * - a shared account may not change its password, address, second factor or sign-in providers,
 *   end sessions or delete itself;
 * - an operator may not block, sign out, reset or change the role of a shared account;
 * - a shared account may not mail an invitation (a link without mail still works);
 * - an operator may not act on, mail or remove a real person (an address outside example.com),
 *   because the operator's password is public; `createDemoAdminMask` hides their addresses too.
 *
 * A refusal is a 403 with a message the screens show. Everything else, including every other
 * request of a shared account, passes; the nightly wipe undoes it.
 */
export function createDemoGuard(
  { isDemo, isRealPerson }: DemoGuardLookups,
): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const method = c.req.method
    const path = c.req.path
    const actorId = c.get(`auth`)?.user.id ?? null

    const reads = method === `POST` &&
      (INVITATION_CREATE.test(path) || ADMIN_SUBSCRIBER_ACTION.test(path))
    const body = reads ? await readAndKeepBody(c) : null
    if (body instanceof Response) return body
    if (method === `POST` && ADMIN_SUBSCRIBER_ACTION.test(path)) {
      const email = typeof body?.email === `string` ? body.email : ``
      if (!isExampleAddress(email)) return c.json({ error: DEMO_REAL_SUBSCRIBER_REFUSAL }, 403)
    }

    const target = method === `POST` ? ADMIN_USER_ACTION.exec(path) : null
    if (target) {
      const id = Number(target[1])
      if ((await isDemo([id])).size > 0) return c.json({ error: DEMO_TARGET_REFUSAL }, 403)
      if ((await isRealPerson([id])).size > 0) {
        return c.json({ error: DEMO_REAL_PERSON_REFUSAL }, 403)
      }
    }
    if (actorId === null) return await next()

    if (OWN_ACCOUNT_ROUTES.some(([m, pattern]) => m === method && pattern.test(path))) {
      if ((await isDemo([actorId])).size > 0) return c.json({ error: DEMO_ACCOUNT_REFUSAL }, 403)
    } else if (method === `POST` && INVITATION_CREATE.test(path)) {
      const mails = body?.sendEmail === true
      if (mails && (await isDemo([actorId])).size > 0) {
        return c.json({ error: DEMO_INVITATION_MAIL_REFUSAL }, 403)
      }
    }
    await next()
  }
}

/** Whether `email` is at example.com, the domain of the demo's own made-up people. */
export function isExampleAddress(email: string): boolean {
  return /@example\.com$/i.test(email.trim())
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
