/**
 * The operator area's reads and writes over `users`, `auth_keys`, `group_members` and
 * `auth_audits` (#146): the searchable user list, one person's detail, blocking and setting a role.
 * Who may call them is the API's business (`apps/api/routes/admin.ts`); nothing here checks it.
 *
 * Reads no environment and imports no singleton: the API and the role script both use it.
 *
 * @module
 */

import type postgres from "postgres"
import {
  ADMIN_AUDIT_LIMIT,
  type AdminAuditRow,
  type AdminSignInMethod,
  type AdminUserFilter,
  type AdminUserGroup,
  type AdminUserRow,
  type UserRole,
} from "@domain/identity"

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
}

/** `value` with `\`, `%` and `_` escaped, inside `%…%`: a pattern that matches it literally. */
export function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/**
 * The columns of {@link AdminUserRow}. The address is the one the person signs in with: the
 * password key's (its subject, which is the username of an older account), or else the first
 * address any key holds.
 */
function userColumns(sql: postgres.Sql) {
  return sql`
    u.id, u.first_name, u.last_name, u.role, u.blocked_at, u.created_at, u.last_seen_at,
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
  }
}

/**
 * One page of the people who are not deleted, newest first, with how many match in all. Each word
 * of `filter.query` must appear, in any case, in the first name, the last name, an address a key
 * holds or the password key's subject.
 */
export async function listAdminUsers(
  sql: postgres.Sql,
  filter: AdminUserFilter,
  pageSize: number,
): Promise<{ users: AdminUserRow[]; total: number }> {
  let where = sql`u.deleted_at IS NULL`
  for (const word of filter.query.split(/\s+/).filter(Boolean)) {
    const pattern = containsPattern(word)
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
  const [{ total }] = await sql<{ total: number }[]>`
    SELECT COUNT(*)::int AS total FROM users u WHERE ${where}
  `
  const rows = await sql<UserRowRaw[]>`
    SELECT ${userColumns(sql)} FROM users u WHERE ${where}
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT ${pageSize} OFFSET ${(filter.page - 1) * pageSize}
  `
  return { users: rows.map(toRow), total }
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
 * secret), their groups, and the newest {@link ADMIN_AUDIT_LIMIT} rows of their audit trail.
 */
export async function readAdminUserParts(sql: postgres.Sql, userId: number): Promise<{
  methods: AdminSignInMethod[]
  groups: AdminUserGroup[]
  audits: AdminAuditRow[]
}> {
  const methods = await sql<
    { method: string; email: string | null; provenAt: Date | null; createdAt: Date }[]
  >`
    SELECT method, email, proven_at, created_at FROM auth_keys
    WHERE user_id = ${userId} ORDER BY id
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
  return {
    methods: methods.map((row) => ({
      method: row.method,
      email: row.email,
      provenAt: row.provenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
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

/**
 * Gives the person who signs in with `address` the role `role`, and answers their id, or `null`
 * when no live person signs in with it. The address is matched as sign-up stores it (trimmed, lower
 * case): first the person who proved it, then the one whose password key names it, which is also
 * how an older account's username is found.
 */
export async function setUserRoleByAddress(
  sql: postgres.Sql,
  address: string,
  role: UserRole,
): Promise<number | null> {
  const wanted = address.trim().toLowerCase()
  const [row] = await sql<{ id: number }[]>`
    UPDATE users SET role = ${role}, updated_at = now()
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
    RETURNING id
  `
  return row?.id ?? null
}
