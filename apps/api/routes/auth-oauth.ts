import { Hono } from "hono"
import type { Context, MiddlewareHandler } from "hono"
import { SecondFactorStatus } from "@spy4x/server/sign-in"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import {
  OAUTH_NOTICE_PARAM,
  OAUTH_PAGES,
  type OAuthNotice,
  oauthProviderId,
  type OAuthProvidersResponse,
  type PendingSignUpResponse,
  signInMethodProofSchema,
} from "@domain/identity"
import { validate } from "@spy4x/validation"
import { readApiJson } from "@api/services/json-body.ts"
import type { AppAuthState, SignIn } from "@api/services/sign-in.ts"
import { UnlinkOutcome } from "@api/services/oauth-sign-in.ts"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { PasswordLockedError, passwordLockedMessage } from "@api/services/password-locked.ts"
import { PROVIDER_PROOF_REQUIRED } from "./auth.ts"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"

/** What the provider sign-in routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface OAuthRouteDependencies {
  signIn: Pick<
    SignIn,
    "auth" | "oauth" | "hasPassword" | "checkPassword" | "confirmedByProvider"
  >
  /** Announces a sign-out, so the person's open sockets close. */
  emit(event: UserSignedOutEvent): void
  mutationGuards: MutationGuards
  rateLimits: Pick<AuthRateLimits, "strictByIp" | "strictByUser" | "normal">
  /** The web app's origin: every redirect after a callback goes to a page under it. */
  origin: string
  /** Records a failure the person only sees as "that did not work". */
  logError(message: string, error: unknown): void
}

/** The answer when the question page confirms a sign-up that no longer waits. */
export const SIGN_UP_EXPIRED = "This took too long. Start again from the sign-in page."

/** The answer for a provider that is off, or a name that is no provider. */
export const PROVIDER_OFF = "This sign-in method is not available."

/** The answer when the method to unlink is not one of the account's provider methods. */
export const METHOD_NOT_FOUND = "This sign-in method is already unlinked."

/** The answer when the method to unlink is the only way into the account. */
export const METHOD_IS_LAST = "This is your only way to sign in. Add another one first."

/** A key id as the methods card sends it: decimal digits and nothing else. */
const KEY_ID = /^[1-9][0-9]{0,9}$/

/** The page parameter `/:provider/start` reads the return page from, as the sign-in pages do. */
const NEXT_PARAM = "next"

/** `path` with `next` as its query, or `path` alone without one. */
function withNext(path: string, next: string | null): string {
  return next ? `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}` : path
}

/**
 * What a link and an unlink ask for (#384, #385), and adding a passkey (#222): the account's
 * password, or for an account without one a sign-in with a provider or a passkey a moment ago.
 * `null` when the body gives it; otherwise the refusal to answer.
 */
export async function refusalWithoutProof(
  signIn: Pick<SignIn, "hasPassword" | "checkPassword" | "confirmedByProvider">,
  c: Context<APIContext>,
  state: AppAuthState,
): Promise<Response | null> {
  const body = validate(signInMethodProofSchema, await readApiJson(c))
  if (body.error) return validationResponse(c, body.error.details)
  const { password } = body.data
  // A guest has no sign-in method to prove: the session is the account's only way in, and adding
  // the first method is what keeping the account means (#224). A kept account is proven as before.
  if (state.user.guestSince) return null
  if (await signIn.hasPassword(state.user.id)) {
    if (password === undefined) {
      return errorResponse(c, `bad_request`, { message: "Invalid password" })
    }
    try {
      if (!(await signIn.checkPassword(state.user.id, password))) {
        return errorResponse(c, `bad_request`, { message: "Invalid password" })
      }
    } catch (error) {
      // Too many wrong passwords at the signed-in steps (#406): the lock they all share runs.
      if (!(error instanceof PasswordLockedError)) throw error
      c.header("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)))
      return errorResponse(c, `rate_limited`, {
        message: passwordLockedMessage(error.retryAfterMs),
      })
    }
  } else if (!(await signIn.confirmedByProvider(state))) {
    return errorResponse(c, `bad_request`, { message: PROVIDER_PROOF_REQUIRED })
  }
  return null
}

/**
 * Sign-in with Google and GitHub: starting a flow, the provider's callback, the question before a
 * provider creates an account, and the account's sign-in methods. Mounted at `/auth` BEFORE
 * `createAuthRoute`, whose session middleware would otherwise answer 401 for the public routes
 * here. For the same reason every route below names its own middleware and none is added with
 * `use`: such a middleware would also run for the routes mounted after this one.
 */
export function createOAuthRoute(
  { signIn, emit, mutationGuards, rateLimits, origin, logError }: OAuthRouteDependencies,
): Hono<APIContext> {
  const { oauth } = signIn
  const { isAuthenticated2FA } = signIn.auth
  const page = (path: string) => new URL(path, origin).href
  const withNotice = (path: string, notice: OAuthNotice) =>
    page(`${path}?${new URLSearchParams({ [OAUTH_NOTICE_PARAM]: notice })}`)
  const refuseWithoutProof = (c: Context<APIContext>, state: AppAuthState) =>
    refusalWithoutProof(signIn, c, state)

  /** The provider a route's `:provider` names, when it is on. */
  const providerOf = (c: Context<APIContext>) => {
    const id = oauthProviderId(c.req.param("provider"))
    return id !== null && oauth.providers().includes(id) ? id : null
  }

  const toSignIn = (c: Context<APIContext>, notice: OAuthNotice) =>
    c.redirect(withNotice(OAUTH_PAGES.signIn, notice), 302)
  /**
   * For the two routes a browser opens as a page (`start` and `callback`): whatever goes wrong,
   * the person lands on the sign-in page with a sentence, never on a page of JSON. A spent rate
   * limit becomes "wait a minute"; a limit that cannot be counted is logged and becomes "that did
   * not work".
   */
  const asPage =
    (limiter: MiddlewareHandler<APIContext>): MiddlewareHandler<APIContext> => async (c, next) => {
      let answer
      try {
        answer = await limiter(c, next)
      } catch (error) {
        logError("error: provider sign-in could not count its rate limit", error)
        return toSignIn(c, "failed")
      }
      if (answer?.status !== 429) return answer
      const retryAfter = answer.headers.get("retry-after")
      if (retryAfter !== null) c.header("retry-after", retryAfter)
      return toSignIn(c, "busy")
    }
  /** The other half of {@link asPage}: an error inside the route is logged and becomes a sentence. */
  const orSignIn = (
    route: (c: Context<APIContext>) => Promise<Response>,
  ) =>
  async (c: Context<APIContext>): Promise<Response> => {
    try {
      return await route(c)
    } catch (error) {
      logError("error: provider sign-in failed", error)
      return toSignIn(c, "failed")
    }
  }

  return new Hono<APIContext>()
    // Which buttons the sign-in pages show. Public: the buttons are on a public page.
    .get(`/providers`, rateLimits.normal, (c) => {
      return c.json({ providers: oauth.providers() } satisfies OAuthProvidersResponse)
    })
    // A plain link opens this: the browser leaves for the provider and comes back to the callback.
    // It changes nothing and proves nothing, so it spends the everyday budget: the strict one is
    // spent at the callback, where an account is entered.
    .get(
      `/:provider{google|github}/start`,
      asPage(rateLimits.normal),
      orSignIn(async (c) => {
        const id = providerOf(c)
        const url = id && await oauth.start(c, id, { next: c.req.query(NEXT_PARAM) })
        if (!url) return toSignIn(c, "failed")
        return c.redirect(url, 302)
      }),
    )
    .get(
      `/:provider{google|github}/callback`,
      asPage(rateLimits.strictByIp),
      orSignIn(async (c) => {
        const id = providerOf(c)
        if (!id) return toSignIn(c, "failed")
        const result = await oauth.callback(c, id, c.get("auth"))
        if (result.kind === "confirm") return c.redirect(page(OAUTH_PAGES.confirmSignUp), 302)
        if (result.kind === "notice") {
          if (result.notice === "guest-taken") return c.redirect(page(OAUTH_PAGES.keepTaken), 302)
          const reportTo = result.notice === "kept"
            ? OAUTH_PAGES.keep
            : result.linking
            ? OAUTH_PAGES.signInMethods
            : OAUTH_PAGES.signIn
          return c.redirect(withNotice(reportTo, result.notice), 302)
        }
        const owesCode = result.signedIn.session.secondFactor === SecondFactorStatus.Pending
        return c.redirect(
          page(
            owesCode
              ? withNext(OAUTH_PAGES.oneTimeCode, result.next)
              : result.next ?? OAUTH_PAGES.home,
          ),
          302,
        )
      }),
    )
    // What the question page shows; `null` when nothing waits, and the page says so.
    .get(`/sign-up/pending`, rateLimits.normal, async (c) => {
      return c.json({ pending: await oauth.pendingSignUp(c) } satisfies PendingSignUpResponse)
    })
    .post(
      `/sign-up/confirm`,
      mutationGuards.anonymous,
      rateLimits.strictByIp,
      async (c) => {
        const signedIn = await oauth.confirmSignUp(c, c.get("auth"))
        if (!signedIn) return errorResponse(c, `bad_request`, { message: SIGN_UP_EXPIRED })
        // As a password sign-in answers: 202 while the authenticator code is owed.
        if (signedIn.session.secondFactor === SecondFactorStatus.Pending) {
          return c.json({ secondFactor: "Pending" }, 202)
        }
        return c.json(signedIn.user, 201)
      },
    )
    // "I already have an account": nothing was created, and the token stops working.
    .post(`/sign-up/cancel`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      await oauth.cancelSignUp(c)
      return c.json({ success: true })
    })
    .get(`/methods`, isAuthenticated2FA, rateLimits.normal, async (c) => {
      return c.json(await oauth.methods(c.get("auth")!))
    })
    // A POST, not a link: another site must not be able to start a link for a signed-in person.
    // It asks for what the deletion asks (#384): the password, or for an account without one a
    // sign-in with a provider a moment ago. A new provider account is a new way in, and a
    // sign-in with it would count as that proof; so a session left open cannot add one.
    .post(
      `/methods/:provider{google|github}/link`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      async (c) => {
        const id = providerOf(c)
        if (!id) return errorResponse(c, `not_found`, { message: PROVIDER_OFF })
        const state = c.get("auth")!
        const refusal = await refuseWithoutProof(c, state)
        if (refusal) return refusal
        const url = await oauth.start(c, id, { linking: state })
        if (!url) return errorResponse(c, `not_found`, { message: PROVIDER_OFF })
        return c.json({ url })
      },
    )
    // Asks for what a link asks (#385): a session left open must not take away the way in the
    // owner uses. The strict per-user limit, since a password is checked.
    .delete(
      `/methods/:id`,
      isAuthenticated2FA,
      mutationGuards.signedIn,
      rateLimits.strictByUser,
      async (c) => {
        const raw = c.req.param("id")
        if (!KEY_ID.test(raw)) return errorResponse(c, `not_found`, { message: METHOD_NOT_FOUND })
        const state = c.get("auth")!
        const refusal = await refuseWithoutProof(c, state)
        if (refusal) return refusal
        const outcome = await oauth.unlink(c, state, Number(raw))
        if (outcome === UnlinkOutcome.NotFound) {
          return errorResponse(c, `not_found`, { message: METHOD_NOT_FOUND })
        }
        if (outcome === UnlinkOutcome.LastMethod) {
          return errorResponse(c, `conflict`, { message: METHOD_IS_LAST })
        }
        // The method's sessions ended with it: their sockets close. The sockets of the person's
        // other sessions reconnect by themselves.
        emit(
          new UserSignedOutEvent({
            userId: state.user.id,
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
        return c.json({ signedOut: outcome === UnlinkOutcome.UnlinkedAndSignedOut })
      },
    )
}
