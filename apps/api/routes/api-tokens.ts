import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { ApiTokenError, parseApiTokenCreateRequest } from "@domain/api-tokens"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import type { ApiTokens } from "@api/services/api-tokens.ts"
import { readApiJson } from "@api/services/json-body.ts"
import { PasswordLockedError, passwordLockedMessage } from "@api/services/password-locked.ts"
import { codeForStatus, errorResponse } from "../services/error-response.ts"

/** What the token management routes call. `index.ts` passes the app's singletons. */
export interface ApiTokensRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  /**
   * The limit a create spends before its password is checked: the per-user budget a password
   * change spends, so a stolen session cannot guess the password here.
   */
  passwordLimit: MiddlewareHandler<APIContext>
  tokens: Pick<ApiTokens, "list" | "create" | "revoke">
}

const STATUS = {
  INVALID_REQUEST: 400,
  PASSWORD_INVALID: 400,
  GROUP_NOT_FOUND: 404,
  TOKEN_NOT_FOUND: 404,
  TOO_MANY_TOKENS: 409,
  TOKEN_INVALID: 401,
  TOKEN_SCOPE: 403,
} as const

/**
 * A person's API tokens (#167), mounted at `/api/tokens`. Only a signed-in session with its second
 * factor reaches them, never a token: tokens are accepted at `/api/v1` alone.
 *
 * - `GET /` lists the live tokens: `{ tokens }`.
 * - `POST /` creates one from `{ name, groupId, access, expiresInDays, password }`: 201
 *   `{ token, secret }`. The secret is in this answer only. `password` is the person's current
 *   password, asked again because a stolen session does not have it: 400 `PASSWORD_INVALID`
 *   without the right one, 429 `PASSWORD_LOCKED` with `Retry-After` after too many wrong ones at
 *   any signed-in step (#406). The owner is mailed that a token was created.
 * - `DELETE /:id` revokes one: `{ success: true }`, or 404 when the person has no such token.
 *
 * A refusal answers the API's error body (docs/api-errors.md): the message the web app shows, the
 * token code as its `reason`, and the failed fields when the body did not fit the schema.
 */
export function createApiTokensRoute(dependencies: ApiTokensRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .onError((error, c) => {
      // Too many wrong passwords at the signed-in steps (#406): the lock they all share runs.
      if (error instanceof PasswordLockedError) {
        c.header("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)))
        return errorResponse(c, `rate_limited`, {
          message: passwordLockedMessage(error.retryAfterMs),
          reason: "PASSWORD_LOCKED",
        })
      }
      if (!(error instanceof ApiTokenError)) throw error
      return errorResponse(c, codeForStatus(STATUS[error.code]), {
        message: error.message,
        reason: error.code,
        status: STATUS[error.code],
        fields: error.fields,
      })
    })
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.mutationGuards.signedIn)
    .use(dependencies.limit)
    .get(`/`, async (c) => {
      return c.json({ tokens: await dependencies.tokens.list(c.get("auth")!.user.id) })
    })
    .post(`/`, dependencies.passwordLimit, async (c) => {
      const request = parseApiTokenCreateRequest(await readApiJson(c))
      const created = await dependencies.tokens.create(c, c.get("auth")!.user.id, request)
      // The only answer that carries the secret: no cache may keep it.
      c.header(`Cache-Control`, `no-store`)
      return c.json(created, 201)
    })
    .delete(`/:id`, async (c) => {
      const id = c.req.param("id")
      const revoked = isUuid(id) &&
        await dependencies.tokens.revoke(c, c.get("auth")!.user.id, id)
      if (!revoked) throw new ApiTokenError("TOKEN_NOT_FOUND", "Token not found")
      return c.json({ success: true })
    })
}
