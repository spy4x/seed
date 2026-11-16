/**
 * The `/auth` routes of the password sign-in: sign-out, `/me` and password sign-in here, and
 * every other flow from its own `auth-*.ts` file, mounted in order behind the factor gates.
 * The provider sign-ins have their own (`auth-oauth.ts`, `auth-passkeys.ts`, `auth-guest.ts`).
 *
 * @module
 */
import { type Context, Hono, type MiddlewareHandler } from "hono"
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
import { deviceFailureSubject, type SignInDevice } from "@api/services/sign-in-device.ts"
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
  /**
   * The device cookie a password sign-in sets. With it, the login's device budget and the device's
   * lock replace the per-address budget and the per-name lock (`services/sign-in-device.ts`). The
   * device's lock counts in `passwordFailures`.
   */
  signInDevice: SignInDevice
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

/** The answer when a login's devices have spent their sign-in budget (`rateLimits.deviceSignIn`). */
export const DEVICE_BUDGET_SPENT = `Too many sign-in attempts. Try again later.`

/**
 * Runs `handler` behind `limit`, a rate-limit middleware, as if the route had mounted the limit
 * before it: a refused request gets the limit's own answer and `handler` never runs.
 */
async function behind(
  c: Context<APIContext>,
  limit: MiddlewareHandler<APIContext>,
  handler: () => Promise<Response>,
): Promise<Response> {
  let answer: Response | undefined
  const refused = await limit(c, async () => {
    answer = await handler()
  })
  if (refused) return refused
  if (!answer) throw new Error(`the rate limit neither refused the request nor let it through`)
  return answer
}

/** What `GET /auth/demo` publishes on the demo: the public admin account's address and password. */
const DEMO_ADMIN_CREDENTIALS = {
  email: PUBLIC_DEMO_ADMIN.email,
  password: PUBLIC_DEMO_ADMIN.password,
}

/** The `/auth` routes of the password sign-in, each flow mounted in the order its gate needs. */
export function createAuthRoute(deps: AuthRouteDependencies): Hono<APIContext> {
  const { signIn, emit, mutationGuards, rateLimits, passwordFailures, signInDevice, demo = null } =
    deps
  const { isAuthenticated1FA, isAuthenticated2FA } = signIn.auth
  /** Whether `login` names the public demo's admin account while the demo is on. */
  const isDemoAdmin = (login: string) => demo !== null && isPublicDemoAdminLogin(login)
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
    .post(`password/check`, mutationGuards.anonymous, async (c) => {
      // The body comes before any budget: which one an attempt spends depends on the login it
      // names. A browser whose device cookie names that login and its current password spends the
      // login's device budget and its device's lock instead of the address's budget and the lock
      // per name, so strangers' wrong passwords cannot keep it out (`services/sign-in-device.ts`).
      const read = await readApiJson(c).then(
        (body) => ({ parsed: validate(authSignInSchema, body) }),
        (error: unknown) => ({ parsed: null, error }),
      )
      const credentials = read.parsed?.data
      // The public demo admin's password is published, so its sign-ins always spend the address's
      // budget: a device of it would give every visitor a budget of their own.
      const deviceId = credentials && !isDemoAdmin(credentials.login)
        ? await signInDevice.recognise(c, credentials.login)
        : null
      if (credentials && deviceId !== null) {
        // One budget for all the login's devices: a new cookie per right password buys no more.
        const decision = await rateLimits.deviceSignIn(
          await passwordFailureSubject(credentials.login),
        )
        if (!decision.allowed) return tooMany(c, decision.retryAfterMs, DEVICE_BUDGET_SPENT)
        // The device's own lock, on the lock per name's policy: a stolen cookie gets no more
        // guesses than a name does. Counted before the password is looked at, as for the name.
        const subject = await deviceFailureSubject(deviceId)
        const waitMs = await passwordFailures.begin(subject)
        if (waitMs > 0) return tooMany(c, waitMs, passwordLockedMessage(waitMs))
        const signedIn = await signIn.signIn(c, credentials.login, credentials.password)
        if (!signedIn) {
          await passwordFailures.fail(subject)
          return errorResponse(c, `unauthorized`, { message: INVALID_CREDENTIALS })
        }
        await passwordFailures.refund(subject)
        return signInAnswer(c, signedIn)
      }
      // Every other request, an unreadable or invalid body included, spends the strict budget of
      // its address first, as when the limit was mounted before the handler.
      return await behind(c, rateLimits.strictByIp, async () => {
        if (read.parsed === null) throw read.error
        if (read.parsed.error) return validationResponse(c, read.parsed.error.details)
        const { login, password } = read.parsed.data
        if (demo && isDemoAdmin(login)) {
          if (!isAdminHost(c.req.url, demo.adminHost)) {
            return errorResponse(c, `forbidden`, {
              message: DEMO_ADMIN_ELSEWHERE,
              reason: `DEMO_ADMIN_ELSEWHERE`,
            })
          }
          // Its password is published, so no lock and no device cookie: a visitor's wrong guesses
          // must not lock the others out. The route's limit per network address still holds.
          const signedIn = await signIn.signIn(c, login, password)
          if (!signedIn) {
            return errorResponse(c, `unauthorized`, { message: INVALID_CREDENTIALS })
          }
          return signInAnswer(c, signedIn)
        }
        // Counted per name and before the password is looked at, whatever address the request
        // comes from and whether or not an account uses the name. While the name is locked not
        // even the right password is checked.
        const subject = await passwordFailureSubject(login)
        const waitMs = await passwordFailures.begin(subject)
        if (waitMs > 0) return tooMany(c, waitMs, passwordLockedMessage(waitMs))
        const signedIn = await signIn.signIn(c, login, password)
        if (!signedIn) {
          await passwordFailures.fail(subject)
          return errorResponse(c, `unauthorized`, { message: INVALID_CREDENTIALS })
        }
        await passwordFailures.refund(subject)
        await signInDevice.remember(c, login)
        return signInAnswer(c, signedIn)
      })
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
