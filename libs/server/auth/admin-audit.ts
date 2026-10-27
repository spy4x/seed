/**
 * The operator area's audit log (#429): `auth_audits` and `audit_events` as one list, newest first,
 * paged by a keyset so a page never shifts when new entries arrive. Who may call this is the API's
 * business (`apps/api/routes/admin/audit.ts`); nothing here checks it.
 *
 * Never reads `audit_events.details`, but for two facts of the operator's own entries: a job's kind,
 * and the name of a file an operator opened or downloaded (#478). Any other group entry's details
 * can hold a note's title or a tag's name, and the operator area shows no content.
 *
 * @module
 */

import type postgres from "postgres"
import {
  accountAuditEvent,
  activityAuditEvent,
  ADMIN_AUDIT_EXPORTED_KIND,
  ADMIN_FILE_AUDIT_KINDS,
  ADMIN_JOB_AUDIT_KINDS,
  ADMIN_OPERATOR_ACTIVITY_KINDS,
  type AdminAuditEntry,
  type AdminAuditFilter,
  type AdminAuditOperator,
  type AdminAuditPerson,
  type AdminAuditSource,
  parseAuditEvent,
  UserRole,
} from "@domain/identity"
import { BILLING_AUDIT_EVENT_TYPES } from "@domain/billing"
import { likeContains } from "@spy4x/server/db"

/** The password method's name in `auth_keys`, as `@spy4x/server/auth/password` stores it. */
const PASSWORD_METHOD = "password"

/**
 * The `identifier` an operator's action leaves on the person's row, as the API writes it:
 * `operator:<id>`, alone or followed by a space and a note such as `from viewer to operator`,
 * `session 5` or `q=ada`.
 */
const OPERATOR_IDENTIFIER = /^operator:([1-9]\d{0,9})(?: (.*))?$/s

/**
 * The group a billing row is about, from the start of its identifier (`billingAuditIdentifier` in
 * `@domain/billing`), as a POSIX pattern for Postgres. Only the shape of a UUID is taken, so the cast
 * that follows never fails on a row written by hand.
 */
const BILLING_GROUP_PATTERN =
  `^group:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) `

/** Whether an account row is a billing action, which the operator writes on their own row. */
function isBillingRow(row: Pick<EntryRaw, "source" | "eventType">): boolean {
  return row.source === "account" && row.eventType !== null &&
    (BILLING_AUDIT_EVENT_TYPES as readonly number[]).includes(row.eventType)
}

/**
 * Where the next page starts: after this entry. `at` is the entry's time to the microsecond, as
 * Postgres keeps it, so two entries in the same millisecond are never skipped or shown twice.
 */
export interface AdminAuditPageKey {
  at: string
  source: AdminAuditSource
  /** The row's id within its table, in decimal. */
  id: string
}

/** One row of the union as Postgres returns it. */
interface EntryRaw {
  source: AdminAuditSource
  id: string
  createdAt: Date
  atKey: string
  eventType: number | null
  kind: string | null
  identifier: string | null
  ip: string | null
  userAgent: string | null
  personId: number | null
  actorId: number | null
  groupId: string | null
  groupName: string | null
  entityType: string | null
  jobKind: string | null
  fileName: string | null
}

/** The time of an entry as the page key carries it: UTC, to the microsecond. */
function atKey(sql: postgres.Sql, column: string) {
  return sql`to_char(${sql(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
}

/** The largest id a `users` row can have: the column is `int4`. */
const MAX_PERSON_ID = 2_147_483_647

/**
 * The ids of the people whose first name, last name, an address a key holds or the password key's
 * subject contains every word of `query`, as the people list matches them; or the one id `query`
 * is when it is a number a person's id can be. A longer number is searched for as a word, like
 * any other text, so it never reaches Postgres as an `int4` it cannot hold.
 */
function personIds(sql: postgres.Sql, query: string) {
  if (/^[1-9]\d{0,9}$/.test(query) && Number(query) <= MAX_PERSON_ID) {
    return sql`SELECT ${Number(query)}::int4 AS id`
  }
  let where = sql`TRUE`
  for (const word of query.split(/\s+/).filter(Boolean)) {
    const pattern = likeContains(word)
    where = sql`${where} AND (
      u.first_name ILIKE ${pattern} OR u.last_name ILIKE ${pattern} OR EXISTS (
        SELECT 1 FROM auth_keys k
        WHERE k.user_id = u.id
          AND (k.email ILIKE ${pattern} OR (k.method = ${PASSWORD_METHOD} AND k.subject ILIKE ${pattern}))
      )
    )`
  }
  return sql`SELECT u.id FROM users u WHERE ${where}`
}

/**
 * The condition that keeps a branch's rows after `key`, in the log's order: newest first, then
 * `activity` before `account` at the same instant, then the higher id first. Each branch holds one
 * source, so the comparison of sources is made here rather than in SQL.
 */
function afterKey(sql: postgres.Sql, source: AdminAuditSource, key: AdminAuditPageKey | null) {
  if (!key) return sql`TRUE`
  // `activity` sorts first; a row of a source that sorts after the key's comes after it at the
  // same instant whatever its id, and one that sorts before it never does.
  if (source === key.source) {
    return sql`(created_at < ${key.at}::timestamptz
      OR (created_at = ${key.at}::timestamptz AND id < ${key.id}::bigint))`
  }
  return source === "account"
    ? sql`created_at <= ${key.at}::timestamptz`
    : sql`created_at < ${key.at}::timestamptz`
}

/** The time window of `filter`: from the start of its first day to the end of its last. */
function timeWindow(sql: postgres.Sql, filter: AdminAuditFilter) {
  let where = sql`TRUE`
  if (filter.from) {
    where = sql`${where} AND created_at >= ${`${filter.from}T00:00:00Z`}::timestamptz`
  }
  if (filter.to) {
    where =
      sql`${where} AND created_at < ${`${filter.to}T00:00:00Z`}::timestamptz + INTERVAL '1 day'`
  }
  return where
}

/** The `auth_audits` branch, or `null` when the filter rules every one of its rows out. */
function accountBranch(
  sql: postgres.Sql,
  filter: AdminAuditFilter,
  key: AdminAuditPageKey | null,
  limit: number,
) {
  const event = parseAuditEvent(filter.event)
  if (event?.source === "activity") return null
  let where = sql`${afterKey(sql, "account", key)} AND ${timeWindow(sql, filter)}`
  if (event?.source === "account") where = sql`${where} AND event_type = ${event.eventType}`
  if (filter.ip) where = sql`${where} AND ip LIKE ${`${filter.ip}%`}`
  if (filter.operator !== null) {
    // `filter.operator` is an int4-checked number, so the mark holds digits only. The literal
    // `LIKE 'operator:%'` lets Postgres read the partial index `idx_auth_audits_operator`, built
    // over exactly those rows; it must stay text in the query, never a parameter.
    const mark = `operator:${filter.operator}`
    // A billing action is on the operator's own row: `user_id` is who acted, and the identifier
    // names the group (`group:<id> …`), so it carries no operator mark.
    where = sql`${where} AND (
      (identifier LIKE 'operator:%'
        AND (identifier = ${mark} OR starts_with(identifier, ${`${mark} `})))
      OR (event_type IN ${sql([...BILLING_AUDIT_EVENT_TYPES])} AND user_id = ${filter.operator})
    )`
  }
  if (filter.person) {
    const people = personIds(sql, filter.person)
    // The person the row is about, or the operator who acted on them.
    where = sql`${where} AND (user_id IN (${people}) OR EXISTS (
      SELECT 1 FROM (${people}) p
      WHERE identifier = 'operator:' || p.id OR starts_with(identifier, 'operator:' || p.id || ' ')
    ))`
  }
  return sql`(
    SELECT 'account' AS source, id::text AS id, created_at, ${atKey(sql, "created_at")} AS at_key,
      event_type, NULL::text AS kind, identifier, ip, user_agent,
      user_id AS person_id, NULL::int4 AS actor_id,
      CASE WHEN event_type IN ${sql([...BILLING_AUDIT_EVENT_TYPES])}
        THEN substring(identifier FROM ${BILLING_GROUP_PATTERN})::uuid END AS group_id,
      NULL::text AS entity_type, NULL::text AS job_kind, NULL::text AS file_name
    FROM auth_audits
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  )`
}

/** The `audit_events` branch, or `null` when the filter rules every one of its rows out. */
function activityBranch(
  sql: postgres.Sql,
  filter: AdminAuditFilter,
  key: AdminAuditPageKey | null,
  limit: number,
) {
  const event = parseAuditEvent(filter.event)
  // Group activity keeps no address: a filter by one finds none of it.
  if (event?.source === "account" || filter.ip) return null
  let where = sql`${afterKey(sql, "activity", key)} AND ${timeWindow(sql, filter)}`
  if (event?.source === "activity") where = sql`${where} AND event_kind = ${event.kind}`
  if (filter.operator !== null) {
    where = sql`${where} AND actor_user_id = ${filter.operator}
      AND event_kind IN ${sql([...ADMIN_OPERATOR_ACTIVITY_KINDS])}`
  }
  if (filter.person) {
    const people = personIds(sql, filter.person)
    where = sql`${where} AND (actor_user_id IN (${people}) OR target_user_id IN (${people}))`
  }
  // Only the job's kind and an opened file's name leave `details`, and only for the operator's own
  // entries: every other entry's details can quote content.
  return sql`(
    SELECT 'activity' AS source, id::text AS id, created_at, ${atKey(sql, "created_at")} AS at_key,
      NULL::int2 AS event_type, event_kind AS kind, NULL::text AS identifier, NULL::text AS ip,
      NULL::text AS user_agent, target_user_id AS person_id, actor_user_id AS actor_id,
      group_id, entity_type,
      CASE WHEN event_kind = ANY(${ADMIN_JOB_AUDIT_KINDS as string[]})
        THEN left(details->>'kind', 64) END AS job_kind,
      CASE WHEN event_kind = ANY(${ADMIN_FILE_AUDIT_KINDS as string[]})
        THEN left(details->>'name', 100) END AS file_name
    FROM audit_events
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  )`
}

/**
 * Up to `limit` entries after `after` (from the newest with `null`) that match `filter`, newest
 * first, and the key of the next page, or `null` when these are the oldest. Each table gives at
 * most `limit + 1` rows in the log's order, so the union never reads past what one page needs.
 */
export async function listAdminAudit(
  sql: postgres.Sql,
  filter: AdminAuditFilter,
  limit: number,
  after: AdminAuditPageKey | null,
): Promise<{ entries: AdminAuditEntry[]; next: AdminAuditPageKey | null }> {
  const branches = [
    accountBranch(sql, filter, after, limit + 1),
    activityBranch(sql, filter, after, limit + 1),
  ].filter((branch) => branch !== null)
  if (branches.length === 0) return { entries: [], next: null }
  const union = branches.length === 2 ? sql`${branches[0]} UNION ALL ${branches[1]}` : branches[0]
  const rows = await sql<EntryRaw[]>`
    WITH page AS (${union})
    SELECT page.*, g.name AS group_name FROM page
    LEFT JOIN groups g ON g.id = page.group_id
    ORDER BY page.created_at DESC, page.source DESC, page.id::bigint DESC
    LIMIT ${limit + 1}
  `
  const shown = rows.slice(0, limit)
  const people = await readPeople(sql, shown)
  const entries = shown.map((row) => toEntry(row, people))
  const last = shown.at(-1)
  return {
    entries,
    next: rows.length > limit && last ? { at: last.atKey, source: last.source, id: last.id } : null,
  }
}

/**
 * The operator who acted, from a person's row, and the rest of its note: `null` unless an
 * operator wrote it.
 */
function operatorOf(
  row: Pick<EntryRaw, "source" | "identifier">,
): { id: number; note: string | null } | null {
  if (row.source !== "account" || !row.identifier) return null
  const match = OPERATOR_IDENTIFIER.exec(row.identifier)
  return match ? { id: Number(match[1]), note: match[2] || null } : null
}

/** Every person `rows` name, by id. */
function readPeople(sql: postgres.Sql, rows: EntryRaw[]): Promise<Map<number, AdminAuditPerson>> {
  const ids = new Set<number>()
  for (const row of rows) {
    if (row.personId !== null) ids.add(row.personId)
    if (row.actorId !== null) ids.add(row.actorId)
    const operator = operatorOf(row)
    if (operator !== null) ids.add(operator.id)
  }
  return readPeopleByIds(sql, [...ids])
}

/**
 * The people `ids` name, deleted or not: their name, or their address when they set none, and the
 * address they sign in with, chosen as the people list chooses it. An id with no row is left out.
 */
async function readPeopleByIds(
  sql: postgres.Sql,
  ids: number[],
): Promise<Map<number, AdminAuditPerson>> {
  if (ids.length === 0) return new Map()
  const found = await sql<
    { id: number; firstName: string | null; lastName: string | null; email: string | null }[]
  >`
    SELECT u.id, u.first_name, u.last_name, (
      SELECT COALESCE(k.email, CASE WHEN k.method = ${PASSWORD_METHOD} THEN k.subject END)
      FROM auth_keys k
      WHERE k.user_id = u.id
      ORDER BY (k.method = ${PASSWORD_METHOD}) DESC, k.email IS NULL, k.id
      LIMIT 1
    ) AS email
    FROM users u WHERE u.id IN ${sql(ids)}
  `
  return new Map(found.map((user) => [user.id, {
    id: user.id,
    name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email || "No name",
    email: user.email,
  }]))
}

function toEntry(row: EntryRaw, people: Map<number, AdminAuditPerson>): AdminAuditEntry {
  const person = row.personId === null ? null : people.get(row.personId) ?? null
  if (isBillingRow(row)) {
    // The operator acted on a group: the group is what the entry is about, and no person is.
    return {
      key: `account-${row.id}`,
      source: "account",
      event: accountAuditEvent(row.eventType ?? 0),
      at: row.createdAt.toISOString(),
      person: null,
      actor: person,
      byOperator: true,
      group: row.groupId && row.groupName ? { id: row.groupId, name: row.groupName } : null,
      identifier: row.identifier,
      ip: row.ip,
      userAgent: row.userAgent,
      jobKind: null,
      fileName: null,
    }
  }
  if (row.source === "account") {
    const operator = operatorOf(row)
    return {
      key: `account-${row.id}`,
      source: "account",
      event: accountAuditEvent(row.eventType ?? 0),
      at: row.createdAt.toISOString(),
      person,
      // A person's own row: they did it. An operator's row names the operator instead.
      actor: operator === null ? person : people.get(operator.id) ?? null,
      byOperator: operator !== null,
      group: null,
      // The operator's mark says who acted, which `actor` already shows; the note after it stays.
      identifier: operator === null ? row.identifier : operator.note,
      ip: row.ip,
      userAgent: row.userAgent,
      jobKind: null,
      fileName: null,
    }
  }
  const kind = row.kind ?? ""
  return {
    key: `activity-${row.id}`,
    source: "activity",
    event: activityAuditEvent(kind),
    at: row.createdAt.toISOString(),
    person,
    actor: row.actorId === null ? null : people.get(row.actorId) ?? null,
    byOperator: ADMIN_OPERATOR_ACTIVITY_KINDS.includes(kind),
    group: row.groupId && row.groupName ? { id: row.groupId, name: row.groupName } : null,
    identifier: null,
    ip: null,
    userAgent: null,
    jobKind: row.jobKind,
    fileName: row.fileName,
  }
}

/** Everyone with the operator role or above who is not deleted, by name, for the operator filter. */
export async function listAdminAuditOperators(sql: postgres.Sql): Promise<AdminAuditOperator[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM users WHERE role >= ${UserRole.OPERATOR} AND deleted_at IS NULL ORDER BY id
  `
  const people = await readPeopleByIds(sql, rows.map((row) => row.id))
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
}

/**
 * Records that the operator downloaded `rows` entries of the log as a file: the file holds
 * addresses and devices, so who took one stays on the record.
 */
export async function recordAuditExport(
  sql: postgres.Sql,
  operatorId: number,
  rows: number,
  requestId: string | null,
): Promise<void> {
  await sql`
    INSERT INTO audit_events (event_kind, actor_user_id, request_id, details)
    VALUES (${ADMIN_AUDIT_EXPORTED_KIND}, ${operatorId}, ${requestId}, ${sql.json({ rows })})
  `
}
