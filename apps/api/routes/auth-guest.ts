import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { validate } from "@spy4x/validation"
import {
  GUEST_ANSWERS,
  guestDeleteSchema,
  type GuestStartResponse,
  type GuestSwitchResponse,
  guestSwitchSchema,
} from "@domain/identity"
import { readApiJson } from "@api/services/json-body.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import { GuestStartOutcome, GuestSwitchOutcome } from "@api/services/guest-sign-in.ts"
import { PasswordLockedError, passwordLockedMessage } from "@api/services/password-locked.ts"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"

/** What the guest routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface GuestRouteDependencies {
  signIn: Pick<SignIn, "auth" | "guests">
  mutationGuards: MutationGuards
  rateLimits: Pick<
    AuthRateLimits,
    "guestByIp" | "strictByUser" | "otpByUser" | "normal"
  >
}

/**
 * Guest accounts (#224): starting one with one click, the choice after a sign-in method turned out
 * to belong to another account, and deleting a guest account. Keeping one goes through the
 * existing paths (the sign-up code, a provider link, a new passkey), which see the guest session.
 * Mounted at `/auth` before `createAuthRoute`, for the reason `createOAuthRoute` gives.
 */
export function createGuestRoute(
  { signIn, mutationGuards, rateLimits }: GuestRouteDependencies,
): Hono<APIContext> {
  const { guests } = signIn
  const { isAuthenticated2FA } = signIn.auth

  /** A request that already carries a session creates nothing and spends no new-account budget. */
  const alreadySignedIn: MiddlewareHandler<APIContext> = async (c, next) => {
    const state = c.get("auth")
    if (!state) return await next()
    const guest = state.user.guestSince ? "already-guest" : "signed-in"
    return c.json({ guest } satisfies GuestStartResponse, 200)
  }
  const off: MiddlewareHandler<APIContext> = async (c, next) => {
    if (!guests.enabled) return c.json({ error: GUEST_ANSWERS.off }, 404)
    await next()
  }
  /** A guest's session, fully signed in; anyone else is refused before the route runs. */
  const guestOnly: MiddlewareHandler<APIContext> = async (c, next) => {
    if (!c.get("auth")?.user.guestSince) return c.json({ error: GUEST_ANSWERS.notGuest }, 403)
    await next()
  }
  const locked = (c: Context<APIContext>, error: PasswordLockedError) => {
    c.header("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)))
    return c.json({ error: passwordLockedMessage(error.retryAfterMs) }, 429)
  }

  return new Hono<APIContext>()
    .post(
      `/guest`,
      mutationGuards.anonymous,
      alreadySignedIn,
      off,
      rateLimits.guestByIp,
      async (c) => {
        const started = await guests.start(c, c.get("auth"))
        if (started.outcome === GuestStartOutcome.Off) {
          return c.json({ error: GUEST_ANSWERS.off }, 404)
        }
        const guest = started.outcome === GuestStartOutcome.Started
          ? "started"
          : started.outcome === GuestStartOutcome.AlreadyGuest
          ? "already-guest"
          : "signed-in"
        return c.json({ guest } satisfies GuestStartResponse, guest === "started" ? 201 : 200)
      },
    )
    .get(`/guest/switch`, isAuthenticated2FA, rateLimits.normal, async (c) => {
      const state = await guests.switchState(c.get("auth")!)
      return c.json({ switch: state } satisfies GuestSwitchResponse)
    })
    // A password and a code may be checked: the strict per-user limit, and the one-time-code
    // budget that wrong codes spend.
    .post(
      `/guest/switch`,
      isAuthenticated2FA,
      guestOnly,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      rateLimits.otpByUser,
      async (c) => {
        const body = validate(guestSwitchSchema, await readApiJson(c))
        if (body.error) return c.json({ error: body.error.description }, 400)
        let answer
        try {
          answer = await guests.switchTo(c, c.get("auth")!, body.data)
        } catch (error) {
          if (error instanceof PasswordLockedError) return locked(c, error)
          throw error
        }
        switch (answer.outcome) {
          case GuestSwitchOutcome.Switched:
            return c.json(answer.result)
          case GuestSwitchOutcome.WrongPassword:
            return c.json({ error: GUEST_ANSWERS.wrongPassword }, 401)
          case GuestSwitchOutcome.WrongCode:
            return c.json({ error: GUEST_ANSWERS.wrongCode }, 401)
          case GuestSwitchOutcome.Unavailable:
            return c.json({ error: GUEST_ANSWERS.unavailable }, 410)
          case GuestSwitchOutcome.Blocked:
            return c.json({ error: GUEST_ANSWERS.notMoved, blockers: answer.blockers }, 409)
          case GuestSwitchOutcome.Expired:
            return c.json({ error: GUEST_ANSWERS.expired }, 410)
        }
      },
    )
    // "Keep the guest account": the choice goes, nothing else changes.
    .delete(
      `/guest/switch`,
      isAuthenticated2FA,
      guestOnly,
      mutationGuards.signedIn,
      rateLimits.normal,
      async (c) => {
        await guests.cancelSwitch(c.get("auth")!)
        return c.json({ success: true })
      },
    )
    // A guest has no password: the typed word confirms, and the account goes at once.
    .post(
      `/guest/delete`,
      isAuthenticated2FA,
      guestOnly,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      async (c) => {
        const body = validate(guestDeleteSchema, await readApiJson(c))
        if (body.error) return c.json({ error: GUEST_ANSWERS.wrongWord }, 400)
        const answer = await guests.deleteAccount(c, c.get("auth")!, body.data.confirm)
        if (answer.deleted) return c.json({ success: true })
        if (answer.reason === "blocked") {
          return c.json({ error: GUEST_ANSWERS.notMoved, blockers: answer.blockers }, 409)
        }
        if (answer.reason === "wrong-word") return c.json({ error: GUEST_ANSWERS.wrongWord }, 400)
        return c.json({ error: GUEST_ANSWERS.notGuest }, 403)
      },
    )
}
