/**
 * The operator area's reads and writes over `users`, `auth_keys`, `group_members` and
 * `auth_audits` (#146): the searchable user list, one person's detail, blocking, setting a role, the reset address and the CSV export.
 * Who may call them is the API's business (`apps/api/routes/admin/users.ts`); nothing here checks it.
 *
 * Reads no environment and imports no singleton: the API and the role script both use it.
 *
 * @module
 */

import type postgres from "postgres"
import type { SortRule } from "@spy4x/platform/universal/sort"
import {
  ADMIN_AUDIT_LIMIT,
  ADMIN_DEFAULT_SORT,
  type AdminAuditRow,
  type AdminSignInMethod,
  type AdminUserFilter,
  type AdminUserGroup,
  type AdminUserPreferences,
  type AdminUserRow,
  type AdminUserSortKey,
  AuthAuditEventType,
  SIGN_IN_LINK_METHOD,
  USER_ROLE_NAMES,
  type UserRole,
} from "@domain/identity"
import { likeContains } from "@spy4x/server/db"
import { readAdminPreferences } from "./preferences.ts"

/** The password method's name in `auth_keys`, as `@spy4x/server/auth/password` stores it. */
const PASSWORD_METHOD = "password"

/** One row as Postgres returns it, before its dates become strings. */
interface UserRowRaw {
  id: number
  firstName: string | null
  lastName: string | null
  email: string | null
  role: UserRole
  blockedAt: Date | null
  createdAt: Date
  lastSeenAt: Date | null
  guestSince: Date | null
  pictureId: string | null
}

/**
 * The columns of {@link AdminUserRow}. The address is the one the person signs in with: the
 * password key's (its subject, which is the username of an older account), or else the first
 * address any key holds.
 */
function userColumns(sql: postgres.Sql) {
  return sql`
    u.id, u.first_name, u.last_name, u.role, u.blocked_at, u.created_at, u.last_seen_at,
    u.guest_since, u.picture_id,
    (
      SELECT COALESCE(k.email, CASE WHEN k.method = ${PASSWORD_METHOD} THEN k.subject END)
      FROM auth_keys k
      WHERE k.user_id = u.id
      ORDER BY (k.method = ${PASSWORD_METHOD}) DESC, k.email IS NULL, k.id
      LIMIT 1
    ) AS email
  `
}

function toRow(row: UserRowRaw): AdminUserRow {
  return {
    id: row.id,
    firstName: row.firstName ?? "",
    lastName: row.lastName ?? "",
    email: row.email,
    role: row.role,
    blockedAt: row.blockedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    guestSince: row.guestSince?.toISOString() ?? null,
    pictureId: row.pictureId,
  }
}

/**
 * The `ORDER BY` of one sort key and direction. Only these fragments ever reach the query: the key
 * and direction come from the page's address, so neither is ever written into the SQL as text.
 */
function sortColumn(sql: postgres.Sql, rule: SortRule<AdminUserSortKey>) {
  const desc = rule.direction === "desc"
  switch (rule.key) {
    case "name":
      return desc
        ? sql`lower(concat_ws(' ', u.first_name, u.last_name)) DESC`
        : sql`lower(concat_ws(' ', u.first_name, u.last_name)) ASC`
    case "role":
      return desc ? sql`u.role DESC` : sql`u.role ASC`
    case "lastSeenAt":
      return desc ? sql`u.last_seen_at DESC NULLS LAST` : sql`u.last_seen_at ASC NULLS LAST`
    case "createdAt":
      return desc ? sql`u.created_at DESC` : sql`u.created_at ASC`
  }
}

/**
 * The list's `ORDER BY`: each rule of `sort` in turn (newest first when it has none), then the id
 * in the direction of the first rule, so equal values keep one order from page to page.
 */
function orderBy(sql: postgres.Sql, sort: readonly SortRule<AdminUserSortKey>[]) {
  const rules = sort.length > 0 ? sort : ADMIN_DEFAULT_SORT
  let clause = sortColumn(sql, rules[0])
  for (const rule of rules.slice(1)) clause = sql`${clause}, ${sortColumn(sql, rule)}`
  return rules[0].direction === "desc" ? sql`${clause}, u.id DESC` : sql`${clause}, u.id ASC`
}

/**
 * The `WHERE` of the people `filter` matches who are not deleted. Each word of `filter.query` must
 * appear, in any case, in the first name, the last name, an address a key holds or the password
 * key's subject. The page and the sort play no part.
 */
function userWhere(sql: postgres.Sql, filter: AdminUserFilter) {
  let where = sql`u.deleted_at IS NULL`
  for (const word of filter.query.split(/\s+/).filter(Boolean)) {
    const pattern = likeContains(word)
    where = sql`${where} AND (
      u.first_name ILIKE ${pattern} OR u.last_name ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM auth_keys k
        WHERE k.user_id = u.id
          AND (k.email ILIKE ${pattern} OR (k.method = ${PASSWORD_METHOD} AND k.subject ILIKE ${pattern}))
      )
    )`
  }
  if (filter.role !== null) where = sql`${where} AND u.role = ${filter.role}`
  if (filter.blocked === "blocked") where = sql`${where} AND u.blocked_at IS NOT NULL`
  if (filter.blocked === "active") where = sql`${where} AND u.blocked_at IS NULL`
  if (filter.account === "guest") where = sql`${where} AND u.guest_since IS NOT NULL`
  if (filter.account === "full") where = sql`${where} AND u.guest_since IS NULL`
  return where
}

/**
 * One page of the people who are not deleted, in the order of `filter.sort` (newest first by
 * default), with how many match in all. Which people match is {@link userWhere}'s.
 */
export async function listAdminUsers(
  sql: postgres.Sql,
  filter: AdminUserFilter,
  pageSize: number,
): Promise<{ users: AdminUserRow[]; total: number }> {
  const where = userWhere(sql, filter)
  const [{ total }] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM users u WHERE ${where}
  `
  const rows = await sql<UserRowRaw[]>`
    SELECT ${userColumns(sql)} FROM users u WHERE ${where}
    ORDER BY ${orderBy(sql, filter.sort)}
    LIMIT ${pageSize} OFFSET ${(filter.page - 1) * pageSize}
  `
  return { users: rows.map(toRow), total }
}

/**
 * Every person `filter` matches, on all its pages, in its sort, `batchSize` rows at a time (#425):
 * the CSV export. A cursor reads them, so the whole list is never in memory at once; stopping the
 * loop early closes the cursor.
 */
export async function* exportAdminUsers(
  sql: postgres.Sql,
  filter: AdminUserFilter,
  batchSize: number,
): AsyncGenerator<AdminUserRow[]> {
  const cursor = sql<UserRowRaw[]>`
    SELECT ${userColumns(sql)} FROM users u WHERE ${userWhere(sql, filter)}
    ORDER BY ${orderBy(sql, filter.sort)}
  `.cursor(batchSize)
  for await (const rows of cursor) yield rows.map(toRow)
}

/** The person `userId` as the list shows them, or `null` when there is none or they are deleted. */
export async function readAdminUser(
  sql: postgres.Sql,
  userId: number,
): Promise<AdminUserRow | null> {
  const [row] = await sql<UserRowRaw[]>`
    SELECT ${userColumns(sql)} FROM users u WHERE u.id = ${userId} AND u.deleted_at IS NULL
  `
  return row ? toRow(row) : null
}

/**
 * What the detail page shows besides the person and their sessions: how they sign in (never a
 * secret), their groups, the newest {@link ADMIN_AUDIT_LIMIT} rows of their audit trail, their
 * display preferences, and when their billing trial was used.
 */
export async function readAdminUserParts(sql: postgres.Sql, userId: number): Promise<{
  methods: AdminSignInMethod[]
  groups: AdminUserGroup[]
  audits: AdminAuditRow[]
  preferences: AdminUserPreferences
  trialUsedAt: string | null
}> {
  const methods = await sql<
    {
      method: string
      email: string | null
      provenAt: Date | null
      createdAt: Date
      passkeyName: string | null
      passkeyLastUsedAt: Date | null
      linkLastUsedAt: Date | null
    }[]
  >`
    SELECT k.method, k.email, k.proven_at, k.created_at,
      p.name AS passkey_name, p.last_used_at AS passkey_last_used_at,
      CASE WHEN k.method = ${SIGN_IN_LINK_METHOD} THEN (
        SELECT max(a.created_at) FROM auth_audits a
        WHERE a.user_id = k.user_id AND a.identifier = ${SIGN_IN_LINK_METHOD}
          AND a.event_type IN (${AuthAuditEventType.SIGNED_IN}, ${AuthAuditEventType.SIGNED_UP})
      ) END AS link_last_used_at
    FROM auth_keys k LEFT JOIN auth_passkeys p ON p.key_id = k.id
    WHERE k.user_id = ${userId} ORDER BY k.id
  `
  const groups = await sql<AdminUserGroup[]>`
    SELECT g.id, g.name, m.role FROM group_members m
    JOIN groups g ON g.id = m.group_id AND g.deleted_at IS NULL
    WHERE m.user_id = ${userId}
    ORDER BY g.name, g.id
  `
  const audits = await sql<
    {
      id: number
      eventType: number
      identifier: string | null
      ip: string | null
      createdAt: Date
    }[]
  >`
    SELECT id, event_type, identifier, ip, created_at FROM auth_audits
    WHERE user_id = ${userId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${ADMIN_AUDIT_LIMIT}
  `
  const preferences = await readAdminPreferences(sql, userId)
  const [trial] = await sql<{ trialUsedAt: Date | null }[]>`
    SELECT trial_used_at FROM users WHERE id = ${userId}
  `
  return {
    preferences,
    trialUsedAt: trial?.trialUsedAt?.toISOString() ?? null,
    methods: methods.map((row) => ({
      method: row.method,
      email: row.email,
      provenAt: row.provenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      passkey: row.passkeyName === null ? undefined : {
        name: row.passkeyName,
        lastUsedAt: row.passkeyLastUsedAt?.toISOString() ?? null,
      },
      ...(row.method === SIGN_IN_LINK_METHOD
        ? { lastUsedAt: row.linkLastUsedAt?.toISOString() ?? null }
        : {}),
    })),
    groups: groups.map((row) => ({ id: row.id, name: row.name, role: row.role })),
    audits: audits.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      identifier: row.identifier,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

/**
 * Locks the live person `userId` until the transaction ends and answers their role and whether
 * they are blocked, or `null` when there is no such live person. Inside a transaction only: an
 * action decides on what it read here, so a role change cannot slip in between.
 */
export async function lockAdminTarget(
  sql: postgres.Sql,
  userId: number,
): Promise<{ role: UserRole; blocked: boolean } | null> {
  const [row] = await sql<{ role: UserRole; blockedAt: Date | null }[]>`
    SELECT role, blocked_at FROM users WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE
  `
  return row ? { role: row.role, blocked: row.blockedAt !== null } : null
}

/** Blocks the person as of `now`, or unblocks them with `null`. */
export async function setUserBlocked(
  sql: postgres.Sql,
  userId: number,
  blockedAt: Date | null,
): Promise<void> {
  await sql`UPDATE users SET blocked_at = ${blockedAt}, updated_at = now() WHERE id = ${userId}`
}

/**
 * Whether the person `userId` is blocked, deleted or not. Sign-in asks before it restores an
 * account waiting to be deleted, so it reads the row whatever its `deleted_at`.
 */
export async function isUserBlocked(sql: postgres.Sql, userId: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM users WHERE id = ${userId} AND blocked_at IS NOT NULL
  `
  return rows.length > 0
}

/** Gives the live person `userId` the role `role`. Inside the action's `begin()`. */
export async function setUserRole(
  sql: postgres.Sql,
  userId: number,
  role: UserRole,
): Promise<void> {
  await sql`UPDATE users SET role = ${role}, updated_at = now() WHERE id = ${userId}`
}

/**
 * The address a password-reset link for `userId` goes to: their password key's, as "Forgot
 * password" looks it up. `null` when they have no password, or only a username with no address
 * (#139), so no link can reach them.
 */
export async function readPasswordResetAddress(
  sql: postgres.Sql,
  userId: number,
): Promise<string | null> {
  const [row] = await sql<{ subject: string }[]>`
    SELECT subject FROM auth_keys
    WHERE user_id = ${userId} AND method = ${PASSWORD_METHOD} AND email IS NOT NULL
  `
  return row?.subject ?? null
}

/**
 * The `identifier` of a role change's audit row: who changed it and both roles, such as
 * `operator:7 from viewer to operator`.
 */
export function roleChangeIdentifier(actor: string, from: UserRole, to: UserRole): string {
  return `${actor} from ${USER_ROLE_NAMES[from]} to ${USER_ROLE_NAMES[to]}`
}

/**
 * Gives the person who signs in with `address` the role `role` and writes the change's audit row
 * naming `actor`, both in one transaction, and answers their id and the role they had; `null`
 * when no live person signs in with it. A role they already have changes nothing and writes no
 * row. The address is matched as sign-up stores it (trimmed, lower case): first the person who
 * proved it, then the one whose password key names it, which is also how an older account's
 * username is found. `sql` is a pool, not a transaction: this opens its own.
 */
export async function setUserRoleByAddress(
  sql: postgres.Sql,
  address: string,
  role: UserRole,
  actor: string,
): Promise<{ id: number; previous: UserRole } | null> {
  const wanted = address.trim().toLowerCase()
  return await sql.begin(async (tx) => {
    const [row] = await tx<{ id: number; role: UserRole }[]>`
      SELECT id, role FROM users
      WHERE deleted_at IS NULL AND id = (
        SELECT owner.user_id FROM (
          SELECT user_id, 1 AS rank FROM auth_email_owners WHERE email = ${wanted}
          UNION ALL
          SELECT user_id, 2 AS rank FROM auth_keys
          WHERE method = ${PASSWORD_METHOD} AND subject = ${wanted}
        ) owner
        ORDER BY owner.rank
        LIMIT 1
      )
      FOR UPDATE
    `
    if (!row) return null
    if (row.role !== role) {
      await tx`UPDATE users SET role = ${role}, updated_at = now() WHERE id = ${row.id}`
      await tx`
        INSERT INTO auth_audits (user_id, event_type, identifier)
        VALUES (${row.id}, ${AuthAuditEventType.USER_ROLE_CHANGED},
          ${roleChangeIdentifier(actor, row.role, role)})
      `
    }
    return { id: row.id, previous: row.role }
  }) as { id: number; previous: UserRole } | null
}
