import type { Context } from "hono"
import { requestInfoFromContext } from "@spy4x/platform/request-info"
import {
  type ApiToken,
  type ApiTokenCreateRequest,
  type ApiTokenCreateResponse,
  ApiTokenError,
  apiTokenExpiresAt,
} from "@domain/api-tokens"
import { AuthAuditEventType } from "@domain/identity"
import {
  type ApiTokenAuditRequest,
  type ApiTokenRefusalReason,
  hashApiToken,
  type LiveApiToken,
  mintApiToken,
} from "@server/api-tokens/api-tokens.ts"
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
  /**
   * Whether `password` is the current password of user `userId`, read inside transaction `tx`:
   * the sign-in's own check. `null` when the account has no password. Not counted itself: the
   * create runs it inside {@link countPasswordCheck}.
   */
  checkPassword: (tx: AppDbBase, userId: number, password: string) => Promise<boolean | null>
  /**
   * The sign-in's count of wrong passwords per account (#406, `SignIn.countPasswordCheck`): runs
   * `check` and counts a `false`, and throws `PasswordLockedError` without running it while the
   * account is locked.
   */
  countPasswordCheck: <Right extends boolean | null>(
    userId: number,
    check: () => Promise<Right>,
  ) => Promise<Right>
  /**
   * Whether one more refusal may be audited under `key`, a token's id and the reason. It spends
   * the budget that keeps a flood of refused requests from filling `auth_audits`
   * (`TokenRateLimits.refusalAudit`). When it throws, the refusal is not audited.
   */
  mayAuditRefusal: (key: string) => Promise<boolean>
  /** Told when recording a token's use or refusal failed; the request goes on. */
  logError: (message: string, error: unknown) => void
  /** Injected by tests. */
  now?: () => Date
}

/** The token operations the routes call. */
export interface ApiTokens {
  /** The user's live tokens, newest first. */
  list(userId: number): Promise<ApiToken[]>
  /**
   * Creates a token for `userId` with its audit row and the mail that tells them, in one
   * transaction, and returns it with the secret, which is never available again. Throws
   * `PASSWORD_INVALID` unless `request.password` is the person's current password, which a stolen
   * session does not have (an account with no password can create none), `GROUP_NOT_FOUND` when
   * the user is not a member of the group and `TOO_MANY_TOKENS` at the cap.
   */
  create(
    c: Context,
    userId: number,
    request: ApiTokenCreateRequest,
  ): Promise<ApiTokenCreateResponse>
  /**
   * Revokes token `tokenId` of `userId` with its audit row, in one statement. `false` when the
   * user has no such live token, the answer for another person's token too.
   */
  revoke(c: Context, userId: number, tokenId: string): Promise<boolean>
  /**
   * The token `presented` names, when it may act now; `null` for anything else. Reads Postgres on
   * every call, so a revoked or expired token is refused at once. Records the use, and audits it,
   * at most once every few minutes per token. A revoked or an expired token is audited as refused
   * ({@link ApiTokens.auditRefusal}); a token nobody has leaves no row, as it has no owner.
   */
  authenticate(c: Context, presented: string | undefined): Promise<LiveApiToken | null>
  /**
   * Writes the audit row of a request refused for `reason`, for the owner of token `tokenId`,
   * unless the budget for that token and reason is spent. Never throws: the refusal is answered
   * either way.
   */
  auditRefusal(c: Context, tokenId: string, reason: ApiTokenRefusalReason): Promise<void>
}

/**
 * What the form shows under the password field of an account that has none, instead of calling a
 * password wrong that does not exist. No sign-up path makes such an account today.
 */
export const PASSWORD_NOT_SET_MESSAGE = "This account has no password, so it cannot create a token"

const REFUSAL_MESSAGES = {
  PASSWORD_INVALID: "The password is incorrect",
  GROUP_NOT_FOUND: "Group not found",
  TOO_MANY_TOKENS: "Too many tokens",
} as const

/** Builds the token operations over `options.db`. */
export function createApiTokens(
  {
    db,
    key,
    checkPassword,
    countPasswordCheck,
    mayAuditRefusal,
    logError,
    now = () => new Date(),
  }: ApiTokensOptions,
): ApiTokens {
  async function auditRefusal(
    c: Context,
    tokenId: string,
    reason: ApiTokenRefusalReason,
  ): Promise<void> {
    try {
      if (!(await mayAuditRefusal(`${tokenId}:${reason}`))) return
      await db.apiTokens.audit(tokenId, AuthAuditEventType.API_TOKEN_REFUSED, reason, requestOf(c))
    } catch (error) {
      // An audit row is a record, never a reason to answer the refusal differently.
      logError("error: cannot record that an API token was refused", error)
    }
  }

  return {
    list: (userId) => db.apiTokens.listLive(userId),

    async create(c, userId, { password, ...request }) {
      const { secret, hash } = await mintApiToken(key)
      const run = () =>
        db.begin(async (tx) => {
          // The password is checked under the lock a password change and a reset take (#293): this
          // create either commits before their revoke runs, or reads the new password and is
          // refused. The connection is held for one verify.
          await tx.lockUser(userId)
          const valid = await checkPassword(tx, userId, password)
          if (valid === null) return { refused: "PASSWORD_NOT_SET" as const }
          if (!valid) return { refused: "PASSWORD_INVALID" as const }
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
            const { id } = result.created
            await tx.apiTokens.audit(id, AuthAuditEventType.API_TOKEN_CREATED, null, requestOf(c))
            await tx.apiTokenMail.queue(id)
          }
          return result
        })
      // Counted around the transaction, which holds its connection (#406). Only a wrong password
      // is a guess; an account with none has nothing to guess.
      const held: { outcome?: Awaited<ReturnType<typeof run>> } = {}
      await countPasswordCheck(userId, async () => {
        const outcome = held.outcome = await run()
        const refused = "refused" in outcome ? outcome.refused : null
        return refused === "PASSWORD_INVALID" ? false : refused === "PASSWORD_NOT_SET" ? null : true
      })
      const outcome = held.outcome!
      if ("refused" in outcome) {
        if (outcome.refused === "PASSWORD_NOT_SET") {
          throw new ApiTokenError("PASSWORD_INVALID", PASSWORD_NOT_SET_MESSAGE)
        }
        throw new ApiTokenError(outcome.refused, REFUSAL_MESSAGES[outcome.refused])
      }
      return { token: outcome.created, secret }
    },

    async revoke(c, userId, tokenId) {
      return await db.apiTokens.revoke({ userId, tokenId }, "owner", requestOf(c)) > 0
    },

    async authenticate(c, presented) {
      if (presented === undefined) return null
      const hash = await hashApiToken(presented, key)
      if (hash === null) return null
      const found = await db.apiTokens.find(hash)
      if (!found) return null
      const { token } = found
      if (found.refused) {
        await auditRefusal(c, token.id, found.refused)
        return null
      }
      try {
        await db.begin(async (tx) => {
          if (await tx.apiTokens.touch(token.id, now())) {
            await tx.apiTokens.audit(
              token.id,
              AuthAuditEventType.API_TOKEN_USED,
              null,
              requestOf(c),
            )
          }
        })
      } catch (error) {
        // The time shown and the audit of use are records, never a reason to refuse the request.
        logError("error: cannot record that an API token was used", error)
      }
      return token
    },

    auditRefusal,
  }
}

/**
 * Where a token action came from, for its `auth_audits` row. The address is read as the sign-in's
 * rows read it, trusting `X-Forwarded-For` and `X-Real-IP` from the proxy in front of the API.
 */
export function requestOf(c: Context): ApiTokenAuditRequest {
  const request = requestInfoFromContext(c, { trustedProxy: true })
  return { ip: request.ip || null, userAgent: request.userAgent || null }
}
