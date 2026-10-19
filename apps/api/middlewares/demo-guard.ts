import type { MiddlewareHandler } from "hono"
import type { APIContext } from "../_types.ts"

/** Why a shared demo account may not do what it asked. */
export const DEMO_ACCOUNT_REFUSAL =
  `This is the shared demo account, so it cannot change its password, e-mail, sign-in methods or sessions, or be deleted. Create your own account to try this.`

/** Why an operator may not act on a shared demo account. */
export const DEMO_TARGET_REFUSAL =
  `This is a shared demo account, so it cannot be blocked, signed out, sent a reset or given another role.`

/** Why a shared demo account may not mail an invitation. */
export const DEMO_INVITATION_MAIL_REFUSAL =
  `The shared demo account cannot mail invitations. Create the invitation without mail and copy its link instead.`

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

/** Answers which of `userIds` are shared demo accounts (`demoAccountIds`). */
export type DemoAccountLookup = (userIds: readonly number[]) => Promise<Set<number>>

/**
 * Guards the public demo's shared accounts (docs/demo.md), mounted only while `DEMO_MODE` is on.
 * Every visitor signs in to the same two accounts, so one visitor must not be able to lock the
 * others out, sign them out or mail strangers from them:
 *
 * - a shared account may not change its password, address, second factor or sign-in providers,
 *   end sessions or delete itself;
 * - an operator may not block, sign out, reset or change the role of a shared account;
 * - a shared account may not mail an invitation (a link without mail still works).
 *
 * A refusal is a 403 with a message the screens show. Everything else, including every other
 * request of a shared account, passes; the nightly wipe undoes it.
 */
export function createDemoGuard(isDemo: DemoAccountLookup): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const method = c.req.method
    const path = c.req.path
    const actorId = c.get(`auth`)?.user.id ?? null

    const target = method === `POST` ? ADMIN_USER_ACTION.exec(path) : null
    if (target && (await isDemo([Number(target[1])])).size > 0) {
      return c.json({ error: DEMO_TARGET_REFUSAL }, 403)
    }
    if (actorId === null) return await next()

    if (OWN_ACCOUNT_ROUTES.some(([m, pattern]) => m === method && pattern.test(path))) {
      if ((await isDemo([actorId])).size > 0) return c.json({ error: DEMO_ACCOUNT_REFUSAL }, 403)
    } else if (method === `POST` && INVITATION_CREATE.test(path)) {
      // Read from a copy, so the route still reads the body itself.
      const body = await c.req.raw.clone().json().catch(() => null)
      const mails = typeof body === `object` && body !== null && body.sendEmail === true
      if (mails && (await isDemo([actorId])).size > 0) {
        return c.json({ error: DEMO_INVITATION_MAIL_REFUSAL }, 403)
      }
    }
    await next()
  }
}
