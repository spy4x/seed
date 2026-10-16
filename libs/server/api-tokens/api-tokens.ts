/**
 * Personal API tokens (#167) over the `api_tokens` table. The table holds a keyed hash of each
 * token, never the token: {@link hashApiToken} turns what a client presents into the value to look
 * up, so a database dump gives nobody a working token.
 *
 * Every statement that reads or ends a token for its owner names the user, so a person reaches only
 * their own tokens; someone else's token and a missing one look the same. A token that is revoked,
 * expired or whose owner is gone is refused by {@link ApiTokenRows.find} on the very next request:
 * nothing caches a token.
 *
 * A revoked token keeps its row, marked `revoked_at`, until the worker's purge: it never works
 * again, is not listed and is not counted, but a later request with it can still be tied to its
 * owner and audited (#293).
 *
 * Every `auth_audits` row about a token names it in `identifier` as
 * `<id> group=<group id> access=<read|write>[ reason=<reason>] name=<name>`, written from the
 * token's own row in the statement that changes it. The name comes last because it is free text.
 * The row therefore still says which token it was after the token is gone; it never holds the
 * secret or its hash.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import { newOpaqueToken, sha256Hex } from "@spy4x/platform/tokens"
import {
  API_TOKEN_PREFIX,
  API_TOKENS_MAX,
  type ApiToken,
  ApiTokenAccess,
  isApiTokenFormat,
} from "@domain/api-tokens"
import { AuthAuditEventType, type UserMFAStatus } from "@domain/identity"

/** How stale `last_used_at` may get before a request writes it again: five minutes. */
export const API_TOKEN_USE_RESOLUTION_MS = 5 * 60_000

/**
 * A new token: `secret` goes to the person once, `hash` is what the table keeps. `secret` is
 * {@link API_TOKEN_PREFIX} followed by the 128 random bits `newOpaqueToken` mints, and `hash` is
 * that package's `sha256Hex(raw + key)`. `key` must be at least 32 characters.
 */
export async function mintApiToken(key: string): Promise<{ secret: string; hash: string }> {
  const { raw, hash } = await newOpaqueToken(key)
  return { secret: `${API_TOKEN_PREFIX}${raw}`, hash }
}

/**
 * The value `api_tokens.token_hash` holds for `secret`: the hash {@link mintApiToken} stored, as
 * lower-case hex. Without the key, a stolen hash cannot be checked against a guess offline. `null`
 * when `secret` does not have a token's shape, so a malformed header never reaches the database.
 */
export async function hashApiToken(secret: string, key: string): Promise<string | null> {
  if (!isApiTokenFormat(secret)) return null
  return await sha256Hex(`${secret.slice(API_TOKEN_PREFIX.length)}${key}`)
}

/** Why a token was revoked, as its audit row says it. */
export type ApiTokenRevokeReason =
  /** Its owner revoked it on the profile page. */
  | "owner"
  /** Its owner changed the password. */
  | "password-change"
  /** Its owner reset a forgotten password. */
  | "password-reset"
  /** Its owner left the group or was removed from it. */
  | "membership-ended"
  /** The group was deleted. */
  | "group-deleted"
  /** An operator revoked it in the operator area (#427); names the operator, as `operator:7`. */
  | `operator:${number}`

/** Why a request with a token was refused, as its audit row says it. */
export type ApiTokenRefusalReason =
  /** The token was revoked. */
  | "revoked"
  /** The token expired. */
  | "expired"
  /** The token is live but may not do this: another group, a write, another API. */
  | "scope"

/**
 * Which tokens a revoke ends: one token of a person, every token of a person, a person's tokens in
 * one group, or every token of a group.
 */
export type ApiTokenRevokeScope =
  | { userId: number; tokenId?: string; groupId?: string }
  | { groupId: string }

/** Where an audited token action came from. Both are cut to their column width. */
export interface ApiTokenAuditRequest {
  ip: string | null
  userAgent: string | null
}

/** A token a request presented, and why it may not act now, if it may not. */
export interface FoundApiToken {
  token: LiveApiToken
  refused: Exclude<ApiTokenRefusalReason, "scope"> | null
}

/** A token that may act now, with what its request needs to know about its owner. */
export interface LiveApiToken {
  id: string
  userId: number
  userMfa: UserMFAStatus
  groupId: string
  access: ApiTokenAccess
}

/** What {@link ApiTokenRows.create} did. */
export type ApiTokenCreateOutcome =
  | { created: ApiToken }
  /** The person is not a member of the group, or the group is deleted. */
  | { refused: "GROUP_NOT_FOUND" }
  /** The person holds {@link API_TOKENS_MAX} live tokens already. */
  | { refused: "TOO_MANY_TOKENS" }

/** The fields a new token row is written with. */
export interface ApiTokenRowInput {
  id: string
  userId: number
  groupId: string
  name: string
  hash: string
  access: ApiTokenAccess
  expiresAt: Date | null
}

interface ApiTokenRow {
  id: string
  name: string
  groupId: string
  groupName: string
  access: number
  createdAt: Date
  expiresAt: Date | null
  lastUsedAt: Date | null
}

/** The operations on `api_tokens`, bound to one client or transaction. */
export interface ApiTokenRows {
  /**
   * Writes a token for `input.userId` in `input.groupId`, unless the person is not a member of a
   * live group there or already holds {@link API_TOKENS_MAX} live tokens. Run it inside a
   * transaction: it locks the person's `users` row, so two creates cannot both take the last slot.
   */
  create(input: ApiTokenRowInput): Promise<ApiTokenCreateOutcome>
  /** The person's live tokens: not revoked, not expired, in a live group, newest first. */
  listLive(userId: number): Promise<ApiToken[]>
  /**
   * Revokes every token in `scope` that is not revoked yet and writes one
   * {@link AuthAuditEventType.API_TOKEN_REVOKED} row per token for its owner, naming the token and
   * `reason`, in one statement: both are kept or neither is. Answers how many it revoked, so 0 for
   * another person's token or a missing one.
   */
  revoke(
    scope: ApiTokenRevokeScope,
    reason: ApiTokenRevokeReason,
    request?: ApiTokenAuditRequest,
  ): Promise<number>
  /**
   * The token whose hash is `hash`, when its owner's account is live and not blocked (#146); a
   * blocked owner's token answers as no token does, and works again once they are unblocked.
   * `refused` says why it may not act now, when it was revoked or has expired. `null` for a hash
   * no token has. Membership of the group is not checked here: the handlers check the owner's role
   * on every message, as they do for a session.
   */
  find(hash: string): Promise<FoundApiToken | null>
  /**
   * Writes one `auth_audits` row of `eventType` for the owner of token `tokenId`, naming the token
   * from its row, with `reason` when there is one. Writes nothing when the row is gone.
   */
  audit(
    tokenId: string,
    eventType: AuthAuditEventType,
    reason: ApiTokenRefusalReason | null,
    request?: ApiTokenAuditRequest,
  ): Promise<void>
  /**
   * Records that token `tokenId` was used at `now`, unless that was already recorded within
   * {@link API_TOKEN_USE_RESOLUTION_MS}. `true` when it wrote, which is when the use is audited.
   */
  touch(tokenId: string, now?: Date): Promise<boolean>
}

/** Binds the token operations to `sql`, a client or a transaction. */
export function apiTokenRows(sql: postgres.Sql): ApiTokenRows {
  return {
    async create(input) {
      await sql`SELECT 1 FROM users WHERE id = ${input.userId} FOR UPDATE`
      const [member] = await sql`
        SELECT 1 FROM group_members
        INNER JOIN groups ON groups.id = group_members.group_id AND groups.deleted_at IS NULL
        WHERE group_members.group_id = ${input.groupId} AND group_members.user_id = ${input.userId}
      `
      if (!member) return { refused: "GROUP_NOT_FOUND" }
      // The same set `listLive` shows: a revoked or expired token, or one of a deleted group, is
      // neither listed nor counted.
      const [{ count }] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM api_tokens
        INNER JOIN groups ON groups.id = api_tokens.group_id AND groups.deleted_at IS NULL
        WHERE api_tokens.user_id = ${input.userId}
          AND api_tokens.revoked_at IS NULL
          AND (api_tokens.expires_at IS NULL OR api_tokens.expires_at > now())
      `
      if (count >= API_TOKENS_MAX) return { refused: "TOO_MANY_TOKENS" }
      const [row] = await sql<ApiTokenRow[]>`
        WITH inserted AS (
          INSERT INTO api_tokens (id, user_id, group_id, name, token_hash, access, expires_at)
          VALUES (${input.id}, ${input.userId}, ${input.groupId}, ${input.name}, ${input.hash},
            ${input.access}, ${input.expiresAt})
          RETURNING *
        )
        SELECT inserted.id, inserted.name, inserted.group_id, groups.name AS group_name,
          inserted.access, inserted.created_at, inserted.expires_at, inserted.last_used_at
        FROM inserted INNER JOIN groups ON groups.id = inserted.group_id
      `
      return { created: toApiToken(row) }
    },

    async listLive(userId) {
      const rows = await sql<ApiTokenRow[]>`
        SELECT api_tokens.id, api_tokens.name, api_tokens.group_id, groups.name AS group_name,
          api_tokens.access, api_tokens.created_at, api_tokens.expires_at, api_tokens.last_used_at
        FROM api_tokens
        INNER JOIN groups ON groups.id = api_tokens.group_id AND groups.deleted_at IS NULL
        WHERE api_tokens.user_id = ${userId}
          AND api_tokens.revoked_at IS NULL
          AND (api_tokens.expires_at IS NULL OR api_tokens.expires_at > now())
        ORDER BY api_tokens.created_at DESC, api_tokens.id
      `
      return rows.map(toApiToken)
    },

    async revoke(scope, reason, request) {
      const userId = "userId" in scope ? scope.userId : null
      const tokenId = "tokenId" in scope ? scope.tokenId ?? null : null
      const groupId = scope.groupId ?? null
      // Never every token there is: a scope names a person or a group.
      if (userId === null && groupId === null) throw new TypeError("A revoke needs a scope")
      const { ip, userAgent } = auditRequest(request)
      const [{ count }] = await sql<{ count: number }[]>`
        WITH revoked AS (
          UPDATE api_tokens SET revoked_at = now()
          WHERE revoked_at IS NULL
            AND (${userId}::int IS NULL OR user_id = ${userId})
            AND (${tokenId}::uuid IS NULL OR id = ${tokenId})
            AND (${groupId}::uuid IS NULL OR group_id = ${groupId})
          RETURNING id, user_id, group_id, access, name
        ),
        audited AS (
          INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent)
          SELECT user_id, ${AuthAuditEventType.API_TOKEN_REVOKED}, ${
        apiTokenAuditIdentifier(sql, reason)
      },
            ${ip}, ${userAgent}
          FROM revoked
        )
        SELECT count(*)::int AS count FROM revoked
      `
      return count
    },

    async find(hash) {
      const [row] = await sql<(LiveApiToken & { refused: FoundApiToken["refused"] })[]>`
        SELECT api_tokens.id, api_tokens.user_id, users.mfa AS user_mfa, api_tokens.group_id,
          api_tokens.access,
          CASE
            WHEN api_tokens.revoked_at IS NOT NULL THEN 'revoked'
            WHEN api_tokens.expires_at <= now() THEN 'expired'
          END AS refused
        FROM api_tokens
        INNER JOIN users ON users.id = api_tokens.user_id AND users.deleted_at IS NULL
          AND users.blocked_at IS NULL
        WHERE api_tokens.token_hash = ${hash}
      `
      return row
        ? {
          token: {
            id: row.id,
            userId: row.userId,
            userMfa: row.userMfa,
            groupId: row.groupId,
            access: row.access,
          },
          refused: row.refused,
        }
        : null
    },

    async audit(tokenId, eventType, reason, request) {
      const { ip, userAgent } = auditRequest(request)
      await sql`
        INSERT INTO auth_audits (user_id, event_type, identifier, ip, user_agent)
        SELECT user_id, ${eventType}, ${apiTokenAuditIdentifier(sql, reason)}, ${ip}, ${userAgent}
        FROM api_tokens
        WHERE id = ${tokenId}
      `
    },

    async touch(tokenId, now = new Date()) {
      const rows = await sql`
        UPDATE api_tokens SET last_used_at = ${now}
        WHERE id = ${tokenId}
          AND (last_used_at IS NULL
            OR last_used_at <= ${new Date(now.getTime() - API_TOKEN_USE_RESOLUTION_MS)})
        RETURNING id
      `
      return rows.length > 0
    },
  }
}

/**
 * The SQL expression of a token audit row's `identifier`, over the columns of one `api_tokens` row:
 * `<id> group=<group id> access=<read|write>[ reason=<reason>] name=<name>`. At most 190
 * characters, inside the column's 320.
 */
export function apiTokenAuditIdentifier(
  sql: postgres.Sql,
  reason: ApiTokenRevokeReason | ApiTokenRefusalReason | null,
): postgres.PendingQuery<postgres.Row[]> {
  const reasonPart = reason === null ? "" : ` reason=${reason}`
  return sql`
    id::text || ' group=' || group_id::text
      || ' access=' || CASE access WHEN ${ApiTokenAccess.WRITE} THEN 'write' ELSE 'read' END
      || ${reasonPart}::text || ' name=' || name
  `
}

/** The client sends both values, so a long header must never fail the action the row records. */
function auditRequest(request?: ApiTokenAuditRequest): ApiTokenAuditRequest {
  return {
    ip: request?.ip?.slice(0, 45) || null,
    userAgent: request?.userAgent?.slice(0, 300) || null,
  }
}

function toApiToken(row: ApiTokenRow): ApiToken {
  return {
    id: row.id,
    name: row.name,
    groupId: row.groupId,
    groupName: row.groupName,
    access: row.access === ApiTokenAccess.WRITE ? ApiTokenAccess.WRITE : ApiTokenAccess.READ,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}
