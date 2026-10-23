import { Hono } from "hono"
import type { Context } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { authenticationResponseSchema, registrationResponseSchema } from "@spy4x/server/webauthn"
import { validate } from "@spy4x/validation"
import { parsePasskeyName, type PasskeyAdded } from "@domain/identity"
import { readApiJson } from "@api/services/json-body.ts"
import type { AppAuthState, SignIn } from "@api/services/sign-in.ts"
import { PasskeyAddOutcome } from "@api/services/passkey-sign-in.ts"
import { refusalWithoutProof } from "./auth-oauth.ts"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import { errorResponse } from "../services/error-response.ts"

/** What the passkey routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface PasskeyRouteDependencies {
  signIn: Pick<
    SignIn,
    "auth" | "passkeys" | "hasPassword" | "checkPassword" | "confirmedByProvider"
  >
  mutationGuards: MutationGuards
  rateLimits: Pick<AuthRateLimits, "strictByIp" | "strictByUser" | "normal">
}

/** The answer when passkeys are off. */
export const PASSKEYS_OFF = "Passkeys are not available."
/** The answer when the device already holds one of the person's passkeys. */
export const PASSKEY_ALREADY_YOURS = "This device already has a passkey for your account."
/** The answer when a new passkey failed a check, expired, or its id is taken or too long. */
export const PASSKEY_NOT_SAVED = "The passkey could not be saved. Try again."
/** The answer when no account has the passkey: the browser is told to forget it. */
export const PASSKEY_UNKNOWN =
  "This passkey is no longer linked to an account. Sign in another way, then add it again."
/** The answer when a passkey sign-in failed a check or took too long. */
export const PASSKEY_REFUSED = "That passkey did not work. Try again, or sign in another way."
/** The answer when a rename names no passkey of the person. */
export const PASSKEY_NOT_FOUND = "This passkey is already removed."
/** The answer when a new name is empty, too long or holds characters a name cannot. */
export const PASSKEY_NAME_INVALID = "Give the passkey a name of up to 64 characters."

/** A key id as the methods card sends it: decimal digits and nothing else. */
const KEY_ID = /^[1-9][0-9]{0,9}$/

/**
 * Passkeys (#222): adding one, renaming it, and signing in with one. Removing one is the methods
 * card's `DELETE /methods/:id` (`auth-oauth.ts`). Mounted at `/auth` before `createAuthRoute`, for
 * the reason `createOAuthRoute` gives: every route names its own middleware.
 */
export function createPasskeyRoute(
  { signIn, mutationGuards, rateLimits }: PasskeyRouteDependencies,
): Hono<APIContext> {
  const { passkeys } = signIn
  const { isAuthenticated2FA } = signIn.auth
  const off = (c: Context<APIContext>) =>
    passkeys.enabled() ? null : errorResponse(c, `not_found`, { message: PASSKEYS_OFF })

  /** Answers a finished sign-in as a password sign-in does: 202 while a code is owed. */
  const signInAnswer = async (c: Context<APIContext>, current?: AppAuthState) => {
    const body = validate(authenticationResponseSchema, await readApiJson(c))
    if (body.error) return errorResponse(c, `bad_request`, { message: PASSKEY_REFUSED })
    const result = await passkeys.signIn(c, body.data, current)
    if (result.kind === "unknown") {
      return errorResponse(c, `not_found`, { message: PASSKEY_UNKNOWN, details: { unknown: true } })
    }
    if (result.kind === "refused") {
      return errorResponse(c, `bad_request`, { message: PASSKEY_REFUSED })
    }
    if (result.signedIn.session.secondFactor === SecondFactorStatus.Pending) {
      return c.json({ secondFactor: "Pending" }, 202)
    }
    return c.json(result.signedIn.user, 200)
  }

  return new Hono<APIContext>()
    // The options the passkey picker and the autofill start from. Public, as the sign-in page.
    .post(`/passkeys/sign-in/options`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      return off(c) ?? c.json(await passkeys.signInOptions())
    })
    // An account is entered here: the strict budget, as a password sign-in.
    .post(`/passkeys/sign-in`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      return off(c) ?? await signInAnswer(c)
    })
    // Signing in again as the same person, which confirms the steps an account without a
    // password confirms with a fresh sign-in. Only that person's passkeys are accepted.
    .post(
      `/passkeys/confirm/options`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.normal,
      async (c) => {
        return off(c) ?? c.json(await passkeys.signInOptions(c.get("auth")!))
      },
    )
    .post(
      `/passkeys/confirm`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      async (c) => {
        return off(c) ?? await signInAnswer(c, c.get("auth")!)
      },
    )
    // A passkey is a new way in, so it asks for what linking a provider asks: the password, or a
    // sign-in a moment ago. The ceremony that follows is bound to this session's challenge.
    .post(
      `/passkeys/add/options`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      async (c) => {
        const refusal = off(c)
        if (refusal) return refusal
        const state = c.get("auth")!
        const unproven = await refusalWithoutProof(signIn, c, state)
        if (unproven) return unproven
        return c.json(await passkeys.addOptions(state))
      },
    )
    .post(
      `/passkeys`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      async (c) => {
        const refusal = off(c)
        if (refusal) return refusal
        const body = validate(registrationResponseSchema, await readApiJson(c))
        if (body.error) return errorResponse(c, `bad_request`, { message: PASSKEY_NOT_SAVED })
        const { outcome, keyId, name } = await passkeys.add(c, c.get("auth")!, body.data)
        if (outcome === PasskeyAddOutcome.AlreadyYours) {
          return errorResponse(c, `conflict`, { message: PASSKEY_ALREADY_YOURS })
        }
        if (outcome !== PasskeyAddOutcome.Added || !keyId || !name) {
          return errorResponse(c, `bad_request`, { message: PASSKEY_NOT_SAVED })
        }
        return c.json({ keyId, name } satisfies PasskeyAdded, 201)
      },
    )
    // Renaming changes no way in, so it asks for no proof.
    .patch(
      `/passkeys/:id`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.normal,
      async (c) => {
        const refusal = off(c)
        if (refusal) return refusal
        const raw = c.req.param("id")
        if (!KEY_ID.test(raw)) return errorResponse(c, `not_found`, { message: PASSKEY_NOT_FOUND })
        const name = parsePasskeyName(await readApiJson(c))
        if (name === null) return errorResponse(c, `bad_request`, { message: PASSKEY_NAME_INVALID })
        if (!(await passkeys.rename(c, c.get("auth")!, Number(raw), name))) {
          return errorResponse(c, `not_found`, { message: PASSKEY_NOT_FOUND })
        }
        return c.json({ name })
      },
    )
}
