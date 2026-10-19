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

/** Why the demo refuses an address outside example.com. */
export const DEMO_ADDRESS_REFUSAL =
  `The public demo takes only made-up addresses at example.com, such as ada@example.com, because anyone can sign in as its operator and see them.`

/** Why the demo refuses a sign-up with a real address; a made-up one would never get its code. */
export const DEMO_SIGN_UP_REFUSAL =
  `The public demo does not take real e-mail addresses, because anyone can sign in as its operator and see them. Sign in with the shared demo account instead.`

/** The only domain the demo stores addresses of: no real person's, so the public operator sees none. */
const DEMO_ADDRESS_DOMAIN = `@example.com`

/** A sign-up with a password, whose body carries the new account's `email`. */
const SIGN_UP = /^\/api\/auth\/password\/sign-up$/

/** Requests whose JSON body carries an `email` the demo stores, by path (all are POST). */
const ADDRESS_ROUTES: readonly RegExp[] = [
  SIGN_UP,
  /^\/api\/auth\/email\/change$/,
  /^\/api\/subscribers$/,
  /^\/api\/groups\/[^/]+\/invitations$/,
]

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
 * - a shared account may not mail an invitation (a link without mail still works);
 * - nobody may give the demo an address outside example.com (sign-up, address change, newsletter,
 *   invitation), because the operator's password is public and the admin panel lists and exports
 *   every address.
 *
 * A refusal is a 403 with a message the screens show. Everything else, including every other
 * request of a shared account, passes; the nightly wipe undoes it.
 */
export function createDemoGuard(isDemo: DemoAccountLookup): MiddlewareHandler<APIContext> {
  return async (c, next) => {
    const method = c.req.method
    const path = c.req.path
    const actorId = c.get(`auth`)?.user.id ?? null

    // Read from a copy, so the route still reads the body itself.
    const body = method === `POST` && (ADDRESS_ROUTES.some((p) => p.test(path)) ||
        INVITATION_CREATE.test(path))
      ? await c.req.raw.clone().json().catch(() => null)
      : null
    const email = typeof body?.email === `string` ? body.email.trim().toLowerCase() : ``
    if (email && ADDRESS_ROUTES.some((p) => p.test(path)) && !email.endsWith(DEMO_ADDRESS_DOMAIN)) {
      return c.json(
        { error: SIGN_UP.test(path) ? DEMO_SIGN_UP_REFUSAL : DEMO_ADDRESS_REFUSAL },
        403,
      )
    }

    const target = method === `POST` ? ADMIN_USER_ACTION.exec(path) : null
    if (target && (await isDemo([Number(target[1])])).size > 0) {
      return c.json({ error: DEMO_TARGET_REFUSAL }, 403)
    }
    if (actorId === null) return await next()

    if (OWN_ACCOUNT_ROUTES.some(([m, pattern]) => m === method && pattern.test(path))) {
      if ((await isDemo([actorId])).size > 0) return c.json({ error: DEMO_ACCOUNT_REFUSAL }, 403)
    } else if (method === `POST` && INVITATION_CREATE.test(path)) {
      const mails = typeof body === `object` && body !== null && body.sendEmail === true
      if (mails && (await isDemo([actorId])).size > 0) {
        return c.json({ error: DEMO_INVITATION_MAIL_REFUSAL }, 403)
      }
    }
    await next()
  }
}
