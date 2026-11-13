/**
 * The `/auth` routes of the password sign-in: sign-out, `/me` and password sign-in here, and
 * every other flow from its own `auth-*.ts` file, mounted in order behind the factor gates.
 * The provider sign-ins have their own (`auth-oauth.ts`, `auth-passkeys.ts`, `auth-guest.ts`).
 *
 * @module
 */
import { Hono } from "hono"
import { validate } from "@spy4x/validation"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import type { SignIn } from "@api/services/sign-in.ts"
import { UserSignedOutEvent } from "@api/cqrs/events.ts"
import { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { Lockout } from "@spy4x/server/lockout"
import type { AuthRateLimits } from "../middlewares/auth-rate-limits.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { passwordFailureSubject } from "@api/services/password-failures.ts"
import { PasswordLockedError, passwordLockedMessage } from "@api/services/password-locked.ts"
import { errorResponse, validationResponse } from "../services/error-response.ts"
import { DEMO_ADMIN_ELSEWHERE, isAdminHost } from "../middlewares/admin-host.ts"
import { isPublicDemoAdminLogin, PUBLIC_DEMO_ADMIN } from "@server/auth/demo-accounts.ts"
import { authSignInSchema } from "@domain/identity"
import { signInAnswer, signUpClosed, tooMany } from "./auth-answers.ts"
import { SignUpClosedError } from "@api/services/sign-up-gate.ts"
import { createSignUpRoutes } from "./auth-sign-up.ts"
import { createPasswordResetRoutes } from "./auth-password-reset.ts"
import { createSignInCodeRoutes } from "./auth-sign-in-codes.ts"
import { createTotpDisconnectRoutes, createTotpRoutes } from "./auth-totp.ts"
import { createEmailChangeRoutes } from "./auth-email-change.ts"
import { createPasswordRoutes } from "./auth-password.ts"
import { createSessionRoutes } from "./auth-sessions.ts"
import { createAccountDeletionRoutes } from "./auth-account-deletion.ts"

/** What the auth routes call. `index.ts` passes the app's singletons; tests pass fakes. */
export interface AuthRouteDependencies {
  /** Without the provider sign-in: `auth-oauth.ts` has those routes. */
  signIn: Omit<SignIn, "oauth" | "passkeys" | "guests">
  /** Announces a sign-out, so the person's open sockets close. Audit rows are not events. */
  emit(event: UserSignedOutEvent): void
  mutationGuards: MutationGuards
  rateLimits: AuthRateLimits
  /** Persistent count of wrong one-time codes per user, with a growing lock. */
  totpFailures: Lockout
  /**
   * Persistent count of wrong passwords per sign-in name, from every network address together,
   * with a short lock (`services/password-failures.ts`).
   */
  passwordFailures: Lockout
  /** Persistent count of wrong e-mail codes per user, with a growing lock. */
  emailCodeFailures: Lockout
  /** Queues a mail with a new code for `email`, the address the user's account must prove. */
  requestEmailCode(userId: number, email: string): Promise<void>
  /**
   * The public demo (docs/demo.md), or `null` when it is off: the admin app's host, where the
   * public admin account ({@link PUBLIC_DEMO_ADMIN}) signs in. Elsewhere its sign-in is refused,
   * and the admin host gate (`createAdminHostGate`) answers its session 401 on any other host.
   */
  demo?: { adminHost: string | null } | null
}

/** The answer to a wrong password. */
const INVALID_CREDENTIALS = "Invalid e-mail, username or password"

/** What `GET /auth/demo` publishes on the demo: the public admin account's address and password. */
const DEMO_ADMIN_CREDENTIALS = {
  email: PUBLIC_DEMO_ADMIN.email,
  password: PUBLIC_DEMO_ADMIN.password,
}

/** The `/auth` routes of the password sign-in, each flow mounted in the order its gate needs. */
export function createAuthRoute(deps: AuthRouteDependencies): Hono<APIContext> {
  const { signIn, emit, mutationGuards, rateLimits, passwordFailures, demo = null } = deps
  const { isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
  return new Hono<APIContext>()
    // A password check of a signed-in step while the account is locked, and a step that would
    // make an account the sign-up gate refused. Every other error goes on to the app's handler.
    .onError((error, c) => {
      if (error instanceof SignUpClosedError) return signUpClosed(c)
      if (!(error instanceof PasswordLockedError)) throw error
      return tooMany(c, error.retryAfterMs, passwordLockedMessage(error.retryAfterMs))
    })
    // The public demo's admin account, for the admin app's sign-in page: published, no secret.
    .get(`/demo`, rateLimits.normal, (c) => c.json({ admin: demo ? DEMO_ADMIN_CREDENTIALS : null }))
    .post(`/sign-out`, mutationGuards.anonymous, rateLimits.normal, async (c) => {
      const authData = c.get("auth")
      await signIn.signOut(c)
      if (authData) {
        emit(
          new UserSignedOutEvent({
            userId: authData.user.id,
            // trustedProxy: true trusts X-Forwarded-For / X-Real-IP: Traefik overwrites them.
            request: requestInfoFromContext(c, { trustedProxy: true }),
          }),
        )
      }
      return c.json({ success: true })
    })
    .get(`/me`, rateLimits.normal, async (c) => {
      const authData = c.get("auth")
      if (!authData) {
        return errorResponse(c, `unauthorized`, { message: "User not signed in" })
      }
      // 202, like `password/check`: the session still owes its second factor. A reloaded page
      // learns that here, since it has no memory of the sign-in response.
      return signInAnswer(c, authData)
    })
    .post(`password/check`, mutationGuards.anonymous, rateLimits.strictByIp, async (c) => {
      const body = await readApiJson(c)
      const validationResult = validate(authSignInSchema, body)
      if (validationResult.error) {
        return validationResponse(c, validationResult.error.details)
      }
      const { login, password } = validationResult.data
      if (demo && isPublicDemoAdminLogin(login)) {
        if (!isAdminHost(c.req.url, demo.adminHost)) {
          return errorResponse(c, `forbidden`, {
            message: DEMO_ADMIN_ELSEWHERE,
            reason: `DEMO_ADMIN_ELSEWHERE`,
          })
        }
        // Its password is published, so no lock: a visitor's wrong guesses must not lock the
        // others out. The route's limit per network address still holds.
        const signedIn = await signIn.signIn(c, login, password)
        if (!signedIn) {
          return errorResponse(c, `unauthorized`, { message: INVALID_CREDENTIALS })
        }
        return signInAnswer(c, signedIn)
      }
      // Counted per name and before the password is looked at, whatever address the request comes
      // from and whether or not an account uses the name. While the name is locked not even the
      // right password is checked.
      const subject = await passwordFailureSubject(login)
      const waitMs = await passwordFailures.begin(subject)
      if (waitMs > 0) return tooMany(c, waitMs, passwordLockedMessage(waitMs))
      const signedIn = await signIn.signIn(c, login, password)
      if (!signedIn) {
        await passwordFailures.fail(subject)
        return errorResponse(c, `unauthorized`, { message: INVALID_CREDENTIALS })
      }
      await passwordFailures.refund(subject)
      return signInAnswer(c, signedIn)
    })
    .route(`/`, createSignUpRoutes(deps))
    .route(`/`, createPasswordResetRoutes(deps))
    .route(`/`, createSignInCodeRoutes(deps))
    .use(isAuthenticated1FA)
    .use(mutationGuards.signedIn)
    .route(`/`, createTotpRoutes(deps))
    .use(isAuthenticated2FA)
    .route(`/`, createTotpDisconnectRoutes(deps))
    .route(`/`, createEmailChangeRoutes(deps))
    .route(`/`, createPasswordRoutes(deps))
    .route(`/`, createSessionRoutes(deps))
    .route(`/`, createAccountDeletionRoutes(deps))
}
