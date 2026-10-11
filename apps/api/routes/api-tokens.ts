import { Hono } from "hono"
import type { MiddlewareHandler } from "hono"
import { ApiTokenError, parseApiTokenCreateRequest } from "@domain/api-tokens"
import { isUuid } from "@spy4x/platform/universal/uuid"
import type { APIContext } from "../_types.ts"
import type { MutationGuards } from "../middlewares/mutation-guards.ts"
import type { SignIn } from "@api/services/sign-in.ts"
import type { ApiTokens } from "@api/services/api-tokens.ts"
import { readApiJson } from "@api/services/json-body.ts"

/** What the token management routes call. `index.ts` passes the app's singletons. */
export interface ApiTokensRouteDependencies {
  auth: Pick<SignIn["auth"], "isAuthenticated2FA">
  mutationGuards: MutationGuards
  /** The normal per-user budget the session routes spend too. */
  limit: MiddlewareHandler<APIContext>
  tokens: Pick<ApiTokens, "list" | "create" | "revoke">
}

const STATUS = {
  INVALID_REQUEST: 400,
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
 * - `POST /` creates one from `{ name, groupId, access, expiresInDays }`: 201 `{ token, secret }`.
 *   The secret is in this answer only.
 * - `DELETE /:id` revokes one: `{ success: true }`, or 404 when the person has no such token.
 *
 * A refusal answers `{ error, code }`, the message the web app shows.
 */
export function createApiTokensRoute(dependencies: ApiTokensRouteDependencies): Hono<APIContext> {
  return new Hono<APIContext>()
    .onError((error, c) => {
      if (!(error instanceof ApiTokenError)) throw error
      return c.json({ error: error.message, code: error.code }, STATUS[error.code])
    })
    .use(dependencies.auth.isAuthenticated2FA)
    .use(dependencies.mutationGuards.signedIn)
    .use(dependencies.limit)
    .get(`/`, async (c) => {
      return c.json({ tokens: await dependencies.tokens.list(c.get("auth")!.user.id) })
    })
    .post(`/`, async (c) => {
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
