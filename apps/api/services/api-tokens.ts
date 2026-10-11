import type { Context } from "hono"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import {
  type ApiToken,
  type ApiTokenCreateRequest,
  type ApiTokenCreateResponse,
  ApiTokenError,
  apiTokenExpiresAt,
} from "@domain/api-tokens"
import { type AuthAuditBase, AuthAuditEventType } from "@domain/identity"
import { hashApiToken, type LiveApiToken, mintApiToken } from "@server/api-tokens/api-tokens.ts"
import type { AppDbBase } from "./db-base.ts"
import { uuidV7 } from "@spy4x/platform/universal/uuid"

/** Options for {@link createApiTokens}. */
export interface ApiTokensOptions {
  db: AppDbBase
  /**
   * The server key every token hash is made with, at least 32 characters. The API derives it from
   * the auth pepper; changing it makes every token stop working.
   */
  key: string
  /** Told when recording a token's use failed; the request goes on. */
  logError: (message: string, error: unknown) => void
  /** Injected by tests. */
  now?: () => Date
}

/** The token operations the routes call. */
export interface ApiTokens {
  /** The user's live tokens, newest first. */
  list(userId: number): Promise<ApiToken[]>
  /**
   * Creates a token for `userId` with its audit row, in one transaction, and returns it with the
   * secret, which is never available again. Throws `GROUP_NOT_FOUND` when the user is not a member
   * of the group and `TOO_MANY_TOKENS` at the cap.
   */
  create(
    c: Context,
    userId: number,
    request: ApiTokenCreateRequest,
  ): Promise<ApiTokenCreateResponse>
  /**
   * Revokes token `tokenId` of `userId` with its audit row, in one transaction. `false` when the
   * user has no such token, the answer for another person's token too.
   */
  revoke(c: Context, userId: number, tokenId: string): Promise<boolean>
  /**
   * The token `presented` names, when it may act now; `null` for anything else. Reads Postgres on
   * every call, so a revoked or expired token is refused at once. Records the use, and audits it,
   * at most once every few minutes per token.
   */
  authenticate(c: Context, presented: string | undefined): Promise<LiveApiToken | null>
}

/** Builds the token operations over `options.db`. */
export function createApiTokens(
  { db, key, logError, now = () => new Date() }: ApiTokensOptions,
): ApiTokens {
  return {
    list: (userId) => db.apiTokens.listLive(userId),

    async create(c, userId, request) {
      const { secret, hash } = await mintApiToken(key)
      const outcome = await db.begin(async (tx) => {
        const result = await tx.apiTokens.create({
          id: uuidV7(),
          userId,
          groupId: request.groupId,
          name: request.name,
          hash,
          access: request.access,
          expiresAt: apiTokenExpiresAt(now(), request.expiresInDays),
        })
        if ("created" in result) {
          await tx.authAudit.insert(
            auditRow(c, userId, AuthAuditEventType.API_TOKEN_CREATED, result.created.id),
          )
        }
        return result
      })
      if ("refused" in outcome) {
        throw new ApiTokenError(
          outcome.refused,
          outcome.refused === "GROUP_NOT_FOUND" ? "Group not found" : "Too many tokens",
        )
      }
      return { token: outcome.created, secret }
    },

    async revoke(c, userId, tokenId) {
      return await db.begin(async (tx) => {
        if (!(await tx.apiTokens.deleteOwn(userId, tokenId))) return false
        await tx.authAudit.insert(
          auditRow(c, userId, AuthAuditEventType.API_TOKEN_REVOKED, tokenId),
        )
        return true
      })
    },

    async authenticate(c, presented) {
      if (presented === undefined) return null
      const hash = await hashApiToken(presented, key)
      if (hash === null) return null
      const token = await db.apiTokens.findLive(hash)
      if (!token) return null
      try {
        await db.begin(async (tx) => {
          if (await tx.apiTokens.touch(token.id, now())) {
            await tx.authAudit.insert(
              auditRow(c, token.userId, AuthAuditEventType.API_TOKEN_USED, token.id),
            )
          }
        })
      } catch (error) {
        // The time shown and the audit of use are records, never a reason to refuse the request.
        logError("error: cannot record that an API token was used", error)
      }
      return token
    },
  }
}

/**
 * The `auth_audits` row of a token action. The address is read as the sign-in's rows read it,
 * trusting `X-Forwarded-For` and `X-Real-IP` from the proxy in front of the API.
 */
function auditRow(
  c: Context,
  userId: number,
  eventType: AuthAuditEventType,
  tokenId: string,
): AuthAuditBase {
  const request = requestInfoFromContext(c, { trustedProxy: true })
  return {
    userId,
    eventType,
    identifier: tokenId,
    ip: request.ip || null,
    userAgent: request.userAgent || null,
  }
}
