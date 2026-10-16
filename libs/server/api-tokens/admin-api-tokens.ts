/**
 * The operator area's reads over `api_tokens` (#427): every token across people, one person's
 * tokens, and whose a token is. Who may call them is the API's business
 * (`apps/api/routes/admin/api-tokens.ts`); nothing here checks it. Revoking goes through
 * `ApiTokenRows.revoke` (`./api-tokens.ts`), the statement the owner's own revoke uses, so the token
 * and its audit row change together.
 *
 * Every statement names its columns: `token_hash` is never read, so no answer built from these rows
 * can carry it.
 *
 * Reads no environment and imports no singleton.
 *
 * @module
 */

import type postgres from "postgres"
import {
  type AdminApiToken,
  type AdminApiTokenCounts,
  type AdminApiTokenFilter,
  type AdminApiTokenState,
  ApiTokenAccess,
} from "@domain/api-tokens"

/** The password method's name in `auth_keys`, as `@spy4x/server/auth/password` stores it. */
const PASSWORD_METHOD = "password"

/** One row as Postgres returns it, before its dates become strings. */
interface AdminApiTokenRaw {
  id: string
  name: string
  groupId: string
  groupName: string | null
  access: number
  state: AdminApiTokenState
  createdAt: Date
  expiresAt: Date | null
  lastUsedAt: Date | null
  revokedAt: Date | null
  ownerId: number
  firstName: string | null
  lastName: string | null
  email: string | null
}

/**
 * A token's state at `now`: revoked first, then expired, else live. The same order
 * `ApiTokenRows.find` refuses a token in.
 */
function stateOf(sql: postgres.Sql, now: Date) {
  return sql`
    CASE
      WHEN t.revoked_at IS NOT NULL THEN 'revoked'
      WHEN t.expires_at IS NOT NULL AND t.expires_at <= ${now} THEN 'expired'
      ELSE 'live'
    END
  `
}

/** Only the tokens in `state` at `now`, or every token for `null`. */
function stateWhere(sql: postgres.Sql, state: AdminApiTokenState | null, now: Date) {
  switch (state) {
    case "revoked":
      return sql`t.revoked_at IS NOT NULL`
    case "expired":
      return sql`t.revoked_at IS NULL AND t.expires_at IS NOT NULL AND t.expires_at <= ${now}`
    case "live":
      return sql`t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > ${now})`
    case null:
      return sql`TRUE`
  }
}

/**
 * The columns of {@link AdminApiToken}, over `api_tokens t` joined to its owner `u` and, when it
 * still exists, its group `g`. The owner's address is the one they sign in with, picked as the
 * people list picks it (`@server/auth/admin-users.ts`).
 */
function tokenColumns(sql: postgres.Sql, now: Date) {
  return sql`
    t.id, t.name, t.group_id, g.name AS group_name, t.access, ${stateOf(sql, now)} AS state,
    t.created_at, t.expires_at, t.last_used_at, t.revoked_at,
    u.id AS owner_id, u.first_name, u.last_name,
    (
      SELECT COALESCE(k.email, CASE WHEN k.method = ${PASSWORD_METHOD} THEN k.subject END)
      FROM auth_keys k
      WHERE k.user_id = u.id
      ORDER BY (k.method = ${PASSWORD_METHOD}) DESC, k.email IS NULL, k.id
      LIMIT 1
    ) AS email
  `
}

/** The tokens of live people, with their owner and group. */
function tokensFrom(sql: postgres.Sql) {
  return sql`
    api_tokens t
    INNER JOIN users u ON u.id = t.user_id AND u.deleted_at IS NULL
    LEFT JOIN groups g ON g.id = t.group_id
  `
}

function toToken(row: AdminApiTokenRaw): AdminApiToken {
  return {
    id: row.id,
    name: row.name,
    groupId: row.groupId,
    groupName: row.groupName,
    access: row.access === ApiTokenAccess.WRITE ? ApiTokenAccess.WRITE : ApiTokenAccess.READ,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    owner: {
      id: row.ownerId,
      firstName: row.firstName ?? "",
      lastName: row.lastName ?? "",
      email: row.email,
    },
  }
}

/**
 * One page of every live person's tokens in `filter.state` at `now`, newest first, with how many
 * match and how many there are of each state.
 */
export async function listAdminApiTokens(
  sql: postgres.Sql,
  filter: AdminApiTokenFilter,
  pageSize: number,
  now: Date,
): Promise<{ tokens: AdminApiToken[]; total: number; counts: AdminApiTokenCounts }> {
  const [counts] = await sql<AdminApiTokenCounts[]>`
    SELECT
      count(*) FILTER (WHERE ${stateWhere(sql, "live", now)})::int AS live,
      count(*) FILTER (WHERE ${stateWhere(sql, "expired", now)})::int AS expired,
      count(*) FILTER (WHERE ${stateWhere(sql, "revoked", now)})::int AS revoked
    FROM ${tokensFrom(sql)}
  `
  const rows = await sql<AdminApiTokenRaw[]>`
    SELECT ${tokenColumns(sql, now)}
    FROM ${tokensFrom(sql)}
    WHERE ${stateWhere(sql, filter.state, now)}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${pageSize} OFFSET ${(filter.page - 1) * pageSize}
  `
  const total = filter.state === null
    ? counts.live + counts.expired + counts.revoked
    : counts[filter.state]
  return {
    tokens: rows.map(toToken),
    total,
    counts: { live: counts.live, expired: counts.expired, revoked: counts.revoked },
  }
}

/**
 * The newest `limit` tokens of the person `userId` at `now`, revoked and expired ones among them
 * until the worker purges them. Empty for someone deleted or with no token.
 */
export async function listAdminUserApiTokens(
  sql: postgres.Sql,
  userId: number,
  limit: number,
  now: Date,
): Promise<AdminApiToken[]> {
  const rows = await sql<AdminApiTokenRaw[]>`
    SELECT ${tokenColumns(sql, now)}
    FROM ${tokensFrom(sql)}
    WHERE t.user_id = ${userId}
    ORDER BY t.created_at DESC, t.id DESC
    LIMIT ${limit}
  `
  return rows.map(toToken)
}

/** The id of the person the token `tokenId` belongs to, or `null` when there is no such token. */
export async function readApiTokenOwner(
  sql: postgres.Sql,
  tokenId: string,
): Promise<number | null> {
  const [row] = await sql<{ userId: number }[]>`
    SELECT user_id FROM api_tokens WHERE id = ${tokenId}
  `
  return row?.userId ?? null
}
